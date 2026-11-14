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
    "image_difference",
    "is_similar_to_danger",
    "judge",
    "same_hazard",
    "scene_is_static",
    "select_frames",
    "sensors_text",
    "user_moving",
]

WATCH_SYSTEM = """Fast stateless obstacle detector for a blind pedestrian.
Input: up to 3 sequential camera tiles, oldest (1) to newest (NEW). Judge danger as of NEW.
If path is clear/safe, output ONLY: {"lvl":0}
If real obstacle or approaching hazard is in path, output compact JSON:
{"lvl":1..5,"key":"wall-ahead","type":"static|moving","why":"<=6 words"}
Levels:
5 = immediate impact (<1 step / <1s) -> Stop now!
4 = very close obstacle (1-2 steps) -> Stop!
3 = obstacle in path (2-3 steps) -> Slow down now.
2 = obstacle ahead (3-5 steps) -> Slow down.
1 = minor caution -> Careful ahead."""


def _age(now: float, t: float) -> str:
    return f"{max(0.0, now - t):.1f}s ago"


def build_contents(
    frames: list[tuple[float, bytes]],
    recent: list[tuple[float, str, str]],
    lang: str,
    sensors: str = "",
    sheet: bytes | None = None,
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
        if "lvl" in raw or "key" in raw or "why" in raw:
            lvl = int(raw.get("lvl", raw.get("danger_level", 0)) or 0)
            htype = raw.get("type", raw.get("hazard_type", "static"))
            d = WatchDecision(
                notify=lvl >= 1 or bool(raw.get("notify", False)),
                danger_level=lvl,
                confidence=float(raw.get("confidence", 0.95 if lvl >= 3 else (0.90 if lvl >= 1 else 0.0))),
                hazard_key=str(raw.get("key", raw.get("hazard_key", ""))),
                reason=str(raw.get("why", raw.get("reason", ""))),
                hazard_type="moving" if htype == "moving" else "static",
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
) -> tuple[WatchDecision, dict]:
    """Run one fast stateless watcher check over at most 3 frames."""
    global _thinking_ok
    capped = frames[-3:]
    sheet = await _make_sheet(capped)
    contents = build_contents(capped, recent, lang, sensors, sheet)
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
