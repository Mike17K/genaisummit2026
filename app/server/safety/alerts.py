"""Background speech that is not a reply to the user: compass guidance cues and short notices (arrival at a place).

Also hosts `spawn`, the shared fire-and-forget task helper that logs unhandled exceptions to the trace.
"""
import asyncio
import time

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


async def speak_notice(state: State, text: str) -> None:
    """Speak a short informational line (e.g. arrival at a place) when nothing more important is playing."""
    await state.send({"type": "reply", "text": text})
    try:
        pcm = await asyncio.wait_for(speak.synthesize(text), 4.0)
    except Exception:
        await state.send({"type": "speak_text", "text": text})
        return
    now = time.time()
    if state.turn.active:
        return
    state.sent_audio(len(pcm), now)
    for i in range(0, len(pcm), 9600):
        await state.socket.send_bytes(pcm[i:i + 9600])


async def _speak_compass_cue(state: State, code: str, comp_deg: float, target_deg: float, delta: float) -> None:
    """Deliver a calm pre-cached compass guidance phrase."""
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
    if state.turn.active or state.target_bearing_deg is None:
        return
    state.sent_audio(len(pcm), now_pcm)
    for i in range(0, len(pcm), 9600):
        await state.socket.send_bytes(pcm[i:i + 9600])


def maybe_guide_compass(state: State, now: float) -> asyncio.Task | None:
    """Check phone compass against `state.target_bearing_deg` and spawn a gentle cue if needed."""
    if state.target_bearing_deg is None or state.depth_mode_active:
        return None
    if state.audible(now) or state.model_speaking or state.turn.active:
        return None
    if state.info_task is not None and not state.info_task.done():
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
    """Background loop issuing compass guidance cues toward the active target bearing."""
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
