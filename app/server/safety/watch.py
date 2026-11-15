"""Stateless 3-frame safety watcher optimized for minimal token & decoding latency."""
import asyncio
import json
import re
import time

from google.genai import types

from ..assistant import agent
from ..utils import compose, config
from ..utils.similarity import (
    frame_movement,
    image_difference,
    is_similar_to_danger,
    scene_is_static,
    select_frames,
)
from .attention import Attention, sensors_text, user_moving
from .policy import AlertPolicy, WatchDecision, apply_danger_level, same_hazard

__all__ = [
    "AlertPolicy",
    "Attention",
    "WatchDecision",
    "apply_danger_level",
    "build_contents",
    "estimate_center_distance",
    "frame_movement",
    "image_difference",
    "is_similar_to_danger",
    "judge",
    "same_hazard",
    "scene_is_static",
    "select_frames",
    "sensors_text",
    "user_moving",
]

WATCH_SYSTEM = """Predictive obstacle-location detector for a blind walker.
Input: sequential camera tiles oldest (1) -> newest (NEW, rightmost yellow-outlined tile).
Project ~1.0s (~1.5 steps) ahead along walking heading:

1) CLEAR OR ALREADY PASSED -> output ONLY:
{"l":0}
- Open walkable floor ahead for >= 3.5 steps in 10-2 o'clock.
- Ignore people/chairs behind glass walls/windows or inside side office rooms off the corridor.
- Ignore side corridor walls when the center floor is open.
- If an obstacle from Tile 1 has already moved to the far side/bottom edge in NEW with open floor ahead in NEW (already passing it), output {"l":0}.

2) OBSTACLE IN WALKING PATH (wall, closed door, doorframe, pillar, desk, chair, person, vehicle, stairs — including a close wall/door filling NEW):
Report WHERE the obstacle sits inside the NEW tile ("p") and how many steps away ("s"):
- "p": "left" (obstacle on left / open floor is on the right) | "right" (obstacle on right / open floor is on the left) | "ahead" (ONLY when centered across 12 o'clock or blocking straight ahead with no open side) | "stairs"
- "s": 3 (~3 steps, "l":2) | 2 (~2 steps, "l":3) | 1 (~1 step, "l":4) | 0 (<1 step right in front, "l":5)

Output ONLY compact JSON:
{"l":3,"p":"left","s":2,"k":"desk"}"""


def _age(now: float, t: float) -> str:
    return f"{max(0.0, now - t):.1f}s ago"


