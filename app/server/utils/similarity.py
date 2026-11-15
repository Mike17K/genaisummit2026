"""Frame selection, static-scene detection, multi-frame movement scoring, and danger similarity."""
import io
from PIL import Image

from . import config


def image_difference(jpeg1: bytes, jpeg2: bytes) -> float:
    """Compare two JPEGs using a 16x16 grayscale thumbnail and return normalized L1 diff in [0.0, 1.0]."""
    try:
        with Image.open(io.BytesIO(jpeg1)) as img1, Image.open(io.BytesIO(jpeg2)) as img2:
            g1 = img1.convert("L").resize((16, 16), Image.BILINEAR).getdata()
            g2 = img2.convert("L").resize((16, 16), Image.BILINEAR).getdata()
            mean_abs = sum(abs(a - b) for a, b in zip(g1, g2)) / 256.0
            return mean_abs / 255.0
    except Exception:
        return 1.0


def is_similar_to_danger(danger_jpeg: bytes | None, candidate_jpeg: bytes) -> tuple[bool, float]:
    """Return (is_similar, diff_score) comparing candidate_jpeg against the stored trigger image."""
    if not danger_jpeg:
        return False, 1.0
    diff = image_difference(danger_jpeg, candidate_jpeg)
    return diff < config.DANGER_SIMILARITY_DIFF, diff


def frame_movement(frames: list[tuple[float, bytes]]) -> dict:
    """Measure visible movement across consecutive frames and oldest->newest span.

    Filters out small hand sway, slight tilts, and 1-frame twitches so alerts only fire on real
    visible movement (`score >= MIN_ALERT_MOVEMENT` and `sustained`), and `STOP` only fires when
    movement is clearly visible (`score >= MIN_STOP_MOVEMENT`).
    """
    if len(frames) < 2:
        return {
            "score": 0.0,
            "mean_step": 0.0,
            "min_step": 0.0,
            "span": 0.0,
            "sustained": False,
            "enough_for_alert": False,
        }
    steps = [image_difference(frames[i][1], frames[i + 1][1]) for i in range(len(frames) - 1)]
    span = image_difference(frames[0][1], frames[-1][1])
    mean_step = sum(steps) / len(steps)
    min_step = min(steps)
    score = 0.55 * mean_step + 0.45 * span
    sustained = min_step >= config.MIN_STEP_MOVEMENT
    enough = score >= config.MIN_ALERT_MOVEMENT and sustained
    return {
        "score": score,
        "mean_step": mean_step,
        "min_step": min_step,
        "span": span,
        "sustained": sustained,
        "enough_for_alert": enough,
    }


def select_frames(
    buffer,
    spacing: float,
    now: float,
    n: int = 3,
    max_age: float = 6.0,
) -> list[tuple[float, bytes]]:
    """Pick up to `n` fresh frames (at most 3 by default), oldest first, spaced ~`spacing` seconds apart."""
    fresh = [f for f in buffer if now - f[0] <= max_age]
    if not fresh:
        return []
    chosen = [fresh[-1]]
    for f in reversed(fresh[:-1]):
        if chosen[-1][0] - f[0] >= spacing * 0.9:
            chosen.append(f)
            if len(chosen) == n:
                break
    return list(reversed(chosen))


def scene_is_static(
    motion_history,
    now: float,
    last_look_at: float,
    attention_level: str,
    last_look_silent: bool,
) -> bool:
    """True when recent frame luminance motion is negligible and safe to skip a check."""
    if not config.STATIC_SKIP or attention_level != "normal" or not last_look_silent:
        return False
    if now - last_look_at >= config.STATIC_MAX_SKIP_S:
        return False
    recent = [m for t, m in motion_history if now - t <= 2.0]
    if len(recent) < 2:
        return False
    return max(recent) < config.STATIC_MOTION
