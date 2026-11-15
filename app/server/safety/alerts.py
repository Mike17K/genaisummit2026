"""Parallel safety watcher loop, movement-gated risk check, and urgent alert + explain/resume delivery."""
import asyncio
import time

from ..assistant import info_pipeline, tools
from ..audio import phrases, speak
from ..core import router
from ..core.state import State
from ..utils import config, debug_report, trace
from . import watch

_watch_slots: asyncio.Semaphore | None = None
_BREATH_PAUSE_PCM = b"\x00" * 7200    # 150 ms of 24 kHz mono PCM16 silence before resumed explanation
_REDIRECT_PAUSE_PCM = b"\x00" * 4800  # 100 ms of 24 kHz mono PCM16 silence between "Stop!" and cached redirect


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
    """Cut active speech at once, play cached alert (+ instant cached redirect), and resume interrupted speech if any."""
    now = time.time()
    state.last_alert_fired_at = now
    state.policy.record(d, now)

    was_speaking, interrupted = info_pipeline.cancel_for_danger(state, now)
    state.reset_mic_turn()

    is_steer = d.action_code in phrases.GUIDANCE_CODES or d.steer in ("left", "right")
    has_interrupted = bool(interrupted and (interrupted.user_question or interrupted.draft_reply))
    # Only run the slow LLM+TTS explain stream when resuming an interrupted user question;
    # otherwise chain the pre-cached redirect phrase in 0 ms without blinding the safety watcher for 6s.
    should_explain = state.assistant_enabled and has_interrupted

    redirect_text = ""
    if not should_explain and not is_steer and d.next_code:
        redirect_text = phrases.code_phrase(d.next_code, state.lang)

    spoken_text = f"{d.message} {redirect_text}".strip() if redirect_text else d.message
    state.recent_alerts.append((now, d.hazard_key, spoken_text))

    state.explaining_alert = should_explain
    if not is_steer:
        state.explain_lock_until = max(state.explain_lock_until, now + 0.70 + config.EXPLAIN_POST_WINDOW_S)

    cached = speak.is_cached(d.message) and (not redirect_text or speak.is_cached(redirect_text))
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
        text=spoken_text,
        confidence=d.confidence,
        cut_speech=was_speaking,
        resuming=has_interrupted,
        voice_cached=cached,
        client_voice=client_voice,
        source=source,
    )

    synth_main = asyncio.create_task(speak.synthesize(d.message))
    synth_redirect = asyncio.create_task(speak.synthesize(redirect_text)) if redirect_text else None

    await state.send({
        "type": "alert",
        "urgency": d.urgency,
        "danger_level": d.danger_level,
        "text": spoken_text,
        "voice_cached": cached,
        "client_voice": client_voice,
        "source": source,
    })

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

    try:
        if client_voice:
            if synth_redirect is not None:
                synth_redirect.cancel()
            trace.log("alert_spoken", ms=round((time.time() - now) * 1000), by="phone")
            if not is_steer:
                await asyncio.sleep(0.65)
                state.explain_lock_until = max(state.explain_lock_until, time.time() + config.EXPLAIN_POST_WINDOW_S)
            return
        try:
            pcm = await asyncio.wait_for(synth_main, 4)
            if synth_redirect is not None:
                try:
                    pcm_next = await asyncio.wait_for(synth_redirect, 2)
                    if pcm_next:
                        pcm = pcm + _REDIRECT_PAUSE_PCM + pcm_next
                except Exception:
                    pass
        except Exception as exc:
            if synth_redirect is not None:
                synth_redirect.cancel()
            trace.log("alert_voice_failed", error=f"{type(exc).__name__}: {exc}"[:150])
            await state.send({"type": "speak_text", "text": spoken_text, "danger_level": d.danger_level})
            if not is_steer:
                await asyncio.sleep(0.65)
                state.explain_lock_until = max(state.explain_lock_until, time.time() + config.EXPLAIN_POST_WINDOW_S)
            return

        payload = pcm + (_BREATH_PAUSE_PCM if should_explain else b"")
        now_pcm = time.time()
        state.audible_until = 0.0
        state.sent_audio(len(payload), now_pcm)
        if not is_steer:
            lock_cap = state.audible_until + config.EXPLAIN_POST_WINDOW_S
            if not should_explain:
                lock_cap = min(lock_cap, now_pcm + 1.55)
            state.explain_lock_until = max(state.explain_lock_until, lock_cap)
        for i in range(0, len(payload), 9600):
            await state.socket.send_bytes(payload[i:i + 9600])
        trace.log("alert_spoken", ms=round((time.time() - now) * 1000), audio_s=round(len(pcm) / 48000, 1), by="server")
    finally:
        alert_audio_done.set()


