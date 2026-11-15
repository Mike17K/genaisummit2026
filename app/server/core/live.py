"""WebSocket session lifecycle manager delegating all routing & decisions to `core.router`."""
import asyncio
import json
import uuid

from fastapi import WebSocket

from ..assistant import info_pipeline, tools, turns
from ..audio import phrases, speak
from ..depth import local_depth
from ..safety import alerts
from ..utils import config, trace
from . import memory, router
from .state import ALERT_MODES, State

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
        await socket.send_json(
            {"type": "error", "text": "The assistant is busy right now. Please try again in a minute."}
        )
        await socket.close()
        return
    _active_connections += 1
    try:
        await _serve(socket, conn_id)
    finally:
        _active_connections -= 1
        trace.log("live_disconnect", active=_active_connections)


async def _serve(socket: WebSocket, conn_id: str) -> None:
    try:
        silence_ms = int(socket.query_params.get("silence", config.SILENCE_MS))
    except ValueError:
        silence_ms = config.SILENCE_MS
    silence_ms = max(int(turns.END_WAIT_FLOOR_S * 1000), min(4000, silence_ms))

    q_lang = socket.query_params.get("lang", "")
    initial_lang = (
        phrases.save_last_lang(q_lang) if phrases.is_supported_lang(q_lang) else phrases.get_last_lang()
    )
    trace.log(
        "live_connect",
        silence_ms=silence_ms,
        lang=initial_lang,
        active=_active_connections,
        pipeline="streaming_clauses",
    )

    if not config.API_KEY:
        await socket.send_json({"type": "error", "text": "The model is not connected yet."})
        await socket.close()
        return

    state = State(socket=socket, conn_id=conn_id, lang=initial_lang, memory=memory.load_persisted())
    state.client_tts = socket.query_params.get("client_tts", "1") != "0"
    state.turn = turns.TurnTracker(end_wait=silence_ms / 1000)
    asyncio.create_task(speak.warm_common())
    asyncio.create_task(local_depth.warm())

    def set_alert_mode(mode: str) -> dict:
        """Change the depth emergency stop. mode: 'normal', 'urgent_only' (closer threshold) or 'off'."""
        if mode not in ALERT_MODES:
            return {"error": f"mode must be one of {ALERT_MODES}"}
        state.alert_mode = mode
        trace.log("alert_mode", mode=mode, by="voice")
        asyncio.get_running_loop().create_task(state.send({"type": "mode", "mode": mode}))
        return {"status": "ok", "mode": mode}

    def set_language(language: str) -> dict:
        """Switch and remember the spoken language. Only 'English' and 'Greek' are supported."""
        if not phrases.is_supported_lang(language):
            return {"error": "language must be 'English' or 'Greek'"}
        canon = phrases.save_last_lang(language)
        state.lang = canon
        trace.log("lang_set", lang=canon, by="voice_tool")
        asyncio.get_running_loop().create_task(state.send({"type": "lang", "lang": canon}))
        return {"status": "ok", "language": canon}

    def set_compass_direction(direction: str) -> dict:
        """Set or clear compass guidance toward a target direction ('N','NE','E','SE','S','SW','W','NW', degrees 0..359, or 'clear')."""
        spec = (direction or "").strip()
        if spec.upper() in ("CLEAR", "STOP", "OFF", "NONE", ""):
            asyncio.get_running_loop().create_task(router.apply_compass_target(state, None, by="voice_tool"))
            return {"status": "cleared"}
        parsed = router.parse_compass_spec(spec)
        if parsed is None:
            return {"error": f"unrecognized compass direction: {spec}"}
        deg, code, en_l, el_l = parsed
        asyncio.get_running_loop().create_task(router.apply_compass_target(state, float(deg), by="voice_tool"))
        return {"status": "ok", "bearing_deg": deg, "code": code, "en": en_l, "el": el_l}

    state.extra_funcs = {
        "set_alert_mode": set_alert_mode,
        "set_language": set_language,
        "set_compass_direction": set_compass_direction,
    }

    await socket.send_json({
        "type": "ready",
        "conn": conn_id,
        "lang": state.lang,
        "memory": state.memory.to_dict(),
        "depth_stop_m": config.DEPTH_STOP_M,
        "depth_stop_urgent_m": config.DEPTH_STOP_URGENT_M,
    })
    # A persisted goal such as "να πάω νότια" restores compass guidance toward that bearing on reconnect
    await router.sync_goal_compass_target(state, by="goal")
    watcher = asyncio.create_task(alerts.compass_loop(state))
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
                await router.handle_audio_chunk(state, chunk)
            elif message.get("text"):
                frame_count = await router.handle_client_message(state, json.loads(message["text"]), frame_count)
    except Exception as exc:
        trace.log("error", error=f"{type(exc).__name__}: {exc}"[:300])
        try:
            await socket.send_json({"type": "error", "text": "Voice connection lost. Reconnecting..."})
        except Exception:
            pass
    finally:
        watcher.cancel()
        if state.emergency_task is not None and not state.emergency_task.done():
            state.emergency_task.cancel()
        info_pipeline.cancel_for_user(state)
        trace.log("live_input_totals", mic_kb=round(mic_bytes / 1024), frames=frame_count)
