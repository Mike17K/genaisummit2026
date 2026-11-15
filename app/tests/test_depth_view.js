// Depth view geometry + colormap (pure). Run: node tests/test_depth_view.js
const assert = require("assert");
const { colormap, fitRect, sectorGeometry, BAND } = require("../static/depth_view.js");
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("PASS ", name); };
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

ok("near is brighter than far (monotonic brightness)", () => {
  let prev = -1;
  for (let v = 0; v <= 255; v += 15) { const l = lum(colormap(v)); assert.ok(l >= prev - 1, `v=${v}`); prev = l; }
  assert.ok(lum(colormap(255)) > 4 * lum(colormap(0)));
});
ok("whole image always visible (contain), centered", () => {
  const wide = fitRect(800, 300), tall = fitRect(300, 800);
  assert.deepStrictEqual(wide, { x: 250, y: 0, w: 300, h: 300 });
  assert.deepStrictEqual(tall, { x: 0, y: 250, w: 300, h: 300 });
});
ok("ear dividers at exact thirds, band matches the sonar band", () => {
  const g = sectorGeometry({ x: 0, y: 0, w: 300, h: 300 });
  assert.deepStrictEqual(g.dividers, [100, 200]);
  assert.strictEqual(g.band.top, 300 * BAND.y0);
  assert.strictEqual(g.band.bottom, 300 * BAND.y1);
  assert.deepStrictEqual(g.sectors.map((s) => [s.key, s.x, s.w]), [["left", 0, 100], ["center", 100, 100], ["right", 200, 100]]);
});
ok("view band equals the band the depth worker and server use", () => {
  const fs = require("fs");
  const worker = fs.readFileSync(__dirname + "/../static/depth_worker.js", "utf8");
  const server = fs.readFileSync(__dirname + "/../server/depth/local_depth.py", "utf8");
  assert.ok(worker.includes(`height * ${BAND.y0}`) && worker.includes(`height * ${BAND.y1}`));
  assert.ok(server.includes(`h * ${BAND.y0}`) && server.includes(`h * ${BAND.y1}`));
});
console.log(`${n} passed`);
