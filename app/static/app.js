// Realtime voice: mic (PCM16 16 kHz) -> /live -> Gemini -> speech (PCM16 24 kHz) back,
// running in parallel with the always-on depth emergency-stop guard (Depth-Anything-V2 on phone WebGPU or laptop ONNX):
// when the camera-center distance drops to the stop threshold we send ONE image + compass to the server, which says
// "Stop!", blocks the answering pipeline and speaks the model's instruction on what to do.
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
const GATE_DEFAULT = 0.045;  // Balanced manual floor paired with adaptive room-noise floor
const GATE_STEP = 0.010;
const GATE_MAX = 0.50;
const ECHO_FACTOR = 1.6;        // gate multiplier while the assistant is audible (echo guard; AEC removes most echo)
const STOP_MIC_BLOCK_MS = 1000;  // only the "Stop!" phrase itself cannot be talked over
const ALERT_MUTE_MS = 900;       // raised gate while "Stop!" + its beep play

function loadGate() {
  const q = parseFloat(new URLSearchParams(location.search).get("gate"));
  if (q > 0) return q;
  try { const v = parseFloat(localStorage.getItem("eyesGateV4")); if (v > 0) return v; } catch (_) {}
  return GATE_DEFAULT;
}
let gate = loadGate();
const micGate = new MicGate({
  onsetMs: 170,
  hangMs: 500,
  rate: IN_RATE,
  grace: 1,
  sustainFactor: 0.78,
  adaptiveFloor: true,
  peakDropFactor: 0.35,
  maxOpenMs: 7500,
});

const imu = new Looming.ImuState({ panDegS: 160, stableDegS: 110 });
const INFO_FRAME_MIN_GAP_MS = 2500; // Max 0.4 fps on-demand Q&A frame when user speaks
const IMU_PUSH_MIN_GAP_MS = 250;
let lastInfoFrameAt = 0;
let lastAnyFrameAt = 0;
let lastImuPushAt = 0;
let lastPushedCompassDeg = null;

function maybePushImu() {
  if (!running || !socket || socket.readyState !== 1 || imu.compassDeg === null) return;
  const now = Date.now();
  if (now - lastImuPushAt < IMU_PUSH_MIN_GAP_MS) return;
  const diff = lastPushedCompassDeg === null
    ? 999
    : Math.abs((((imu.compassDeg - lastPushedCompassDeg) % 360) + 540) % 360 - 180);
  if (diff >= 5) {
    lastImuPushAt = now;
    lastPushedCompassDeg = imu.compassDeg;
    socket.send(JSON.stringify({ type: "imu", imu: imu.snapshot() }));
  }
}

window.addEventListener("devicemotion", (e) => imu.handleMotion(e, performance.now()));
window.addEventListener("deviceorientationabsolute", (e) => { imu.handleOrientation(e, true); maybePushImu(); });
window.addEventListener("deviceorientation", (e) => { imu.handleOrientation(e, false); maybePushImu(); });
let alertMuteUntil = 0;
let micBlockedUntil = 0;
let assistantEnabled = true;
let sessionLang = "";
try {
  const savedL = localStorage.getItem("eyesLang");
  if (savedL === "English" || savedL === "Greek") sessionLang = savedL;
} catch (_) {}

// Phone GPS (browser geolocation) for the places / tour-guide tools. Needs HTTPS and the user's permission.
const GPS_MIN_MOVE_M = 5;
const GPS_MIN_GAP_MS = 2000;
const GPS_HEARTBEAT_MS = 15000;
let gpsWatchId = null;
let gpsFix = null;          // latest {lat, lon, acc, at}
let gpsSent = null;         // last fix sent to the server
let gpsStatus = "off";

function gpsDistanceM(a, b) {
  const r = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function maybeSendGps(force = false) {
  if (!gpsFix || !socket || socket.readyState !== 1) return;
  const now = Date.now();
  if (!force && gpsSent) {
    const moved = gpsDistanceM(gpsSent, gpsFix);
    if (now - gpsSent.at < GPS_MIN_GAP_MS) return;
    if (moved < GPS_MIN_MOVE_M && now - gpsSent.at < GPS_HEARTBEAT_MS) return;
  }
  socket.send(JSON.stringify({ type: "gps", lat: gpsFix.lat, lon: gpsFix.lon, acc: gpsFix.acc }));
  gpsSent = { ...gpsFix, at: now };
}

function startGps() {
  if (!("geolocation" in navigator)) { gpsStatus = "unsupported"; return; }
  if (gpsWatchId !== null) return;
  gpsStatus = "waiting for fix";
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      gpsFix = { lat: c.latitude, lon: c.longitude, acc: Math.round(c.accuracy || 0), at: Date.now() };
      gpsStatus = `±${gpsFix.acc} m`;
      maybeSendGps();
    },
    (err) => {
      gpsStatus = err && err.code === 1 ? "permission denied" : `error: ${(err && err.message) || err}`.slice(0, 50);
      note("gps: " + gpsStatus);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
}

function stopGps() {
  if (gpsWatchId !== null) { try { navigator.geolocation.clearWatch(gpsWatchId); } catch (_) {} }
  gpsWatchId = null;
  gpsSent = null;
  gpsStatus = "off";
}

function requestSensorPermissions() {
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") DeviceMotionEvent.requestPermission().catch(() => {});
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") DeviceOrientationEvent.requestPermission().catch(() => {});
  } catch (_) {}
}

// Calm, natural local TTS calibrated to danger_level 1..5
function speakLocal(text, dangerLevel = 0) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = /[\u0370-\u03ff\u1f00-\u1fff]/.test(text) ? "el-GR" : "en-US";
    const lvl = Math.max(1, Math.min(5, +dangerLevel || 3));
    u.rate = [1.0, 1.0, 1.02, 1.06, 1.10, 1.14][lvl];
    u.pitch = [1.0, 1.0, 1.0, 1.02, 1.04, 1.06][lvl];
    speechSynthesis.speak(u);
  } catch (_) {}
}

const WS_RECONNECT_MS = 500;
let socket, stream, ctx, processor, frameTimer, wakeLock, debugTimer;
let running = false;
let reconnectTimer = null;
let reconnecting = false;
let reconnectAttempts = 0;
let nextPlayTime = 0;
const playing = new Set();

// Depth-Anything-V2-Small (Auto mobile->laptop perf switch | Mobile WebGPU | Laptop Server ONNX) + Web PDAF + Hold > 1s
const HOLD_DEPTH_MS = 1000;
const DEPTH_MODES = ["auto", "mobile", "laptop"];
let depthMode = "auto"; // Default: auto (starts mobile, switches to laptop if phone >280ms/frame)
try {
  const savedMode = localStorage.getItem("eyesDepthMode");
  if (DEPTH_MODES.includes(savedMode)) depthMode = savedMode;
} catch (_) {}
let depthDevice = depthMode === "laptop" ? "laptop" : "mobile";
let depthReason = depthMode === "auto" ? "mobile fast" : `forced ${depthMode}`;
let videoTrack = null;
let videoCaps = {};
let depthEngine = null;
const laptopCalibrator = new Looming.DepthCalibrator(4.5);
let lastLaptopDisp = null;
let laptopInFlight = false;
let laptopSentAt = 0;
let laptopRttEmaMs = null;
let laptopProvider = "Laptop ONNX";
let holdTimer = null;
let activePointerId = null;
let depthScanActive = false;
let suppressNextClick = false;
let suppressClickUntil = 0;
let smoothedDepthM = null;
let depthSource = "-";
let depthPollTimer = null;
let depthPulseTimer = null;
let lastPulseAt = 0;
let lastDepthProbeAt = 0;
let depthProbeSeq = 0;

