// On-device looming logic. Run: node tests/test_looming.js   (Node is needed only for this test)
const {
  RollingBaseline, ImuState, LoomingTracker, zone, distanceMeters, lumaMotion,
  parseFocusDistance, depthFeedback, extractCenterDisparity, DepthCalibrator,
  MOBILE_SLOW_MS, chooseDepthTarget,
} = require("../static/looming.js");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name, detail); }
}
const HZ = 10, DT = 1000 / HZ;

// a detection of `label` centred at cx, with width w (normalised); height follows the width
const det = (label, cx, w, cy = 0.6) => ({ label, cx, cy, normW: w, normH: w * 0.6 });

// Run frames through a tracker. frameFn(i, tMs) returns the detections for that frame. Returns hazards with their times.
function run(tracker, frames, frameFn, imuFn = () => null) {
  const hazards = [];
  for (let i = 0; i < frames; i++) {
    const t = 1000 + i * DT;
    const f = frameFn(i, t);
    const { hazard } = tracker.update(Array.isArray(f) ? f : [f], imuFn(i, t), t);
    if (hazard) hazards.push({ t, ...hazard });
  }
  return hazards;
}

// ---- growth measurement
{
  const b = new RollingBaseline();
  for (let i = 0; i < 12; i++) b.push(0.05, 1000 + i * DT);
  check("a constant size has no growth", b.growthRatePerSec === 0);
  const few = new RollingBaseline();
  for (let i = 0; i < 3; i++) few.push(0.05 * (1 + i), 1000 + i * DT);
  check("fewer than 4 samples: not ready, no growth", few.growthRatePerSec === 0 && !few.isReady);
  const g = new RollingBaseline();
  const k = 0.7;                                                   // area grows 70% per second (exponentially)
  for (let i = 0; i < 12; i++) g.push(0.02 * Math.exp(k * (i * DT) / 1000), 1000 + i * DT);
  const rate = g.growthRatePerSec;
  check("steady growth is measured near its true rate", rate > 0.55 && rate < 1.0, rate);
  const shrink = new RollingBaseline();
  for (let i = 0; i < 12; i++) shrink.push(0.1 * Math.exp(-0.7 * (i * DT) / 1000), 1000 + i * DT);
  check("a shrinking object reports no growth", shrink.growthRatePerSec === 0);
  const old = new RollingBaseline(1800);
  for (let i = 0; i < 40; i++) old.push(0.05, 1000 + i * DT);
  check("history older than the window is dropped", old.samples.length <= 1800 / DT + 1, old.samples.length);
}

// ---- position and distance helpers
check("the middle of the picture is 12 o'clock and in the path", zone(0.5, 0.6).clock === "12 o'clock" && zone(0.5, 0.6).inPath);
check("the left edge is not in the path", !zone(0.1, 0.6).inPath && zone(0.1, 0.6).clock === "10 o'clock");
check("a car half the picture wide is about 3 m away", Math.abs(distanceMeters("car", 0.5) - 3.1) < 0.2, distanceMeters("car", 0.5));
check("a tiny box gives no distance", distanceMeters("car", 0.005) === null);

// ---- phone motion
{
  const imu = new ImuState();
  check("movement is unknown before any data (never 'stationary')", imu.walking === null);
  imu.handleMotion({ rotationRate: { alpha: 5, beta: 5, gamma: 5 } }, 0);
  check("a slow turn is steady", !imu.panning && imu.stable);
  imu.handleMotion({ rotationRate: { alpha: 55, beta: 0, gamma: 0 } }, 10);
  check("55 deg/s is not panning but not steady either", !imu.panning && !imu.stable);
  imu.handleMotion({ rotationRate: { alpha: 0, beta: 80, gamma: 0 } }, 20);
  check("80 deg/s is panning", imu.panning && imu.angularSpeed === 80);
  imu.handleOrientation({ beta: 83.6 });
  check("tilt is read from the orientation", imu.pitchDeg === 84);

  const still = new ImuState();
  for (let i = 0; i < 20; i++) still.handleMotion({ acceleration: { x: 0.02 * Math.sin(i), y: 0.03, z: 0.01 } }, i * 16);
  check("a still phone is stationary (false, not null)", still.walking === false);
  const walk = new ImuState();
  for (let i = 0; i < 60; i++) walk.handleMotion({ acceleration: { x: 0.3, y: 3 * Math.sin(i * 0.5), z: 0.3 } }, i * 16);
  check("walking-like shaking (about 3 m/s2) is detected", walk.walking === true, walk.walking);
  const gentle = new ImuState();
  for (let i = 0; i < 60; i++) gentle.handleMotion({ acceleration: { x: 0.1, y: 1.5 * Math.sin(i * 0.5), z: 0.1 } }, i * 16);
  check("in-between movement is UNKNOWN, not 'stationary'", gentle.walking === null, gentle.walking);
  const grav = new ImuState();
  for (let i = 0; i < 20; i++) grav.handleMotion({ acceleration: { x: null }, accelerationIncludingGravity: { x: 0.1, y: 9.8, z: 0.2 } }, i * 16);
  check("falls back to acceleration including gravity", grav.walking === false);
  const gyroOnly = new ImuState();
  for (let i = 0; i < 20; i++) gyroOnly.handleMotion({ rotationRate: { alpha: 1, beta: 1, gamma: 1 } }, i * 16);
  check("a gyroscope alone leaves walking unknown", gyroOnly.walking === null);
  check("snapshot has what the server needs", Object.keys(still.snapshot()).sort().join() === "angularSpeed,panning,pitchDeg,walking");
}

