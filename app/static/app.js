// Realtime voice: mic (PCM16 16 kHz) -> /live -> Gemini Live -> speech (PCM16 24 kHz) back.
// Gemini detects when you start and stop talking, and you can interrupt it at any time.
// Add ?debug=0 to hide the debug panel.
const go = document.getElementById("go");
const statusEl = document.getElementById("status");
const badgeEl = document.getElementById("badge");
const debugEl = document.getElementById("debug");
const cam = document.getElementById("cam");
const canvas = document.getElementById("canvas");

const IN_RATE = 16000;
const OUT_RATE = 24000;
// Noise gate: mic audio below this level is replaced by silence, so room noise and speaker echo are not sent.
// Change it on the page (gate - / gate +), with ?gate=0.05, or it is remembered from last time.
const GATE_DEFAULT = 0.03;
const GATE_HANG_MS = 800; // keep sending this long after the voice drops, so word endings are not cut
function loadGate() {
  const q = parseFloat(new URLSearchParams(location.search).get("gate"));
  if (q > 0) return q;
  try { const v = parseFloat(localStorage.getItem("eyesGate")); if (v > 0) return v; } catch (_) {}
  return GATE_DEFAULT;
}
let gate = loadGate();

// How long the assistant waits after you stop talking before it answers (applies the next time you tap Start).
const WAIT_DEFAULT_MS = 1200;
function loadWait() {
  const q = parseInt(new URLSearchParams(location.search).get("silence"), 10);
  if (q > 0) return q;
  try { const v = parseInt(localStorage.getItem("eyesWait"), 10); if (v > 0) return v; } catch (_) {}
  return WAIT_DEFAULT_MS;
}
let waitMs = loadWait();
let gateOpenUntil = 0;
let prevChunk = null;

let socket, stream, ctx, processor, frameTimer, wakeLock, debugTimer;
let running = false;
let nextPlayTime = 0;
const playing = new Set();

// ---- debug state ----------------------------------------------------------
const dbg = {
  state: "idle", camera: "-", mic: "-", audioCtx: "-", ws: "-", gemini: "-",
  micLevel: 0, micPeak: 0, sentKB: 0, sentFrames: 0, recvKB: 0, recvChunks: 0,
  lastHeard: "", lastReply: "", lastEvent: "", lastModelAudioAt: 0, lastSpeechAt: 0,
  error: "", startedAt: 0, log: [],
  watch: "-", lastAlert: "-", alertMode: "normal", alerts: 0,
};
const hideDebug = new URLSearchParams(location.search).get("debug") === "0";
if (hideDebug) debugEl.style.display = "none";

function note(msg) {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  dbg.log.push(`${t} ${msg}`);
  if (dbg.log.length > 14) dbg.log.shift();
  console.log("[eyes]", msg);
}

function setState(state, text) {
  dbg.state = state;
  badgeEl.textContent = state;
  badgeEl.className = state;
  if (text) statusEl.textContent = text;
  go.dataset.state = state;
  note("state -> " + state + (text ? " (" + text + ")" : ""));
}

function cls(ok, text) { return `<span class="${ok === true ? "ok" : ok === false ? "bad" : "warn"}">${text}</span>`; }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

