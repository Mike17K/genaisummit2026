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

const dbg = {
  state: "idle", camera: "-", mic: "-", audioCtx: "-", ws: "-", gemini: "-",
  micLevel: 0, micPeak: 0, sentKB: 0, sentFrames: 0, recvKB: 0, recvChunks: 0,
  lastHeard: "", lastReply: "", lastEvent: "", lastModelAudioAt: 0, lastSpeechAt: 0,
  error: "", startedAt: 0, log: [],
  watch: "-", lastAlert: "-", alertMode: "normal", alerts: 0, conn: "-", fps: 2, attention: "normal", frameStamps: [], voiceOpen: false, effGate: 0, depth: "-", depthModel: "idle", memory: "empty",
};
const hideDebug = new URLSearchParams(location.search).get("debug") === "0";
if (hideDebug) debugEl.style.display = "none";

function formatMemory(mem) {
  if (!mem) return "empty";
  const parts = [];
  if (mem.goal) parts.push(`trying to: ${mem.goal}`);
  if (Array.isArray(mem.notes) && mem.notes.length) parts.push(`notes: ${mem.notes.join("; ")}`);
  return parts.length ? parts.join(" | ") : "empty";
}

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
    ["user memory", esc(dbg.memory || "empty")],
    ["on-device", esc(spatial ? spatial.summary() : (ON_DEVICE ? "waiting to start" : "off (add ?ondevice=1 to try it)"))],
    ["depth model", esc(`[${depthMode === "auto" ? "auto->" + depthDevice : depthMode}] ` + (dbg.depthModel || "-"))],
    ["center depth", esc(dbg.depth || "-")],
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
  if (!running || depthScanActive) return;
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
      onPerfChange: () => evaluateDepthTarget(true),
    });
  }
  if (depthEngine) {
    depthEngine.video = cam;
    depthEngine.init();
  }
}