// ---- the tracker
{
  // a car in the path growing from 15% to 45% of the picture width over 1.5 s (about 9 times the area)
  const approaching = (i) => det("car", 0.5, 0.15 + 0.30 * Math.min(1, i / 15));
  let t = new LoomingTracker();
  let h = run(t, 40, approaching);
  check("an approaching car in the path raises exactly one alert", h.length === 1, h.length);
  check("it names the object and the place", h[0] && h[0].label === "car" && h[0].clock === "12 o'clock", JSON.stringify(h[0]));
  const startT = 1000 + 0 * DT;
  check("and it comes within about a second of the car starting to move", h[0] && h[0].t - startT < 1100, h[0] && h[0].t - startT);

  t = new LoomingTracker();
  check("a car that stays the same size is ignored", run(t, 40, () => det("car", 0.5, 0.3)).length === 0);
  t = new LoomingTracker();
  check("an approaching car at the edge of the picture is ignored", run(t, 40, (i) => det("car", 0.08, 0.15 + 0.3 * Math.min(1, i / 15))).length === 0);
  t = new LoomingTracker();
  check("slow growth (10% a second) is ignored", run(t, 40, (i) => det("car", 0.5, 0.2 * Math.pow(1.05, i * DT / 1000))).length === 0);

  // sensors
  t = new LoomingTracker();
  check("no alert while the camera is panning", run(t, 40, approaching, () => ({ panning: true, stable: false })).length === 0);
  t = new LoomingTracker();
  check("no alert while the camera is not steady", run(t, 40, approaching, () => ({ panning: false, stable: false })).length === 0);
  t = new LoomingTracker();
  check("without sensor data the detector still works", run(t, 40, approaching, () => null).length === 1);
  t = new LoomingTracker();
  check("with steady sensors it works", run(t, 40, approaching, () => ({ panning: false, stable: true, walking: true })).length === 1);
  t = new LoomingTracker();
  const afterPan = run(t, 60, approaching, (i) => ({ panning: i < 10, stable: i >= 10 }));
  check("after the panning stops, a real approach still alerts", afterPan.length === 1, afterPan.length);

  // jitter and sustain
  t = new LoomingTracker();
  const spike = run(t, 40, (i) => det("chair", 0.5, i === 20 ? 0.45 : 0.15));
  check("a one-frame box spike does not alert", spike.length === 0, spike.length);

  // distance rule: close and moderately approaching
  t = new LoomingTracker();
  const close = run(t, 40, (i) => det("person", 0.5, 0.40 + 0.08 * Math.min(1, i / 10)));
  check("a person very close and approaching alerts", close.length === 1, close.length);
  t = new LoomingTracker();
  const far = run(t, 40, (i) => det("person", 0.5, 0.10 + 0.02 * Math.min(1, i / 10)));
  check("the same relative growth far away does not", far.length === 0, far.length);

  // minimum gap between alerts and de-duplication
  t = new LoomingTracker();
  const two = run(t, 100, (i) => det("car", 0.5, 0.15 + 0.30 * Math.min(1, (i % 30) / 15)));   // repeated approaches every 3 s
  check("alerts are at least 4 s apart", two.length >= 1 && two.every((x, j) => j === 0 || x.t - two[j - 1].t >= 4000), JSON.stringify(two.map((x) => x.t)));
  t = new LoomingTracker();
  const twoChairs = run(t, 40, () => [det("chair", 0.5, 0.30), det("chair", 0.45, 0.10)]);
  check("two chairs in one place do not mix their histories", twoChairs.length === 0);
  t = new LoomingTracker();
  const { objects } = (() => { let r; for (let i = 0; i < 12; i++) r = t.update([det("car", 0.5, 0.3), det("person", 0.5, 0.4, 0.5)], null, 1000 + i * DT); return r; })();
  check("objects come back nearest first", objects.length === 2 && (objects[0].distM ?? 99) <= (objects[1].distM ?? 99), JSON.stringify(objects));
  t = new LoomingTracker();
  run(t, 10, approaching);
  t.reset();
  check("reset forgets everything", t.baselines.size === 0 && t.sustainedSince.size === 0);
}

