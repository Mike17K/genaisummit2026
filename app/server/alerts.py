"""Parallel safety watcher loop, post-trigger similarity latch, and urgent alert delivery."""
import asyncio
import time

from google.genai import types

from . import config, debug_report, phrases, speak, trace, watch
from .state import State

_watch_slots: asyncio.Semaphore | None = None


def spawn(coro) -> asyncio.Task:
    """Run a background coroutine and log any unhandled exception to trace."""
    task = asyncio.create_task(coro)

    def _done(t: asyncio.Task) -> None:
        if not t.cancelled() and t.exception() is not None:
            trace.log("task_error", error=f"{type(t.exception()).__name__}: {t.exception()}"[:300])

    task.add_done_callback(_done)
    return task


async def announce_rate(state: State, why: str) -> None:
    """Notify the browser of the active camera frame rate and attention level."""
    a = state.attention
    trace.log("attention", level=a.level, fps=a.fps, look_s=a.look_s, why=why)
    await state.send({"type": "rate", "fps": a.fps, "attention": a.level, "look_s": a.look_s})


async def _warm_voice(text: str) -> None:
    try:
        await speak.synthesize(text)
    except Exception:
        pass


async def fire_alert(state: State, d: watch.WatchDecision, source: str = "watch") -> None:
    """Cancel any active assistant speech immediately and deliver the safety alert."""
    now = time.time()
    state.policy.record(d, now)
    state.recent_alerts.append((now, d.hazard_key, d.message))
    was_speaking = state.model_speaking
    cached = speak.is_cached(d.message)
    client_voice = state.client_tts and d.urgency == "high" and not cached

    trace.log(
        "alert",
        urgency=d.urgency,
        danger_level=d.danger_level,
        key=d.hazard_key,
        text=d.message,
        confidence=d.confidence,
        cut_speech=was_speaking,
        voice_cached=cached,
        client_voice=client_voice,
        source=source,
    )

    synth = asyncio.create_task(speak.synthesize(d.message))

    # 1. Immediately command browser to cancel speech playback, play level-matched cue, and vibrate.
    await state.send({
        "type": "alert",
        "urgency": d.urgency,
        "danger_level": d.danger_level,
        "text": d.message,
        "voice_cached": cached,
        "client_voice": client_voice,
        "source": source,
    })

    # 2. Hard barge-in on Gemini Live if the conversational model was speaking.
    if state.session is not None:
        if was_speaking and not state.turn.active:
            state.drop_audio_since = now
            state.expect_interrupt = True
            state.turn.hold_for_alert()
            await state.session.send_realtime_input(activity_start=types.ActivityStart())
        if state.assistant_enabled:
            await state.session.send_client_content(
                turns=types.Content(
                    role="user",
                    parts=[types.Part(text=(
                        f'(Note: your safety watcher just told the user: "{d.message}". '
                        "Do not repeat it and do not respond to this note.)"
                    ))],
                ),
                turn_complete=False,
            )

    # 3. Stream pre-cached / synthesized voice unless the phone already spoke it locally.
    if client_voice:
        trace.log("alert_spoken", ms=round((time.time() - now) * 1000), by="phone")
        return
    try:
        pcm = await asyncio.wait_for(synth, 6)
    except Exception as exc:
        trace.log("alert_voice_failed", error=f"{type(exc).__name__}: {exc}"[:150])
        await state.send({"type": "speak_text", "text": d.message, "danger_level": d.danger_level})
        return

    state.audible_until = 0.0
    state.sent_audio(len(pcm), time.time())
    for i in range(0, len(pcm), 9600):
        await state.socket.send_bytes(pcm[i:i + 9600])
    trace.log("alert_spoken", ms=round((time.time() - now) * 1000), audio_s=round(len(pcm) / 48000, 1), by="server")


async def local_alert(state: State, msg: dict) -> None:
    """Handle an optional on-device looming alert."""
    label = str(msg.get("label", "object"))[:30]
    key, text = phrases.local_alert(label, state.lang)
    now = time.time()
    try:
        confidence = max(0.0, min(1.0, float(msg.get("confidence", 0.92))))
    except (TypeError, ValueError):
        confidence = 0.92
    d = watch.WatchDecision(
        notify=True,
        danger_level=4,
        urgency="high",
        confidence=confidence,
        hazard_key=key,
        message=text,
        reason="on-device looming",
        attention="high",
        hazard_type="moving",
    )
    imu = state.imu if state.imu and now - state.imu_at <= config.SENSOR_MAX_AGE_S else None
    if imu and imu.get("panning"):
        trace.log("local_alert", label=label, outcome="held: camera panning", key=key)
        return
    fire, why = state.policy.decide(
        d, now, now - state.turn.last_voice, fast_confirm=True, user_moving=watch.user_moving(imu)
    )
    trace.log(
        "local_alert",
        label=label,
        outcome="ALERT" if fire else "held: " + why,
        key=key,
        growth=msg.get("growth"),
        dist_m=msg.get("distM"),
        confidence=confidence,
    )
    if fire:
        if state.attention.update("high", now, alerted=True):
            await announce_rate(state, "on-device alert")
        await fire_alert(state, d, source="local")


