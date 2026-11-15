// On-device "looming" logic: is something in my path getting rapidly bigger (so, closer)? Pure functions and classes with no
// browser dependencies, so they can be tested in Node (tests/test_looming.js). static/spatial.js connects them to the camera.
(function (root) {
  // Approximate real widths (metres) for a rough distance from how wide an object looks.
  const KNOWN_WIDTHS_M = {
    person: 0.5, chair: 0.55, couch: 1.8, "dining table": 1.2, bench: 1.2, car: 1.8, bicycle: 0.6, motorcycle: 0.75,
    bus: 2.5, truck: 2.4, bottle: 0.075, cup: 0.08, laptop: 0.32, "cell phone": 0.075, book: 0.16, backpack: 0.32,
    handbag: 0.28, suitcase: 0.45, "potted plant": 0.35, dog: 0.35, cat: 0.22, "stop sign": 0.75,
  };
  const FOCAL_NORM = 0.85;   // rough focal length in units of image width (depends on the phone's camera; only the distance guess uses it)

  const DEFAULTS = {
    growthMin: 0.35,      // area growth per second that counts as approaching
    growthFast: 0.8,      // area growth per second ~ contact within about 2.5 s (area ~ 1/d^2, so time to contact ~ 2 / growth)
    distUrgentM: 1.1,     // or: close and approaching
    sustainMs: 350,       // the condition must hold this long (filters out box jitter)
    minGapMs: 4000,       // at most one on-device alert this often
    windowMs: 1800,       // growth is measured over this much history
  };

  function distanceMeters(label, normW) {
    if (!(normW > 0.01)) return null;
    const realW = KNOWN_WIDTHS_M[label] || 0.35;
    return Number(((realW * FOCAL_NORM) / normW).toFixed(1));
  }

  // Where is it? Clock position, and whether it is in the walking path (roughly the middle of the picture).
  function zone(cx, cy) {
    const clock = cx < 0.22 ? "10 o'clock" : cx < 0.40 ? "11 o'clock" : cx <= 0.60 ? "12 o'clock" : cx <= 0.78 ? "1 o'clock" : "2 o'clock";
    return { clock, inPath: cx >= 0.28 && cx <= 0.72, elevation: cy < 0.33 ? "upper" : cy < 0.68 ? "mid" : "ground" };
  }

  // Area history of one tracked object. Growth rate compares the MEDIAN of the newest half of the samples with the median of
  // the oldest half. (A mean lets one wrong detection box dominate a half-window for about a second and trigger an alert;
  // a median ignores a single outlier.)
  class RollingBaseline {
    constructor(windowMs = DEFAULTS.windowMs, minSamples = 4) {
      this.windowMs = windowMs; this.minSamples = minSamples; this.samples = [];
    }
    push(value, now) {
      this.samples.push({ value, ts: now });
      const cutoff = now - this.windowMs;
      while (this.samples.length && this.samples[0].ts < cutoff) this.samples.shift();
    }
    get isReady() { return this.samples.length >= this.minSamples; }
    get growthRatePerSec() {
      if (!this.isReady) return 0;
      const mid = Math.floor(this.samples.length / 2);
      const oldHalf = this.samples.slice(0, mid), newHalf = this.samples.slice(mid);
      const median = (a) => { const v = a.map((x) => x.value).sort((p, q) => p - q); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
      const oldMean = median(oldHalf), newMean = median(newHalf);
      // time between the middles of the two halves
      const tOld = (oldHalf[0].ts + oldHalf[oldHalf.length - 1].ts) / 2;
      const tNew = (newHalf[0].ts + newHalf[newHalf.length - 1].ts) / 2;
      const dtSec = (tNew - tOld) / 1000;
      if (dtSec < 0.15 || oldMean <= 0.003) return 0;
      if (newHalf[newHalf.length - 1].value < oldHalf[0].value) return 0;   // must end bigger than it started
      return Math.max(0, (newMean - oldMean) / oldMean / dtSec);
    }
  }

  // Phone motion: turning (panning), walking and tilt, from the phone's gyroscope and accelerometer.
  // walking is true / false / null (unknown). Unknown must never be read as "standing still".
  class ImuState {
    constructor({ panDegS = 65, stableDegS = 50, walkVariance = 0.3, stillVariance = 0.06, windowMs = 800 } = {}) {
      Object.assign(this, { panDegS, stableDegS, walkVariance, stillVariance, windowMs });
      this.angularSpeed = 0; this.panning = false; this.stable = true; this.pitchDeg = null; this.walking = null; this.turnDir = null;
      this._acc = []; this._yaw = [];
    }
    handleMotion(e, now) {
      const r = e && e.rotationRate;
      if (r) {
        const speed = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
        this.angularSpeed = Math.round(speed); this.stable = speed < this.stableDegS; this.panning = speed > this.panDegS;
        const yawRate = r.alpha || 0;
        this._yaw.push({ v: yawRate, ts: now });
        while (this._yaw.length && this._yaw[0].ts < now - 600) this._yaw.shift();
        if (this._yaw.length >= 3) {
          const avgYaw = this._yaw.reduce((s, x) => s + x.v, 0) / this._yaw.length;
          this.turnDir = avgYaw > 14 ? "turning left" : avgYaw < -14 ? "turning right" : "heading straight";
        }
      }
      const a = e && (e.acceleration && e.acceleration.x != null ? e.acceleration : e.accelerationIncludingGravity);
      if (a && a.x != null) {
        this._acc.push({ mag: Math.hypot(a.x || 0, a.y || 0, a.z || 0), ts: now });
        while (this._acc.length && this._acc[0].ts < now - this.windowMs) this._acc.shift();
        if (this._acc.length >= 6) {
          const mean = this._acc.reduce((s, x) => s + x.mag, 0) / this._acc.length;
          const variance = this._acc.reduce((s, x) => s + (x.mag - mean) ** 2, 0) / this._acc.length;
          // Three answers, biased so that a wrong guess never hides an alert: clearly shaking = walking, clearly still = stationary,
          // anything in between = unknown (the server then treats the user as possibly moving). Thresholds are not yet tuned on real phones.
          this.walking = variance > this.walkVariance ? true : variance < this.stillVariance ? false : null;
        }
      }
    }
    handleOrientation(e) { if (e && e.beta != null) this.pitchDeg = Math.round(e.beta); }
    snapshot() {
      const snap = { angularSpeed: this.angularSpeed, panning: this.panning, walking: this.walking, pitchDeg: this.pitchDeg };
      if (this.turnDir) snap.turnDir = this.turnDir;
      return snap;
    }
  }

  // Follows what the detector sees and says when something in the path is rapidly approaching.
  class LoomingTracker {
    constructor(options = {}) {
      this.o = Object.assign({}, DEFAULTS, options);
      this.baselines = new Map(); this.sustainedSince = new Map(); this.lastAlertAt = -Infinity;
    }
    reset() { this.baselines.clear(); this.sustainedSince.clear(); }
    // detections: [{label, cx, cy, normW, normH}] in 0..1 picture coordinates. Returns {objects, hazard|null}.
    update(detections, imu, now) {
      // One object per kind and place: keep the biggest, so two chairs never share one history.
      const best = new Map();
      for (const d of detections) {
        const z = zone(d.cx, d.cy);
        const area = d.normW * d.normH;
        const key = `${d.label}-${z.inPath ? "ahead" : z.clock}`;
        const prev = best.get(key);
        if (!prev || area > prev.area) best.set(key, { key, label: d.label, area, distM: distanceMeters(d.label, d.normW), ...z });
      }
      // forget things that left the picture
      for (const k of [...this.baselines.keys()]) if (!best.has(k)) { this.baselines.delete(k); this.sustainedSince.delete(k); }
      const steady = !imu || (!imu.panning && imu.stable !== false);   // a swinging camera makes everything "grow"
      const objects = []; let hazard = null;
      for (const it of best.values()) {
        if (!this.baselines.has(it.key)) this.baselines.set(it.key, new RollingBaseline(this.o.windowMs));
        const b = this.baselines.get(it.key);
        b.push(it.area, now);
        const growth = b.growthRatePerSec;
        const approaching = growth > this.o.growthMin;
        const urgent = steady && it.inPath && approaching && (growth >= this.o.growthFast || (it.distM !== null && it.distM <= this.o.distUrgentM));
        objects.push({ label: it.label, clock: it.clock, inPath: it.inPath, distM: it.distM, growth: Number(growth.toFixed(2)), urgent });
        if (!urgent) { this.sustainedSince.delete(it.key); continue; }
        if (!this.sustainedSince.has(it.key)) { this.sustainedSince.set(it.key, now); continue; }
        if (now - this.sustainedSince.get(it.key) >= this.o.sustainMs && now - this.lastAlertAt >= this.o.minGapMs && !hazard) {
          hazard = { label: it.label, clock: it.clock, growth: Number(growth.toFixed(2)), distM: it.distM, confidence: 0.92 };
          this.lastAlertAt = now; this.sustainedSince.delete(it.key);
        }
      }
      objects.sort((a, b) => (a.distM ?? 99) - (b.distM ?? 99));
      return { objects, hazard };
    }
  }

  // How much did the picture change? Mean absolute luminance difference (0..1) between two small greyscale versions of the
  // picture (for example 16x16). The server uses it to skip watcher looks while nothing is changing.
  function lumaMotion(prev, cur) {
    if (!prev || !cur || prev.length !== cur.length || !cur.length) return null;
    let d = 0;
    for (let i = 0; i < cur.length; i++) d += Math.abs(cur[i] - prev[i]);
    return d / cur.length;
  }

  const api = { KNOWN_WIDTHS_M, DEFAULTS, distanceMeters, zone, RollingBaseline, ImuState, LoomingTracker, lumaMotion };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, { Looming: api });
})(typeof window !== "undefined" ? window : globalThis);