function renderDebug() {
  if (hideDebug) return;
  const now = Date.now();
  const wsState = socket ? ["connecting", "open", "closing", "closed"][socket.readyState] : "-";
  const sinceAudio = dbg.lastModelAudioAt ? ((now - dbg.lastModelAudioAt) / 1000).toFixed(1) + "s ago" : "never";
  const talkingNow = dbg.micLevel > gate;
  const up = dbg.startedAt ? Math.round((now - dbg.startedAt) / 1000) + "s" : "-";
  const rows = [
    ["state", cls(dbg.state === "error" ? false : dbg.state === "idle" ? null : true, dbg.state) + "  up " + up],
    ["camera", cls(dbg.camera === "ok" ? true : dbg.camera === "-" ? null : false, dbg.camera) + `  sent ${dbg.sentFrames} frames`],
    ["mic", cls(dbg.mic === "ok" ? true : dbg.mic === "-" ? null : false, dbg.mic) + `  sent ${dbg.sentKB.toFixed(0)} KB` +
      `<div id="meter"><div style="width:${Math.min(100, dbg.micLevel * 600)}%"></div></div>` +
      `level ${dbg.micLevel.toFixed(3)} peak ${dbg.micPeak.toFixed(3)} gate ${gate.toFixed(3)} ${talkingNow ? cls(true, "(sending your voice)") : cls(null, "(below gate: sending silence)")}`],
    ["audio ctx", cls(dbg.audioCtx === "running" ? true : dbg.audioCtx === "-" ? null : false, dbg.audioCtx)],
    ["websocket", cls(wsState === "open" ? true : wsState === "-" ? null : wsState === "connecting" ? null : false, wsState) + (dbg.ws !== "-" ? "  " + esc(dbg.ws) : "")],
    ["gemini", cls(dbg.gemini === "ready" ? true : dbg.gemini === "-" ? null : false, esc(dbg.gemini))],
    ["received", `${dbg.recvKB.toFixed(0)} KB in ${dbg.recvChunks} chunks, last audio ${sinceAudio}`],
    ["you said", esc(dbg.lastHeard || "-")],
    ["eyes said", esc(dbg.lastReply || "-")],
    ["watcher", esc(dbg.watch) + "  (mode: " + esc(dbg.alertMode) + ")"],
    ["last alert", (dbg.alerts ? dbg.alerts + " so far. " : "") + esc(dbg.lastAlert)],
    ["last event", esc(dbg.lastEvent || "-")],
  ];
  if (dbg.error) rows.push(["error", cls(false, esc(dbg.error))]);
  debugEl.innerHTML = "<table>" + rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("") + "</table>" +
    `<div id="log">${esc(dbg.log.join("\n"))}</div>`;
}

function updateLiveState() {
  // Derive what is happening from the audio flow, so the badge matches reality.
  if (!running) return;
  const now = Date.now();
  if (dbg.micLevel > gate) dbg.lastSpeechAt = now;
  const speaking = playing.size > 0 || (dbg.lastModelAudioAt && now - dbg.lastModelAudioAt < 700);
  let next = "listening";
  if (speaking) next = "speaking";
  else if (dbg.micLevel > gate) next = "hearing";
  else if (dbg.lastSpeechAt && now - dbg.lastSpeechAt < 6000 && dbg.lastSpeechAt > dbg.lastModelAudioAt) next = "thinking";
  if (next !== dbg.state) setState(next, { listening: "Listening. Ask me anything.", hearing: "Hearing you...", thinking: "Thinking...", speaking: "Speaking..." }[next]);
}

function fail(where, err) {
  const name = err && err.name ? err.name + ": " : "";
  dbg.error = `${where}: ${name}${err && err.message ? err.message : err}`;
  note("ERROR " + dbg.error);
  setState("error", dbg.error);
}

window.addEventListener("error", (e) => fail("page", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => fail("promise", e.reason));

// ---- sounds ---------------------------------------------------------------
function chime(freq = 880) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = freq; g.gain.value = 0.08;
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.12);
}

// Alert cue: short and distinct, plus a buzz. Played the moment an alert is approved, before the spoken words arrive.
function alertCue(urgency) {
  if (!ctx) return;
  const tones = urgency === "high" ? [[990, 0, 0.09], [990, 0.13, 0.09]] : [[660, 0, 0.07]];
  for (const [freq, at, len] of tones) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = 0.12;
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + len);
  }
  try { navigator.vibrate?.(urgency === "high" ? [90, 50, 90] : [60]); } catch (_) {}
}

// ---- playback -------------------------------------------------------------
function playPcm(arrayBuffer) {
  dbg.recvKB += arrayBuffer.byteLength / 1024;
  dbg.recvChunks++;
  dbg.lastModelAudioAt = Date.now();
  const int16 = new Int16Array(arrayBuffer);
  const buf = ctx.createBuffer(1, int16.length, OUT_RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  nextPlayTime = Math.max(nextPlayTime, ctx.currentTime + 0.05);
  src.start(nextPlayTime);
  nextPlayTime += buf.duration;
  playing.add(src);
  src.onended = () => playing.delete(src);
}

function stopPlayback() {
  for (const s of playing) { try { s.stop(); } catch (_) {} }
  playing.clear();
  nextPlayTime = 0;
}

// ---- microphone -----------------------------------------------------------
function downsampleToInt16(float32, fromRate) {
  const ratio = fromRate / IN_RATE;
  const n = Math.floor(float32.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, float32.length - 1);
    const v = float32[i0] + (float32[i1] - float32[i0]) * (pos - i0);
    out[i] = Math.max(-1, Math.min(1, v)) * 32767;
  }
  return out;
}

