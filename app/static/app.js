// Realtime voice: mic (PCM16 16 kHz) -> /live -> Gemini Live -> speech (PCM16 24 kHz) back,
// running in parallel with the stateless 3-frame safety watcher.
(function () {
"use strict";
const go = document.getElementById("go");
const statusEl = document.getElementById("status");
const badgeEl = document.getElementById("badge");
const debugEl = document.getElementById("debug");
const cam = document.getElementById("cam");
const canvas = document.getElementById("canvas");

const IN_RATE = 16000;
const OUT_RATE = 24000;
const SILENCE_WAIT_MS = 400; // Fixed 400 ms wait after user stops talking
const GATE_DEFAULT = 0.03;
const ECHO_FACTOR = 2.5;

function loadGate() {
  const q = parseFloat(new URLSearchParams(location.search).get("gate"));
  if (q > 0) return q;
  try { const v = parseFloat(localStorage.getItem("eyesGate")); if (v > 0) return v; } catch (_) {}
  return GATE_DEFAULT;
}
let gate = loadGate();
const micGate = new MicGate({ onsetMs: 250, hangMs: 500, rate: IN_RATE });

const imu = new Looming.ImuState({ panDegS: 160, stableDegS: 110 });
window.addEventListener("devicemotion", (e) => imu.handleMotion(e, performance.now()));
window.addEventListener("deviceorientation", (e) => imu.handleOrientation(e));
let spatial = null;
const ON_DEVICE = new URLSearchParams(location.search).get("ondevice") === "1";
let alertMuteUntil = 0;
let assistantEnabled = true;
let sessionLang = "";
try {
  const savedL = localStorage.getItem("eyesLang");
  if (savedL === "English" || savedL === "Greek") sessionLang = savedL;
} catch (_) {}

function requestSensorPermissions() {
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") DeviceMotionEvent.requestPermission().catch(() => {});
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") DeviceOrientationEvent.requestPermission().catch(() => {});
  } catch (_) {}
}

// Expressive local TTS calibrated to danger_level 1..5
function speakLocal(text, dangerLevel = 0) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = /[\u0370-\u03ff\u1f00-\u1fff]/.test(text) ? "el-GR" : "en-US";
    const lvl = Math.max(1, Math.min(5, +dangerLevel || 3));
    u.rate = [1.0, 1.05, 1.12, 1.2, 1.3, 1.38][lvl];
    u.pitch = [1.0, 1.0, 1.05, 1.12, 1.22, 1.32][lvl];
    speechSynthesis.speak(u);
  } catch (_) {}
}

let socket, stream, ctx, processor, frameTimer, wakeLock, debugTimer;
let running = false;
let nextPlayTime = 0;
const playing = new Set();

