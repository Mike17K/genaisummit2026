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