function startMic() {
  const source = ctx.createMediaStreamSource(stream);
  processor = ctx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    dbg.micLevel = Math.sqrt(sum / input.length);
    dbg.micPeak = Math.max(dbg.micPeak * 0.995, dbg.micLevel);
    if (!socket || socket.readyState !== 1) return;
    const pcm = downsampleToInt16(input, ctx.sampleRate);
    const now = Date.now();
    const wasOpen = now < gateOpenUntil;
    if (dbg.micLevel > gate) gateOpenUntil = now + GATE_HANG_MS;
    if (now < gateOpenUntil) {
      if (!wasOpen && prevChunk) socket.send(prevChunk.buffer); // include the chunk just before the voice started
      socket.send(pcm.buffer);
      dbg.sentKB += pcm.byteLength / 1024;
    } else {
      socket.send(new Int16Array(pcm.length).buffer); // silence keeps the timing steady and lets the server detect the end of your sentence
    }
    prevChunk = pcm;
  };
  const mute = ctx.createGain(); mute.gain.value = 0; // keeps the processor running without echoing the mic
  source.connect(processor); processor.connect(mute); mute.connect(ctx.destination);
  const track = stream.getAudioTracks()[0];
  dbg.mic = "ok";
  note(`mic: ${track ? track.label || "default" : "no track"} @ ${ctx.sampleRate} Hz`);
}

