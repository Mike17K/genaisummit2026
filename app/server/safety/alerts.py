"""Depth-triggered emergency stop + background compass guidance.

Emergency stop flow (the only obstacle alert path; the old camera-video watcher is gone):
  1. The browser runs Depth-Anything-V2 on the camera center continuously (phone WebGPU or laptop ONNX).
  2. When the calibrated distance drops to the stop threshold it sends ONE `depth_stop` message with a
     camera image, the measured distance and the phone compass/IMU snapshot.
  3. `depth_emergency_stop` cuts any speech, blocks the answering pipeline (`state.emergency_active`),
     plays the cached "Stop!", asks the model for a turn in degrees + what is ahead (image + compass), and
     speaks FIRST the degrees then what is ahead, sped up. The block lifts only after the guidance has played.
"""
import asyncio
import base64
import time

from ..assistant import info_pipeline
from ..audio import phrases, speak
from ..core import router
from ..core.state import State
from ..utils import config, trace


def spawn(coro) -> asyncio.Task:
    """Run a background coroutine and log any unhandled exception to trace."""
    task = asyncio.create_task(coro)

    def _done(t: asyncio.Task) -> None:
        if not t.cancelled() and t.exception() is not None:
            trace.log("task_error", error=f"{type(t.exception()).__name__}: {t.exception()}"[:300])

    task.add_done_callback(_done)
    return task


# ---------------------------------------------------------------------------
# Depth emergency stop
# ---------------------------------------------------------------------------

def stop_threshold_m(state: State) -> float:
    """Distance at or below which a depth reading counts as an emergency for the current alert mode."""
    return config.DEPTH_STOP_URGENT_M if state.alert_mode == "urgent_only" else config.DEPTH_STOP_M


def _parse_dist(raw) -> float | None:
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    return val if 0.0 < val < 20.0 else None


async def _play_stop_phrase(state: State, text: str) -> None:
    """Speak the cached stop phrase right away (phone voice if it is not cached yet)."""
    now = time.time()
    if not speak.is_cached(text) and state.client_tts:
        # The client already received the `alert` with client_voice=True and speaks it locally
        await asyncio.sleep(0.5)
        return
    try:
        pcm = await asyncio.wait_for(speak.synthesize_fast(text), 3.0)
    except Exception as exc:
        trace.log("alert_voice_failed", error=f"{type(exc).__name__}: {exc}"[:150])
        await state.send({"type": "speak_text", "text": text, "danger_level": 5})
        await asyncio.sleep(0.9)
        return
    state.audible_until = 0.0
    state.sent_audio(len(pcm), time.time())
    for i in range(0, len(pcm), 9600):
        await state.socket.send_bytes(pcm[i:i + 9600])
    trace.log("alert_spoken", ms=round((time.time() - now) * 1000), audio_s=round(len(pcm) / 48000, 1))