// ---- scene motion score
{
  const a = new Float32Array(256).fill(0.5);
  check("an identical picture has no motion", lumaMotion(a, new Float32Array(256).fill(0.5)) === 0);
  const b = new Float32Array(256).fill(0.5); for (let i = 0; i < 128; i++) b[i] = 0.7;
  check("half the picture 0.2 brighter is a motion score of 0.1", Math.abs(lumaMotion(a, b) - 0.1) < 1e-6, lumaMotion(a, b));
  check("a different size or missing picture gives null, not a guess", lumaMotion(a, new Float32Array(100)) === null && lumaMotion(null, a) === null);
  const noisy = new Float32Array(256); for (let i = 0; i < 256; i++) noisy[i] = 0.5 + (i % 2 ? 0.004 : -0.004);
  check("camera noise (+-0.004) stays well under the 0.012 'still' threshold", lumaMotion(a, noisy) < 0.012, lumaMotion(a, noisy));
}

// ---- Approach 1 Web PDAF focusDistance & Depth Identification Mode feedback
{
  check("standard W3C focusDistance in metres is read directly", parseFocusDistance({ focusDistance: 0.85 }, { focusDistance: { min: 0.1, max: 5.0 } }) === 0.85);
  check("legacy Android Camera2 diopter HAL (min=0, max>=8) converts 1/diopters to metres", parseFocusDistance({ focusDistance: 2.0 }, { focusDistance: { min: 0, max: 10 } }) === 0.5);
  check("missing or uncalibrated zero focusDistance returns null", parseFocusDistance({}, {}) === null && parseFocusDistance({ focusDistance: 0 }, { focusDistance: { min: 0, max: 10 } }) === null);
  check("extreme focusDistance is clamped to [0.08, 6.0] m", parseFocusDistance({ focusDistance: 25 }, { focusDistance: { min: 0.1, max: 50 } }) === 6.0 && parseFocusDistance({ focusDistance: 0.02 }, {}) === 0.08);

  const far = depthFeedback(3.5);
  const mid = depthFeedback(1.2);
  const near = depthFeedback(0.2);
  check("depthFeedback returns null on invalid distance", depthFeedback(null) === null && depthFeedback(0) === null && depthFeedback(-1) === null);
  check("beep volume increases strictly as object gets closer", far.volume < mid.volume && mid.volume < near.volume, `${far.volume} < ${mid.volume} < ${near.volume}`);
  check("vibration power (vibeMs) increases strictly as object gets closer", far.vibeMs < mid.vibeMs && mid.vibeMs < near.vibeMs, `${far.vibeMs} < ${mid.vibeMs} < ${near.vibeMs}`);
  check("pulse interval shortens strictly as object gets closer", far.intervalMs > mid.intervalMs && mid.intervalMs > near.intervalMs, `${far.intervalMs} > ${mid.intervalMs} > ${near.intervalMs}`);

  // Phase 2: Depth-Anything-V2-Small center disparity & metric calibration
  const grid = new Float32Array(20 * 20).fill(1.5); // far background disparity = 1.5
  for (let y = 8; y < 12; y++) for (let x = 9; x < 12; x++) grid[y * 20 + x] = 9.0; // narrow pole in center crosshair
  const stats = extractCenterDisparity(grid, 20, 20);
  check("extractCenterDisparity locks onto obstacle inside center crosshair", stats && stats.centerDisp === 9.0 && stats.p10 === 1.5, JSON.stringify(stats));

  const cal = new DepthCalibrator(4.5);
  check("unanchored DepthCalibrator responds immediately with inverse-depth metres", cal.toMeters(4.5) === 1.0 && cal.toMeters(9.0) === 0.5);
  check("anchoring calibrator locks metric scale (doubling disparity halves distance)", cal.anchor(6.0, 2.0) && cal.anchored && cal.toMeters(6.0) === 2.0 && cal.toMeters(12.0) === 1.0);

  // Auto mobile <-> laptop performance switch
  check("MOBILE_SLOW_MS threshold is 280 ms", MOBILE_SLOW_MS === 280);
  check("auto keeps mobile before benchmark and when phone is fast",
    chooseDepthTarget({ mode: "auto" }).target === "mobile" &&
    chooseDepthTarget({ mode: "auto", mobileBenchMs: 75, mobileEmaMs: 90, mobileFrames: 6 }).target === "mobile");
  check("auto switches to laptop when phone warmup bench is slow (>280 ms)",
    chooseDepthTarget({ mode: "auto", mobileBenchMs: 420 }).target === "laptop");
  check("auto switches to laptop when live phone EMA slows down (>280 ms over >=3 frames)",
    chooseDepthTarget({ mode: "auto", mobileBenchMs: 110, mobileEmaMs: 360, mobileFrames: 4 }).target === "laptop");
  check("auto switches to laptop when mobile worker/WebGPU errors out",
    chooseDepthTarget({ mode: "auto", mobileError: true }).target === "laptop");
  check("auto stays on mobile if laptop network RTT is even slower than mobile",
    chooseDepthTarget({ mode: "auto", mobileEmaMs: 320, mobileFrames: 4, laptopRttMs: 900 }).target === "mobile");
  check("explicit mobile and laptop modes override auto heuristics",
    chooseDepthTarget({ mode: "mobile", mobileBenchMs: 600, mobileError: true }).target === "mobile" &&
    chooseDepthTarget({ mode: "laptop", mobileBenchMs: 45 }).target === "laptop");
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