// ---- camera ---------------------------------------------------------------
function sendFrame() {
  if (!cam.videoWidth || !socket || socket.readyState !== 1) return;
  canvas.width = 640;
  canvas.height = Math.round(640 * cam.videoHeight / cam.videoWidth);
  canvas.getContext("2d").drawImage(cam, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
  socket.send(JSON.stringify({ type: "frame", data }));
  dbg.sentFrames++;
}

// ---- lifecycle ------------------------------------------------------------
async function start() {
  Object.assign(dbg, { error: "", camera: "-", mic: "-", ws: "-", gemini: "-", sentKB: 0, sentFrames: 0, recvKB: 0,
    recvChunks: 0, lastHeard: "", lastReply: "", lastEvent: "", lastModelAudioAt: 0, lastSpeechAt: 0, micPeak: 0,
    startedAt: Date.now() });
  setState("starting", "Starting...");

  // Must happen inside the tap so phones allow audio.
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  dbg.audioCtx = ctx.state;
  ctx.onstatechange = () => { dbg.audioCtx = ctx.state; note("audio context: " + ctx.state); };

  note("asking for camera and microphone");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: { facingMode: "environment" },
    });
  } catch (err) {
    dbg.camera = dbg.mic = "blocked (" + err.name + ")";
    throw err;
  }
  cam.srcObject = stream;
  await cam.play();
  dbg.camera = "ok";
  note(`camera: ${cam.videoWidth}x${cam.videoHeight}`);

  setState("connecting", "Connecting to the assistant...");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/live?silence=${waitMs}`);
  note(`wait after you stop talking: ${waitMs} ms`);
  socket.binaryType = "arraybuffer";
  socket.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) { playPcm(e.data); return; }
    const m = JSON.parse(e.data);
    dbg.lastEvent = m.type + (m.name ? ":" + m.name : "");
    if (m.type === "ready") {
      dbg.gemini = "ready"; chime(); note("gemini session ready");
      socket.send(JSON.stringify({ type: "mode", mode: dbg.alertMode }));
    }
    else if (m.type === "interrupted") { stopPlayback(); note("interrupted by you"); }
    else if (m.type === "heard") { dbg.lastHeard = m.text; note("heard: " + m.text); }
    else if (m.type === "reply") { if (m.text) { dbg.lastReply = m.text; note("reply: " + m.text); } }
    else if (m.type === "tool") note("tool call: " + m.name + " " + JSON.stringify(m.args || {}));
    else if (m.type === "error") { dbg.gemini = "error"; fail("server", m.text); chime(330); stop(false); }
    else if (m.type === "go_away") note("server says the session will end soon");
    else if (m.type === "alert") {
      stopPlayback();                // whatever was being said is cancelled at once
      alertCue(m.urgency);
      dbg.alerts++; dbg.lastAlert = `${m.urgency.toUpperCase()}: ${m.text}`;
      note(`ALERT (${m.urgency}): ${m.text}`);
    }
    else if (m.type === "watch") {
      dbg.watch = `${m.outcome}${m.key ? " [" + m.key + "]" : ""} conf ${(+m.confidence).toFixed(2)} ${m.ms} ms`;
    }
    else if (m.type === "speak_text") { try { speechSynthesis.speak(new SpeechSynthesisUtterance(m.text)); } catch (_) {} note("fallback voice: " + m.text); }
    else if (m.type === "suppressed") note(`held back (${m.reason}): ${m.key}`);
    else if (m.type === "mode") { dbg.alertMode = m.mode; syncModeButton(); note("alert mode: " + m.mode); }
  };
  socket.onclose = (e) => {
    dbg.ws = `closed code ${e.code}${e.reason ? " " + e.reason : ""}`;
    note("websocket closed " + dbg.ws);
    if (running) { fail("websocket", dbg.ws); stop(false); }
  };
  await new Promise((res, rej) => {
    socket.onopen = () => { dbg.ws = "open"; note("websocket open"); res(); };
    socket.onerror = () => { dbg.ws = "error"; rej(new Error("could not reach the server (websocket error)")); };
  });

  startMic();
  frameTimer = setInterval(sendFrame, 1000);
  try { wakeLock = await navigator.wakeLock?.request("screen"); note("screen wake lock on"); } catch (_) { note("screen wake lock unavailable"); }

  running = true;
  dbg.startedAt = Date.now();
  go.setAttribute("aria-pressed", "true");
  go.textContent = "Listening. Tap to stop.";
  setState("listening", "Waiting for the assistant...");
}

function stop(announce = true) {
  const wasError = dbg.state === "error";
  running = false;
  clearInterval(frameTimer);
  stopPlayback();
  processor?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  if (socket && socket.readyState <= 1) socket.close();
  wakeLock?.release?.();
  if (ctx && announce) chime(440);
  go.setAttribute("aria-pressed", "false");
  go.textContent = wasError ? "Tap to try again" : "Tap to start";
  if (!wasError) setState("idle", announce ? "Stopped. Tap to start." : "Tap to start");
}

const gateVal = document.getElementById("gateVal");
function setGate(v) {
  gate = Math.min(0.3, Math.max(0.005, Math.round(v * 1000) / 1000));
  gateVal.textContent = gate.toFixed(3);
  try { localStorage.setItem("eyesGate", String(gate)); } catch (_) {}
  note("gate set to " + gate.toFixed(3));
}
document.getElementById("gateDown").addEventListener("click", () => setGate(gate - 0.005));
document.getElementById("gateUp").addEventListener("click", () => setGate(gate + 0.005));
gateVal.textContent = gate.toFixed(3);

const MODES = ["normal", "urgent_only", "off"];
const modeBtn = document.getElementById("modeBtn");
function syncModeButton() {
  modeBtn.textContent = { normal: "alerts: normal", urgent_only: "alerts: urgent only", off: "alerts: off" }[dbg.alertMode];
}
try { const saved = localStorage.getItem("eyesMode"); if (MODES.includes(saved)) dbg.alertMode = saved; } catch (_) {}
syncModeButton();
modeBtn.addEventListener("click", () => {
  dbg.alertMode = MODES[(MODES.indexOf(dbg.alertMode) + 1) % MODES.length];
  try { localStorage.setItem("eyesMode", dbg.alertMode); } catch (_) {}
  syncModeButton();
  if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "mode", mode: dbg.alertMode }));
  note("alert mode: " + dbg.alertMode);
});

const waitVal = document.getElementById("waitVal");
function setWait(v) {
  waitMs = Math.min(4000, Math.max(300, Math.round(v / 100) * 100));
  waitVal.textContent = waitMs + " ms";
  try { localStorage.setItem("eyesWait", String(waitMs)); } catch (_) {}
  note("wait set to " + waitMs + " ms" + (running ? " (applies next start)" : ""));
}
document.getElementById("waitDown").addEventListener("click", () => setWait(waitMs - 200));
document.getElementById("waitUp").addEventListener("click", () => setWait(waitMs + 200));
waitVal.textContent = waitMs + " ms";

go.addEventListener("click", () => {
  if (running) stop();
  else start().catch((e) => { fail("start", e); stop(false); });
});

debugTimer = setInterval(() => { updateLiveState(); renderDebug(); }, 200);
renderDebug();