const dbg = {
  state: "idle", camera: "-", mic: "-", audioCtx: "-", ws: "-", gemini: "-",
  micLevel: 0, micPeak: 0, sentKB: 0, sentFrames: 0, recvKB: 0, recvChunks: 0,
  lastHeard: "", lastReply: "", lastEvent: "", lastModelAudioAt: 0, lastSpeechAt: 0,
  error: "", startedAt: 0, log: [],
  watch: "-", lastAlert: "-", alertMode: "normal", alerts: 0, conn: "-", fps: 2, attention: "normal", frameStamps: [], voiceOpen: false, effGate: 0,
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
  const talkingNow = !!dbg.voiceOpen;
  const up = dbg.startedAt ? Math.round((now - dbg.startedAt) / 1000) + "s" : "-";
  const rows = [
    ["state", cls(dbg.state === "error" ? false : dbg.state === "idle" ? null : true, dbg.state) + "  up " + up],
    ["camera", cls(dbg.camera === "ok" ? true : dbg.camera === "-" ? null : false, dbg.camera) + `  sent ${dbg.sentFrames} frames`],
    ["camera rate", `${dbg.fps} fps set (measured ${(dbg.frameStamps.length / 3).toFixed(1)}), attention: ` + cls(dbg.attention === "normal" ? null : dbg.attention === "high" ? false : true, dbg.attention)],
    ["mic", cls(dbg.mic === "ok" ? true : dbg.mic === "-" ? null : false, dbg.mic) + `  sent ${dbg.sentKB.toFixed(0)} KB` +
      `<div id="meter"><div style="width:${Math.min(100, dbg.micLevel * 600)}%"></div></div>` +
      `level ${dbg.micLevel.toFixed(3)} peak ${dbg.micPeak.toFixed(3)} gate ${(dbg.effGate || gate).toFixed(3)}${dbg.effGate > gate ? " (raised: assistant speaking)" : ""} ${talkingNow ? cls(true, "(voice open: sending speech)") : dbg.micLevel > (dbg.effGate || gate) ? cls(null, "(sound above gate, waiting to confirm)") : cls(null, "(below gate: sending silence)")}`],
    ["audio ctx", cls(dbg.audioCtx === "running" ? true : dbg.audioCtx === "-" ? null : false, dbg.audioCtx)],
    ["session id", esc(dbg.conn) + "  (filter the server trace with /panel?conn=" + esc(dbg.conn) + ")"],
    ["websocket", cls(wsState === "open" ? true : wsState === "-" ? null : wsState === "connecting" ? null : false, wsState) + (dbg.ws !== "-" ? "  " + esc(dbg.ws) : "")],
    ["gemini", cls(dbg.gemini === "ready" ? true : dbg.gemini === "-" ? null : false, esc(dbg.gemini)) + " (assistant: " + (assistantEnabled ? "on" : "off") + ", lang: " + esc(sessionLang || "English") + ")"],
    ["received", `${dbg.recvKB.toFixed(0)} KB in ${dbg.recvChunks} chunks, last audio ${sinceAudio}`],
    ["you said", esc(dbg.lastHeard || "-")],
    ["eyes said", esc(dbg.lastReply || "-")],
    ["on-device", esc(spatial ? spatial.summary() : (ON_DEVICE ? "waiting to start" : "off (add ?ondevice=1 to try it)"))],
    ["phone motion", esc(imu.panning ? "panning" : imu.walking === true ? "walking" : imu.walking === false ? "stationary" : "movement unknown") + `  gyro ${imu.angularSpeed} deg/s, pitch ${imu.pitchDeg ?? "?"}`],
    ["watcher", esc(dbg.watch) + "  (mode: " + esc(dbg.alertMode) + ")"],
    ["last alert", (dbg.alerts ? dbg.alerts + " so far. " : "") + esc(dbg.lastAlert)],
    ["last event", esc(dbg.lastEvent || "-")],
  ];
  if (dbg.error) rows.push(["error", cls(false, esc(dbg.error))]);
  debugEl.innerHTML = "<table>" + rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("") + "</table>" +
    `<div id="log">${esc(dbg.log.join("\n"))}</div>`;
}

function updateLiveState() {
  if (!running) return;
  const now = Date.now();
  if (dbg.voiceOpen && assistantEnabled) dbg.lastSpeechAt = now;
  const speaking = playing.size > 0 || (dbg.lastModelAudioAt && now - dbg.lastModelAudioAt < 700);
  let next = "listening";
  if (speaking) next = "speaking";
  else if (dbg.voiceOpen && assistantEnabled) next = "hearing";
  else if (assistantEnabled && dbg.lastSpeechAt && now - dbg.lastSpeechAt < 6000 && dbg.lastSpeechAt > dbg.lastModelAudioAt) next = "thinking";
  const label = !assistantEnabled && next === "listening"
    ? "Safety watcher active (assistant off)."
    : { listening: "Listening. Ask me anything.", hearing: "Hearing you...", thinking: "Thinking...", speaking: "Speaking..." }[next];
  if (next !== dbg.state) setState(next, label);
}

function fail(where, err) {
  const name = err && err.name ? err.name + ": " : "";
  dbg.error = `${where}: ${name}${err && err.message ? err.message : err}`;
  note("ERROR " + dbg.error);
  setState("error", dbg.error);
}

window.addEventListener("error", (e) => fail("page", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => fail("promise", e.reason));

function chime(freq = 880) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = freq; g.gain.value = 0.08;
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.12);
}

// Danger-level calibrated alert cue + haptic buzz (levels 1..5).
function alertCue(urgency, dangerLevel = 0) {
  if (!ctx) return;
  const lvl = +dangerLevel || (urgency === "high" ? 4 : 2);
  let tones;
  if (lvl >= 5) tones = [[1240, 0, 0.08], [1240, 0.10, 0.08], [1240, 0.20, 0.10]];
  else if (lvl >= 4) tones = [[1040, 0, 0.09], [1040, 0.12, 0.09]];
  else if (lvl >= 3) tones = [[880, 0, 0.08], [880, 0.12, 0.08]];
  else tones = [[660, 0, 0.07]];

  for (const [freq, at, len] of tones) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = lvl >= 4 ? 0.16 : 0.11;
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + len);
  }
  try {
    navigator.vibrate?.(lvl >= 5 ? [120, 40, 120, 40, 140] : lvl >= 3 ? [90, 50, 90] : [60]);
  } catch (_) {}
}

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
  try { speechSynthesis.cancel(); } catch (_) {}
  for (const s of playing) { try { s.stop(); } catch (_) {} }
  playing.clear();
  nextPlayTime = 0;
}

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