// Depth emergency-stop guard (runs whenever alerts are not "off" and the hold scan is not active)
const qStop = parseFloat(new URLSearchParams(location.search).get("stop"));
let depthStopM = qStop > 0 ? qStop : 0.9;      // server sends its EYES_DEPTH_STOP_M in "ready"
let depthStopUrgentM = qStop > 0 ? qStop * 0.67 : 0.6;
const STOP_REARM_GAP_M = 0.5;                  // must back off this much past the threshold before the next stop
const GUARD_PAN_DEG_S = 60;                    // turning the phone changes the center depth without walking: ignore
const PRIORITY_BUZZ_GAP_MS = 1200;
// A stop needs the center depth to be FALLING (walking toward it), never just "close": standing by a wall is fine.
const approach = new Looming.ApproachDetector({ windowMs: 1500, minSpanMs: 450, minDropM: 0.25, minSpeedMps: 0.2 });
let lastPriorityBuzzAt = 0;
const GUARD_MOBILE_INTERVAL_MS = 180;          // ~5 fps on-phone guard
const GUARD_LAPTOP_GAP_MS = 220;               // ~4 fps laptop-ONNX guard
// Depth-Anything gives RELATIVE depth whose scale drifts with the scene, so the guard re-anchors metres with the
// Gemini center-crop probe just like the hold scan does (more often when something is getting close).
const GUARD_ANCHOR_FAR_MS = 3000;
const GUARD_ANCHOR_NEAR_MS = 1200;
const GUARD_STALE_MS = 3000;                   // no depth reading for this long -> show "stalled" in debug
const REARM_AFTER_STOP_MS = 8000;              // re-arm even if the user never backed off (e.g. still facing the wall)
const REARM_AFTER_HOLD_MS = 2000;
let stopArmed = true;
let stopRearmAt = 0;
let stopHits = 0;
let lastGuardReadingAt = 0;
let emergencyActive = false;
let emergencyTimer = null;
let guardTimer = null;

const dbg = {
  state: "idle", camera: "-", mic: "-", audioCtx: "-", ws: "-", gemini: "-",
  micLevel: 0, micPeak: 0, sentKB: 0, sentFrames: 0, sentWatchFrames: 0, sentInfoFrames: 0, recvKB: 0, recvChunks: 0,
  lastHeard: "", lastReply: "", lastEvent: "", lastModelAudioAt: 0, lastSpeechAt: 0,
  error: "", startedAt: 0, log: [],
  guard: "-", lastAlert: "-", alertMode: "normal", alerts: 0, conn: "-", fps: 1, frameStamps: [], voiceOpen: false, effGate: 0, depth: "-", depthModel: "idle", memory: "empty", memoryObj: { goal: "", notes: [] }, compassTarget: "",
};
const hideDebug = new URLSearchParams(location.search).get("debug") === "0";
if (hideDebug) debugEl.style.display = "none";
const dbgTableEl = document.getElementById("dbgTable");
const logEl = document.getElementById("log");
const memTitleEl = document.getElementById("memTitle");
const memListEl = document.getElementById("memlist");
const memEmptyEl = document.getElementById("memempty");
const memClearBtn = document.getElementById("memClear");

function formatMemory(mem) {
  if (!mem) return "empty";
  const parts = [];
  if (mem.goal) parts.push(`trying to: ${mem.goal}`);
  if (Array.isArray(mem.notes) && mem.notes.length) parts.push(`notes: ${mem.notes.join("; ")}`);
  return parts.length ? parts.join(" | ") : "empty";
}

function renderMemories(mem) {
  const goal = mem && mem.goal ? String(mem.goal).trim() : "";
  const notes = mem && Array.isArray(mem.notes) ? mem.notes.map((x) => String(x || "").trim()).filter(Boolean) : [];
  dbg.memoryObj = { goal, notes };
  dbg.memory = formatMemory(dbg.memoryObj);
  if (!memTitleEl || !memListEl || !memEmptyEl) return;
  const items = [];
  if (goal) items.push(`<li><span class="mem-tag">[goal]</span> ${esc(goal)}</li>`);
  for (let i = 0; i < notes.length; i++) {
    items.push(`<li><span class="mem-tag">[note ${i + 1}]</span> ${esc(notes[i])}</li>`);
  }
  memTitleEl.textContent = `memories (${items.length})`;
  if (memClearBtn) memClearBtn.hidden = items.length === 0;
  if (items.length === 0) {
    memEmptyEl.hidden = false;
    memListEl.hidden = true;
    memListEl.innerHTML = "";
  } else {
    memEmptyEl.hidden = true;
    memListEl.hidden = false;
    memListEl.innerHTML = items.join("");
  }
}

if (memClearBtn) {
  memClearBtn.addEventListener("click", () => {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: "memory_clear" }));
    }
    fetch("/memory/clear", { method: "POST" })
      .then((r) => r.json())
      .then((m) => renderMemories(m))
      .catch(() => renderMemories({ goal: "", notes: [] }));
    note("memories cleared");
  });
}

