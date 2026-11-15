"""Parallel safety watcher loop, post-trigger similarity latch, and urgent alert + explain/resume delivery."""
import asyncio
import time

from . import config, debug_report, info_pipeline, phrases, speak, trace, watch
from .state import State

_watch_slots: asyncio.Semaphore | None = None
_BREATH_PAUSE_PCM = b"\x00" * 7200  # 150 ms of 24 kHz mono PCM16 silence after alert before explanation


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


async def fire_alert(
    state: State,
    d: watch.WatchDecision,
    source: str = "watch",
    frame_jpeg: bytes | None = None,
    trajectory_frames: list[tuple[float, bytes]] | None = None,
    sensors_desc: str = "",
) -> None:
    """Cut active speech at once, play urgent alert, then explain why (+ resume interrupted speech)."""
    now = time.time()
    state.policy.record(d, now)
    state.recent_alerts.append((now, d.hazard_key, d.message))

    # 1. Immediately cancel active LLM + TTS stream, reset partial mic turn, and lock re-triggers
    #    before the first await so no parallel watcher tick can fire while explaining why to stop.
    was_speaking, interrupted = info_pipeline.cancel_for_danger(state, now)
    state.reset_mic_turn()

    is_steer = d.action_code in phrases.GUIDANCE_CODES or d.steer in ("left", "right")
    should_explain = state.assistant_enabled and (
        interrupted is not None
        or (not is_steer and (d.danger_level >= 3 or d.urgency == "high"))
    )
    state.explaining_alert = should_explain
    state.explain_lock_until = max(state.explain_lock_until, now + 0.85 + config.EXPLAIN_POST_WINDOW_S)

    cached = speak.is_cached(d.message)
    client_voice = state.client_tts and d.urgency == "high" and not cached

    trace.log(
        "alert",
        urgency=d.urgency,
        danger_level=d.danger_level,
        code=d.action_code or None,
        next_code=d.next_code or None,
        steer=d.steer or None,
        move=d.user_direction or None,
        key=d.hazard_key,
        text=d.message,
        confidence=d.confidence,
        cut_speech=was_speaking,
        resuming=interrupted is not None,
        voice_cached=cached,
        client_voice=client_voice,
        source=source,
    )

    synth = asyncio.create_task(speak.synthesize(d.message))

    # 2. Command browser to stop playback immediately, play level-matched cue, and vibrate.
    await state.send({
        "type": "alert",
        "urgency": d.urgency,
        "danger_level": d.danger_level,
        "text": d.message,
        "voice_cached": cached,
        "client_voice": client_voice,
        "source": source,
    })

    # 3. Start streaming the laconic "why + where to head" cue (+ continuation if interrupted)
    #    IN PARALLEL while the alert phrase plays, gated so its audio follows right behind the alert.
    alert_audio_done = asyncio.Event()
    if should_explain:
        ref_jpeg = frame_jpeg or state.danger_frame_jpeg or (state.frames[-1][1] if state.frames else None)
        traj = trajectory_frames or watch.select_frames(state.frames, state.attention.spacing, now, n=3)
        if not sensors_desc and state.imu and now - state.imu_at <= config.SENSOR_MAX_AGE_S:
            sensors_desc = watch.sensors_text(state.imu)
        state.info_task = spawn(
            info_pipeline.explain_after_alert(
                state,
                d,
                ref_jpeg,
                interrupted,
                alert_audio_done,
                trajectory_frames=traj,
                sensors_desc=sensors_desc,
            )
        )

    # 4. Deliver the short alert audio ("Stop!", etc.), then open the gate for the explanation stream.
    try:
        if client_voice:
            trace.log("alert_spoken", ms=round((time.time() - now) * 1000), by="phone")
            await asyncio.sleep(0.85)  # let local phone utterance finish before streaming explanation PCM
            state.explain_lock_until = max(state.explain_lock_until, time.time() + config.EXPLAIN_POST_WINDOW_S)
            return
        try:
            pcm = await asyncio.wait_for(synth, 6)
        except Exception as exc:
            trace.log("alert_voice_failed", error=f"{type(exc).__name__}: {exc}"[:150])
            await state.send({"type": "speak_text", "text": d.message, "danger_level": d.danger_level})
            await asyncio.sleep(0.85)
            state.explain_lock_until = max(state.explain_lock_until, time.time() + config.EXPLAIN_POST_WINDOW_S)
            return

        payload = pcm + (_BREATH_PAUSE_PCM if should_explain else b"")
        now_pcm = time.time()
        state.audible_until = 0.0
        state.sent_audio(len(payload), now_pcm)
        state.explain_lock_until = max(
            state.explain_lock_until, state.audible_until + config.EXPLAIN_POST_WINDOW_S
        )
        for i in range(0, len(payload), 9600):
            await state.socket.send_bytes(payload[i:i + 9600])
        trace.log("alert_spoken", ms=round((time.time() - now) * 1000), audio_s=round(len(pcm) / 48000, 1), by="server")
    finally:
        alert_audio_done.set()


async def local_alert(state: State, msg: dict) -> None:
    """Handle an optional on-device looming alert."""
    label = str(msg.get("label", "object"))[:30]
    key, text = phrases.local_alert(label, state.lang)
    now = time.time()
    if state.alert_locked(now):
        trace.log("local_alert", label=label, outcome="held: explain_lock_active", key=key)
        return
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
        reason=f"approaching {label} detected on-device",
        attention="high",
        hazard_type="moving",
    )
    imu = state.imu if state.imu and now - state.imu_at <= config.SENSOR_MAX_AGE_S else None
    if _is_panning(imu):
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
        latest_jpeg = state.frames[-1][1] if state.frames else None
        await fire_alert(state, d, source="local", frame_jpeg=latest_jpeg)


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

    # Do not trigger stopping again while explaining why to stop (+ 0.5 s post-explanation window).
    if state.alert_locked(look_started_at):
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
    if state.alert_locked(now_after):
        trace.log("watch_skipped", reason="explain_lock_active")
        return True
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
        code=d.action_code or None,
        next_code=d.next_code or None,
        steer=d.steer or None,
        move=d.user_direction or None,
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
        "code": d.action_code,
        "next_code": d.next_code,
        "steer": d.steer,
        "move": d.user_direction,
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
        await fire_alert(
            state, d, frame_jpeg=danger_jpeg, trajectory_frames=list(frames), sensors_desc=sensors_desc
        )
    elif d.notify:
        await state.send({"type": "suppressed", "reason": why, "key": d.hazard_key})
        if why == "needs_confirmation" and d.message:
            asyncio.create_task(_warm_voice(d.message))
    return True
