"""FastAPI server: serves the page and one WebSocket for frames, voice text and replies."""
import asyncio
import base64
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import agent, live, trace

STATIC = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="Eyes")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/panel")
async def panel() -> FileResponse:
    """Judges' screen: live trace of what the agent heard, did and said."""
    return FileResponse(STATIC / "trace.html")


@app.get("/trace")
async def get_trace() -> list[dict]:
    return trace.recent()


@app.websocket("/live")
async def live_ws(socket: WebSocket) -> None:
    await live.run(socket)


@app.websocket("/ws")
async def ws(socket: WebSocket) -> None:
    await socket.accept()
    trace.log("connect")
    session = agent.Session()
    current: asyncio.Task | None = None

    async def answer(text: str) -> None:
        reply = await agent.decide(session, text)
        if reply:
            await socket.send_json({"type": "say", "text": reply})

    try:
        while True:
            msg = await socket.receive_json()
            kind = msg.get("type")
            if kind == "frame":
                session.set_frame(base64.b64decode(msg.get("data", "")))
            elif kind == "say":
                if current and not current.done():
                    current.cancel()  # the user spoke again: drop the old answer
                current = asyncio.create_task(answer(msg.get("text", "")))
            elif kind == "ping":
                await socket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        trace.log("disconnect")
    finally:
        if current and not current.done():
            current.cancel()


app.mount("/static", StaticFiles(directory=STATIC), name="static")