fetch("/memory")
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => { if (m) renderMemories(m); })
  .catch(() => {});

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
  const compassText = imu.compassDeg !== null
    ? `${imu.compassDeg}° ${imu.compassDir || ""}${imu.compassAbs ? "" : " (rel)"}${dbg.compassTarget ? "  -> target: " + dbg.compassTarget : ""}`
    : (dbg.compassTarget ? `waiting for sensor (target: ${dbg.compassTarget})` : "no sensor");
  const rows = [
    ["state", cls(dbg.state === "error" ? false : dbg.state === "idle" ? null : true, dbg.state) + "  up " + up],
    ["camera", cls(dbg.camera === "ok" ? true : dbg.camera === "-" ? null : false, dbg.camera) + `  context: ${dbg.sentWatchFrames} frames · Q&A: ${dbg.sentInfoFrames} frames (on speech)`],
    ["camera rate", `${dbg.fps} fps context frames (measured ${(dbg.frameStamps.length / 3).toFixed(1)}), Q&A <=0.4 fps`],
    ["mic", cls(dbg.mic === "ok" ? true : dbg.mic === "-" ? null : false, dbg.mic) + `  sent ${dbg.sentKB.toFixed(0)} KB` +
      `<div id="meter"><div style="width:${Math.min(100, dbg.micLevel * 250)}%"></div><i style="left:${Math.min(99, (micGate.lastOpenThresh || dbg.effGate || gate) * 250)}%"></i></div>` +
      `level ${dbg.micLevel.toFixed(3)} floor ${micGate.noiseFloor.toFixed(3)} open ${(micGate.lastOpenThresh || dbg.effGate || gate).toFixed(3)} gate ${gate.toFixed(3)}${dbg.effGate > gate ? " (raised: assistant speaking)" : ""} ${talkingNow ? cls(true, "(voice open: sending speech)") : dbg.micLevel > (micGate.lastOpenThresh || dbg.effGate || gate) ? cls(null, "(sound above gate, waiting to confirm)") : cls(null, "(below gate: sending silence)")}`],
    ["audio ctx", cls(dbg.audioCtx === "running" ? true : dbg.audioCtx === "-" ? null : false, dbg.audioCtx)],
    ["session id", esc(dbg.conn) + "  (filter the server trace with /panel?conn=" + esc(dbg.conn) + ")"],
    ["websocket", cls(wsState === "open" ? true : wsState === "-" ? null : wsState === "connecting" ? null : false, wsState) + (dbg.ws !== "-" ? "  " + esc(dbg.ws) : "")],
    ["gemini", cls(dbg.gemini === "ready" ? true : dbg.gemini === "-" ? null : false, esc(dbg.gemini)) + " (assistant: " + (assistantEnabled ? "on" : "off") + ", lang: " + esc(sessionLang || "English") + ")"],
    ["received", `${dbg.recvKB.toFixed(0)} KB in ${dbg.recvChunks} chunks, last audio ${sinceAudio}`],
    ["you said", esc(dbg.lastHeard || "-")],
    ["eyes said", esc(dbg.lastReply || "-")],
    ["user memory", esc(dbg.memory || "empty")],
    ["depth model", esc(`[${depthMode === "auto" ? "auto->" + depthDevice : depthMode}] ` + (dbg.depthModel || "-"))],
    ["center depth", esc(dbg.depth || "-")],
    ["compass", esc(compassText)],
    ["gps", esc(gpsStatus + (gpsFix ? `  (${gpsFix.lat.toFixed(5)}, ${gpsFix.lon.toFixed(5)}, ${Math.round((Date.now() - gpsFix.at) / 1000)}s ago)` : ""))],
    ["phone motion", esc(imu.panning ? "panning" : imu.walking === true ? "walking" : imu.walking === false ? "stationary" : "movement unknown") + `  gyro ${imu.angularSpeed} deg/s, pitch ${imu.pitchDeg ?? "?"}`],
    ["stop guard", esc(dbg.guard) + `  (mode: ${esc(dbg.alertMode)}, stop <= ${currentStopM().toFixed(2)} m, ${stopArmed ? "armed" : `re-arms > ${(currentStopM() + STOP_REARM_GAP_M).toFixed(2)} m or in ${Math.max(0, (stopRearmAt - Date.now()) / 1000).toFixed(0)} s`}${emergencyActive ? ", EMERGENCY" : ""})`],
    ["last alert", (dbg.alerts ? dbg.alerts + " so far. " : "") + esc(dbg.lastAlert)],
    ["last event", esc(dbg.lastEvent || "-")],
  ];
  if (dbg.error) rows.push(["error", cls(false, esc(dbg.error))]);
  const tableHtml = "<table>" + rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("") + "</table>";
  if (dbgTableEl) dbgTableEl.innerHTML = tableHtml;
  if (logEl) logEl.textContent = dbg.log.join("\n");
}

function updateLiveState() {
  if (!running || depthScanActive || emergencyActive || reconnecting || !socket || socket.readyState !== 1) return;
  const now = Date.now();
  if (dbg.voiceOpen && assistantEnabled) dbg.lastSpeechAt = now;
  const speaking = playing.size > 0 || (dbg.lastModelAudioAt && now - dbg.lastModelAudioAt < 700);
  let next = "listening";
  if (speaking) next = "speaking";
  else if (dbg.voiceOpen && assistantEnabled) next = "hearing";
  else if (assistantEnabled && dbg.lastSpeechAt && now - dbg.lastSpeechAt < 6000 && dbg.lastSpeechAt > dbg.lastModelAudioAt) next = "thinking";
  const label = !assistantEnabled && next === "listening"
    ? "Depth stop guard active (assistant off)."
    : { listening: "Listening. Ask me anything.", hearing: "Hearing you...", thinking: "Thinking...", speaking: "Speaking..." }[next];
  const btnLabel = {
    listening: "Listening. Tap to stop · Hold 1s for depth",
    hearing: "Hearing you... · Tap to stop",
    thinking: "Thinking... · Tap to stop",
    speaking: "Speaking... · Tap to stop",
  }[next];
  if (btnLabel && go.textContent !== btnLabel) go.textContent = btnLabel;
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
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  dbg.recvKB += arrayBuffer.byteLength / 1024;
  dbg.recvChunks++;
  dbg.lastModelAudioAt = Date.now();
  const int16 = new Int16Array(arrayBuffer);
  if (!int16.length) return;
  const buf = ctx.createBuffer(1, int16.length, OUT_RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  if (nextPlayTime > ctx.currentTime + 30) nextPlayTime = 0;
  nextPlayTime = Math.max(nextPlayTime, ctx.currentTime + 0.04);
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

// Is the assistant saying or doing anything the user's voice should cut?
function assistantBusyLocal() {
  let ttsSpeaking = false;
  try { ttsSpeaking = speechSynthesis.speaking; } catch (_) {}
  return playing.size > 0 || ttsSpeaking || emergencyActive || dbg.state === "thinking" || dbg.state === "speaking";
}

// The user's voice just opened the gate: silence everything at once (no round trip) and tell the server to cancel too.
function bargeIn() {
  if (!assistantBusyLocal()) return;
  stopPlayback();
  if (emergencyActive) endEmergency("user barge-in", 0, true);
  if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "barge_in" }));
  dbg.lastModelAudioAt = 0;
  note("barge-in: you spoke, assistant stopped");
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
    if (!socket || socket.readyState !== 1 || !assistantEnabled || depthScanActive || Date.now() < micBlockedUntil) {
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
    if (!wasOpen && micGate.open) bargeIn();
    if (!wasOpen && micGate.open && now - lastInfoFrameAt >= INFO_FRAME_MIN_GAP_MS) {
      lastInfoFrameAt = now;
      setTimeout(() => sendFrame(true), 0);
    }
  };
  const mute = ctx.createGain(); mute.gain.value = 0;
  source.connect(processor); processor.connect(mute); mute.connect(ctx.destination);
  const track = stream.getAudioTracks()[0];
  dbg.mic = "ok";
  note(`mic: ${track ? track.label || "default" : "no track"} @ ${ctx.sampleRate} Hz`);
}

// Low-rate context frames so a spoken question always has a recent picture (no video safety watcher any more)
function setFrameRate(fps) {
  fps = Math.min(3.0, Math.max(0.5, +fps || 1));
  dbg.fps = fps;
  clearInterval(frameTimer);
  frameTimer = setInterval(() => sendFrame(false), 1000 / fps);
}

function readPdafDistance() {
  if (!videoTrack || typeof videoTrack.getSettings !== "function") return null;
  try {
    return Looming.parseFocusDistance(videoTrack.getSettings(), videoCaps);
  } catch (_) {
    return null;
  }
}

const depthCanvas = document.createElement("canvas");
depthCanvas.width = depthCanvas.height = 128;
const depthCtx = depthCanvas.getContext("2d");

const laptopCanvas = document.createElement("canvas");
laptopCanvas.width = laptopCanvas.height = 168;
const laptopCtx = laptopCanvas.getContext("2d");

