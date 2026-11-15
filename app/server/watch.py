"""Stateless 3-frame safety watcher optimized for minimal token & decoding latency.

Inspects at most 3 recent frames tiled into a compact 224px-per-tile composite sheet using
MINIMAL thinking, MEDIUM media resolution, and a tiny JSON output (~5 tokens when safe,
~20 tokens on danger). Re-exports policy, attention, and similarity symbols.
"""
import asyncio
import json
import re
import time

from google.genai import types

from . import agent, compose, config
from .attention import Attention, sensors_text, user_moving
from .policy import AlertPolicy, WatchDecision, apply_danger_level, same_hazard
from .similarity import image_difference, is_similar_to_danger, scene_is_static, select_frames

__all__ = [
    "AlertPolicy",
    "Attention",
    "WatchDecision",
    "apply_danger_level",
    "build_contents",
    "estimate_center_distance",
    "image_difference",
    "is_similar_to_danger",
    "judge",
    "same_hazard",
    "scene_is_static",
    "select_frames",
    "sensors_text",
    "user_moving",
]

WATCH_SYSTEM = """Fast stateless navigation & obstacle checker for a blind pedestrian.
Input: up to 3 sequential camera tiles, oldest (1) to newest (NEW).

STEP 1 — Infer where the person wants to go from motion/rotation across tiles 1 -> NEW:
- Scene shifts LEFT across 1->NEW = person is ROTATING RIGHT (wants to go right).
- Scene shifts RIGHT across 1->NEW = person is ROTATING LEFT (wants to go left).
- Objects ahead grow/expand from center = person is MOVING FORWARD (wants to go straight ahead).
- Nearly identical tiles = "still".
Set "move": "forward" | "right" | "left" | "still".

STEP 2 — Emit ONLY standard action codes (never custom messages):
A) CLEAR PATH along where they want to go -> output ONLY:
{"lvl":0}
(Ignore side walls/furniture they are walking parallel to or already rotating away from.)

B) OPEN WAY AVAILABLE + OBSTACLE IN SIDE-FRONT (guide around without stopping, lvl 2 or 3):
Choose ONE standard "code":
- "SLIGHT_LEFT" / "SLIGHT_RIGHT": obstacle in front-right (1-2 o'clock) or front-left (10-11 o'clock), turn slightly toward open gap.
- "SLIDE_LEFT" / "SLIDE_RIGHT": sidestep laterally left or right past a narrow edge obstacle while keeping heading.
- "KEEP_LEFT" / "KEEP_RIGHT": stay hugging the clear side of a corridor/aisle.
- "TURN_LEFT" / "TURN_RIGHT": clear ~45-90 deg turn into open doorway/hallway when ahead closes off.
Output JSON:
{"lvl":2,"code":"SLIGHT_LEFT","move":"forward","key":"desk-front-right","type":"static|moving","why":"<=5 words"}
(Use lvl 3 when closer ~1.5-2.5 steps needing immediate steering.)

C) BLOCKED PATH / MUST STOP (dead-center obstacle with no safe pass without stopping, or <1.5 steps):
Choose "code" from: "STOP_NOW" (lvl 5, <1 step), "STOP" (lvl 4, 1-2 steps), "SLOW_NOW" (lvl 3), "SLOW_DOWN" (lvl 2), "CAREFUL" (lvl 1).
Also set "next" to the standard redirect code after stopping:
"SLIDE_LEFT" | "SLIDE_RIGHT" | "SLIGHT_LEFT" | "SLIGHT_RIGHT" | "TURN_LEFT" | "TURN_RIGHT" | "TURN_BACK" | "CHECK_CANE" | "".
Output JSON:
{"lvl":4,"code":"STOP","next":"SLIDE_RIGHT","move":"forward","key":"chair-ahead","type":"static|moving","why":"<=5 words"}

If "User context" is provided (what the person is trying to do or explicitly asked to avoid/remember), factor it into steering/caution codes while keeping immediate collision safety first."""


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
        prompt = f"Tiles 1..{len(frames)} oldest->NEW."
    else:
        for idx, (t, jpeg) in enumerate(frames, start=1):
            parts.append(types.Part.from_text(text=f"F{idx} ({_age(now, t)}):"))
            parts.append(types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"))
        prompt = "Compare frames oldest->newest."

    if sensors:
        prompt += f" Sensors: {sensors}."
    if user_context:
        prompt += f" User context: {user_context}."
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
        **kwargs,
    )


def _parse_decision(response, lang: str) -> WatchDecision:
    """Accept both ultra-compact {"lvl":...} JSON and full WatchDecision JSON."""
    if isinstance(getattr(response, "parsed", None), WatchDecision):
        d = response.parsed
    else:
        raw = json.loads((response.text or "{}").strip())
        if isinstance(raw, list):
            raw = raw[0] if raw and isinstance(raw[0], dict) else {}
        if "lvl" in raw or "key" in raw or "why" in raw or "steer" in raw or "code" in raw:
            lvl = int(raw.get("lvl", raw.get("danger_level", 0)) or 0)
            htype = raw.get("type", raw.get("hazard_type", "static"))
            code_raw = str(raw.get("code", raw.get("action_code", "")) or "").strip()
            next_raw = str(raw.get("next", raw.get("next_code", "")) or "").strip()
            steer_raw = str(raw.get("steer", "") or "").strip().lower()
            steer = steer_raw if steer_raw in ("left", "right") else ""
            move_raw = re.sub(r"[^a-z\-]", "", str(raw.get("move", raw.get("user_direction", "")) or "").lower())[:20]
            d = WatchDecision(
                notify=lvl >= 1 or bool(code_raw) or bool(steer) or bool(raw.get("notify", False)),
                danger_level=lvl,
                confidence=float(raw.get("confidence", 0.95 if lvl >= 3 else (0.90 if (lvl >= 1 or code_raw or steer) else 0.0))),
                hazard_key=str(raw.get("key", raw.get("hazard_key", ""))),
                reason=str(raw.get("why", raw.get("reason", ""))),
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
        apply_danger_level(d, lang)
    return d


async def _make_sheet(frames: list[tuple[float, bytes]]) -> bytes | None:
    if not config.WATCH_COMPOSE or len(frames) <= 1:
        return None
    try:
        return await asyncio.to_thread(compose.compose, frames, time.time(), config.COMPOSE_TILE_W, 3, 62)
    except Exception:
        return None


async def judge(
    frames: list[tuple[float, bytes]],
    recent: list[tuple[float, str, str]],
    lang: str,
    sensors: str = "",
    user_context: str = "",
) -> tuple[WatchDecision, dict]:
    """Run one fast stateless watcher check over at most 3 frames."""
    global _thinking_ok
    capped = frames[-3:]
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
                client.aio.models.generate_content(model=config.WATCH_MODEL, contents=contents, config=_cfg(thinking)),
                timeout=1.2,
            )
        except Exception as exc:
            if thinking is None or "INVALID_ARGUMENT" not in str(exc):
                raise
            _thinking_ok = False
            resp = await asyncio.wait_for(
                client.aio.models.generate_content(model=config.WATCH_MODEL, contents=contents, config=_cfg(None)),
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
