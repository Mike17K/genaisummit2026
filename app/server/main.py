"""FastAPI server: serves the page and one WebSocket for frames, voice text and replies."""
import base64
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import agent, trace

STATIC = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Eyes")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/trace")
async def get_trace() -> list[dict]:
    return trace.recent()


@app.websocket("/ws")
async def ws(socket: WebSocket) -> None:
    await socket.accept()
    trace.log("connect")
    latest_frame_bytes: int | None = None
    try:
        while True:
            msg = await socket.receive_json()
            kind = msg.get("type")
            if kind == "frame":
                # Base64 JPEG, about 1-2 per second from the phone camera.
                latest_frame_bytes = len(base64.b64decode(msg.get("data", "")))
            elif kind == "say":
                reply = await agent.decide(msg.get("text"), latest_frame_bytes)
                if reply:
                    await socket.send_json({"type": "say", "text": reply})
            elif kind == "ping":
                await socket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        trace.log("disconnect")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
