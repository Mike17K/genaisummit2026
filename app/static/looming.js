// On-device sensor helpers: IMU/compass state, Web PDAF focus distance, depth calibration (disparity -> metres),
// depth sonar feedback and the mobile/laptop depth-engine chooser. Pure functions/classes, testable in Node.
(function (root) {
  const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function cardinalFromDeg(deg) {
    if (typeof deg !== "number" || !Number.isFinite(deg)) return null;
    const norm = ((deg % 360) + 360) % 360;
    return CARDINALS[Math.round(norm / 45) % 8];
  }

  // Tilt-compensated forward azimuth (0=N, 90=E, 180=S, 270=W) from W3C Euler angles (alpha, beta, gamma),
  // seamlessly handling phones held flat (beta~0) through upright rear-camera posture (beta~90).
  function compassHeadingFromEuler(alpha, beta, gamma) {
    if (typeof alpha !== "number" || !Number.isFinite(alpha)) return null;
    const a = (alpha * Math.PI) / 180;
    const b = ((typeof beta === "number" && Number.isFinite(beta) ? beta : 0) * Math.PI) / 180;
    const g = ((typeof gamma === "number" && Number.isFinite(gamma) ? gamma : 0) * Math.PI) / 180;
    const x2 = -Math.sin(g);
    const y2 = Math.cos(b) + Math.sin(b) * Math.cos(g);
    if (Math.hypot(x2, y2) < 1e-4) return null;
    const east = Math.cos(a) * x2 - Math.sin(a) * y2;
    const north = Math.sin(a) * x2 + Math.cos(a) * y2;
    return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  }

  // Phone motion & compass: turning (panning), walking, tilt, and magnetic heading.
  // walking is true / false / null (unknown). Unknown must never be read as "standing still".
  class ImuState {
    constructor({ panDegS = 65, stableDegS = 50, walkVariance = 0.3, stillVariance = 0.06, windowMs = 800 } = {}) {
      Object.assign(this, { panDegS, stableDegS, walkVariance, stillVariance, windowMs });
      this.angularSpeed = 0; this.panning = false; this.stable = true; this.pitchDeg = null; this.walking = null; this.turnDir = null;
      this.compassDeg = null; this.compassDir = null; this.compassAbs = false;
      this._hasAbsCompass = false; this._compCos = null; this._compSin = null;
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
          this.walking = variance > this.walkVariance ? true : variance < this.stillVariance ? false : null;
        }
      }
    }
    handleOrientation(e, isAbsoluteEvent = false) {
      if (!e) return;
      if (e.beta != null && Number.isFinite(e.beta)) this.pitchDeg = Math.round(e.beta);
      let rawDeg = null;
      let isAbs = false;
      if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading) && e.webkitCompassHeading >= 0) {
        rawDeg = ((e.webkitCompassHeading % 360) + 360) % 360;
        isAbs = true;
      } else if (e.alpha != null && Number.isFinite(e.alpha)) {
        isAbs = !!(isAbsoluteEvent || e.absolute === true);
        if (!isAbs && this._hasAbsCompass) return;
        rawDeg = compassHeadingFromEuler(e.alpha, e.beta, e.gamma);
      }
      if (rawDeg === null) return;
      if (isAbs && !this._hasAbsCompass) {
        this._hasAbsCompass = true;
        this._compCos = null;
        this._compSin = null;
      }
      const rad = (rawDeg * Math.PI) / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      if (this._compCos === null || this._compSin === null) {
        this._compCos = c;
        this._compSin = s;
      } else {
        this._compCos = 0.72 * this._compCos + 0.28 * c;
        this._compSin = 0.72 * this._compSin + 0.28 * s;
      }
      const smoothed = ((Math.atan2(this._compSin, this._compCos) * 180) / Math.PI + 360) % 360;
      this.compassDeg = Math.round(smoothed) % 360;
      this.compassDir = cardinalFromDeg(this.compassDeg);
      this.compassAbs = isAbs;
    }
    snapshot() {
      const snap = { angularSpeed: this.angularSpeed, panning: this.panning, walking: this.walking, pitchDeg: this.pitchDeg };
      if (this.turnDir) snap.turnDir = this.turnDir;
      if (this.compassDeg !== null) {
        snap.compassDeg = this.compassDeg;
        snap.compassDir = this.compassDir;
        snap.compassAbs = this.compassAbs;
      }
      return snap;
    }
  }

  // Approach 1 (Web PDAF): read center-weighted hardware lens focus distance from MediaStreamTrack.getSettings().
  // W3C ImageCapture reports focusDistance in metres; legacy Camera2 HALs with min===0 && max>=8 report diopters (1/m).
  function parseFocusDistance(settings, capabilities) {
    const raw = settings && typeof settings.focusDistance === "number" ? settings.focusDistance : null;
    if (raw === null || !Number.isFinite(raw) || raw <= 0) return null;
    const cap = capabilities && capabilities.focusDistance;
    const isDiopters = !!(cap && cap.min === 0 && typeof cap.max === "number" && cap.max >= 8);
    const meters = isDiopters ? 1 / raw : raw;
    if (!Number.isFinite(meters) || meters <= 0) return null;
    const clamped = Math.max(0.08, Math.min(6.0, meters));
    return Number(clamped.toFixed(2));
  }

  // Map centre-view distance (metres) to haptic motor power (PWM pulse width + cadence) and WebAudio beep volume.
  function depthFeedback(distM) {
    if (typeof distM !== "number" || !Number.isFinite(distM) || distM <= 0) return null;
    const d = Math.max(0.15, Math.min(3.5, distM));
    const proximity = (3.5 - d) / (3.5 - 0.15); // 0.0 at >=3.5m .. 1.0 at <=0.15m
    const power = proximity * proximity;         // perceptual quadratic curve
    return {
      distM: Number(d.toFixed(2)),
      proximity: Number(proximity.toFixed(3)),
      power: Number(power.toFixed(3)),
      volume: Number((0.015 + 0.305 * power).toFixed(3)), // 0.015 whisper -> 0.320 loud
      vibeMs: Math.round(12 + 108 * power),               // 12ms micro-tick -> 120ms full motor power
      intervalMs: Math.round(460 - 325 * proximity),      // 460ms slow -> 135ms rapid buzz
      freqHz: Math.round(520 + 360 * proximity),          // 520Hz -> 880Hz
    };
  }

  // Extract 75th-percentile inverse depth (disparity) inside the central 20%x20% crosshair of a Depth-Anything-V2 map.
  function extractCenterDisparity(data, width, height) {
    if (!data || !width || !height || data.length < width * height) return null;
    const x0 = Math.max(0, Math.floor(width * 0.40));
    const x1 = Math.min(width, Math.ceil(width * 0.60));
    const y0 = Math.max(0, Math.floor(height * 0.40));
    const y1 = Math.min(height, Math.ceil(height * 0.60));
    const center = [];
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = x0; x < x1; x++) {
        const v = Number(data[row + x]);
        if (Number.isFinite(v) && v > 0) center.push(v);
      }
    }
    if (!center.length) return null;
    center.sort((a, b) => a - b);
    const centerDisp = center[Math.min(center.length - 1, Math.floor(center.length * 0.75))];

    const sample = [];
    const step = Math.max(1, Math.floor(data.length / 512));
    for (let i = 0; i < data.length; i += step) {
      const v = Number(data[i]);
      if (Number.isFinite(v) && v > 0) sample.push(v);
    }
    sample.sort((a, b) => a - b);
    const p10 = sample.length ? sample[Math.floor(sample.length * 0.10)] : centerDisp;
    const p90 = sample.length ? sample[Math.floor(sample.length * 0.90)] : centerDisp;
    return { centerDisp, p10, p90 };
  }

  // Calibrates Depth-Anything-V2 inverse-depth disparity (disp ~ k / Z) into metric metres.
  // Responds in 0 ms with a sensible prior (k=4.5) and locks onto exact metric scale whenever an anchor arrives.
  class DepthCalibrator {
    constructor(defaultScaleK = 4.5) {
      this.defaultScaleK = defaultScaleK;
      this.scaleK = defaultScaleK;
      this.anchored = false;
      this.epoch = 0; // bumps when the metric scale jumps (>8%), so distance history before it is not comparable
    }
    reset() {
      this.scaleK = this.defaultScaleK;
      this.anchored = false;
      this.epoch++;
    }
    anchor(dispAtCapture, metricMeters) {
      if (!(dispAtCapture > 0.05) || !(metricMeters >= 0.10 && metricMeters <= 8.0)) return false;
      const obsK = Math.max(0.25, Math.min(120.0, dispAtCapture * metricMeters));
      const prev = this.scaleK;
      if (!this.anchored) {
        this.scaleK = obsK;
        this.anchored = true;
      } else {
        this.scaleK = 0.65 * this.scaleK + 0.35 * obsK;
      }
      if (Math.abs(this.scaleK - prev) / prev > 0.08) this.epoch++;
      return true;
    }
    toMeters(centerDisp) {
      if (!(centerDisp > 0.02) || !Number.isFinite(centerDisp)) return null;
      const rawM = this.scaleK / centerDisp;
      const clamped = Math.max(0.12, Math.min(6.0, rawM));
      return Number(clamped.toFixed(2));
    }
  }

  const MOBILE_SLOW_MS = 280; // >280 ms/frame (<3.5 fps) counts as "slow AF" -> auto-switch to laptop

  // Decide whether depth inference runs on "mobile" or "laptop".
  // In "auto" mode (default), keeps "mobile" unless the phone's steady-state benchmark or live EMA exceeds MOBILE_SLOW_MS
  // (or mobile WebGPU/WASM errors out), provided the laptop round-trip isn't even slower.
  // Is the camera-center surface getting CLOSER (the user walking toward it, or it toward the user)?
  // Standing still in front of a wall gives a flat distance line and never counts. Uses a least-squares slope
  // over the recent window plus a minimum total drop, so a single noisy reading cannot trigger it.
  class ApproachDetector {
    constructor({ windowMs = 1500, minSpanMs = 450, minDropM = 0.25, minSpeedMps = 0.2, minSamples = 3 } = {}) {
      Object.assign(this, { windowMs, minSpanMs, minDropM, minSpeedMps, minSamples });
      this.samples = [];
      this.epoch = null;
    }
    reset() { this.samples = []; this.epoch = null; }
    push(distM, now, epoch = 0) {
      if (this.epoch !== epoch) { this.samples = []; this.epoch = epoch; }
      this.samples.push({ d: distM, t: now });
      while (this.samples.length && this.samples[0].t < now - this.windowMs) this.samples.shift();
      return this.state();
    }
    state() {
      const s = this.samples;
      const none = { approaching: false, dropM: 0, speedMps: 0 };
      if (s.length < this.minSamples || s[s.length - 1].t - s[0].t < this.minSpanMs) return none;
      const n = s.length;
      const mt = s.reduce((a, x) => a + x.t, 0) / n, md = s.reduce((a, x) => a + x.d, 0) / n;
      let num = 0, den = 0;
      for (const x of s) { num += (x.t - mt) * (x.d - md); den += (x.t - mt) ** 2; }
      const slopeMps = den > 0 ? (num / den) * 1000 : 0; // metres per second (negative = closer)
      const k = Math.max(1, Math.floor(n / 3));
      const oldAvg = s.slice(0, k).reduce((a, x) => a + x.d, 0) / k;
      const newAvg = s.slice(n - k).reduce((a, x) => a + x.d, 0) / k;
      const dropM = oldAvg - newAvg;
      return {
        approaching: slopeMps <= -this.minSpeedMps && dropM >= this.minDropM,
        dropM: Number(dropM.toFixed(2)),
        speedMps: Number((-slopeMps).toFixed(2)),
      };
    }
  }

  // Stop decision from distance + approach: close and closing in, with an earlier trigger for faster approaches
  // (time-to-contact) so a brisk walker is warned before the plain distance threshold.
  function shouldStop(distM, a, stopM, { ttcS = 1.4, maxFactor = 2.0 } = {}) {
    if (!a || !a.approaching || !(distM > 0)) return false;
    if (distM <= stopM) return true;
    return distM <= stopM * maxFactor && a.speedMps > 0 && distM / a.speedMps <= ttcS;
  }

  function chooseDepthTarget({
    mode = "auto",
    mobileBenchMs = null,
    mobileEmaMs = null,
    mobileFrames = 0,
    mobileError = false,
    laptopRttMs = null,
  } = {}) {
    if (mode === "mobile") return { target: "mobile", reason: "forced mobile" };
    if (mode === "laptop") return { target: "laptop", reason: "forced laptop" };
    if (mobileError) return { target: "laptop", reason: "mobile unavailable" };

    if (mobileFrames >= 3 && typeof mobileEmaMs === "number" && mobileEmaMs > MOBILE_SLOW_MS) {
      if (typeof laptopRttMs === "number" && laptopRttMs > mobileEmaMs * 1.25) {
        return { target: "mobile", reason: "laptop slower than mobile" };
      }
      return { target: "laptop", reason: `mobile slow (${Math.round(mobileEmaMs)} ms/frame)` };
    }
    if (mobileFrames < 3 && typeof mobileBenchMs === "number" && mobileBenchMs > MOBILE_SLOW_MS) {
      if (typeof laptopRttMs === "number" && laptopRttMs > mobileBenchMs * 1.25) {
        return { target: "mobile", reason: "laptop slower than mobile" };
      }
      return { target: "laptop", reason: `mobile bench slow (${Math.round(mobileBenchMs)} ms/frame)` };
    }
    return { target: "mobile", reason: "mobile fast" };
  }

  const api = {
    ImuState, ApproachDetector, shouldStop, parseFocusDistance, depthFeedback, extractCenterDisparity, DepthCalibrator,
    MOBILE_SLOW_MS, chooseDepthTarget, cardinalFromDeg, compassHeadingFromEuler,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, { Looming: api });
})(typeof window !== "undefined" ? window : globalThis);