async def watch_loop(state: State) -> None:
    """Continuous parallel safety watcher loop with fast 100 ms retry on skipped ticks."""
    while True:
        started = time.time()
        ran_model = False
        try:
            ran_model = await watch_once(state, started)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            trace.log("watch_error", error=f"{type(exc).__name__}: {exc}"[:200])
        if ran_model:
            await asyncio.sleep(max(0.08, state.attention.look_s - (time.time() - started)))
        else:
            await asyncio.sleep(0.10)


def _is_panning(imu: dict | None) -> bool:
    if not imu:
        return False
    speed = imu.get("angularSpeed")
    if isinstance(speed, (int, float)):
        return speed > config.PAN_DEG_S
    return bool(imu.get("panning"))


async def watch_once(state: State, look_started_at: float) -> bool:
    """Execute a single stateless 3-frame safety check. Returns True only if the model was called."""
    if state.policy.mode == "off":
        if state.attention.level != "normal":
            state.attention = watch.Attention()
            await announce_rate(state, "alerts off")
        return False

    n_frames = min(3, config.COMPOSE_FRAMES if config.WATCH_COMPOSE else config.WATCH_FRAMES)
    frames = watch.select_frames(state.frames, state.attention.spacing, look_started_at, n=n_frames)
    if len(frames) < 2 or frames[-1][0] <= state.last_judged_frame:
        return False

    # Post-trigger similarity latch: skip while scene stays visually similar to last triggered danger frame.
    if state.danger_frame_jpeg is not None:
        similar, diff = watch.is_similar_to_danger(state.danger_frame_jpeg, frames[-1][1])
        if similar:
            state.last_judged_frame = frames[-1][0]
            trace.log("watch_skipped", reason="similar_to_danger_frame", diff=round(diff, 3))
            return False
        state.danger_frame_jpeg = None
        trace.log("danger_cleared", diff=round(diff, 3))

    global _watch_slots
    if _watch_slots is None:
        _watch_slots = asyncio.Semaphore(config.MAX_PARALLEL_CALLS)
    if _watch_slots.locked():
        trace.log("watch_skipped", reason="all model slots busy")
        return False

    imu = state.imu if state.imu and look_started_at - state.imu_at <= config.SENSOR_MAX_AGE_S else None
    if _is_panning(imu):
        state.last_judged_frame = frames[-1][0]
        trace.log("watch_skipped", reason="camera panning", deg_s=imu.get("angularSpeed") if imu else None)
        return False

    if watch.scene_is_static(
        list(state.motion), look_started_at, state.last_look_at, state.attention.level, state.last_look_silent
    ):
        return False

    moving = watch.user_moving(imu)
    sensors_desc = watch.sensors_text(imu)
    state.last_judged_frame = frames[-1][0]
    state.last_look_at = look_started_at

    t0 = time.time()
    async with _watch_slots:
        d, info = await watch.judge(frames, list(state.recent_alerts), state.lang, sensors_desc)
    model_ms = round((time.time() - t0) * 1000, 1)

    now_after = time.time()
    state.last_look_silent = not d.notify
    if not d.notify and state.danger_frame_jpeg is None:
        state.policy.clear_resolved()

    fire, why = state.policy.decide(d, now_after, now_after - state.turn.last_voice, user_moving=moving)
    outcome = "ALERT" if fire else ("silent" if not d.notify else "held: " + why)

    held = d.notify and not fire and why in (
        "needs_confirmation", "low_confidence", "cooldown", "rate_limit", "user_speaking"
    )
    changed = state.attention.update(d.attention, now_after, alerted=fire, held=held)

    trace.log(
        "watch",
        outcome=outcome,
        notify=d.notify,
        danger_level=d.danger_level,
        urgency=d.urgency,
        confidence=d.confidence,
        key=d.hazard_key,
        message=d.message or None,
        reason=d.reason[:100],
        ms=round(model_ms),
        attention=d.attention,
        level=state.attention.level,
        fps=state.attention.fps,
        hazard_type=d.hazard_type,
        moving=moving,
        **info,
    )
    await state.send({
        "type": "watch",
        "outcome": outcome,
        "danger_level": d.danger_level,
        "urgency": d.urgency,
        "confidence": d.confidence,
        "key": d.hazard_key,
        "ms": round(model_ms),
        "attention": state.attention.level,
    })

    if changed:
        reason_note = f"model said {d.attention}" + (", alert fired" if fire else "") + (f", held ({why})" if held else "")
        await announce_rate(state, reason_note)

    if fire:
        trigger_at = time.time()
        danger_jpeg = frames[-1][1]
        state.danger_frame_jpeg = danger_jpeg
        spawn(asyncio.to_thread(
            debug_report.save_trigger_report,
            frames=list(frames),
            danger_jpeg=danger_jpeg,
            decision=d.model_copy(),
            session_started_at=state.started_at,
            look_started_at=look_started_at,
            model_ms=model_ms,
            trigger_at=trigger_at,
            policy_reason=why,
            attention_level=state.attention.level,
            fps=state.attention.fps,
            sensors_desc=sensors_desc,
            token_info=dict(info),
            conn_id=state.conn_id,
        ))
        await fire_alert(state, d)
    elif d.notify:
        await state.send({"type": "suppressed", "reason": why, "key": d.hazard_key})
        if why == "needs_confirmation" and d.message:
            asyncio.create_task(_warm_voice(d.message))
    return True
