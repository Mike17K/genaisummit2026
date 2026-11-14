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

## Status
- Done: page, camera frames at ~1 fps, browser speech in/out, WebSocket, trace log, stub agent.
- Next: real multimodal model call in `server/agent.py`, "read this" and "what's in front of me" flows, one tool action, spoken uncertainty.
