// Realtime voice: mic (PCM16 16 kHz) -> /live -> Gemini -> speech (PCM16 24 kHz) back, plus phone compass + GPS for
// guidance and places, and a hold-1s depth sonar (Depth-Anything-V2 on phone WebGPU or laptop ONNX).
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

// Audio mode. "earphones" (default) keeps phone audio in STEREO media mode: the mic opens without echo
// cancellation / call processing (earphones produce no echo) and avoids a Bluetooth headset mic, because both put
// Android into mono call audio and the sonar would sound the same in both ears. "speaker" keeps echo cancellation
// for use without earphones. Applies when the assistant starts.
let earphoneMode = true;
try { if (localStorage.getItem("eyesEarphones") === "0") earphoneMode = false; } catch (_) {}
const BT_MIC_RE = /bluetooth|headset|hands-?free|airpods|buds|\bsco\b|\bbt\b/i;
let micInfo = "-";

function micConstraints(deviceId) {
  const base = earphoneMode
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base;
}

// Earphone mode: if the mic in use belongs to a Bluetooth headset, switch to the phone's own mic so the
// earbuds stay on the stereo media profile instead of the mono call profile.
async function preferPhoneMic() {
  if (!earphoneMode || !stream) return;
  const track = stream.getAudioTracks()[0];
  if (!track || !BT_MIC_RE.test(track.label || "")) return;
  try {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    const phone = inputs.find((d) => d.deviceId && d.deviceId !== "default" && d.label && !BT_MIC_RE.test(d.label));
    if (!phone) return;
    const fresh = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(phone.deviceId) });
    const nt = fresh.getAudioTracks()[0];
    stream.removeTrack(track);
    track.stop();
    stream.addTrack(nt);
    note(`mic: switched from "${track.label}" to phone mic "${nt.label}" to keep earphones in stereo`);
  } catch (err) {
    note("mic switch failed: " + ((err && err.name) || err));
  }
}

function describeAudio() {
  const outCh = ctx && ctx.destination ? ctx.destination.maxChannelCount : null;
  const t = stream && stream.getAudioTracks()[0];
  const st = t && typeof t.getSettings === "function" ? t.getSettings() : {};
  micInfo = t ? `${t.label || "mic"} (echo cancel ${st.echoCancellation ? "ON" : "off"})` : "-";
  return `${earphoneMode ? "earphones (stereo)" : "speaker (echo cancel)"} · output ${outCh === null ? "?" : outCh >= 2 ? "stereo" : "MONO (" + outCh + " ch)"} · mic: ${micInfo}`;
}

function requestSensorPermissions() {
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") DeviceMotionEvent.requestPermission().catch(() => {});
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") DeviceOrientationEvent.requestPermission().catch(() => {});
  } catch (_) {}
}

