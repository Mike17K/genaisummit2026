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
    }
    reset() {
      this.scaleK = this.defaultScaleK;
      this.anchored = false;
    }
    anchor(dispAtCapture, metricMeters) {
      if (!(dispAtCapture > 0.05) || !(metricMeters >= 0.10 && metricMeters <= 8.0)) return false;
      const obsK = Math.max(0.25, Math.min(120.0, dispAtCapture * metricMeters));
      if (!this.anchored) {
        this.scaleK = obsK;
        this.anchored = true;
      } else {
        this.scaleK = 0.65 * this.scaleK + 0.35 * obsK;
      }
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
    ImuState, parseFocusDistance, extractCenterDisparity, DepthCalibrator,
    MOBILE_SLOW_MS, chooseDepthTarget, cardinalFromDeg, compassHeadingFromEuler,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, { Looming: api });
})(typeof window !== "undefined" ? window : globalThis);
