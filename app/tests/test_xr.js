// WebXR depth sampling (pure parts). Run: node tests/test_xr.js
const assert = require("assert");
const { sampleSectors, depthThumb } = require("../static/xr_depth.js");
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("PASS ", name); };

ok("wall on the right is the right sector", () => {
  const s = sampleSectors((x) => (x > 0.7 ? 0.6 : 3.0));
  assert.strictEqual(s.right, 0.6);
  assert.strictEqual(s.left, 3.0);
});
ok("floor band and invalid pixels ignored", () => {
  const s = sampleSectors((x, y) => (y > 0.75 ? 0.3 : x < 0.2 ? 0 : 2.0));
  assert.strictEqual(s.center, 2.0);
  assert.strictEqual(s.left, 2.0);
});
ok("one noisy pixel does not fake an obstacle", () => {
  let i = 0;
  const s = sampleSectors((x) => (x < 1 / 3 ? (i++ === 7 ? 0.2 : 1.5) : 2.5));
  assert.strictEqual(s.left, 1.5);
});
ok("too few valid pixels -> null", () => assert.strictEqual(sampleSectors(() => 0).center, null));
ok("thumbnail: near bright, far dark, invalid black, left/right preserved", () => {
  const t = depthThumb((x) => (x < 0.5 ? 0.3 : 4.0), 8);
  assert.strictEqual(t[0], 255);      // top-left near
  assert.strictEqual(t[7], 0);        // top-right far
  assert.strictEqual(depthThumb(() => NaN, 4).every((v) => v === 0), true);
});
console.log(`${n} passed`);