// Phone TTS fallback when server audio is unavailable
function speakLocal(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = /[\u0370-\u03ff\u1f00-\u1fff]/.test(text) ? "el-GR" : "en-US";
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
// Stereo depth sonar (earphones): LEFT / CENTER / RIGHT nearest surfaces -> beeps in that ear. It is the danger
// feedback: always on while running (unless switched off), and a focused full-speed scan while holding 1s.
const sonar = new SpatialSonar(() => ctx, {
  isMuted: () => micGate.open || dbg.voiceOpen,          // never beep over the user's own voice (mic leak)
  duck: () => (playing.size > 0 ? 0.45 : 1),             // quieter while VoxEye is speaking
});
// Sonar settings (per-ear pitch / max volume / max beep rate, range, pitch offsets): saved on this device, then
// URL overrides, e.g. ?pitchL=400&pitchR=620&volL=0.4&volR=0.25&rateL=6&rateR=9&range=3&pitchOff=4
const SONAR_SETTINGS_KEY = "eyesSonarSettings";
(function loadSonarSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SONAR_SETTINGS_KEY) || "null");
    if (saved) SpatialSonarLib.setSettings(saved);
  } catch (_) {}
  const q = new URLSearchParams(location.search);
  const n = (k) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? v : undefined; };
  SpatialSonarLib.setSettings({
    ears: {
      left: { pitchHz: n("pitchL"), maxVolume: n("volL"), maxRateHz: n("rateL") },
      right: { pitchHz: n("pitchR"), maxVolume: n("volR"), maxRateHz: n("rateR") },
    },
    rangeM: n("range"),
    sideOffset: n("pitchOff"),
    centerSplit: n("pitchSplit"),
    proximityRise: n("pitchRise"),
  });
})();
function saveSonarSettings() {
  try { localStorage.setItem(SONAR_SETTINGS_KEY, JSON.stringify(SpatialSonarLib.getSettings())); } catch (_) {}
}
const SONAR_MOBILE_INTERVAL_MS = 180;  // ~5 fps phone model when it is fast enough
const SONAR_LAPTOP_GAP_MS = 220;       // ~4 fps laptop ONNX
const SONAR_ANCHOR_MS = 3000;          // re-anchor metres with the Gemini center probe (no PDAF)
let sonarEnabled = new URLSearchParams(location.search).get("sonar") !== "0";
try { if (localStorage.getItem("eyesSonar") === "0") sonarEnabled = false; } catch (_) {}
let sonarTimer = null;
let sonarSentState = null;
const smoothedSectors = { left: null, center: null, right: null };
// WebXR Depth Sensing (Chrome + ARCore) is the preferred hold-scan source; ?xr=0 disables it
const XR_ALLOWED = new URLSearchParams(location.search).get("xr") !== "0";
let xrSupported = null;   // null = unknown yet, then true / false
let xrBroken = "";        // set when a session failed on this phone, so later holds use the model directly
let xrSource = null;
let xrStatus = "-";
let lastDepthProbeAt = 0;
let depthProbeSeq = 0;

const dbg = {
  state: "idle", camera: "-", mic: "-", audioCtx: "-", ws: "-", gemini: "-",
  micLevel: 0, micPeak: 0, sentKB: 0, sentFrames: 0, sentWatchFrames: 0, sentInfoFrames: 0, recvKB: 0, recvChunks: 0,
  lastHeard: "", lastReply: "", lastEvent: "", lastModelAudioAt: 0, lastSpeechAt: 0,
  error: "", startedAt: 0, log: [],
  conn: "-", fps: 1, frameStamps: [], voiceOpen: false, effGate: 0, depth: "-", depthModel: "idle", memory: "empty", memoryObj: { goal: "", notes: [] }, compassTarget: "",
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
    ["audio mode", esc(describeAudio())],
    ["session id", esc(dbg.conn) + "  (filter the server trace with /panel?conn=" + esc(dbg.conn) + ")"],
    ["websocket", cls(wsState === "open" ? true : wsState === "-" ? null : wsState === "connecting" ? null : false, wsState) + (dbg.ws !== "-" ? "  " + esc(dbg.ws) : "")],
    ["gemini", cls(dbg.gemini === "ready" ? true : dbg.gemini === "-" ? null : false, esc(dbg.gemini)) + " (assistant: " + (assistantEnabled ? "on" : "off") + ", lang: " + esc(sessionLang || "English") + ")"],
    ["received", `${dbg.recvKB.toFixed(0)} KB in ${dbg.recvChunks} chunks, last audio ${sinceAudio}`],
    ["you said", esc(dbg.lastHeard || "-")],
    ["eyes said", esc(dbg.lastReply || "-")],
    ["user memory", esc(dbg.memory || "empty")],
    ["depth model", esc(`[${depthMode === "auto" ? "auto->" + depthDevice : depthMode}] ` + (dbg.depthModel || "-"))],
    ["center depth", esc(dbg.depth || "-")],
    ["webxr depth", esc(!XR_ALLOWED ? "disabled (?xr=0)" : xrSupported === null ? "checking..." : xrSupported ? (xrBroken ? "failed: " + xrBroken : "supported (" + xrStatus + ")") : "not supported on this browser/phone")],
    ["sonar settings", esc((() => {
      const c = SpatialSonarLib.getSettings(), e = (k) => `${c.ears[k].pitchHz}Hz vol ${Math.round(c.ears[k].maxVolume * 100)}% max ${c.ears[k].maxRateHz}/s`;
      return `L ${e("left")} · R ${e("right")} · range ${c.rangeM} m · sides ±${c.sideOffset} st · split ±${c.centerSplit} st · closer +${c.proximityRise} st`;
    })())],
    ["stereo sonar", esc(!sonarEnabled && !depthScanActive ? "off" : sonar.running ? `${depthScanActive ? "[HOLD] " : ""}${sonar.summary()}${sonar.isMuted() ? " (paused: you are talking)" : ""}` : "starts with the assistant")],
    ["compass", esc(compassText)],
    ["gps", esc(gpsStatus + (gpsFix ? `  (${gpsFix.lat.toFixed(5)}, ${gpsFix.lon.toFixed(5)}, ${Math.round((Date.now() - gpsFix.at) / 1000)}s ago)` : ""))],
    ["phone motion", esc(imu.panning ? "panning" : imu.walking === true ? "walking" : imu.walking === false ? "stationary" : "movement unknown") + `  gyro ${imu.angularSpeed} deg/s, pitch ${imu.pitchDeg ?? "?"}`],
    ["last event", esc(dbg.lastEvent || "-")],
  ];
  if (dbg.error) rows.push(["error", cls(false, esc(dbg.error))]);
  const tableHtml = "<table>" + rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("") + "</table>";
  if (dbgTableEl) dbgTableEl.innerHTML = tableHtml;
  if (logEl) logEl.textContent = dbg.log.join("\n");
}

