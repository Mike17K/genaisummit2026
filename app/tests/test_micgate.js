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

check("hysteresis keeps softer mid-sentence syllables open without letting room noise open from closed", () => {
  const gClosed = new MicGate({ sustainFactor: 0.62 });
  feed(gClosed, [0.042, 0.042, 0.042, 0.042], 1000, 0.055);
  assert(!gClosed.open, "room noise below gate (0.042 < 0.055) never opens turn");

  const gOpen = new MicGate({ sustainFactor: 0.62 });
  feed(gOpen, [0.07, 0.07, 0.07], 1000, 0.055);
  assert(gOpen.open);
  const r = gOpen.process(loud(), 0.042, 1300, 0.055);
  assert.deepStrictEqual(flags(r), [1], "softer syllable (0.042 > 0.055*0.62) stays voiced once open");
});

check("adaptiveFloor + peakDropFactor closes cleanly in loud room even when manual gate is lowered below ambient noise", () => {
  const g = new MicGate({
    onsetMs: 170,
    hangMs: 500,
    grace: 1,
    sustainFactor: 0.78,
    adaptiveFloor: true,
    peakDropFactor: 0.35,
    maxOpenMs: 7500,
  });
  // Loud venue ambient noise = 0.032, user lowered gate all the way to 0.015!
  feed(g, [0.032, 0.032, 0.032, 0.032], 1000, 0.015);
  assert(!g.open, "steady loud room noise does not falsely open even when manual gate < room noise");

  // User speaks at 0.110 -> opens promptly
  feed(g, [0.110, 0.110, 0.110], 1400, 0.015);
  assert(g.open, "foreground speech opens cleanly");

  // User stops speaking, mic returns to 0.032 loud room noise -> must stop extending voice (flag=0) and close!
  const after = [];
  for (let i = 0; i < 8; i++) {
    after.push(g.process(loud(), 0.032, 1700 + i * 85, 0.015));
  }
  assert(after.every((r) => r[0][1] === 0), "loud room noise after speech is tagged quiet (flag=0), never stuck flag=1");
  assert(!g.open, "gate closes cleanly after hangMs even though gate (0.015) < room noise (0.032)");
});

check("maxOpenMs forces a stuck turn closed and flushes >=400ms quiet so server always answers", () => {
  const g = new MicGate({ onsetMs: 170, hangMs: 500, maxOpenMs: 2000 });
  feed(g, [HIGH, HIGH, HIGH], 1000, GATE); // opens at 1085
  assert(g.open);
  const forced = g.process(loud(), HIGH, 3200, GATE);
  assert(!g.open && forced[0][1] === 0 && isZero(forced[0][0]), "maxOpenMs forces turn closed");
  const holdQuiet = g.process(loud(), HIGH, 3450, GATE);
  assert(!g.open && holdQuiet[0][1] === 0, "stays quiet for ~500ms so server TurnTracker ends turn");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