function ensureDepthEngine() {
  if (depthMode === "laptop") return;
  if (!depthEngine && typeof DepthEngine === "function") {
    depthEngine = new DepthEngine({
      video: cam,
      onStatus: (s) => { if (depthDevice === "mobile") dbg.depthModel = s; },
      onDepth: (distM, backend, ms) => {
        if (depthDevice === "mobile") updateDepthReading(distM, `${backend} ${ms}ms`);
      },
      // Called on every frame: must stay cheap and must never (re)start the depth loop itself
      onPerfChange: () => evaluateDepthTarget(true),
    });
  }
  if (depthEngine) {
    depthEngine.video = cam;
    depthEngine.init();
  }
}

// True when the on-phone WebGPU engine is the live depth source (ready and not failing)
function mobileDepthLive() {
  return depthDevice === "mobile" && !!(depthEngine && depthEngine.ready && !depthEngine.hasError);
}

function guardOn() {
  return running && dbg.alertMode !== "off";
}

function depthWanted() {
  return depthScanActive || guardOn();
}

function currentStopM() {
  return dbg.alertMode === "urgent_only" ? depthStopUrgentM : depthStopM;
}

// Keep the depth model running at the right rate: full speed while holding, throttled as the stop guard, off otherwise.
// Idempotent: call it from anywhere state changes.
function syncDepthGuard() {
  if (depthEngine) {
    if (depthDevice === "mobile" && depthWanted()) {
      depthEngine.setIntervalMs(depthScanActive ? 0 : GUARD_MOBILE_INTERVAL_MS);
      depthEngine.start();
    } else {
      depthEngine.stop();
    }
  }
  const wantGuardTimer = running && guardOn() && !depthScanActive;
  if (wantGuardTimer && !guardTimer) {
    guardTimer = setInterval(guardTick, 60);
  } else if (!wantGuardTimer && guardTimer) {
    clearInterval(guardTimer);
    guardTimer = null;
  }
  if (!guardOn()) { stopHits = 0; dbg.guard = "off"; }
}

// Guard housekeeping between depth frames: laptop-ONNX probes, metric re-anchoring, stall reporting.
function guardTick() {
  if (depthScanActive || !guardOn()) return;
  const now = Date.now();
  if (laptopInFlight && now - laptopSentAt > 800) laptopInFlight = false;
  const mobileReady = mobileDepthLive();
  if (!mobileReady && !laptopInFlight && now - laptopSentAt >= GUARD_LAPTOP_GAP_MS) sendLaptopDepthProbe();

  const pdaf = readPdafDistance();
  if (pdaf !== null) {
    if (mobileReady) depthEngine.anchorMetric(pdaf);
    else if (lastLaptopDisp !== null) laptopCalibrator.anchor(lastLaptopDisp, pdaf);
  } else {
    const near = smoothedDepthM !== null && smoothedDepthM <= currentStopM() + 1.0;
    sendCenterDepthProbe(near ? GUARD_ANCHOR_NEAR_MS : GUARD_ANCHOR_FAR_MS);
  }
  if (lastGuardReadingAt && now - lastGuardReadingAt > GUARD_STALE_MS) {
    dbg.guard = `stalled: no depth for ${((now - lastGuardReadingAt) / 1000).toFixed(1)} s (${depthDevice})`;
  }
}

function disarmStop(holdMs) {
  stopArmed = false;
  stopHits = 0;
  stopRearmAt = Date.now() + holdMs;
}

function calibEpoch() {
  return mobileDepthLive() ? depthEngine.calibrator.epoch : laptopCalibrator.epoch;
}

// The user is talking, or VoxEye is working on / answering what they asked: that has priority over stops.
function userHasPriority() {
  return micGate.open || dbg.voiceOpen || dbg.state === "hearing" || dbg.state === "thinking" ||
    (playing.size > 0 && !emergencyActive);
}

// Haptic-only nudge while the user has priority: no sound (it would leak into the mic), no speech cut.
function priorityBuzz(distM, a) {
  const now = Date.now();
  if (now - lastPriorityBuzzAt < PRIORITY_BUZZ_GAP_MS) return;
  lastPriorityBuzzAt = now;
  try { navigator.vibrate?.([70, 50, 70]); } catch (_) {}
  note(`approach ${distM.toFixed(2)} m (${a.speedMps} m/s) held: you are talking`);
}

// Fire the emergency stop only when the center surface is close AND getting closer (movement).
function checkDepthStop(distM) {
  if (!guardOn() || depthScanActive) { stopHits = 0; approach.reset(); return; }
  if ((imu.angularSpeed || 0) > GUARD_PAN_DEG_S || imu.panning) {
    stopHits = 0; approach.reset(); // rotating toward a wall is not walking into it
    return;
  }
  const a = approach.push(distM, Date.now(), calibEpoch());
  dbg.guard = `${distM.toFixed(2)} m via ${depthSource}, ${a.approaching ? "APPROACHING" : "steady"} ` +
    `(${a.speedMps >= 0 ? "-" : "+"}${Math.abs(a.speedMps).toFixed(2)} m/s, drop ${a.dropM.toFixed(2)} m)`;
  const thr = currentStopM();
  if (!stopArmed) {
    stopHits = 0;
    const backedOff = distM >= thr + STOP_REARM_GAP_M;
    if (!backedOff && Date.now() < stopRearmAt) return;
    stopArmed = true;
    note(`stop guard re-armed (${backedOff ? distM.toFixed(2) + " m" : "timeout"})`);
  }
  // The approach detector already needs several samples, so one qualifying reading is enough here
  if (!Looming.shouldStop(distM, a, thr)) { stopHits = 0; return; }
  stopHits = 0;
  if (userHasPriority()) { priorityBuzz(distM, a); return; } // stays armed: fires once the user is done
  fireDepthStop(distM, thr, a);
}

const stopCanvas = document.createElement("canvas");
function fireDepthStop(distM, thr, a = null) {
  if (emergencyActive) return;
  disarmStop(REARM_AFTER_STOP_MS);
  emergencyActive = true;
  stopPlayback();
  micGate.reset();
  dbg.voiceOpen = false;
  alertCue("high", 5); // instant local beep + buzz, no network round trip
  alertMuteUntil = Date.now() + ALERT_MUTE_MS;
  micBlockedUntil = Date.now() + STOP_MIC_BLOCK_MS;
  dbg.alerts++;
  dbg.lastAlert = `DEPTH STOP at ${distM.toFixed(2)} m (<= ${thr.toFixed(2)} m, ${depthSource})`;
  setState("stop", `Stop! Obstacle at ${distM.toFixed(2)} m. Asking what to do...`);
  go.textContent = "STOP · obstacle ahead";
  note(`DEPTH STOP ${distM.toFixed(2)} m via ${depthSource}`);
  clearTimeout(emergencyTimer);
  if (!socket || socket.readyState !== 1 || !cam.videoWidth) {
    speakLocal(sessionLang === "Greek" ? "Σταμάτα! Κάτι είναι ακριβώς μπροστά σου." : "Stop! Something is right ahead.", 5);
    emergencyTimer = setTimeout(() => endEmergency("offline"), 2500);
    return;
  }
  const w = 512;
  stopCanvas.width = w;
  stopCanvas.height = Math.round(w * cam.videoHeight / cam.videoWidth);
  stopCanvas.getContext("2d").drawImage(cam, 0, 0, stopCanvas.width, stopCanvas.height);
  const data = stopCanvas.toDataURL("image/jpeg", 0.62).split(",")[1];
  socket.send(JSON.stringify({
    type: "depth_stop", data, dist_m: Number(distM.toFixed(2)), threshold_m: thr, source: depthSource, imu: imu.snapshot(),
    approach_mps: a ? a.speedMps : null, drop_m: a ? a.dropM : null,
  }));
  emergencyTimer = setTimeout(() => endEmergency("no server reply"), 14000); // safety net
}

