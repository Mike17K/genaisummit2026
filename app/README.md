# Eyes (scaffold)

Camera and voice assistant for blind and low-vision users. FastAPI backend, plain HTML/JS client, no Node.

## Run
```bash
cd app
uv sync
cp .env.example .env   # add GEMINI_API_KEY when you have it
uv run uvicorn server.main:app --host 0.0.0.0 --port 8000
```
Open http://localhost:8000 on the PC. For a phone, the camera and mic need HTTPS, so use a tunnel
(for example `cloudflared tunnel --url http://localhost:8000`) or a boxd VM.

## Configure
`.env` (copy from `.env.example`): `GEMINI_API_KEY` (AI Studio, from your @gcplab.me project) and
`GEMINI_MODEL` (default `gemini-3.5-flash-lite`, about 1-2 s per answer; `gemini-2.5-flash` is retired for new keys).
`GEMINI_HARD_MODEL` (`gemini-3.8-flash`) is reserved for hard reading and is not wired in yet.
List what your key can use: `uv run python -c "from google import genai; from server import config; [print(m.name) for m in genai.Client(api_key=config.API_KEY).models.list()]"`
Without a key the app answers "The model is not connected yet".

## Voice (Gemini Live)
The phone streams microphone audio and a camera frame per second to `/live`; Gemini Live (`GEMINI_LIVE_MODEL`,
default `gemini-2.5-flash-native-audio-latest`) hears, sees, calls tools and answers in a natural voice.
Gemini detects when you stop talking; you can interrupt at any time. Change the voice with `GEMINI_VOICE`
(Kore, Aoede, Puck, Charon, Fenrir, Leda, Zephyr). Live and TTS models are on the `v1beta` endpoint, not `v1`.
Browser speech recognition was dropped: it sent nothing on the phone. Use headphones or low volume if the
assistant interrupts itself (echo). The older text path (`/ws`, `server/agent.py`) is kept for tests.
Test without a phone: run the server, then `PYTHONPATH=. uv run --with pillow --with websockets python <script>`
that synthesizes speech with a TTS model and sends it to `/live` (this is how it was verified).

## On-screen debug (phone)
The page shows a state badge (idle, starting, connecting, listening, hearing, thinking, speaking, error) and a debug
panel: camera and mic status with permission errors, a live mic level meter, KB and frames sent, KB received, websocket
state and close code, Gemini session status, what it heard and said, and a log of the last events. Add `?debug=0` to hide it.
Server side, `/panel` also shows `first_mic_audio`, `first_frame`, `first_audio` (latency) and `live_input_totals`.

## Judges' screen
Open http://localhost:8000/panel to watch heard text, tool calls, replies, latency and token counts live.

## Status
- Done: page, camera frames ~1 fps, browser speech in/out, WebSocket, per-connection history,
  Gemini call with the latest frame (`server/agent.py`), spoken uncertainty rules, silence token,
  interruption (a new question cancels the old answer), tools (`server/tools.py`: remember_place,
  recall_places, call_contact DEMO ONLY), trace log and `/panel`.
- Tested with a fake model: routing, history, no-frame note, error handling, tools.
- Tested with the real Gemini API (2026-11-14, generated image with text): reading, simulated call, remember/recall, refusing to call a road safe. Latency ~1-2 s (fast model), 3-6 s on the bigger models.
- Not tested: real phone camera/mic, Gemini Live API (voice is the browser's speech APIs for now).
- Next: real-phone test over a tunnel, "read this" tuning with real images, optional larger model for hard reading, Gemini Live.
