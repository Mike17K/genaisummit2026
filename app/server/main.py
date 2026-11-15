"""FastAPI entrypoint (`uvicorn server.main:app`): static UI, HTTP endpoints, and `/live` WebSocket."""
import asyncio
import base64
from contextlib import asynccontextmanager
import uuid

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .assistant import agent, tools
from .audio import speak
from .core import live, memory
from .depth import local_depth
from .utils import config, trace

STATIC = config.APP_DIR / "static"
REPO_ROOT = config.APP_DIR.parent
BRAG_DIR = REPO_ROOT / "brag-output"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    asyncio.create_task(local_depth.warm())
    if config.API_KEY:
        asyncio.create_task(speak.warm_common())
    yield


app = FastAPI(title="VoxEye", lifespan=lifespan)


@app.get("/")
async def index(request: Request) -> FileResponse:
    """Serve the VoxEye Sketchbook Landing Page by default, or the WebApp when ?app=1 is passed."""
    if request.query_params.get("app") in ("1", "true") or "sonar" in request.query_params:
        return FileResponse(STATIC / "index.html")
    landing = STATIC / "landing.html"
    if landing.exists():
        return FileResponse(landing)
    return FileResponse(STATIC / "index.html")


@app.get("/landing")
async def landing_page() -> FileResponse:
    """Explicit route for the VoxEye Hackathon Landing Page."""
    return FileResponse(STATIC / "landing.html")


@app.get("/app")
async def webapp() -> FileResponse:
    """Live VoxEye Mobile & Desktop WebApp (camera + stereo depth sonar + bilingual voice)."""
    return FileResponse(STATIC / "index.html")


@app.get("/manifest.json", include_in_schema=False)
async def manifest() -> FileResponse:
    return FileResponse(STATIC / "manifest.json", media_type="application/manifest+json")


@app.api_route("/voxeye.apk", methods=["GET", "HEAD"], include_in_schema=False)
@app.api_route("/download/apk", methods=["GET", "HEAD"], include_in_schema=False)
async def download_apk() -> FileResponse:
    """Download the signed VoxEye Android APK."""
    apk_path = STATIC / "voxeye.apk"
    if not apk_path.exists():
        raise HTTPException(status_code=404, detail="APK not found")
    return FileResponse(
        apk_path,
        media_type="application/vnd.android.package-archive",
        filename="voxeye-v1.8.apk",
    )


@app.api_route("/video/v9.mp4", methods=["GET", "HEAD"], include_in_schema=False)
@app.api_route("/video/v8.mp4", methods=["GET", "HEAD"], include_in_schema=False)
async def video_hero() -> FileResponse:
    """Serve the v9 (ElevenLabs v3 voiceover) hand-drawn sketchbook story hero video."""
    for candidate in (
        "voxeye-sketchbook-story-v9-elevenlabs-voice.mp4",
        "voxeye-sketchbook-story.mp4",
        "voxeye-sketchbook-story-v8.mp4",
    ):
        video_path = BRAG_DIR / candidate
        if video_path.exists():
            return FileResponse(video_path, media_type="video/mp4")
    raise HTTPException(status_code=404, detail="Video not found")


@app.api_route("/video/v9-poster.jpg", methods=["GET", "HEAD"], include_in_schema=False)
@app.api_route("/video/v8-poster.jpg", methods=["GET", "HEAD"], include_in_schema=False)
async def video_hero_poster() -> FileResponse:
    """Serve the poster image for the sketchbook story video."""
    poster = BRAG_DIR / "voxeye-sketchbook-story.jpg"
    if not poster.exists():
        raise HTTPException(status_code=404, detail="Poster not found")
    return FileResponse(poster, media_type="image/jpeg")


@app.get("/panels/{name}", include_in_schema=False)
async def storyboard_panel(name: str) -> FileResponse:
    """Serve v8 storyboard panel thumbnails (p01.jpg - p07.jpg)."""
    if not name.endswith(".jpg") or "/" in name or ".." in name:
        raise HTTPException(status_code=404, detail="Invalid panel")
    p = BRAG_DIR / "storyboard" / "panels" / "v3" / name
    if not p.exists():
        raise HTTPException(status_code=404, detail="Panel not found")
    return FileResponse(p, media_type="image/jpeg")


@app.get("/brand-logo.png", include_in_schema=False)
async def brand_logo() -> FileResponse:
    p = REPO_ROOT / "context" / "VoxEye_logo.png"
    if not p.exists():
        return FileResponse(STATIC / "icon-192.png", media_type="image/png")
    return FileResponse(p, media_type="image/png")


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


@app.get("/memory")
async def get_memory() -> dict:
    """Current persisted explicit user memories (`goal` and `notes`)."""
    return memory.load_persisted().to_dict()


@app.post("/memory/clear")
async def clear_memory() -> dict:
    """Clear persisted explicit user memories from disk."""
    m = memory.UserMemory()
    memory.save_persisted(m)
    trace.log("memory_update", **m.to_dict(), by="http_clear")
    return m.to_dict()


def _clip(v, depth: int = 0):
    """Keep client diagnostics small and JSON-safe."""
    if isinstance(v, str):
        return v[:160]
    if isinstance(v, bool) or v is None or isinstance(v, (int, float)):
        return v
    if isinstance(v, list) and depth < 3:
        return [_clip(x, depth + 1) for x in v[:16]]
    if isinstance(v, dict) and depth < 3:
        return {str(k)[:40]: _clip(x, depth + 1) for k, x in list(v.items())[:30]}
    return str(v)[:80]


@app.post("/audio_diag")
async def audio_diag(payload: dict) -> dict:
    """Phone audio diagnostics (devices, mic settings, output channels, test-beep context) for /trace."""
    trace.log("audio_diag", **{k: _clip(v) for k, v in list(payload.items())[:30] if k not in ("t", "conn", "kind")})
    return {"ok": True}


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