function updateLiveState() {
  if (!running || depthScanActive || reconnecting || !socket || socket.readyState !== 1) return;
  const now = Date.now();
  if (dbg.voiceOpen && assistantEnabled) dbg.lastSpeechAt = now;
  const speaking = playing.size > 0 || (dbg.lastModelAudioAt && now - dbg.lastModelAudioAt < 700);
  let next = "listening";
  if (speaking) next = "speaking";
  else if (dbg.voiceOpen && assistantEnabled) next = "hearing";
  else if (assistantEnabled && dbg.lastSpeechAt && now - dbg.lastSpeechAt < 6000 && dbg.lastSpeechAt > dbg.lastModelAudioAt) next = "thinking";
  const label = !assistantEnabled && next === "listening"
    ? "Assistant off. Hold 1s for depth."
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
  return playing.size > 0 || ttsSpeaking || dbg.state === "thinking" || dbg.state === "speaking";
}

// The user's voice just opened the gate: silence everything at once (no round trip) and tell the server to cancel too.
function bargeIn() {
  if (!assistantBusyLocal()) return;
  stopPlayback();
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
    if (!socket || socket.readyState !== 1 || !assistantEnabled || depthScanActive) {
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
      onDepth: (distM, backend, ms, _disp, sectors) => {
        if (depthDevice === "mobile" && !xrSource) updateDepthReading(distM, `${backend} ${ms}ms`, sectors);
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

function sonarContinuous() {
  return running && sonarEnabled;
}

// Depth is needed for the hold scan or the always-on sonar
function depthWanted() {
  return depthScanActive || sonarContinuous();
}

// One place that decides what runs: depth engine rate, continuous feed timer, sonar, server flag. Idempotent.
function syncDepthEngine() {
  const wanted = depthWanted();
  if (depthEngine) {
    if (depthDevice === "mobile" && wanted && !xrSource) {
      depthEngine.setIntervalMs(depthScanActive ? 0 : SONAR_MOBILE_INTERVAL_MS);
      depthEngine.start();
    } else {
      depthEngine.stop();
    }
  }
  const feed = sonarContinuous() && !depthScanActive;
  if (feed && !sonarTimer) sonarTimer = setInterval(sonarTick, 60);
  else if (!feed && sonarTimer) { clearInterval(sonarTimer); sonarTimer = null; }
  sonar.aliveTick = depthScanActive;
  if (wanted) sonar.start();
  else sonar.stop();
  const serverState = sonarContinuous();
  if (socket && socket.readyState === 1 && serverState !== sonarSentState) {
    socket.send(JSON.stringify({ type: "sonar", active: serverState }));
    sonarSentState = serverState;
  }
}

// Continuous sonar feed between depth frames: laptop-ONNX probes, metric re-anchoring.
function sonarTick() {
  if (depthScanActive || !sonarContinuous()) return;
  const now = Date.now();
  if (laptopInFlight && now - laptopSentAt > 800) laptopInFlight = false;
  const mobile = mobileDepthLive();
  if (!mobile && !laptopInFlight && now - laptopSentAt >= SONAR_LAPTOP_GAP_MS) sendLaptopDepthProbe();
  const pdaf = readPdafDistance();
  if (pdaf !== null) {
    if (mobile) depthEngine.anchorMetric(pdaf);
    else if (lastLaptopDisp !== null) laptopCalibrator.anchor(lastLaptopDisp, pdaf);
  } else {
    sendCenterDepthProbe(SONAR_ANCHOR_MS);
  }
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

function smoothSector(key, d) {
  if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) { smoothedSectors[key] = null; return; }
  const prev = smoothedSectors[key];
  if (prev === null) { smoothedSectors[key] = d; return; }
  const alpha = prev - d > 0.2 ? 0.85 : 0.55; // react fast when something gets closer, calm otherwise
  smoothedSectors[key] = Number(((1 - alpha) * prev + alpha * d).toFixed(2));
}

// One depth reading during the hold scan: center metres for the status text, plus optional per-sector metres
// for the stereo sonar (center-only sources feed just the center voice).
function updateDepthReading(rawM, src, sectors = null) {
  if (typeof rawM === "number" && Number.isFinite(rawM) && rawM > 0) {
    if (smoothedDepthM === null) {
      smoothedDepthM = Number(rawM.toFixed(2));
    } else {
      // Fast jump (85%) on real distance shifts (>0.30m) so pointing from far to close reacts immediately
      const alpha = Math.abs(rawM - smoothedDepthM) > 0.30 ? 0.85 : 0.68;
      smoothedDepthM = Number(((1 - alpha) * smoothedDepthM + alpha * rawM).toFixed(2));
    }
  }
  if (sectors) {
    for (const k of ["left", "center", "right"]) smoothSector(k, sectors[k]);
  } else {
    smoothedSectors.left = smoothedSectors.right = null;
    smoothedSectors.center = smoothedDepthM;
  }
  depthSource = src;
  const f = (d) => (d == null ? "-" : d.toFixed(2));
  dbg.depth = `L ${f(smoothedSectors.left)} · C ${f(smoothedSectors.center)} · R ${f(smoothedSectors.right)} m (${src})`;
  if (!depthWanted()) return;
  sonar.update(smoothedSectors);
  if (!depthScanActive) return;
  statusEl.textContent = `Depth L ${f(smoothedSectors.left)} · C ${f(smoothedSectors.center)} · R ${f(smoothedSectors.right)} m (${src})`;
  go.textContent = `Depth ${f(smoothedSectors.center)} m ahead · Release to exit`;
}

function xrUsable() {
  return XR_ALLOWED && xrSupported === true && !xrBroken && typeof XrDepthSource === "function";
}

function startDepthScan() {
  if (!running || depthScanActive) return;
  depthScanActive = true;
  stopPlayback();
  micGate.reset();
  dbg.voiceOpen = false;
  lastDepthProbeAt = 0;
  laptopInFlight = false;
  smoothedSectors.left = smoothedSectors.center = smoothedSectors.right = null;
  sonar.update(smoothedSectors);
  if (xrUsable()) {
    xrSource = "starting"; // pauses the continuous model feed before the session exists
    syncDepthEngine();
    startXrScan();
    return;
  }
  startModelScan();
}

// Preferred source: WebXR Depth Sensing (ARCore). Falls back to the depth model if the session fails.
async function startXrScan() {
  setState("depth", "Starting AR depth...");
  go.textContent = "Starting AR depth · Release to exit";
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "depth_mode", active: true, pdaf: false, engine: "webxr", device: "phone" }));
  }
  if (xrSource === "starting") xrSource = null;
  const src = new XrDepthSource({
    overlayRoot: document.body,
    onStatus: (st) => { xrStatus = st; },
    onSectors: (sectors) => {
      if (!depthScanActive || xrSource !== src) return;
      const c = sectors.center ?? Math.min(...["left", "right"].map((k) => sectors[k] ?? Infinity));
      updateDepthReading(Number.isFinite(c) ? c : null, "WebXR depth", sectors);
    },
  });
  xrSource = src;
  src.onEnded = () => {
    if (xrSource === src) xrSource = null;
    restoreCameraAfterXr();
    syncDepthEngine(); // resume the continuous model feed
    if (depthScanActive) stopDepthScan(true); // system ended AR (back gesture, error) while holding
  };
  try {
    await src.start();
    note("depth: WebXR depth sensing session started");
    if (!depthScanActive) await src.stop(); // released while the session was starting
  } catch (err) {
    if (xrSource === src) xrSource = null;
    syncDepthEngine();
    xrBroken = String((err && err.message) || err).slice(0, 80);
    xrStatus = "unavailable: " + xrBroken;
    note("WebXR depth failed, using depth model: " + xrBroken);
    if (depthScanActive) startModelScan(true);
  }
}