def build_contents(
    frames: list[tuple[float, bytes]],
    recent: list[tuple[float, str, str]],
    lang: str,
    sensors: str = "",
    sheet: bytes | None = None,
    user_context: str = "",
) -> list:
    now = time.time()
    parts: list = []
    if sheet is not None:
        parts.append(types.Part.from_bytes(data=sheet, mime_type="image/jpeg"))
        prompt = f"Tiles 1..{len(frames)}->NEW."
    else:
        for idx, (t, jpeg) in enumerate(frames, start=1):
            parts.append(types.Part.from_text(text=f"F{idx} ({_age(now, t)}):"))
            parts.append(types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"))
        prompt = "Oldest->newest."

    if sensors:
        prompt += f" {sensors}."
    if user_context:
        prompt += f" Context: {user_context}."
    parts.append(types.Part.from_text(text=prompt))
    return [types.Content(role="user", parts=parts)]


_thinking_ok = True


def _thinking_config():
    level = (config.WATCH_THINKING or "").strip().upper()
    if not level or not _thinking_ok:
        return None
    enum_val = getattr(types.ThinkingLevel, level, None)
    return types.ThinkingConfig(thinking_level=enum_val) if enum_val is not None else None


def _media_res():
    name = (config.WATCH_MEDIA_RES or "").strip().upper()
    return getattr(types.MediaResolution, name, None) if name else None


def _generation_config(thinking) -> types.GenerateContentConfig:
    kwargs: dict = {}
    if thinking is not None:
        kwargs["thinking_config"] = thinking
    mres = _media_res()
    if mres is not None:
        kwargs["media_resolution"] = mres
    return types.GenerateContentConfig(
        system_instruction=WATCH_SYSTEM,
        response_mime_type="application/json",
        temperature=0.0,
        max_output_tokens=72,
        **kwargs,
    )


def _parse_decision(response, lang: str) -> WatchDecision:
    """Accept ultra-compact {"l":...}, {"lvl":...}, and full WatchDecision JSON."""
    if isinstance(getattr(response, "parsed", None), WatchDecision):
        d = response.parsed
    else:
        raw = json.loads((response.text or "{}").strip())
        if isinstance(raw, list):
            raw = raw[0] if raw and isinstance(raw[0], dict) else {}
        compact_keys = ("l", "lvl", "c", "code", "p", "pos", "s", "steps", "k", "key", "w", "why", "steer")
        if any(k in raw for k in compact_keys):
            lvl = int(raw.get("l", raw.get("lvl", raw.get("danger_level", 0))) or 0)
            htype = raw.get("t", raw.get("type", raw.get("hazard_type", "static")))
            code_raw = str(raw.get("c", raw.get("code", raw.get("action_code", ""))) or "").strip()
            pos_raw = str(raw.get("p", raw.get("pos", "")) or "").strip().lower()
            steps_val = raw.get("s", raw.get("steps", None))
            if not code_raw and (pos_raw or lvl >= 1):
                zone = (
                    "LEFT" if "left" in pos_raw
                    else "RIGHT" if "right" in pos_raw
                    else "STAIRS" if "stair" in pos_raw or "step" in pos_raw
                    else "AHEAD"
                )
                try:
                    st = int(steps_val) if steps_val is not None else (3 if lvl <= 2 else 2 if lvl == 3 else 1 if lvl == 4 else 0)
                except (TypeError, ValueError):
                    st = 2
                if zone == "STAIRS":
                    code_raw = "STAIRS_2" if st >= 2 else "STAIRS_1"
                elif st <= 0 or lvl >= 5:
                    code_raw = f"{zone}_NOW"
                elif st == 1:
                    code_raw = f"{zone}_1"
                elif st == 2:
                    code_raw = f"{zone}_2"
                else:
                    code_raw = f"{zone}_3"
                if lvl == 0:
                    lvl = 2 if st >= 3 else 3 if st == 2 else 4 if st == 1 else 5
            next_raw = str(raw.get("n", raw.get("next", raw.get("next_code", ""))) or "").strip()
            steer_raw = str(raw.get("steer", "") or "").strip().lower()
            steer = steer_raw if steer_raw in ("left", "right") else ""
            move_src = raw.get("m", raw.get("move", raw.get("user_direction", "")))
            move_raw = re.sub(r"[^a-z\-]", "", str(move_src or "").lower())[:20]
            d = WatchDecision(
                notify=lvl >= 1 or bool(code_raw) or bool(steer) or bool(raw.get("notify", False)),
                danger_level=lvl,
                confidence=float(
                    raw.get("confidence", 0.95 if lvl >= 3 else (0.90 if (lvl >= 1 or code_raw or steer) else 0.0))
                ),
                hazard_key=str(raw.get("k", raw.get("key", raw.get("hazard_key", "")))),
                reason=str(raw.get("w", raw.get("why", raw.get("reason", "")))),
                hazard_type="moving" if htype == "moving" else "static",
                action_code=code_raw,
                next_code=next_raw,
                steer=steer,
                user_direction=move_raw,
            )
        else:
            d = WatchDecision.model_validate(raw)

    d.message = re.sub(r"\s+", " ", d.message.replace('"', "")).strip()[:90]
    d.hazard_key = re.sub(r"[^a-z0-9\- ]", "", d.hazard_key.lower()).strip().replace(" ", "-")[:40]
    if d.danger_level >= 1:
        if not d.reason and d.hazard_key:
            d.reason = d.hazard_key.replace("-", " ")
        apply_danger_level(d, lang)
    return d


async def _make_sheet(frames: list[tuple[float, bytes]]) -> bytes | None:
    if not config.WATCH_COMPOSE or len(frames) <= 1:
        return None
    try:
        return await asyncio.to_thread(
            compose.compose, frames, time.time(), config.COMPOSE_TILE_W, min(3, len(frames)), 58
        )
    except Exception:
        return None


async def judge(
    frames: list[tuple[float, bytes]],
    recent: list[tuple[float, str, str]],
    lang: str,
    sensors: str = "",
    user_context: str = "",
) -> tuple[WatchDecision, dict]:
    """Run one fast stateless watcher check over compact sequential trajectory tiles."""
    global _thinking_ok
    max_n = min(3, config.COMPOSE_FRAMES if config.WATCH_COMPOSE else config.WATCH_FRAMES)
    capped = frames[-max(1, max_n):]
    sheet = await _make_sheet(capped)
    contents = build_contents(capped, recent, lang, sensors, sheet, user_context=user_context)
    client = agent._get_client()
    thinking = _thinking_config()

    async def _call(cfg):
        return await asyncio.wait_for(
            client.aio.models.generate_content(model=config.WATCH_MODEL, contents=contents, config=cfg),
            timeout=config.WATCH_TIMEOUT_S,
        )

    try:
        response = await _call(_generation_config(thinking))
    except Exception as exc:
        if thinking is None or "INVALID_ARGUMENT" not in str(exc):
            raise
        _thinking_ok = False
        response = await _call(_generation_config(None))

    decision = _parse_decision(response, lang)
    usage = getattr(response, "usage_metadata", None)
    return decision, {
        "prompt_tokens": getattr(usage, "prompt_token_count", None),
        "output_tokens": getattr(usage, "candidates_token_count", None),
        "composed": sheet is not None,
    }


DEPTH_PROBE_SYSTEM = (
    "Estimate metric distance in meters from the camera lens to the object or surface at the exact center "
    'of this center-cropped view. Output ONLY JSON: {"m":1.2}'
)


async def estimate_center_distance(center_jpeg: bytes) -> float | None:
    """Fast center-crop metric distance fallback when browser/HAL omits Web PDAF focusDistance."""
    global _thinking_ok
    client = agent._get_client()
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(data=center_jpeg, mime_type="image/jpeg"),
                types.Part.from_text(text="Center distance in meters?"),
            ],
        )
    ]
    mres = getattr(types.MediaResolution, "MEDIA_RESOLUTION_LOW", None) or _media_res()
    thinking = _thinking_config()

    def _cfg(th):
        kw: dict = {}
        if th is not None:
            kw["thinking_config"] = th
        if mres is not None:
            kw["media_resolution"] = mres
        return types.GenerateContentConfig(
            system_instruction=DEPTH_PROBE_SYSTEM,
            response_mime_type="application/json",
            temperature=0.0,
            **kw,
        )

    try:
        try:
            resp = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=config.WATCH_MODEL, contents=contents, config=_cfg(thinking)
                ),
                timeout=1.2,
            )
        except Exception as exc:
            if thinking is None or "INVALID_ARGUMENT" not in str(exc):
                raise
            _thinking_ok = False
            resp = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=config.WATCH_MODEL, contents=contents, config=_cfg(None)
                ),
                timeout=1.2,
            )
        raw = json.loads((resp.text or "{}").strip())
        if isinstance(raw, list):
            raw = raw[0] if raw and isinstance(raw[0], dict) else {}
        val = float(raw.get("m", raw.get("dist_m", 0)))
        if val <= 0:
            return None
        return round(max(0.10, min(6.0, val)), 2)
    except Exception:
        return None