// keepMic: the user is talking right now (barge-in), so do not reset the open mic gate under their words.
function endEmergency(why, delayMs = 0, keepMic = false) {
  clearTimeout(emergencyTimer);
  emergencyTimer = null;
  const finish = () => {
    emergencyTimer = null;
    if (!emergencyActive) return;
    emergencyActive = false;
    micBlockedUntil = 0;
    if (!keepMic) micGate.reset();
    note(`emergency over (${why})`);
    if (running && !depthScanActive) {
      go.textContent = "Listening. Tap to stop · Hold 1s for depth";
      setState("listening", assistantEnabled ? "Listening. Ask me anything." : "Depth stop guard active (assistant off).");
    }
  };
  if (delayMs > 0) emergencyTimer = setTimeout(finish, delayMs);
  else finish();
}

function sendLaptopDepthProbe() {
  if (!depthWanted() || laptopInFlight || !cam.videoWidth || !socket || socket.readyState !== 1) return;
  laptopInFlight = true;
  laptopSentAt = Date.now();
  const vw = cam.videoWidth, vh = cam.videoHeight;
  const side = Math.round(Math.min(vw, vh) * 0.70);
  const sx = Math.round((vw - side) / 2), sy = Math.round((vh - side) / 2);
  laptopCtx.drawImage(cam, sx, sy, side, side, 0, 0, 168, 168);
  const data = laptopCanvas.toDataURL("image/jpeg", 0.55).split(",")[1];
  socket.send(JSON.stringify({ type: "depth_local_probe", data, seq: ++depthProbeSeq }));
}

function sendCenterDepthProbe(minGapMs = 260) {
  if (!depthWanted() || !cam.videoWidth || !socket || socket.readyState !== 1) return;
  const now = Date.now();
  if (now - lastDepthProbeAt < minGapMs) return;
  lastDepthProbeAt = now;
  const vw = cam.videoWidth, vh = cam.videoHeight;
  const cw = Math.round(vw * 0.4), ch = Math.round(vh * 0.4);
  const sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
  depthCtx.drawImage(cam, sx, sy, cw, ch, 0, 0, 128, 128);
  const data = depthCanvas.toDataURL("image/jpeg", 0.52).split(",")[1];
  const seq = ++depthProbeSeq;
  const disp = depthDevice === "laptop"
    ? lastLaptopDisp
    : (mobileDepthLive() ? depthEngine.lastDisp : null);
  socket.send(JSON.stringify({ type: "depth_probe", data, seq, disp }));
}

function updateDepthReading(rawM, src) {
  if (typeof rawM !== "number" || !Number.isFinite(rawM) || rawM <= 0) return;
  if (smoothedDepthM === null) {
    smoothedDepthM = Number(rawM.toFixed(2));
  } else {
    // Fast jump (85%) on real distance shifts (>0.30m) so pointing from far to close reacts immediately
    const alpha = Math.abs(rawM - smoothedDepthM) > 0.30 ? 0.85 : 0.68;
    smoothedDepthM = Number(((1 - alpha) * smoothedDepthM + alpha * rawM).toFixed(2));
  }
  depthSource = src;
  dbg.depth = `${smoothedDepthM.toFixed(2)} m (${src})${depthScanActive ? " [HOLD]" : " [guard]"}`;
  if (!depthScanActive) {
    lastGuardReadingAt = Date.now();
    checkDepthStop(smoothedDepthM);
    return;
  }
  if (depthScanActive) {
    statusEl.textContent = `Center depth: ${smoothedDepthM.toFixed(2)} m (${src})`;
    go.textContent = `Depth: ${smoothedDepthM.toFixed(2)} m · Release to exit`;

    // Immediately shorten active timer when moving closer so a sudden close obstacle buzzes with 0 lag
    const fb = Looming.depthFeedback(smoothedDepthM);
    if (fb && depthPulseTimer && lastPulseAt > 0) {
      const elapsed = performance.now() - lastPulseAt;
      if (elapsed >= fb.intervalMs) {
        clearTimeout(depthPulseTimer);
        depthPulseTimer = null;
        depthPulseTick();
      } else {
        clearTimeout(depthPulseTimer);
        depthPulseTimer = setTimeout(depthPulseTick, Math.max(15, Math.round(fb.intervalMs - elapsed)));
      }
    }
  }
}

function depthBeep(freqHz, volume) {
  if (!ctx || !(volume > 0)) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  const dur = 0.05;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(freqHz, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(volume, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.005);
}

function depthPulseTick() {
  if (!depthScanActive) return;
  lastPulseAt = performance.now();
  const fb = smoothedDepthM !== null ? Looming.depthFeedback(smoothedDepthM) : null;
  if (!fb) {
    depthBeep(440, 0.02);
    depthPulseTimer = setTimeout(depthPulseTick, 160);
    return;
  }
  let vibrated = false;
  try {
    if (typeof navigator.vibrate === "function") vibrated = navigator.vibrate(fb.vibeMs);
  } catch (_) {}
  depthBeep(fb.freqHz, vibrated ? Number((fb.volume * 0.85).toFixed(3)) : fb.volume);
  depthPulseTimer = setTimeout(depthPulseTick, fb.intervalMs);
}

function startDepthScan() {
  if (!running || depthScanActive) return;
  depthScanActive = true;
  stopPlayback();
  micGate.reset();
  dbg.voiceOpen = false;
  lastDepthProbeAt = 0;
  lastPulseAt = 0;
  laptopInFlight = false;

  if (depthDevice === "mobile") ensureDepthEngine();
  const gpuReady = mobileDepthLive();
  const d0 = readPdafDistance();
  if (d0 !== null) {
    smoothedDepthM = d0;
    depthSource = "PDAF";
    if (depthEngine) depthEngine.anchorMetric(d0);
    if (lastLaptopDisp !== null) laptopCalibrator.anchor(lastLaptopDisp, d0);
  } else if (!gpuReady) {
    smoothedDepthM = null;
    depthSource = depthDevice === "laptop" ? "laptop" : "scanning";
  }

  const engineName = depthDevice === "laptop" ? laptopProvider : (gpuReady ? depthEngine.backend : (d0 !== null ? "PDAF" : "local-server-fallback"));
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "depth_mode", active: true, pdaf: d0 !== null, engine: engineName, device: depthDevice }));
  }
  setState("depth", smoothedDepthM !== null ? `Center depth: ${smoothedDepthM.toFixed(2)} m (${depthSource})` : "Scanning center depth...");
  go.textContent = smoothedDepthM !== null ? `Depth: ${smoothedDepthM.toFixed(2)} m · Release to exit` : "Scanning depth · Release to exit";
  note(`depth mode ON (${depthDevice}: ${engineName})`);

  syncDepthGuard(); // full-speed depth while holding (guard paused)
  if (depthDevice === "laptop" || !gpuReady) sendLaptopDepthProbe();
  if (d0 === null) sendCenterDepthProbe(0);

  depthPollTimer = setInterval(() => {
    if (laptopInFlight && Date.now() - laptopSentAt > 800) laptopInFlight = false;
    const d = readPdafDistance();
    if (d !== null) {
      if (mobileDepthLive()) depthEngine.anchorMetric(d);
      else if (depthDevice === "laptop" && lastLaptopDisp !== null) laptopCalibrator.anchor(lastLaptopDisp, d);
      else updateDepthReading(d, "PDAF");
    }
    if (depthDevice === "laptop") {
      if (!laptopInFlight) sendLaptopDepthProbe();
      if (d === null) sendCenterDepthProbe(2200);
    } else if (mobileDepthLive()) {
      if (d === null) sendCenterDepthProbe(2000);
    } else {
      // Mobile WebGPU weights still downloading on first visit -> use fast local laptop ONNX in the meantime
      if (!laptopInFlight) sendLaptopDepthProbe();
      if (d === null) sendCenterDepthProbe(2000);
    }
  }, 80);
  depthPulseTick();
}

