"""FastAPI server: serves the page and one WebSocket for frames, voice text and replies."""
import asyncio
import base64
from contextlib import asynccontextmanager
from pathlib import Path
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import agent, config, live, local_depth, speak, tools, trace

STATIC = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    asyncio.create_task(local_depth.warm())
    if config.API_KEY:
        asyncio.create_task(speak.warm_common())
    yield


app = FastAPI(title="VoxEye", lifespan=lifespan)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse(STATIC / "favicon.ico", media_type="image/x-icon")


@app.get("/apple-touch-icon.png", include_in_schema=False)
async def apple_touch_icon() -> FileResponse:
    return FileResponse(STATIC / "apple-touch-icon.png", media_type="image/png")


@app.get("/panel")
async def panel() -> FileResponse:
    """Judges' screen: live trace of what the agent heard, did and said."""
    return FileResponse(STATIC / "trace.html")


@app.get("/trace")
async def get_trace(conn: str | None = None, n: int = 100) -> list[dict]:
    """Recent events. Pass ?conn=<id> (shown in each event and in the page's debug panel) to see one connection."""
    return trace.recent(max(1, min(n, 1000)), conn)


@app.websocket("/live")
async def live_ws(socket: WebSocket) -> None:
    await live.run(socket)


@app.websocket("/ws")
async def ws(socket: WebSocket) -> None:
    await socket.accept()
    trace.set_conn(uuid.uuid4().hex[:6])
    tools.use_new_memory()
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
