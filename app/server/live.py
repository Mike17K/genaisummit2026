"""WebSocket session coordinator running two integrated parallel pipelines per connection:
  1) Streaming Information Pipeline (info_pipeline.py): multimodal audio+frame -> text-token
     streaming LLM -> concurrent clause-by-clause streaming TTS, cut immediately on danger
     to explain why and smoothly resume what it was saying.
  2) Fast Stateless Safety Guardrail (alerts.py + watch.py): 3-frame composite obstacle check.
"""
import asyncio
import base64
import json
import time
import uuid

from fastapi import WebSocket

from . import alerts, config, info_pipeline, local_depth, memory, phrases, speak, tools, trace, turns, watch
from .state import State

__all__ = ["State", "run"]

_active_connections = 0
MIN_VOICE_PCM_BYTES = 4800  # ~150 ms of 16 kHz mono PCM16
MIN_VOICED_S = 0.20         # Ignore sub-200 ms room clicks/blips that only look big due to quiet hang tail


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
    """Track user voice turns and launch the streaming information pipeline on turn end."""
    if not state.assistant_enabled:
        return
    now_c = time.time()
    if state.depth_mode_active or state.alert_locked(now_c):
        state.reset_mic_turn()
        return
    info_generating = state.info_task is not None and not state.info_task.done()
    assistant_busy = state.audible(now_c) or state.model_speaking or info_generating
    for action in state.turn.feed(chunk, now_c, assistant_busy):
        if action[0] == "start":
            was_cut = info_pipeline.cancel_for_user(state)
            trace.log("user_turn", state="start", cut_assistant=was_cut)
            if was_cut:
                await state.send({"type": "interrupted"})
            state.mic_turn_pcm.clear()
            state.turn_frame_jpeg = state.frames[-1][1] if state.frames else None
        elif action[0] == "audio":
            state.mic_turn_pcm.extend(action[1])
        elif action[0] == "end":
            pcm_bytes = bytes(state.mic_turn_pcm)
            state.mic_turn_pcm.clear()
            frame_jpeg = state.turn_frame_jpeg or (state.frames[-1][1] if state.frames else None)
            state.turn_frame_jpeg = None
            voiced_s = state.turn.voiced_s
            trace.log(
                "user_turn",
                state="end",
                silence_s=action[1],
                voiced_s=round(voiced_s, 1),
                pcm_kb=round(len(pcm_bytes) / 1024, 1),
            )
            if len(pcm_bytes) >= MIN_VOICE_PCM_BYTES and voiced_s >= MIN_VOICED_S:
                info_pipeline.cancel_for_user(state)
                state.info_task = alerts.spawn(
                    info_pipeline.answer_user_audio(state, pcm_bytes, frame_jpeg)
                )
            else:
                await state.send({"type": "heard_ignored"})


async def _run_depth_probe(state: State, b64_data: str, seq: int = 0, disp: float | None = None) -> None:
    """Metric center-crop anchor / fast pipelined fallback (up to 3 concurrent staggered calls)."""
    if state.depth_probes_inflight >= 3 or not state.depth_mode_active:
        return
    state.depth_probes_inflight += 1
    try:
        jpeg = base64.b64decode(b64_data)
        t0 = time.time()
        dist = await watch.estimate_center_distance(jpeg)
        ms = round((time.time() - t0) * 1000)
        if state.depth_mode_active and dist is not None:
            if seq and seq < state.depth_probe_latest_seq:
                return
            if seq:
                state.depth_probe_latest_seq = seq
            trace.log("depth_probe", dist_m=dist, ms=ms, seq=seq or None)
            payload: dict = {"type": "depth_result", "dist_m": dist, "source": "center-crop", "ms": ms}
            if seq:
                payload["seq"] = seq
            if isinstance(disp, (int, float)) and disp > 0:
                payload["disp"] = float(disp)
            await state.send(payload)
    finally:
        state.depth_probes_inflight = max(0, state.depth_probes_inflight - 1)