function stopDepthScan(notifyServer = true) {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (!depthScanActive) return;
  depthScanActive = false;
  laptopInFlight = false;
  suppressClickUntil = Date.now() + 450;
  disarmStop(REARM_AFTER_HOLD_MS); // what was scanned up close must not instantly fire a stop
  clearInterval(depthPollTimer); depthPollTimer = null;
  clearTimeout(depthPulseTimer); depthPulseTimer = null;
  try { navigator.vibrate?.(0); } catch (_) {}
  alertMuteUntil = Math.max(alertMuteUntil, Date.now() + 250);
  if (notifyServer && socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "depth_mode", active: false }));
  }
  note("depth mode OFF");
  if (running) {
    go.textContent = "Listening. Tap to stop · Hold 1s for depth";
    setState("listening", assistantEnabled ? "Listening. Ask me anything." : "Depth stop guard active (assistant off).");
  }
  syncDepthGuard();
}

function sendFrame(fresh = false) {
  if (!cam.videoWidth || !socket || socket.readyState !== 1 || depthScanActive) return;
  const now = Date.now();
  if (fresh !== true && now - lastAnyFrameAt < 280) return;
  const w = fresh === true ? 512 : 352;
  canvas.width = w;
  canvas.height = Math.round(w * cam.videoHeight / cam.videoWidth);
  canvas.getContext("2d").drawImage(cam, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", fresh === true ? 0.58 : 0.48).split(",")[1];
  const imuSnap = imu.snapshot();
  const pdafM = readPdafDistance();
  if (pdafM !== null) {
    imuSnap.focusDistM = pdafM;
    if (!depthScanActive) dbg.depth = `${pdafM.toFixed(2)} m (PDAF)`;
  }
  const msg = { type: "frame", data, imu: imuSnap };
  if (fresh === true) msg.fresh = true;
  socket.send(JSON.stringify(msg));
  lastAnyFrameAt = now;
  lastImuPushAt = now;
  if (imu.compassDeg !== null) lastPushedCompassDeg = imu.compassDeg;
  dbg.sentFrames++;
  if (fresh === true) dbg.sentInfoFrames++;
  else dbg.sentWatchFrames++;
  dbg.frameStamps.push(now);
  while (dbg.frameStamps.length && now - dbg.frameStamps[0] > 3000) dbg.frameStamps.shift();
}

function scheduleReconnect() {
  if (!running || reconnectTimer) return;
  reconnecting = true;
  reconnectAttempts++;
  stopPlayback();
  micGate.reset();
  dbg.voiceOpen = false;
  laptopInFlight = false;
  dbg.gemini = "reconnecting";
  if (!depthScanActive) {
    setState("connecting", `Reconnecting in 0.5s (attempt ${reconnectAttempts})...`);
    go.textContent = "Reconnecting... · Tap to stop";
  }
  note(`reconnecting websocket in ${WS_RECONNECT_MS} ms (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (running) openLiveSocket(false);
  }, WS_RECONNECT_MS);
}

function openLiveSocket(isInitial = false) {
  if (!running) return;
  if (socket) {
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    try { if (socket.readyState <= 1) socket.close(); } catch (_) {}
  }
  reconnecting = true;
  if (!depthScanActive) {
    setState("connecting", isInitial ? "Connecting to the assistant..." : `Reconnecting (attempt ${reconnectAttempts})...`);
    go.textContent = (isInitial ? "Connecting..." : "Reconnecting...") + " · Tap to stop";
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const langParam = (sessionLang === "English" || sessionLang === "Greek") ? `&lang=${encodeURIComponent(sessionLang)}` : "";
  const ws = new WebSocket(`${proto}://${location.host}/live?silence=${SILENCE_WAIT_MS}${langParam}${"speechSynthesis" in window ? "" : "&client_tts=0"}`);
  socket = ws;
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    if (ws !== socket || !running) return;
    reconnecting = false;
    reconnectAttempts = 0;
    dbg.error = "";
    dbg.ws = "open";
    note(isInitial ? "websocket open" : "websocket reconnected");
    if (!depthScanActive) {
      go.textContent = "Listening. Tap to stop · Hold 1s for depth";
      setState("listening", assistantEnabled ? "Listening. Ask me anything." : "Depth stop guard active (assistant off).");
    }
  };

  ws.onmessage = (e) => {
    if (ws !== socket) return;
    if (e.data instanceof ArrayBuffer) { if (!depthScanActive) playPcm(e.data); return; }
    const m = JSON.parse(e.data);
    dbg.lastEvent = m.type + (m.name ? ":" + m.name : "");
    if (m.type === "ready") {
      if (m.lang === "English" || m.lang === "Greek") {
        sessionLang = m.lang;
        try { localStorage.setItem("eyesLang", sessionLang); } catch (_) {}
      }
      if (m.memory) renderMemories(m.memory);
      if (!(qStop > 0) && m.depth_stop_m > 0) depthStopM = m.depth_stop_m;
      if (!(qStop > 0) && m.depth_stop_urgent_m > 0) depthStopUrgentM = m.depth_stop_urgent_m;
      if (emergencyActive) endEmergency("reconnected");
      syncDepthGuard();
      maybeSendGps(true); // the new connection has no location yet
      dbg.gemini = "ready"; dbg.conn = m.conn || "-"; chime(); note(`gemini session ready, id ${dbg.conn} (${sessionLang || "English"})`);
      ws.send(JSON.stringify({ type: "mode", mode: dbg.alertMode }));
      ws.send(JSON.stringify({ type: "assistant", enabled: assistantEnabled }));
      ws.send(JSON.stringify({ type: "depth_device", device: depthDevice, mode: depthMode, reason: depthReason }));
      if (depthScanActive) {
        const d0 = readPdafDistance();
        ws.send(JSON.stringify({ type: "depth_mode", active: true, pdaf: d0 !== null, device: depthDevice }));
        if (!mobileDepthLive()) sendLaptopDepthProbe();
      }
    }
    else if (m.type === "depth_device_status") {
      if (m.provider) laptopProvider = m.provider;
      if (depthDevice === "laptop") dbg.depthModel = `ready (${laptopProvider})`;
    }
    else if (m.type === "depth_local") {
      laptopInFlight = false;
      if (laptopSentAt > 0) {
        const rtt = Math.max(1, Date.now() - laptopSentAt);
        laptopRttEmaMs = laptopRttEmaMs === null ? rtt : 0.7 * laptopRttEmaMs + 0.3 * rtt;
      }
      if (m.provider) laptopProvider = m.provider;
      if (typeof m.center_disp === "number" && m.center_disp > 0) {
        lastLaptopDisp = m.center_disp;
        const distM = laptopCalibrator.toMeters(m.center_disp);
        if (depthDevice === "laptop") {
          const rttTag = laptopRttEmaMs ? ` (rtt ${Math.round(laptopRttEmaMs)}ms)` : "";
          dbg.depthModel = `${laptopProvider}, ${m.ms} ms/frame${rttTag}${laptopCalibrator.anchored ? " [cal]" : ""}`;
        }
        if (depthWanted() && distM !== null && !mobileDepthLive()) {
          updateDepthReading(distM, `${laptopProvider} ${m.ms}ms`);
        }
      }
      if (depthMode === "auto") evaluateDepthTarget(true);
      if (depthScanActive && !mobileDepthLive()) {
        requestAnimationFrame(sendLaptopDepthProbe);
      }
    }
    else if (m.type === "depth_local_skip") {
      laptopInFlight = false;
      if (depthScanActive && !mobileDepthLive()) {
        setTimeout(sendLaptopDepthProbe, 35);
      }
    }
    else if (m.type === "memory") {
      renderMemories(m);
      note("memory -> " + dbg.memory);
    }
    else if (m.type === "compass_target") {
      dbg.compassTarget = m.label ? `${m.label} (${Math.round(m.deg)}°)` : "";
      note("compass target -> " + (dbg.compassTarget || "cleared"));
    }
    else if (m.type === "compass_cue") {
      if (m.text) { dbg.lastReply = m.text; note("compass cue: " + m.text); }
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
    else if (m.type === "heard_ignored") { dbg.lastSpeechAt = 0; note("mic clip ignored (background noise)"); }
    else if (m.type === "reply") { if (m.text) { dbg.lastReply = m.text; note("reply: " + m.text); } }
    else if (m.type === "tool") note("tool call: " + m.name + " " + JSON.stringify(m.args || {}));
    else if (m.type === "error") {
      const fatal = /not connected yet/i.test(m.text || "");
      if (fatal) {
        dbg.gemini = "error"; fail("server", m.text); chime(330); stop(false);
      } else {
        dbg.gemini = "reconnecting";
        note("server error: " + m.text);
        try { ws.close(); } catch (_) {}
      }
    }
    else if (m.type === "go_away") note("server says the session will end soon");
    else if (m.type === "depth_result") {
      // Metric anchor from Gemini (hold scan AND stop guard): re-calibrates the relative depth model's scale
      if (depthWanted() && typeof m.dist_m === "number") {
        if (depthDevice === "laptop") {
          laptopCalibrator.anchor(m.disp || lastLaptopDisp, m.dist_m);
        } else if (mobileDepthLive()) {
          // Calibrate on-phone WebGPU Depth-Anything-V2 scale without injecting stale network latency
          depthEngine.anchorMetric(m.dist_m, m.disp);
        } else if (readPdafDistance() === null) {
          if (lastLaptopDisp !== null) laptopCalibrator.anchor(m.disp || lastLaptopDisp, m.dist_m);
          else updateDepthReading(m.dist_m, m.source || "center-crop");
        }
      }
    }
    else if (m.type === "alert") {
      if (depthScanActive) return;
      stopPlayback();
      micGate.reset();
      dbg.voiceOpen = false;
      if (!emergencyActive) { emergencyActive = true; disarmStop(REARM_AFTER_STOP_MS); alertCue(m.urgency, m.danger_level); }
      clearTimeout(emergencyTimer);
      emergencyTimer = setTimeout(() => endEmergency("no server reply"), 14000);
      alertMuteUntil = Date.now() + ALERT_MUTE_MS;
      if (m.client_voice) setTimeout(() => speakLocal(m.text, m.danger_level), 60);
      dbg.lastAlert = `STOP ${typeof m.dist_m === "number" ? m.dist_m.toFixed(2) + " m" : ""}: ${m.text}${m.client_voice ? " [phone voice]" : m.voice_cached ? " [cached voice]" : ""}`;
      note(`ALERT: ${m.text}`);
    }
    else if (m.type === "emergency_done") {
      endEmergency("guidance spoken", typeof m.resume_in_ms === "number" ? m.resume_in_ms : 0);
    }
    else if (m.type === "emergency_ignored") {
      note(`depth stop ignored by server (${m.reason})`);
      if (m.reason !== "already_active") endEmergency("ignored: " + m.reason);
      if (m.reason === "user_priority") { stopArmed = true; stopHits = 0; } // retry once the user is done
    }
    else if (m.type === "speak_text") { speakLocal(m.text, m.danger_level); note("fallback voice: " + m.text); }
    else if (m.type === "mode") { dbg.alertMode = m.mode; syncModeButton(); syncDepthGuard(); note("alert mode: " + m.mode); }
  };

  ws.onerror = () => {
    if (ws !== socket) return;
    dbg.ws = "error";
    note("websocket error");
  };

  ws.onclose = (e) => {
    if (ws !== socket) return;
    dbg.ws = `closed code ${e.code}${e.reason ? " " + e.reason : ""}`;
    note("websocket closed " + dbg.ws);
    if (running) scheduleReconnect();
  };
}

async function start() {
  requestSensorPermissions();
  try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch (_) {}
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnecting = false;
  reconnectAttempts = 0;
  Object.assign(dbg, { error: "", camera: "-", mic: "-", ws: "-", gemini: "-", sentKB: 0, sentFrames: 0, sentWatchFrames: 0, sentInfoFrames: 0, recvKB: 0,
    recvChunks: 0, lastHeard: "", lastReply: "", lastEvent: "", lastModelAudioAt: 0, lastSpeechAt: 0, micPeak: 0, compassTarget: "",
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
      video: { facingMode: "environment", focusMode: { ideal: "continuous" } },
    });
  } catch (err) {
    dbg.camera = dbg.mic = "blocked (" + err.name + ")";
    throw err;
  }
  cam.srcObject = stream;
  await cam.play();
  videoTrack = stream.getVideoTracks()[0] || null;
  videoCaps = (videoTrack && typeof videoTrack.getCapabilities === "function") ? videoTrack.getCapabilities() : {};
  if (videoTrack && typeof videoTrack.applyConstraints === "function") {
    if (Array.isArray(videoCaps.focusMode) && videoCaps.focusMode.includes("continuous")) {
      await videoTrack.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    }
    if (videoCaps.pointsOfInterest) {
      await videoTrack.applyConstraints({ advanced: [{ pointsOfInterest: [{ x: 0.5, y: 0.5 }] }] }).catch(() => {});
    }
  }
  const initPdaf = readPdafDistance();
  dbg.depth = initPdaf !== null ? `${initPdaf.toFixed(2)} m (PDAF)` : (videoCaps.focusDistance ? "PDAF ready" : "hold 1s (center-crop)");
  dbg.camera = "ok";
  note(`camera: ${cam.videoWidth}x${cam.videoHeight}, pdaf: ${videoCaps.focusDistance ? "supported" : "fallback"}`);

  startMic();
  setFrameRate(1);
  ensureDepthEngine(); // Pre-load & pre-compile WebGPU Depth-Anything-V2-Small in background worker
  try { wakeLock = await navigator.wakeLock?.request("screen"); note("screen wake lock on"); } catch (_) { note("screen wake lock unavailable"); }

  running = true;
  stopArmed = true;
  stopHits = 0;
  lastGuardReadingAt = 0;
  emergencyActive = false;
  dbg.startedAt = Date.now();
  go.setAttribute("aria-pressed", "true");
  syncDepthGuard(); // start the always-on depth stop guard
  startGps();
  note(`wait after you stop talking: ${SILENCE_WAIT_MS} ms`);
  openLiveSocket(true);
}

function stop(announce = true) {
  const wasError = dbg.state === "error";
  stopDepthScan(false);
  running = false;
  reconnecting = false;
  reconnectAttempts = 0;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  videoTrack = null;
  videoCaps = {};
  smoothedDepthM = null;
  dbg.depth = "-";
  syncDepthGuard(); // running=false: stops the guard engine + laptop timer
  stopGps();
  clearTimeout(emergencyTimer); emergencyTimer = null;
  emergencyActive = false;
  clearInterval(frameTimer);
  stopPlayback();
  processor?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  if (socket) {
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    try { if (socket.readyState <= 1) socket.close(); } catch (_) {}
    socket = null;
  }
  wakeLock?.release?.();
  if (ctx && announce) chime(440);
  go.setAttribute("aria-pressed", "false");
  go.textContent = wasError ? "Tap to try again" : "Tap to start";
  if (!wasError) setState("idle", announce ? "Stopped. Tap to start." : "Tap to start");
}

const gateVal = document.getElementById("gateVal");
function setGate(v) {
  gate = Math.min(GATE_MAX, Math.max(0.01, Math.round(v * 1000) / 1000));
  gateVal.textContent = gate.toFixed(3);
  if (micGate.open) {
    micGate.reset(true);
    dbg.voiceOpen = false;
  }
  try { localStorage.setItem("eyesGateV4", String(gate)); } catch (_) {}
  note("gate set to " + gate.toFixed(3));
}
window.addEventListener("pointerdown", () => {
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}, { passive: true });
document.getElementById("gateDown").addEventListener("click", () => setGate(gate - GATE_STEP));
document.getElementById("gateUp").addEventListener("click", () => setGate(gate + GATE_STEP));
gateVal.textContent = gate.toFixed(3);

const MODES = ["normal", "urgent_only", "off"];
const modeBtn = document.getElementById("modeBtn");
function syncModeButton() {
  modeBtn.textContent = { normal: "depth stop: on", urgent_only: "depth stop: close only", off: "depth stop: off" }[dbg.alertMode];
}
try { const saved = localStorage.getItem("eyesMode"); if (MODES.includes(saved)) dbg.alertMode = saved; } catch (_) {}
syncModeButton();
modeBtn.addEventListener("click", () => {
  dbg.alertMode = MODES[(MODES.indexOf(dbg.alertMode) + 1) % MODES.length];
  try { localStorage.setItem("eyesMode", dbg.alertMode); } catch (_) {}
  syncModeButton();
  if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "mode", mode: dbg.alertMode }));
  syncDepthGuard();
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

