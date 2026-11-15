// Stereo sonar mapping + WebXR sector sampling (pure). Run: node tests/test_sonar.js
const assert = require("assert");
const L = require("../static/spatial_sonar.js");
const { sonarVoice, planVoices } = L;
const RANGE_M = L.DEFAULTS.rangeM;
const { sampleSectors } = require("../static/xr_depth.js");
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("PASS ", name); };

ok("silent beyond range / invalid", () => {
  assert.strictEqual(sonarVoice("center", RANGE_M + 0.1), null);
  assert.strictEqual(sonarVoice("left", 0), null);
  assert.strictEqual(sonarVoice("right", NaN), null);
});
ok("closer = louder and faster", () => {
  const far = sonarVoice("center", 2.0), near = sonarVoice("center", 0.5);
  assert.ok(near.gainL > far.gainL && near.gainR > far.gainR);
  assert.ok(near.intervalMs < far.intervalMs && near.intervalMs >= 130);
  assert.ok(near.gainL <= 0.3 && near.gainR <= 0.3, "capped at the ear's max volume");
});
ok("left sector is in the left ear, right in the right ear, center in both", () => {
  const l = sonarVoice("left", 1.0), r = sonarVoice("right", 1.0), c = sonarVoice("center", 1.0);
  assert.ok(l.gainL > 5 * l.gainR);
  assert.ok(r.gainR > 5 * r.gainL);
  assert.strictEqual(c.gainL, c.gainR);
  assert.ok(l.freqL < c.freqL && c.freqL < r.freqL, "side offset shifts the left ear");
  assert.ok(l.freqR < c.freqR && c.freqR < r.freqR, "side offset shifts the right ear");
  assert.ok(c.freqR > c.freqL, "each ear has its own register");
});
ok("focus: only sectors near the closest, at most 2 voices", () => {
  const v = planVoices({ left: 0.6, center: 0.9, right: 0.7 });
  assert.deepStrictEqual(v.map((x) => x.sector), ["left", "right"]);
  const w = planVoices({ left: 0.5, center: 2.2, right: null });
  assert.deepStrictEqual(w.map((x) => x.sector), ["left"]);   // center is >0.8 m farther: stays quiet
  assert.deepStrictEqual(planVoices({ left: null, center: 3.5, right: 9 }), []);
});

// synthetic depth maps for the WebXR sampler: (x,y) normalized view coords -> metres
ok("sampler: wall on the right", () => {
  const s = sampleSectors((x) => (x > 0.7 ? 0.6 : 3.0));
  assert.strictEqual(s.right, 0.6);
  assert.strictEqual(s.left, 3.0);
});
ok("sampler: ignores the floor band and invalid pixels", () => {
  const s = sampleSectors((x, y) => (y > 0.75 ? 0.3 : x < 0.2 ? 0 : 2.0)); // floor close, some 0 = invalid
  assert.strictEqual(s.center, 2.0);
  assert.strictEqual(s.left, 2.0);
});
ok("sampler: nearest surface uses a low percentile, not a single pixel", () => {
  let i = 0;
  const s = sampleSectors((x) => (x < 1 / 3 ? (i++ === 7 ? 0.2 : 1.5) : 2.5)); // one spike in left
  assert.strictEqual(s.left, 1.5);
});
ok("sampler: too few valid pixels -> null", () => {
  assert.strictEqual(sampleSectors(() => 0).center, null);
});
ok("per-ear pitch: base, side offset, center split, proximity rise", () => {
  L.resetSettings();
  L.setSettings({ ears: { left: { pitchHz: 400 }, right: { pitchHz: 800 } }, sideOffset: 12, centerSplit: 0, proximityRise: 0 });
  assert.strictEqual(sonarVoice("center", 2).freqL, 400);
  assert.strictEqual(sonarVoice("center", 2).freqR, 800);
  assert.strictEqual(sonarVoice("left", 2).freqL, 200);   // -12 st = one octave down
  assert.strictEqual(sonarVoice("right", 2).freqR, 1600); // +12 st = one octave up
  L.setSettings({ centerSplit: 6 });
  assert.ok(sonarVoice("center", 2).freqL < 400 && sonarVoice("center", 2).freqR > 800);
  L.setSettings({ centerSplit: 0, proximityRise: 12 });
  assert.ok(sonarVoice("center", 0.35).freqL >= 795, "touching = +1 octave");
});
ok("strict routing: left only left ear, right only right ear, center both", () => {
  L.resetSettings();
  const l = sonarVoice("left", 0.8), r = sonarVoice("right", 0.8), c = sonarVoice("center", 0.8);
  assert.ok(l.gainL > 0 && l.gainR === 0);
  assert.ok(r.gainR > 0 && r.gainL === 0);
  assert.ok(c.gainL > 0 && c.gainL === c.gainR);
});
ok("muting one ear: that ear gets nothing, the other is unchanged", () => {
  L.resetSettings();
  const before = sonarVoice("right", 0.8).gainR;
  L.setSettings({ ears: { left: { maxVolume: 0 } } });
  assert.strictEqual(sonarVoice("left", 0.8), null, "left-only sound with a muted left ear is dropped");
  assert.strictEqual(sonarVoice("center", 0.8).gainL, 0);
  assert.strictEqual(sonarVoice("right", 0.8).gainR, before);
  assert.deepStrictEqual(planVoices({ left: 0.5, center: 0.9, right: 1.0 }).map((v) => v.sector), ["center", "right"]);
  L.resetSettings();
});
ok("per-ear max volume is independent", () => {
  L.resetSettings();
  L.setSettings({ ears: { left: { maxVolume: 0.8 }, right: { maxVolume: 0.2 } } });
  const touch = sonarVoice("center", 0.35);
  assert.ok(Math.abs(touch.gainL - 0.8) < 1e-3 && Math.abs(touch.gainR - 0.2) < 1e-3);
  L.setSettings({ ears: { right: { maxVolume: 0 } } });
  assert.strictEqual(sonarVoice("right", 0.5), null, "right-only sound with a muted right ear is dropped");
});
ok("per-ear max beep rate is independent (center = average)", () => {
  L.resetSettings();
  L.setSettings({ ears: { left: { maxRateHz: 4 }, right: { maxRateHz: 10 } } });
  assert.strictEqual(sonarVoice("left", 0.35).intervalMs, 250);
  assert.strictEqual(sonarVoice("right", 0.35).intervalMs, 100);
  assert.strictEqual(sonarVoice("center", 0.35).intervalMs, Math.round(1000 / 7));
  assert.ok(sonarVoice("left", 2.4).intervalMs >= 600, "far stays slow");
});
ok("range limit and clamping", () => {
  L.resetSettings();
  L.setSettings({ rangeM: 1.2 });
  assert.strictEqual(sonarVoice("center", 1.5), null);
  assert.ok(sonarVoice("center", 1.0));
  const c = L.setSettings({ ears: { left: { pitchHz: 99999, maxVolume: -3 } }, rangeM: "far", proximityRise: 50 });
  assert.strictEqual(c.ears.left.pitchHz, L.LIMITS.pitchHz[1]);
  assert.strictEqual(c.ears.left.maxVolume, 0);
  assert.strictEqual(c.rangeM, 1.2, "non-number ignored");
  assert.strictEqual(c.proximityRise, L.LIMITS.proximityRise[1]);
  assert.deepStrictEqual(L.resetSettings(), JSON.parse(JSON.stringify(L.DEFAULTS)));
});
console.log(`${n} passed`);