async def depth_emergency_stop(state: State, msg: dict) -> None:
    """Handle a `depth_stop` trigger from the client's depth model."""
    now = time.time()
    dist = _parse_dist(msg.get("dist_m"))
    reason = ""
    if state.alert_mode == "off":
        reason = "alerts_off"
    elif state.depth_mode_active:
        reason = "hold_scan_active"
    elif state.emergency_active:
        reason = "already_active"
    elif state.turn.active or (state.info_task is not None and not state.info_task.done()):
        # The user is talking or their request is being handled: hearing and acting on them comes first
        reason = "user_priority"
    elif now - state.last_emergency_at < config.DEPTH_STOP_COOLDOWN_S:
        reason = "cooldown"
    elif dist is None:
        reason = "bad_distance"
    elif dist > stop_threshold_m(state):
        reason = "too_far"
    if reason:
        trace.log("depth_stop", outcome="ignored: " + reason, dist_m=dist, mode=state.alert_mode)
        await state.send({"type": "emergency_ignored", "reason": reason})
        return

    jpeg: bytes | None = None
    if msg.get("data"):
        try:
            jpeg = base64.b64decode(str(msg["data"]))
        except Exception:
            jpeg = None
    if jpeg is None and state.frames:
        jpeg = state.frames[-1][1]
    if isinstance(msg.get("imu"), dict):
        state.imu, state.imu_at = msg["imu"], now

    # Block the answering pipeline: drop any in-flight answer and any half-heard user turn.
    # Only "Stop!" itself is protected; the user can talk over the guidance that follows.
    state.emergency_active = True
    state.last_emergency_at = now
    state.stop_phrase_until = now + 1.5  # refined to the real end of the phrase once it is queued
    state.emergency_task = asyncio.current_task()
    cut = info_pipeline.cancel_for_user(state)
    state.reset_mic_turn()

    stop_text = phrases.code_phrase("DEPTH_STOP", state.lang)
    cached = speak.is_cached(stop_text)
    client_voice = state.client_tts and not cached
    comp = state.imu.get("compassDeg") if isinstance(state.imu, dict) else None
    trace.log(
        "depth_stop",
        outcome="STOP",
        dist_m=round(dist, 2),
        approach_mps=msg.get("approach_mps"),
        drop_m=msg.get("drop_m"),
        source=str(msg.get("source") or "")[:40] or None,
        compass_deg=round(comp) if isinstance(comp, (int, float)) else None,
        cut_speech=cut,
        has_image=jpeg is not None,
        voice_cached=cached,
    )
    guide: asyncio.Task | None = None
    try:
        await state.send({
            "type": "alert",
            "urgency": "high",
            "danger_level": 5,
            "text": stop_text,
            "voice_cached": cached,
            "client_voice": client_voice,
            "source": "depth",
            "dist_m": round(dist, 2),
        })

        stop_done = asyncio.Event()
        guide = asyncio.create_task(info_pipeline.guide_after_depth_stop(state, jpeg, dist, stop_done))
        try:
            await _play_stop_phrase(state, stop_text)
        finally:
            state.stop_phrase_until = max(time.time(), state.audible_until) + 0.1
            stop_done.set()

        guidance = ""
        try:
            guidance = await asyncio.wait_for(guide, config.DEPTH_STOP_GUIDE_TIMEOUT_S)
        except asyncio.TimeoutError:
            trace.log("depth_stop_guide", outcome="timeout")
        except Exception as exc:
            trace.log("depth_stop_guide", outcome="error", error=f"{type(exc).__name__}: {exc}"[:200])
        if not guidance:
            fallback = phrases.code_phrase("DEPTH_STOP_FALLBACK", state.lang)
            await _play_stop_phrase(state, fallback)
            await state.send({"type": "reply", "text": fallback})
    except asyncio.CancelledError:
        trace.log("depth_stop", outcome="interrupted by user")
        raise
    finally:
        if guide is not None and not guide.done():
            guide.cancel()
        # Hold compass cues back until the guidance has finished playing (the mic stays open for barge-in)
        state.explain_lock_until = max(state.explain_lock_until, state.audible_until + config.EXPLAIN_POST_WINDOW_S)
        state.emergency_active = False
        state.emergency_task = None
        state.stop_phrase_until = 0.0
        state.last_emergency_at = time.time()
        try:
            await state.send({
                "type": "emergency_done",
                "resume_in_ms": round(max(0.0, state.explain_lock_until - time.time()) * 1000),
            })
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Compass guidance (unchanged behaviour, now the only background loop)
# ---------------------------------------------------------------------------

async def speak_notice(state: State, text: str) -> None:
    """Speak a short informational line (e.g. arrival at a place) when nothing more important is playing."""
    await state.send({"type": "reply", "text": text})
    try:
        pcm = await asyncio.wait_for(speak.synthesize(text), 4.0)
    except Exception:
        await state.send({"type": "speak_text", "text": text})
        return
    now = time.time()
    if state.alert_locked(now) or state.turn.active:
        return
    state.sent_audio(len(pcm), now)
    for i in range(0, len(pcm), 9600):
        await state.socket.send_bytes(pcm[i:i + 9600])


async def _speak_compass_cue(state: State, code: str, comp_deg: float, target_deg: float, delta: float) -> None:
    """Deliver a calm pre-cached compass guidance phrase without blocking emergency stops."""
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
    if (now - state.last_emergency_at) < 2.8:
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


async def compass_loop(state: State) -> None:
    """Background loop that only issues compass guidance cues (obstacles come from the depth stop)."""
    active: set[asyncio.Task] = set()
    try:
        while True:
            active = {t for t in active if not t.done()}
            cue_task = maybe_guide_compass(state, time.time())
            if cue_task is not None:
                active.add(cue_task)
            await asyncio.sleep(0.15)
    finally:
        for t in active:
            t.cancel()