async def local_alert(state: State, msg: dict) -> None:
    """Handle an optional on-device looming alert gated through centralized movement evaluation."""
    if state.depth_mode_active:
        return
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
    has_frames = len(state.frames) >= 2
    gate = router.evaluate_movement_risk_gate(list(state.frames)[-3:], imu)
    if gate.panning:
        trace.log("local_alert", label=label, outcome="held: camera panning", key=key)
        return
    voice_age = (
        now - state.turn.last_voice
        if (state.assistant_enabled and state.turn.active and state.turn.voiced_s >= 0.20)
        else 99.0
    )
    fire, why = state.policy.decide(
        d,
        now,
        voice_age,
        fast_confirm=True,
        user_moving=gate.user_moving,
        movement_score=gate.score if has_frames else None,
        movement_sustained=gate.sustained if has_frames else True,
        lang=state.lang,
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


async def _speak_compass_cue(state: State, code: str, comp_deg: float, target_deg: float, delta: float) -> None:
    """Deliver a calm pre-cached compass guidance phrase without blocking or locking obstacle alerts."""
    text = phrases.code_phrase(code, state.lang)
    if not text:
        return
    trace.log(
        "compass_cue",
        code=code,
        compass_deg=round(comp_deg),
        target_deg=round(target_deg),
        delta_deg=round(delta),
        text=text,
        cached=speak.is_cached(text),
    )
    await state.send({
        "type": "compass_cue",
        "code": code,
        "text": text,
        "deg": round(comp_deg),
        "target_deg": round(target_deg),
    })
    try:
        pcm = await asyncio.wait_for(speak.synthesize(text), 3.0)
    except Exception as exc:
        trace.log("compass_voice_failed", error=f"{type(exc).__name__}: {exc}"[:120])
        await state.send({"type": "speak_text", "text": text})
        return
    now_pcm = time.time()
    if state.alert_locked(now_pcm) or state.turn.active or state.target_bearing_deg is None:
        return
    state.sent_audio(len(pcm), now_pcm)
    for i in range(0, len(pcm), 9600):
        await state.socket.send_bytes(pcm[i:i + 9600])


def maybe_guide_compass(state: State, now: float) -> asyncio.Task | None:
    """Check phone compass against `state.target_bearing_deg` and spawn a gentle cue if needed."""
    if state.target_bearing_deg is None or state.depth_mode_active:
        return None
    if state.alert_locked(now) or state.audible(now) or state.model_speaking or state.turn.active:
        return None
    if state.info_task is not None and not state.info_task.done():
        return None
    if (now - state.last_alert_fired_at) < 2.8:
        return None

    imu = state.imu if isinstance(state.imu, dict) and (now - state.imu_at) <= config.SENSOR_MAX_AGE_S else None
    if not imu:
        return None
    ang_speed = imu.get("angularSpeed")
    if isinstance(ang_speed, (int, float)) and ang_speed > 90.0:
        return None
    comp_deg = imu.get("compassDeg")
    if not isinstance(comp_deg, (int, float)):
        return None

    target_deg = float(state.target_bearing_deg)
    delta = router.compass_delta_deg(target_deg, float(comp_deg))
    abs_d = abs(delta)

    if abs_d <= config.COMPASS_ALIGNED_DEG:
        if not state.compass_aligned_announced and (now - state.last_compass_cue_at) >= 1.6:
            state.compass_aligned_announced = True
            state.last_compass_cue_at = now
            return spawn(_speak_compass_cue(state, "COMPASS_ALIGNED", float(comp_deg), target_deg, delta))
        return None

    if abs_d >= config.COMPASS_DRIFT_DEG:
        state.compass_aligned_announced = False
        if (now - state.last_compass_cue_at) < config.COMPASS_CUE_COOLDOWN_S:
            return None
        state.last_compass_cue_at = now
        if abs_d >= 135.0:
            code = "COMPASS_BEHIND"
        elif delta <= -55.0:
            code = "COMPASS_LEFT"
        elif delta < 0.0:
            code = "COMPASS_SLIGHT_LEFT"
        elif delta >= 55.0:
            code = "COMPASS_RIGHT"
        else:
            code = "COMPASS_SLIGHT_RIGHT"
        return spawn(_speak_compass_cue(state, code, float(comp_deg), target_deg, delta))
    return None


async def _run_watch_slot(state: State, started: float) -> None:
    state.watch_inflight += 1
    try:
        await watch_once(state, started)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        trace.log("watch_error", error=f"{type(exc).__name__}: {exc}"[:200])
    finally:
        state.watch_inflight = max(0, state.watch_inflight - 1)


async def watch_loop(state: State) -> None:
    """Staggered parallel safety watcher loop launching non-blocking checks as fresh frames arrive."""
    active_slots: set[asyncio.Task] = set()
    try:
        while True:
            now = time.time()
            active_slots = {t for t in active_slots if not t.done()}
            due = (now - state.last_look_at) >= state.attention.look_s
            has_unjudged = len(state.frames) >= 2 and state.frames[-1][0] > state.last_judged_frame
            if (
                state.watch_inflight == 0
                or (due and has_unjudged and state.watch_inflight < config.WATCH_MAX_INFLIGHT_PER_CONN)
            ):
                active_slots.add(spawn(_run_watch_slot(state, now)))
            cue_task = maybe_guide_compass(state, now)
            if cue_task is not None:
                active_slots.add(cue_task)
            await asyncio.sleep(0.08)
    finally:
        for t in active_slots:
            t.cancel()


async def _report_watch_idle(state: State, now: float, reason: str, move_score: float | None = None) -> None:
    """Send a throttled watcher heartbeat to the client debug UI when standing by."""
    if now - state.last_watch_idle_at < 1.5:
        return
    state.last_watch_idle_at = now
    payload: dict = {"type": "watch_idle", "reason": reason}
    if move_score is not None:
        payload["move_score"] = round(move_score, 3)
    await state.send(payload)


async def watch_once(state: State, look_started_at: float) -> bool:
    """Execute a single movement-gated safety check. Returns True only if the model was called."""
    if state.policy.mode == "off":
        if state.attention.level != "normal":
            state.attention = watch.Attention()
            await announce_rate(state, "alerts off")
        await _report_watch_idle(state, look_started_at, "alerts_off")
        return False

    if state.depth_mode_active or state.alert_locked(look_started_at):
        return False

    n_frames = min(3, config.COMPOSE_FRAMES if config.WATCH_COMPOSE else config.WATCH_FRAMES)
    frames = watch.select_frames(state.frames, state.attention.spacing, look_started_at, n=n_frames)
    if len(frames) < 2 or frames[-1][0] <= state.last_judged_frame:
        return False

    if state.danger_frame_jpeg is not None:
        similar, diff = watch.is_similar_to_danger(state.danger_frame_jpeg, frames[-1][1])
        if similar:
            state.last_judged_frame = frames[-1][0]
            trace.log("watch_skipped", reason="similar_to_danger_frame", diff=round(diff, 3))
            await _report_watch_idle(state, look_started_at, "same_obstacle", diff)
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
    move_frames = watch.select_frames(state.frames, config.MOVEMENT_SPAN_S, look_started_at, n=3)
    if len(move_frames) < 2:
        move_frames = frames
    gate = router.evaluate_movement_risk_gate(move_frames, imu)
    if gate.panning:
        state.last_judged_frame = frames[-1][0]
        trace.log("watch_skipped", reason="camera panning", deg_s=imu.get("angularSpeed") if imu else None)
        await _report_watch_idle(state, look_started_at, "panning", gate.score)
        return False

    if watch.scene_is_static(
        list(state.motion), look_started_at, state.last_look_at, state.attention.level, state.last_look_silent
    ):
        await _report_watch_idle(state, look_started_at, "still_scene", gate.score)
        return False

    # Centralized movement gate: only identify risks when the user moves visibly across frames
    if not gate.moved_enough:
        state.last_judged_frame = frames[-1][0]
        if state.attention.update("normal", look_started_at):
            await announce_rate(state, "low movement")
        trace.log(
            "watch_skipped",
            reason="low_movement",
            move_score=round(gate.score, 3),
            min_step=round(gate.min_step, 3),
            span=round(gate.span, 3),
        )
        await _report_watch_idle(state, look_started_at, "low_movement", gate.score)
        return False

    moving = gate.user_moving
    sensors_desc = watch.sensors_text(imu)
    sensors_desc = (
        f"{sensors_desc}, move {gate.score:.2f}" if sensors_desc else f"move {gate.score:.2f}"
    )
    user_ctx = state.memory.context_text(tools.peek_places())
    state.watch_seq += 1
    seq = state.watch_seq
    state.last_judged_frame = max(state.last_judged_frame, frames[-1][0])
    state.last_look_at = max(state.last_look_at, look_started_at)

    t0 = time.time()
    async with _watch_slots:
        d, info = await watch.judge(
            frames, list(state.recent_alerts), state.lang, sensors_desc, user_context=user_ctx
        )
    model_ms = round((time.time() - t0) * 1000, 1)

    now_after = time.time()
    if state.alert_locked(now_after):
        trace.log("watch_skipped", reason="explain_lock_active")
        return True
    if seq < state.watch_applied_seq:
        trace.log("watch_skipped", reason="superseded_by_newer_look", seq=seq, ms=round(model_ms))
        return True
    state.watch_applied_seq = seq
    state.last_look_silent = not d.notify
    if not d.notify and state.danger_frame_jpeg is None:
        state.policy.clear_resolved()

    voice_age = (
        now_after - state.turn.last_voice
        if (state.assistant_enabled and state.turn.active and state.turn.voiced_s >= 0.20)
        else 99.0
    )
    fire, why = state.policy.decide(
        d,
        now_after,
        voice_age,
        user_moving=moving,
        movement_score=gate.score,
        movement_sustained=gate.sustained,
        lang=state.lang,
    )
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
        move_score=round(gate.score, 3),
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
        reason_note = (
            f"model said {d.attention}"
            + (", alert fired" if fire else "")
            + (f", held ({why})" if held else "")
        )
        await announce_rate(state, reason_note)

    if fire:
        trigger_at = time.time()
        danger_jpeg = frames[-1][1]
        if d.danger_level >= 4:
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
