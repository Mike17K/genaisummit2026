"""Gemini center-crop metric distance: anchors the relative Depth-Anything-V2 disparity to metres."""
import asyncio
import json

from google.genai import types

from ..assistant import agent
from ..utils import config

DEPTH_PROBE_SYSTEM = (
    "Estimate metric distance in meters from the camera lens to the object or surface at the exact center "
    'of this center-cropped view. Output ONLY JSON: {"m":1.2}'
)

_thinking_ok = True


def _cfg(with_thinking: bool) -> types.GenerateContentConfig:
    kw: dict = {}
    level = (config.DEPTH_PROBE_THINKING or "").strip().upper()
    enum_val = getattr(types.ThinkingLevel, level, None) if level else None
    if with_thinking and enum_val is not None:
        kw["thinking_config"] = types.ThinkingConfig(thinking_level=enum_val)
    mres = getattr(types.MediaResolution, "MEDIA_RESOLUTION_LOW", None)
    if mres is not None:
        kw["media_resolution"] = mres
    return types.GenerateContentConfig(
        system_instruction=DEPTH_PROBE_SYSTEM,
        response_mime_type="application/json",
        temperature=0.0,
        **kw,
    )


async def estimate_center_distance(center_jpeg: bytes) -> float | None:
    """Fast center-crop metric distance used when the browser/HAL omits Web PDAF focusDistance."""
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

    async def _call(with_thinking: bool):
        return await asyncio.wait_for(
            client.aio.models.generate_content(
                model=config.DEPTH_PROBE_MODEL, contents=contents, config=_cfg(with_thinking)
            ),
            timeout=1.2,
        )

    try:
        try:
            resp = await _call(_thinking_ok)
        except Exception as exc:
            if not _thinking_ok or "INVALID_ARGUMENT" not in str(exc):
                raise
            _thinking_ok = False
            resp = await _call(False)
        raw = json.loads((resp.text or "{}").strip())
        if isinstance(raw, list):
            raw = raw[0] if raw and isinstance(raw[0], dict) else {}
        val = float(raw.get("m", raw.get("dist_m", 0)))
        if val <= 0:
            return None
        return round(max(0.10, min(6.0, val)), 2)
    except Exception:
        return None