// After an AR session ARCore hands the camera back; if our track ended or stays muted, re-open it.
async function restoreCameraAfterXr() {
  await new Promise((r) => setTimeout(r, 600));
  if (!running || !stream) return;
  const old = stream.getVideoTracks()[0];
  if (old && old.readyState === "live" && !old.muted) return;
  try {
    const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", focusMode: { ideal: "continuous" } } });
    const track = fresh.getVideoTracks()[0];
    if (old) { stream.removeTrack(old); try { old.stop(); } catch (_) {} }
    stream.addTrack(track);
    cam.srcObject = stream;
    await cam.play().catch(() => {});
    videoTrack = track;
    videoCaps = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
    note("camera restored after AR depth");
  } catch (err) {
    note("camera restore failed: " + ((err && err.name) || err));
  }
}

function startModelScan(afterXrFailure = false) {
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
  if (!afterXrFailure && socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "depth_mode", active: true, pdaf: d0 !== null, engine: engineName, device: depthDevice }));
  }
  setState("depth", smoothedDepthM !== null ? `Center depth: ${smoothedDepthM.toFixed(2)} m (${depthSource})` : "Scanning center depth...");
  go.textContent = smoothedDepthM !== null ? `Depth: ${smoothedDepthM.toFixed(2)} m · Release to exit` : "Scanning depth · Release to exit";
  note(`depth mode ON (${depthDevice}: ${engineName})`);

  syncDepthEngine();
  if (depthDevice === "laptop" || !gpuReady) sendLaptopDepthProbe();
  if (d0 === null) sendCenterDepthProbe(0);

  depthPollTimer = setInterval(() => {
    if (laptopInFlight && Date.now() - laptopSentAt > 800) laptopInFlight = false;
    const d = readPdafDistance();
    if (d !== null) {
      if (mobileDepthLive()) depthEngine.anchorMetric(d);
      else if (depthDevice === "laptop" && lastLaptopDisp !== null) laptopCalibrator.anchor(lastLaptopDisp, d);
      else if (!xrSource) updateDepthReading(d, "PDAF");
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
}

function stopDepthScan(notifyServer = true) {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (!depthScanActive) return;
  depthScanActive = false;
  laptopInFlight = false;
  suppressClickUntil = Date.now() + 450;
  clearInterval(depthPollTimer); depthPollTimer = null;
  if (xrSource && typeof xrSource.stop === "function") xrSource.stop(); // its "end" event restores the camera
  if (xrSource === "starting") xrSource = null;
  try { navigator.vibrate?.(0); } catch (_) {}
  if (notifyServer && socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "depth_mode", active: false }));
  }
  note("depth mode OFF");
  if (running) {
    go.textContent = "Listening. Tap to stop · Hold 1s for depth";
    setState("listening", assistantEnabled ? "Listening. Ask me anything." : "Assistant off. Hold 1s for depth.");
  }
  syncDepthEngine();
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
      setState("listening", assistantEnabled ? "Listening. Ask me anything." : "Assistant off. Hold 1s for depth.");
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
      sonarSentState = null; // new connection: tell the server whether the sonar runs
      syncDepthEngine();
      maybeSendGps(true); // the new connection has no location yet
      dbg.gemini = "ready"; dbg.conn = m.conn || "-"; chime(); note(`gemini session ready, id ${dbg.conn} (${sessionLang || "English"})`);
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
        if (depthWanted() && distM !== null && !mobileDepthLive() && !xrSource) {
          const sd = Array.isArray(m.sector_disp) ? m.sector_disp : null;
          const toM = (v) => (typeof v === "number" && v > 0 ? laptopCalibrator.toMeters(v) : null);
          const sectors = sd ? { left: toM(sd[0]), center: toM(sd[1]), right: toM(sd[2]) } : null;
          updateDepthReading(distM, `${laptopProvider} ${m.ms}ms`, sectors);
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
      // Metric anchor from Gemini during the hold scan: re-calibrates the relative depth model's scale
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
    else if (m.type === "speak_text") { speakLocal(m.text); note("fallback voice: " + m.text); }
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
      audio: micConstraints(),
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

  await preferPhoneMic();
  startMic();
  note("audio: " + describeAudio());
  setFrameRate(1);
  ensureDepthEngine(); // Pre-load & pre-compile WebGPU Depth-Anything-V2-Small in background worker (fallback)
  if (XR_ALLOWED && typeof XrDepthSource === "function" && xrSupported === null) {
    XrDepthSource.supported().then((ok) => { xrSupported = ok; note(`WebXR depth: ${ok ? "supported" : "not supported, using depth model"}`); });
  }
  try { wakeLock = await navigator.wakeLock?.request("screen"); note("screen wake lock on"); } catch (_) { note("screen wake lock unavailable"); }

  running = true;
  sonarSentState = null;
  syncDepthEngine(); // always-on stereo sonar (danger feedback)
  dbg.startedAt = Date.now();
  go.setAttribute("aria-pressed", "true");
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
  syncDepthEngine();
  stopGps();
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

const sonarBtn = document.getElementById("sonarBtn");
function syncSonarButton() {
  if (sonarBtn) sonarBtn.textContent = `sonar: ${sonarEnabled ? "on" : "off"}`;
}
syncSonarButton();
if (sonarBtn) sonarBtn.addEventListener("click", () => {
  sonarEnabled = !sonarEnabled;
  try { localStorage.setItem("eyesSonar", sonarEnabled ? "1" : "0"); } catch (_) {}
  syncSonarButton();
  syncDepthEngine();
  note(`stereo sonar ${sonarEnabled ? "on" : "off"}`);
});

// Sonar settings panel: sliders generated from the engine's LIMITS, applied live, saved on this device.
let previewCtx = null;
const previewSonar = new SpatialSonar(() => ctx || (previewCtx = previewCtx || new (window.AudioContext || window.webkitAudioContext)()));
const SONAR_FIELDS = [
  { group: "Left ear", path: ["ears", "left", "pitchHz"], label: "pitch", unit: "Hz", limit: "pitchHz" },
  { group: "Left ear", path: ["ears", "left", "maxVolume"], label: "max volume", unit: "%", limit: "maxVolume", pct: true },
  { group: "Left ear", path: ["ears", "left", "maxRateHz"], label: "max beeps", unit: "/s", limit: "maxRateHz" },
  { group: "Right ear", path: ["ears", "right", "pitchHz"], label: "pitch", unit: "Hz", limit: "pitchHz" },
  { group: "Right ear", path: ["ears", "right", "maxVolume"], label: "max volume", unit: "%", limit: "maxVolume", pct: true },
  { group: "Right ear", path: ["ears", "right", "maxRateHz"], label: "max beeps", unit: "/s", limit: "maxRateHz" },
  { group: "Both", path: ["rangeM"], label: "range limit", unit: "m", limit: "rangeM" },
  { group: "Both", path: ["sideOffset"], label: "side pitch offset", unit: "st", limit: "sideOffset" },
  { group: "Both", path: ["centerSplit"], label: "center split", unit: "st", limit: "centerSplit" },
  { group: "Both", path: ["proximityRise"], label: "closer pitch rise", unit: "st", limit: "proximityRise" },
];
const readPath = (obj, path) => path.reduce((o, k) => o[k], obj);
function settingsPatch(path, value) {
  const patch = {};
  let o = patch;
  path.forEach((k, i) => { o[k] = i === path.length - 1 ? value : {}; o = o[k]; });
  return patch;
}

function buildSonarPanel() {
  const box = document.getElementById("sonarFields");
  if (!box) return;
  box.innerHTML = "";
  const cfg = SpatialSonarLib.getSettings();
  let group = "";
  for (const f of SONAR_FIELDS) {
    if (f.group !== group) {
      group = f.group;
      const h = document.createElement("div");
      h.className = "sgroup";
      h.textContent = group;
      box.appendChild(h);
    }
    const [min, max, step] = SpatialSonarLib.LIMITS[f.limit];
    const row = document.createElement("label");
    row.className = "srow";
    const name = document.createElement("span");
    name.textContent = f.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(readPath(cfg, f.path));
    input.setAttribute("aria-label", `${f.group} ${f.label}`);
    const out = document.createElement("b");
    const show = (v) => { out.textContent = f.pct ? `${Math.round(v * 100)}${f.unit}` : `${+(+v).toFixed(2)} ${f.unit}`; };
    show(input.value);
    input.addEventListener("input", () => {
      const applied = SpatialSonarLib.setSettings(settingsPatch(f.path, parseFloat(input.value)));
      show(readPath(applied, f.path));
      saveSonarSettings();
    });
    row.append(name, input, out);
    box.appendChild(row);
  }
}
buildSonarPanel();
for (const [id, sector] of [["sonarTestL", "left"], ["sonarTestC", "center"], ["sonarTestR", "right"]]) {
  const b = document.getElementById(id);
  if (b) b.addEventListener("click", () => { const v = previewSonar.test(sector, 0.8); if (v) note(`test ${sector}: L ${v.freqL}Hz ${v.gainL} · R ${v.freqR}Hz ${v.gainR}`); });
}
const sonarResetBtn = document.getElementById("sonarReset");
if (sonarResetBtn) sonarResetBtn.addEventListener("click", () => {
  SpatialSonarLib.resetSettings();
  saveSonarSettings();
  buildSonarPanel();
  note("sonar settings reset to defaults");
});

const audioModeBtn = document.getElementById("audioModeBtn");
function syncAudioModeButton() {
  if (audioModeBtn) audioModeBtn.textContent = earphoneMode ? "audio: earphones (stereo)" : "audio: speaker";
}
syncAudioModeButton();
if (audioModeBtn) audioModeBtn.addEventListener("click", () => {
  earphoneMode = !earphoneMode;
  try { localStorage.setItem("eyesEarphones", earphoneMode ? "1" : "0"); } catch (_) {}
  syncAudioModeButton();
  note(`audio mode: ${earphoneMode ? "earphones (stereo)" : "speaker"}${running ? " - tap stop and start again to apply" : ""}`);
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
  syncDepthEngine();
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