async def _run_local_depth_probe(state: State, b64_data: str, seq: int = 0) -> None:
    """Run Depth-Anything-V2-Small locally on the laptop/server via ONNX Runtime."""
    if not state.depth_mode_active:
        return
    try:
        jpeg = base64.b64decode(b64_data)
        stats, provider, ms = await local_depth.predict_center_disparity(jpeg)
        if not state.depth_mode_active:
            return
        if stats is None:
            await state.send({"type": "depth_local_skip", "seq": seq, "provider": provider})
            return
        trace.log("depth_local", center_disp=stats["center_disp"], provider=provider, ms=ms, seq=seq or None)
        await state.send({
            "type": "depth_local",
            "seq": seq,
            "center_disp": stats["center_disp"],
            "p10": stats["p10"],
            "p90": stats["p90"],
            "provider": provider,
            "ms": ms,
        })
    except Exception as exc:
        trace.log("depth_local_error", error=f"{type(exc).__name__}: {exc}"[:160])
        if state.depth_mode_active:
            await state.send({"type": "depth_local_skip", "seq": seq})


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
        if msg.get("fresh"):
            trace.log("fresh_frame")
            if state.turn.active:
                state.turn_frame_jpeg = jpeg
    elif kind == "local_alert":
        alerts.spawn(alerts.local_alert(state, msg))
    elif kind == "mode" and msg.get("mode") in watch.AlertPolicy.MODES:
        state.policy.mode = msg["mode"]
        trace.log("alert_mode", mode=msg["mode"], by="button")
    elif kind == "assistant":
        enabled = bool(msg.get("enabled", True))
        state.assistant_enabled = enabled
        trace.log("assistant_toggle", enabled=enabled)
        if not enabled and info_pipeline.cancel_for_user(state):
            await state.send({"type": "interrupted"})
    elif kind == "lang" and phrases.is_supported_lang(msg.get("lang")):
        await info_pipeline.update_session_lang(state, msg["lang"], source="client")
    elif kind == "depth_mode":
        active = bool(msg.get("active", False))
        state.depth_mode_active = active
        if active:
            state.depth_probe_latest_seq = 0
        trace.log("depth_mode", active=active, pdaf=msg.get("pdaf"), engine=msg.get("engine"))
        if active:
            if info_pipeline.cancel_for_user(state):
                await state.send({"type": "interrupted"})
            state.reset_mic_turn()
    elif kind == "depth_device" and msg.get("device") in ("auto", "mobile", "laptop"):
        dev = str(msg["device"])
        mode = str(msg.get("mode") or dev)
        state.depth_device = dev
        trace.log("depth_device", device=dev, mode=mode, reason=msg.get("reason"))
        if dev == "laptop" or mode == "auto":
            prov = await local_depth.warm()
            await state.send({"type": "depth_device_status", "device": dev, "mode": mode, "provider": prov})
    elif kind == "depth_local_probe" and msg.get("data"):
        alerts.spawn(_run_local_depth_probe(state, str(msg["data"]), seq=int(msg.get("seq") or 0)))
    elif kind == "depth_probe" and msg.get("data"):
        seq = int(msg.get("seq") or 0)
        disp = msg.get("disp")
        alerts.spawn(
            _run_depth_probe(
                state,
                str(msg["data"]),
                seq=seq,
                disp=float(disp) if isinstance(disp, (int, float)) else None,
            )
        )
    elif kind == "memory_clear":
        if state.memory.clear():
            memory.save_persisted(state.memory)
            trace.log("memory_update", **state.memory.to_dict(), by="clear")
            await state.send({"type": "memory", **state.memory.to_dict()})
    return frame_count


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
        """Change how often camera safety alerts interrupt the user. mode: 'normal', 'urgent_only' or 'off'."""
        if mode not in watch.AlertPolicy.MODES:
            return {"error": f"mode must be one of {watch.AlertPolicy.MODES}"}
        state.policy.mode = mode
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

    state.extra_funcs = {"set_alert_mode": set_alert_mode, "set_language": set_language}

    await socket.send_json(
        {"type": "ready", "conn": conn_id, "lang": state.lang, "memory": state.memory.to_dict()}
    )
    await alerts.announce_rate(state, "start")
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
    except Exception as exc:
        trace.log("error", error=f"{type(exc).__name__}: {exc}"[:300])
        try:
            await socket.send_json({"type": "error", "text": "Voice connection lost. Reconnecting..."})
        except Exception:
            pass
    finally:
        watcher.cancel()
        info_pipeline.cancel_for_user(state)
        trace.log("live_input_totals", mic_kb=round(mic_bytes / 1024), frames=frame_count)