const depthBtn = document.getElementById("depthBtn");
function syncDepthButton() {
  depthBtn.textContent = depthMode === "auto"
    ? `depth: auto (${depthDevice})`
    : `depth: ${depthMode}`;
  if (depthDevice === "laptop" && (dbg.depthModel === "idle" || !dbg.depthModel.includes("Laptop"))) {
    dbg.depthModel = `ready (${laptopProvider}, ${depthReason})`;
  } else if (depthDevice === "mobile" && depthEngine && depthEngine.status) {
    dbg.depthModel = depthEngine.status;
  }
}

function evaluateDepthTarget(announceAuto = true) {
  const res = Looming.chooseDepthTarget({
    mode: depthMode,
    mobileBenchMs: depthEngine ? depthEngine.benchMs : null,
    mobileEmaMs: depthEngine ? depthEngine.emaMs : null,
    mobileFrames: depthEngine ? depthEngine.frames : 0,
    mobileError: !!(depthEngine && depthEngine.hasError),
    laptopRttMs: laptopRttEmaMs,
  });
  const changed = res.target !== depthDevice;
  depthDevice = res.target;
  depthReason = res.reason;
  syncDepthButton();
  if (!changed) return;

  if (depthDevice === "laptop") {
    dbg.depthModel = `ready (${laptopProvider}, ${res.reason})`;
    if (depthScanActive) sendLaptopDepthProbe();
  } else if (running) {
    ensureDepthEngine();
  }
  syncDepthGuard();
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "depth_device", device: depthDevice, mode: depthMode, reason: res.reason }));
  }
  if (announceAuto && depthMode === "auto") {
    note(`depth auto-switched -> ${depthDevice} (${res.reason})`);
  }
}

