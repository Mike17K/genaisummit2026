// Step 1-2 of the build order: camera + mic -> WebSocket -> spoken replies.
const go = document.getElementById("go");
const statusEl = document.getElementById("status");
const cam = document.getElementById("cam");
const canvas = document.getElementById("canvas");

let socket, stream, frameTimer, wakeLock, recognition, running = false;

function speak(text) {
  statusEl.textContent = text;
  speechSynthesis.cancel(); // lets new speech interrupt the old
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

async function start() {
  // The first tap unlocks audio and permissions on phones.
  speak("Starting. One moment.");
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }, audio: true,
  });
  cam.srcObject = stream;
  await cam.play();

  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "say") speak(m.text);
  };
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });

  frameTimer = setInterval(sendFrame, 1000); // about 1 frame per second
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (_) {}

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    recognition = new SR();
    recognition.continuous = true;
    recognition.onresult = (e) => {
      const text = e.results[e.results.length - 1][0].transcript.trim();
      if (text) { speechSynthesis.cancel(); socket.send(JSON.stringify({ type: "say", text })); }
    };
    recognition.onend = () => { if (running) recognition.start(); };
    recognition.start();
  }
  running = true;
  go.setAttribute("aria-pressed", "true");
  go.textContent = "Listening. Tap to stop.";
  speak("Ready. Ask me what is in front of you.");
}

function sendFrame() {
  if (!cam.videoWidth || socket.readyState !== 1) return;
  canvas.width = 640;
  canvas.height = Math.round(640 * cam.videoHeight / cam.videoWidth);
  canvas.getContext("2d").drawImage(cam, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
  socket.send(JSON.stringify({ type: "frame", data }));
}

function stop() {
  running = false;
  clearInterval(frameTimer);
  recognition?.stop();
  stream?.getTracks().forEach((t) => t.stop());
  socket?.close();
  wakeLock?.release?.();
  go.setAttribute("aria-pressed", "false");
  go.textContent = "Tap to start";
  speak("Stopped.");
}

go.addEventListener("click", () => (running ? stop() : start().catch((e) => speak("Could not start: " + e.message))));
