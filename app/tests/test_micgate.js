// Microphone gate. Run: node tests/test_micgate.js   (needs Node only for this test; the app itself does not use Node)
const assert = require("assert");
const { MicGate } = require("../static/micgate.js");

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("PASS", name); }
  catch (e) { fail++; console.log("FAIL", name, "-", e.message); }
}

const N = 1360;                                   // 85 ms at 16 kHz
const loud = () => new Int16Array(N).fill(1000);
const quiet = () => new Int16Array(N).fill(0);
const GATE = 0.03, HIGH = 0.1, LOW = 0.005;
const flags = (res) => res.map((r) => r[1]);
const isZero = (pcm) => pcm.every((v) => v === 0);

function feed(g, seq, start = 1000, gate = GATE) {
  // seq: list of levels; loud levels send loud audio
  const out = [];
  let now = start;
  for (const level of seq) {
    out.push(g.process(level > LOW ? loud() : quiet(), level, now, gate));
    now += 85;
  }
  return out;
}

check("silence stays closed and sends zeros flagged quiet", () => {
  const g = new MicGate();
  const out = feed(g, [LOW, LOW, LOW, LOW]);
  assert(!g.open);
  out.forEach((r) => { assert.strictEqual(r.length, 1); assert.strictEqual(r[0][1], 0); assert(isZero(r[0][0])); });
});

check("one loud chunk (a click) does not open a turn and sends no real audio", () => {
  const g = new MicGate();
  const out = feed(g, [LOW, HIGH, LOW, LOW, LOW]);
  assert(!g.open);
  out.flat().forEach(([pcm, flag]) => { assert.strictEqual(flag, 0); assert(isZero(pcm)); });
});

check("two loud chunks (170 ms) are still too short", () => {
  const g = new MicGate();
  feed(g, [LOW, HIGH, HIGH, LOW, LOW]);
  assert(!g.open);
});

check("sustained sound (about 250 ms) opens the gate", () => {
  const g = new MicGate();
  feed(g, [LOW, HIGH, HIGH, HIGH]);
  assert(g.open);
});

check("on opening, the chunk before the voice and the onset chunks are sent, in order", () => {
  const g = new MicGate();
  const out = feed(g, [LOW, HIGH, HIGH, HIGH]);
  const opening = out[3];
  assert.deepStrictEqual(flags(opening), [0, 1, 1, 1]);          // pre-roll (quiet), then 3 voice chunks
});

check("after opening, voice is sent flagged voice", () => {
  const g = new MicGate();
  feed(g, [LOW, HIGH, HIGH, HIGH]);
  const r = g.process(loud(), HIGH, 2000, GATE);
  assert.deepStrictEqual(flags(r), [1]);
});

check("the tail after the voice stops is real audio flagged quiet, then zeros", () => {
  const g = new MicGate({ hangMs: 500 });
  feed(g, [HIGH, HIGH, HIGH], 1000);                              // opens at 1170
  const t0 = 1255;
  const tail = [];
  for (let i = 0; i < 10; i++) tail.push(g.process(loud(), LOW, t0 + 85 * i, GATE));
  const flagsSeen = tail.map((r) => r[0][1]);
  assert(flagsSeen.slice(0, 5).every((f) => f === 0));
  assert(!isZero(tail[0][0][0]), "the tail keeps real audio");
  assert(isZero(tail[9][0][0]) && !g.open, "after the hang the gate closes and sends zeros");
});

check("voice during the tail extends it", () => {
  const g = new MicGate({ hangMs: 500 });
  feed(g, [HIGH, HIGH, HIGH], 1000);
  g.process(loud(), LOW, 1300, GATE);
  const r = g.process(loud(), HIGH, 1500, GATE);
  assert.deepStrictEqual(flags(r), [1]);
  assert(g.hangUntil >= 1500 + 500);
});

check("one quiet chunk between loud ones is tolerated (speech dips)", () => {
  const g = new MicGate();
  feed(g, [HIGH, LOW, HIGH, HIGH]);
  assert(g.open);
});

check("two quiet chunks in a row reset the onset", () => {
  const g = new MicGate();
  feed(g, [HIGH, LOW, LOW, HIGH, HIGH]);
  assert(!g.open);
});

check("a raised gate (while the assistant speaks) ignores speech-level echo", () => {
  const g = new MicGate();
  feed(g, [0.05, 0.05, 0.05, 0.05, 0.05], 1000, GATE * 2.5);     // 0.05 < 0.075
  assert(!g.open);
  const g2 = new MicGate();
  feed(g2, [0.12, 0.12, 0.12, 0.12], 1000, GATE * 2.5);          // clearly louder than the echo
  assert(g2.open);
});

check("reset closes the gate", () => {
  const g = new MicGate();
  feed(g, [HIGH, HIGH, HIGH]);
  assert(g.open);
  g.reset();
  assert(!g.open);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
