// Sonar scheduler in real time with a recording fake audio output. Run: node tests/test_sonar_runtime.js
const assert = require("assert");
const { SpatialSonar, sonarVoice } = require("../static/spatial_sonar.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeSonar(opts = {}) {
  const ctx = { state: "running", currentTime: 0 };
  const s = new SpatialSonar(() => ctx, opts);
  s.beeps = [];
  s._beep = (_c, fl, fr, gl, gr) => s.beeps.push({ fl, fr, gl, gr, t: Date.now() });
  return s;
}

(async () => {
  let n = 0;
  const pass = (m) => { n++; console.log("PASS ", m); };

  // 1. wall on the left, fed at ~4 Hz like the laptop path: beeps only in the left ear, at the mapped rate
  let s = makeSonar();
  s.start();
  for (let i = 0; i < 10; i++) { s.update({ left: 0.6, center: null, right: null }); await sleep(200); }
  s.stop();
  const v = sonarVoice("left", 0.6);
  assert.ok(s.beeps.length >= Math.floor(2000 / v.intervalMs) - 2, `rate: ${s.beeps.length} beeps`);
  assert.ok(s.beeps.every((b) => b.gl > 5 * b.gr), "left ear");
  pass(`left wall: ${s.beeps.length} beeps in 2 s, all left-ear (interval ${v.intervalMs} ms)`);

  // 2. user talking -> silent
  s = makeSonar({ isMuted: () => true });
  s.start();
  for (let i = 0; i < 5; i++) { s.update({ center: 0.5 }); await sleep(200); }
  s.stop();
  assert.strictEqual(s.beeps.length, 0);
  pass("paused while the user talks");

  // 3. assistant speaking -> ducked volume
  s = makeSonar({ duck: () => 0.45 });
  s.start();
  for (let i = 0; i < 4; i++) { s.update({ right: 0.8 }); await sleep(200); }
  s.stop();
  const full = sonarVoice("right", 0.8).gainR;
  assert.ok(s.beeps.length > 0 && s.beeps.every((b) => Math.abs(b.gr - full * 0.45) < 1e-6));
  pass("ducked to 45% while VoxEye speaks");

  // 4. depth source stalls -> stops beeping after the stale window
  s = makeSonar();
  s.start();
  s.update({ center: 0.5 });
  await sleep(2600);
  const late = s.beeps.filter((b) => b.t - s.beeps[0].t > 1700).length;
  s.stop();
  assert.strictEqual(late, 0, `stale beeps: ${late}`);
  pass(`stale reading expires (${s.beeps.length} beeps, none after 1.5 s)`);

  // 5. continuous mode with nothing near -> total silence; hold mode -> soft alive tick
  s = makeSonar();
  s.start();
  for (let i = 0; i < 9; i++) { s.update({ left: 4, center: 5, right: null }); await sleep(200); }
  assert.strictEqual(s.beeps.length, 0);
  s.aliveTick = true;
  for (let i = 0; i < 9; i++) { s.update({ left: 4, center: 5, right: null }); await sleep(200); }
  s.stop();
  assert.ok(s.beeps.length >= 1 && s.beeps.every((b) => b.gl <= 0.015));
  pass(`nothing near: silent when continuous, ${s.beeps.length} soft alive tick(s) in hold mode`);

  console.log(`${n} passed`);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