function effectiveGate(now) {
  if (now < alertMuteUntil) return Math.max(gate * 4, 0.15);
  const assistantSpeaking = playing.size > 0 || (dbg.lastModelAudioAt && now - dbg.lastModelAudioAt < 600);
  return assistantSpeaking ? gate * ECHO_FACTOR : gate;
}

function sendAudio(pcm, flag) {
  const out = new Uint8Array(1 + pcm.byteLength);
  out[0] = flag;
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 1);
  socket.send(out.buffer);
  if (flag === 1 || pcm.some((v) => v !== 0)) dbg.sentKB += pcm.byteLength / 1024;
}

function startMic() {
  micGate.reset();
  const source = ctx.createMediaStreamSource(stream);
  processor = ctx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    dbg.micLevel = Math.sqrt(sum / input.length);
    dbg.micPeak = Math.max(dbg.micPeak * 0.995, dbg.micLevel);
    if (!socket || socket.readyState !== 1 || !assistantEnabled) {
      dbg.voiceOpen = false;
      return;
    }
    const pcm = downsampleToInt16(input, ctx.sampleRate);
    const now = Date.now();
    dbg.effGate = effectiveGate(now);
    const wasOpen = micGate.open;
    for (const [chunk, flag] of micGate.process(pcm, dbg.micLevel, now, dbg.effGate)) {
      sendAudio(chunk, flag);
    }
    dbg.voiceOpen = micGate.open;
    if (!wasOpen && micGate.open) setTimeout(() => sendFrame(true), 0);
  };
  const mute = ctx.createGain(); mute.gain.value = 0;
  source.connect(processor); processor.connect(mute); mute.connect(ctx.destination);
  const track = stream.getAudioTracks()[0];
  dbg.mic = "ok";
  note(`mic: ${track ? track.label || "default" : "no track"} @ ${ctx.sampleRate} Hz`);
}

function setFrameRate(fps) {
  fps = Math.min(5, Math.max(0.5, +fps || 1));
  dbg.fps = fps;
  clearInterval(frameTimer);
  frameTimer = setInterval(sendFrame, 1000 / fps);
}

const motionCanvas = document.createElement("canvas");
motionCanvas.width = motionCanvas.height = 16;
const motionCtx = motionCanvas.getContext("2d", { willReadFrequently: true });
let prevLuma = null;
function frameMotion() {
  try {
    motionCtx.drawImage(cam, 0, 0, 16, 16);
    const d = motionCtx.getImageData(0, 0, 16, 16).data;
    const luma = new Float32Array(256);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) luma[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    const m = Looming.lumaMotion(prevLuma, luma);
    prevLuma = luma;
    return m;
  } catch (_) { return null; }
}