function sendLaptopDepthProbe() {
  if (!depthScanActive || laptopInFlight || !cam.videoWidth || !socket || socket.readyState !== 1) return;
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
  if (!depthScanActive || !cam.videoWidth || !socket || socket.readyState !== 1) return;
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
    : (depthEngine && depthEngine.ready ? depthEngine.lastDisp : null);
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
  dbg.depth = `${smoothedDepthM.toFixed(2)} m (${src})${depthScanActive ? " [HOLD]" : ""}`;
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
  const gpuReady = depthDevice === "mobile" && !!(depthEngine && depthEngine.ready);
  const d0 = readPdafDistance();
  if (d0 !== null) {
    smoothedDepthM = d0;
    depthSource = "PDAF";
    if (depthEngine) depthEngine.anchorMetric(d0);
    if (lastLaptopDisp !== null) laptopCalibrator.anchor(lastLaptopDisp, d0);
  } else if (!gpuReady) {
    smoothedDepthM = null;
    depthSource = depthDevice === "laptop" ? "laptop" : "scanning";
    if (spatial && spatial.latest && Array.isArray(spatial.latest.objects)) {
      const centerObj = spatial.latest.objects.find((o) => o.inPath && typeof o.distM === "number");
      if (centerObj) {
        smoothedDepthM = centerObj.distM;
        depthSource = "on-device";
      }
    }
  }

  const engineName = depthDevice === "laptop" ? laptopProvider : (gpuReady ? depthEngine.backend : (d0 !== null ? "PDAF" : "local-server-fallback"));
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: "depth_mode", active: true, pdaf: d0 !== null, engine: engineName, device: depthDevice }));
  }
  setState("depth", smoothedDepthM !== null ? `Center depth: ${smoothedDepthM.toFixed(2)} m (${depthSource})` : "Scanning center depth...");
  go.textContent = smoothedDepthM !== null ? `Depth: ${smoothedDepthM.toFixed(2)} m · Release to exit` : "Scanning depth · Release to exit";
  note(`depth mode ON (${depthDevice}: ${engineName})`);

  if (depthDevice === "mobile" && depthEngine) depthEngine.start();
  if (depthDevice === "laptop" || !gpuReady) sendLaptopDepthProbe();
  if (d0 === null) sendCenterDepthProbe(0);

  depthPollTimer = setInterval(() => {
    if (laptopInFlight && Date.now() - laptopSentAt > 800) laptopInFlight = false;
    const d = readPdafDistance();
    if (d !== null) {
      if (depthDevice === "mobile" && depthEngine && depthEngine.ready) depthEngine.anchorMetric(d);
      else if (depthDevice === "laptop" && lastLaptopDisp !== null) laptopCalibrator.anchor(lastLaptopDisp, d);
      else updateDepthReading(d, "PDAF");
    }
    if (depthDevice === "laptop") {
      if (!laptopInFlight) sendLaptopDepthProbe();
      if (d === null) sendCenterDepthProbe(2200);
    } else if (depthEngine && depthEngine.ready) {
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
  if (depthEngine) depthEngine.stop();
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
    setState("listening", assistantEnabled ? "Listening. Ask me anything." : "Safety watcher active (assistant off).");
  }
}

function sendFrame(fresh = false) {
  if (!cam.videoWidth || !socket || socket.readyState !== 1) return;
  const w = fresh === true ? 640 : 384;
  canvas.width = w;
  canvas.height = Math.round(w * cam.videoHeight / cam.videoWidth);
  canvas.getContext("2d").drawImage(cam, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", fresh === true ? 0.6 : 0.5).split(",")[1];
  const motion = frameMotion();
  const imuSnap = imu.snapshot();
  const pdafM = readPdafDistance();
  if (pdafM !== null) {
    imuSnap.focusDistM = pdafM;
    if (!depthScanActive) dbg.depth = `${pdafM.toFixed(2)} m (PDAF)`;
  }
  const msg = { type: "frame", data, imu: imuSnap };
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

  setState("connecting", "Connecting to the assistant...");
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const langParam = (sessionLang === "English" || sessionLang === "Greek") ? `&lang=${encodeURIComponent(sessionLang)}` : "";
  socket = new WebSocket(`${proto}://${location.host}/live?silence=${SILENCE_WAIT_MS}${langParam}${"speechSynthesis" in window ? "" : "&client_tts=0"}`);
  note(`wait after you stop talking: ${SILENCE_WAIT_MS} ms`);
  socket.binaryType = "arraybuffer";
  socket.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) { if (!depthScanActive) playPcm(e.data); return; }
    const m = JSON.parse(e.data);
    dbg.lastEvent = m.type + (m.name ? ":" + m.name : "");
    if (m.type === "ready") {
      if (m.lang === "English" || m.lang === "Greek") {
        sessionLang = m.lang;
        try { localStorage.setItem("eyesLang", sessionLang); } catch (_) {}
      }
      if (m.memory) dbg.memory = formatMemory(m.memory);
      dbg.gemini = "ready"; dbg.conn = m.conn || "-"; chime(); note(`gemini session ready, id ${dbg.conn} (${sessionLang || "English"})`);
      socket.send(JSON.stringify({ type: "mode", mode: dbg.alertMode }));
      socket.send(JSON.stringify({ type: "assistant", enabled: assistantEnabled }));
      socket.send(JSON.stringify({ type: "depth_device", device: depthDevice, mode: depthMode, reason: depthReason }));
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
        if (depthScanActive && distM !== null && (depthDevice === "laptop" || !(depthEngine && depthEngine.ready))) {
          updateDepthReading(distM, `${laptopProvider} ${m.ms}ms`);
        }
      }
      if (depthMode === "auto") evaluateDepthTarget(true);
      if (depthScanActive && (depthDevice === "laptop" || !(depthEngine && depthEngine.ready))) {
        requestAnimationFrame(sendLaptopDepthProbe);
      }
    }
    else if (m.type === "depth_local_skip") {
      laptopInFlight = false;
      if (depthScanActive && (depthDevice === "laptop" || !(depthEngine && depthEngine.ready))) {
        setTimeout(sendLaptopDepthProbe, 35);
      }
    }
    else if (m.type === "memory") {
      dbg.memory = formatMemory(m);
      note("memory -> " + dbg.memory);
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
    else if (m.type === "depth_result") {
      if (depthScanActive && typeof m.dist_m === "number") {
        if (depthDevice === "laptop") {
          laptopCalibrator.anchor(m.disp || lastLaptopDisp, m.dist_m);
        } else if (depthEngine && depthEngine.ready) {
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
  ensureDepthEngine(); // Pre-load & pre-compile WebGPU Depth-Anything-V2-Small in background worker
  if (ON_DEVICE && typeof SpatialSentry === "function") spatial = new SpatialSentry({
    video: cam, imu,
    onLocalAlert: (h) => { if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "local_alert", ...h })); note(`on-device: ${h.label} approaching (growth ${h.growth}/s)`); },
  });
  if (spatial) spatial.init().then(() => { if (running && spatial) spatial.start(); note("on-device detector: " + (spatial ? spatial.status : "stopped")); });
  try { wakeLock = await navigator.wakeLock?.request("screen"); note("screen wake lock on"); } catch (_) { note("screen wake lock unavailable"); }

  running = true;
  dbg.startedAt = Date.now();
  go.setAttribute("aria-pressed", "true");
  go.textContent = "Listening. Tap to stop · Hold 1s for depth";
  setState("listening", assistantEnabled ? "Listening. Ask me anything." : "Safety watcher active (assistant off).");
}

function stop(announce = true) {
  const wasError = dbg.state === "error";
  stopDepthScan(false);
  running = false;
  videoTrack = null;
  videoCaps = {};
  smoothedDepthM = null;
  dbg.depth = "-";
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
    if (depthEngine) depthEngine.stop();
    dbg.depthModel = `ready (${laptopProvider}, ${res.reason})`;
    if (depthScanActive) sendLaptopDepthProbe();
  } else {
    if (running) ensureDepthEngine();
    if (depthScanActive && depthEngine) depthEngine.start();
  }
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

debugTimer = setInterval(() => { updateLiveState(); renderDebug(); }, 200);
renderDebug();
})();
