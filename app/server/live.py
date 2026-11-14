"""WebSocket session coordinator running two parallel tasks per connection:
  1) Task 1: Stateful conversational voice + camera assistant (Gemini Live API, toggleable ON/OFF)
  2) Task 2: Fast stateless 3-frame safety watcher (alerts.py + watch.py)
"""
import asyncio
import base64
import json
import time
import uuid

from fastapi import WebSocket
from google.genai import types

from . import alerts, config, live_bridge, speak, tools, trace, turns, watch
from .state import State

__all__ = ["State", "run"]

_active_connections = 0


async def run(socket: WebSocket) -> None:
    """Accept and serve a single browser WebSocket connection."""
    global _active_connections
    await socket.accept()
    conn_id = uuid.uuid4().hex[:6]
    trace.set_conn(conn_id)
    tools.use_new_memory()
    if _active_connections >= config.MAX_CONNECTIONS:
        trace.log("rejected_busy", active=_active_connections, limit=config.MAX_CONNECTIONS)
        await socket.send_json({"type": "error", "text": "The assistant is busy right now. Please try again in a minute."})
        await socket.close()
        return
    _active_connections += 1
    try:
        await _serve(socket, conn_id)
    finally:
        _active_connections -= 1
        trace.log("live_disconnect", active=_active_connections)


async def _handle_audio_chunk(state: State, chunk: bytes) -> None:
    """Process a 16 kHz PCM16 audio chunk when the conversational assistant is enabled."""
    if not state.assistant_enabled or state.session is None:
        return
    now_c = time.time()
    for action in state.turn.feed(chunk, now_c, state.audible(now_c) or state.model_speaking):
        if action[0] == "start":
            was_audible = state.audible(now_c)
            trace.log("user_turn", state="start", model_speaking=state.model_speaking, audible=was_audible)
            if was_audible:
                state.audible_until = 0.0
                await state.send({"type": "interrupted"})
            await state.session.send_realtime_input(activity_start=types.ActivityStart())
        elif action[0] == "audio":
            await state.session.send_realtime_input(
                audio=types.Blob(data=action[1], mime_type="audio/pcm;rate=16000")
            )
        elif action[0] == "end":
            trace.log("user_turn", state="end", silence_s=action[1], voiced_s=round(state.turn.voiced_s, 1))
            await state.session.send_realtime_input(activity_end=types.ActivityEnd())


async def _handle_json_message(state: State, msg: dict, frame_count: int) -> int:
    """Handle JSON control & camera frame messages from the browser."""
    kind = msg.get("type")
    if kind == "frame":
        jpeg = base64.b64decode(msg["data"])
        if frame_count == 0:
            trace.log("first_frame", bytes=len(jpeg))
        frame_count += 1
        now_f = time.time()
        state.frames.append((now_f, jpeg))
        if isinstance(msg.get("imu"), dict):
            state.imu, state.imu_at = msg["imu"], now_f
        if isinstance(msg.get("motion"), (int, float)):
            state.motion.append((now_f, float(msg["motion"])))
        if state.assistant_enabled and state.session is not None:
            if msg.get("fresh") and now_f - state.last_live_frame < 0.95:
                trace.log("fresh_frame")
            if msg.get("fresh") or now_f - state.last_live_frame >= 0.95:
                state.last_live_frame = now_f
                await state.session.send_realtime_input(video=types.Blob(data=jpeg, mime_type="image/jpeg"))
    elif kind == "local_alert":
        alerts.spawn(alerts.local_alert(state, msg))
    elif kind == "mode" and msg.get("mode") in watch.AlertPolicy.MODES:
        state.policy.mode = msg["mode"]
        trace.log("alert_mode", mode=msg["mode"], by="button")
    elif kind == "assistant":
        enabled = bool(msg.get("enabled", True))
        state.assistant_enabled = enabled
        trace.log("assistant_toggle", enabled=enabled)
        if not enabled and (state.model_speaking or state.audible(time.time())):
            state.audible_until = 0.0
            state.drop_audio_since = time.time()
            await state.send({"type": "interrupted"})
    return frame_count


async def _serve(socket: WebSocket, conn_id: str) -> None:
    try:
        silence_ms = int(socket.query_params.get("silence", config.SILENCE_MS))
    except ValueError:
        silence_ms = config.SILENCE_MS
    silence_ms = max(int(turns.END_WAIT_FLOOR_S * 1000), min(4000, silence_ms))
    trace.log("live_connect", silence_ms=silence_ms, active=_active_connections)

    if not config.API_KEY:
        await socket.send_json({"type": "error", "text": "The model is not connected yet."})
        await socket.close()
        return

    state = State(socket=socket, conn_id=conn_id)
    state.client_tts = socket.query_params.get("client_tts", "1") != "0"
    state.turn = turns.TurnTracker(end_wait=silence_ms / 1000)
    asyncio.create_task(speak.warm_common())

    def set_alert_mode(mode: str) -> dict:
        """Change how often camera safety alerts interrupt the user. mode: 'normal', 'urgent_only' or 'off'."""
        if mode not in watch.AlertPolicy.MODES:
            return {"error": f"mode must be one of {watch.AlertPolicy.MODES}"}
        state.policy.mode = mode
        trace.log("alert_mode", mode=mode, by="voice")
        asyncio.get_running_loop().create_task(state.send({"type": "mode", "mode": mode}))
        return {"status": "ok", "mode": mode}

    state.extra_funcs = {"set_alert_mode": set_alert_mode}

    try:
        live_model = await live_bridge.pick_live_model()
        client = live_bridge.get_client()
        async with client.aio.live.connect(model=live_model, config=live_bridge.live_config([set_alert_mode])) as session:
            state.session = session
            await socket.send_json({"type": "ready", "conn": conn_id})
            await alerts.announce_rate(state, "start")

            downstream = asyncio.create_task(live_bridge.gemini_to_browser(state))
            watcher = asyncio.create_task(alerts.watch_loop(state))
            mic_bytes = frame_count = 0
            try:
                while True:
                    message = await socket.receive()
                    if message["type"] == "websocket.disconnect":
                        break
                    if message.get("bytes"):
                        chunk = message["bytes"]
                        if mic_bytes == 0:
                            trace.log("first_mic_audio", bytes=len(chunk))
                        mic_bytes += len(chunk)
                        await _handle_audio_chunk(state, chunk)
                    elif message.get("text"):
                        frame_count = await _handle_json_message(state, json.loads(message["text"]), frame_count)
                    if downstream.done():
                        downstream.result()
                        break
            finally:
                downstream.cancel()
                watcher.cancel()
                trace.log("live_input_totals", mic_kb=round(mic_bytes / 1024), frames=frame_count)
    except Exception as exc:
        trace.log("error", error=f"{type(exc).__name__}: {exc}"[:300])
        try:
            await socket.send_json({"type": "error", "text": "Voice connection lost. Tap to restart."})
        except Exception:
            pass