function sendFrame(fresh = false) {
  if (!cam.videoWidth || !socket || socket.readyState !== 1) return;
  const w = fresh === true ? 640 : 384;
  canvas.width = w;
  canvas.height = Math.round(w * cam.videoHeight / cam.videoWidth);
  canvas.getContext("2d").drawImage(cam, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", fresh === true ? 0.6 : 0.5).split(",")[1];
  const motion = frameMotion();
  const msg = { type: "frame", data, imu: imu.snapshot() };
  if (motion !== null) msg.motion = Number(motion.toFixed(4));
  if (fresh === true) msg.fresh = true;
  socket.send(JSON.stringify(msg));
  dbg.sentFrames++;
  const t = Date.now();
  dbg.frameStamps.push(t);
  while (dbg.frameStamps.length && t - dbg.frameStamps[0] > 3000) dbg.frameStamps.shift();
}

async function start() {
  requestSensorPermissions();
  try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch (_) {}
  Object.assign(dbg, { error: "", camera: "-", mic: "-", ws: "-", gemini: "-", sentKB: 0, sentFrames: 0, recvKB: 0,
    recvChunks: 0, lastHeard: "", lastReply: "", lastEvent: "", lastModelAudioAt: 0, lastSpeechAt: 0, micPeak: 0,
    startedAt: Date.now() });
  setState("starting", "Starting...");

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
  const langParam = (sessionLang === "English" || sessionLang === "Greek") ? `&lang=${encodeURIComponent(sessionLang)}` : "";
  socket = new WebSocket(`${proto}://${location.host}/live?silence=${SILENCE_WAIT_MS}${langParam}${"speechSynthesis" in window ? "" : "&client_tts=0"}`);
  note(`wait after you stop talking: ${SILENCE_WAIT_MS} ms`);
  socket.binaryType = "arraybuffer";
  socket.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) { playPcm(e.data); return; }
    const m = JSON.parse(e.data);
    dbg.lastEvent = m.type + (m.name ? ":" + m.name : "");
    if (m.type === "ready") {
      if (m.lang === "English" || m.lang === "Greek") {
        sessionLang = m.lang;
        try { localStorage.setItem("eyesLang", sessionLang); } catch (_) {}
      }
      dbg.gemini = "ready"; dbg.conn = m.conn || "-"; chime(); note(`gemini session ready, id ${dbg.conn} (${sessionLang || "English"})`);
      socket.send(JSON.stringify({ type: "mode", mode: dbg.alertMode }));
      socket.send(JSON.stringify({ type: "assistant", enabled: assistantEnabled }));
    }
    else if (m.type === "lang") {
      if (m.lang === "English" || m.lang === "Greek") {
        sessionLang = m.lang;
        try { localStorage.setItem("eyesLang", sessionLang); } catch (_) {}
        note("language kept: " + sessionLang);
      }
    }
    else if (m.type === "interrupted") { stopPlayback(); note("interrupted"); }
    else if (m.type === "heard") { dbg.lastHeard = m.text; note("heard: " + m.text); }
    else if (m.type === "reply") { if (m.text) { dbg.lastReply = m.text; note("reply: " + m.text); } }
    else if (m.type === "tool") note("tool call: " + m.name + " " + JSON.stringify(m.args || {}));
    else if (m.type === "error") { dbg.gemini = "error"; fail("server", m.text); chime(330); stop(false); }
    else if (m.type === "go_away") note("server says the session will end soon");
    else if (m.type === "alert") {
      stopPlayback();
      micGate.reset();
      dbg.voiceOpen = false;
      alertCue(m.urgency, m.danger_level);
      alertMuteUntil = Date.now() + 1800;
      if (m.client_voice) setTimeout(() => speakLocal(m.text, m.danger_level), 110);
      const lvlTag = m.danger_level ? `L${m.danger_level} ` : "";
      dbg.alerts++;
      dbg.lastAlert = `${lvlTag}${m.urgency.toUpperCase()}${m.source === "local" ? " (on-device)" : ""}: ${m.text}${m.client_voice ? " [phone voice]" : m.voice_cached ? " [cached voice]" : ""}`;
      note(`ALERT (${lvlTag}${m.urgency}): ${m.text}`);
    }
    else if (m.type === "watch") {
      const lvlTag = m.danger_level ? ` L${m.danger_level}` : "";
      const codeTag = m.code ? ` ${m.code}` : "";
      const moveTag = m.move ? ` move:${m.move}` : "";
      dbg.watch = `${m.outcome}${lvlTag}${codeTag}${moveTag}${m.key ? " [" + m.key + "]" : ""} conf ${(+m.confidence).toFixed(2)} ${m.ms} ms`;
    }
    else if (m.type === "speak_text") { speakLocal(m.text, m.danger_level); note("fallback voice: " + m.text); }
    else if (m.type === "rate") {
      setFrameRate(m.fps); dbg.attention = m.attention;
      note(`camera rate ${m.fps} fps (attention ${m.attention})`);
    }
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
  setFrameRate(3);
  if (ON_DEVICE && typeof SpatialSentry === "function") spatial = new SpatialSentry({
    video: cam, imu,
    onLocalAlert: (h) => { if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "local_alert", ...h })); note(`on-device: ${h.label} approaching (growth ${h.growth}/s)`); },
  });
  if (spatial) spatial.init().then(() => { if (running && spatial) spatial.start(); note("on-device detector: " + (spatial ? spatial.status : "stopped")); });
  try { wakeLock = await navigator.wakeLock?.request("screen"); note("screen wake lock on"); } catch (_) { note("screen wake lock unavailable"); }

  running = true;
  dbg.startedAt = Date.now();
  go.setAttribute("aria-pressed", "true");
  go.textContent = "Listening. Tap to stop.";
  setState("listening", assistantEnabled ? "Listening. Ask me anything." : "Safety watcher active (assistant off).");
}

function stop(announce = true) {
  const wasError = dbg.state === "error";
  running = false;
  if (spatial) { spatial.stop(); spatial = null; }
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

const agentBtn = document.getElementById("agentBtn");
try { assistantEnabled = localStorage.getItem("eyesAssistant") !== "0"; } catch (_) {}
function syncAgentButton() {
  agentBtn.textContent = `assistant: ${assistantEnabled ? "on" : "off"}`;
}
syncAgentButton();
agentBtn.addEventListener("click", () => {
  assistantEnabled = !assistantEnabled;
  try { localStorage.setItem("eyesAssistant", assistantEnabled ? "1" : "0"); } catch (_) {}
  syncAgentButton();
  if (!assistantEnabled) stopPlayback();
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "assistant", enabled: assistantEnabled }));
  }
  note(`assistant is now ${assistantEnabled ? "on" : "off"}`);
});

go.addEventListener("click", () => {
  if (running) stop();
  else start().catch((e) => { fail("start", e); stop(false); });
});

debugTimer = setInterval(() => { updateLiveState(); renderDebug(); }, 200);
renderDebug();
})();
