// Depth-stop movement gate: only a FALLING center depth may trigger. Run: node tests/test_approach.js
const assert = require("assert");
const { ApproachDetector, DepthCalibrator, shouldStop } = require("../static/looming.js");

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5); // deterministic noise in [-0.5, 0.5]
const STOP_M = 0.9;

// Feed a distance(t) profile at ~5 fps and report whether a stop would fire (close + approaching, 2 readings).
function run(profile, { ms = 3000, noise = 0.05, epochAt = null } = {}) {
  const det = new ApproachDetector();
  let firedAt = null, firedD = null, epoch = 0;
  for (let t = 0; t <= ms; t += 180) {
    if (epochAt !== null && t >= epochAt) epoch = 1;
    const d = profile(t) + rand() * 2 * noise;
    const a = det.push(d, t, epoch);
    if (firedAt === null && shouldStop(d, a, STOP_M)) { firedAt = t; firedD = d; }
  }
  return firedAt === null ? null : { t: firedAt, d: firedD };
}

const cases = [
  ["standing still 0.6 m from a wall", () => run(() => 0.6), null],
  ["standing still 0.4 m from a wall, noisy", () => run(() => 0.4, { noise: 0.08 }), null],
  ["swaying +-10 cm at 0.7 m", () => run((t) => 0.7 + 0.1 * Math.sin(t / 300)), null],
  ["one wild reading at 0.7 m", () => run((t) => (t === 1440 ? 0.3 : 0.7)), null],
  ["calibration jump 1.2 -> 0.7 m while standing", () => run((t) => (t < 1500 ? 1.2 : 0.7), { epochAt: 1500 }), null],
  ["walking into a wall at 0.8 m/s from 2.6 m", () => run((t) => Math.max(0.3, 2.6 - 0.8 * t / 1000)), "fires"],
  ["slow careful walk 0.35 m/s from 1.6 m", () => run((t) => Math.max(0.3, 1.6 - 0.35 * t / 1000), { ms: 4000 }), "fires"],
  ["person walking toward a stationary user", () => run((t) => Math.max(0.4, 3.0 - 1.0 * t / 1000)), "fires"],
];

let failed = 0;
for (const [name, fn, expect] of cases) {
  const firedAt = fn();
  const ok = expect === "fires" ? firedAt !== null : firedAt === null;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${firedAt === null ? "no stop" : `stop at ${firedAt.t} ms, ${firedAt.d.toFixed(2)} m away`}`);
  if (!ok) failed++;
}

// Calibrator epoch only bumps on a real scale jump
const cal = new DepthCalibrator(4.5);
cal.anchor(3.0, 1.0); const e1 = cal.epoch;        // first anchor 4.5 -> 3.0: jump
cal.anchor(3.0, 1.02); assert.strictEqual(cal.epoch, e1, "tiny refinement must not reset history");
cal.anchor(3.0, 2.0); assert.ok(cal.epoch > e1, "big re-anchor must bump the epoch");
console.log("PASS  calibrator epoch");

process.exit(failed ? 1 : 0);