evaluateDepthTarget(false);
depthBtn.addEventListener("click", () => {
  depthMode = DEPTH_MODES[(DEPTH_MODES.indexOf(depthMode) + 1) % DEPTH_MODES.length];
  try { localStorage.setItem("eyesDepthMode", depthMode); } catch (_) {}
  const prevTarget = depthDevice;
  evaluateDepthTarget(false);
  if (depthDevice === prevTarget) {
    if (depthDevice === "mobile" && running) ensureDepthEngine();
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: "depth_device", device: depthDevice, mode: depthMode, reason: depthReason }));
    }
  }
  note(`depth mode: ${depthMode} (running on ${depthDevice})`);
});

go.addEventListener("contextmenu", (e) => e.preventDefault());

go.addEventListener("pointerdown", (e) => {
  if (e.button != null && e.button !== 0) return;
  suppressNextClick = false;
  suppressClickUntil = 0;
  activePointerId = e.pointerId;
  try { go.setPointerCapture(e.pointerId); } catch (_) {}
  if (!running) return;
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdTimer = null;
    if (!running) return;
    suppressNextClick = true;
    startDepthScan();
  }, HOLD_DEPTH_MS);
});

function releaseGoHold(e) {
  if (e && activePointerId !== null && e.pointerId != null && e.pointerId !== activePointerId) return;
  activePointerId = null;
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (depthScanActive) stopDepthScan(true);
}

window.addEventListener("pointerup", releaseGoHold);
window.addEventListener("pointercancel", releaseGoHold);
window.addEventListener("blur", () => releaseGoHold(null));
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseGoHold(null); });

go.addEventListener("click", (e) => {
  if (suppressNextClick || Date.now() < suppressClickUntil) {
    suppressNextClick = false;
    e.preventDefault();
    return;
  }
  if (running) stop();
  else start().catch((err) => { fail("start", err); stop(false); });
});

debugTimer = setInterval(() => { updateLiveState(); renderDebug(); if (running) maybeSendGps(); }, 200);
renderDebug();
})();
