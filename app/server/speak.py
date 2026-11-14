"""Speak a short alert with a TTS model. Returns raw PCM16 mono 24 kHz, ready for the page to play.

Why not let the Live model say it: it sometimes read the instruction aloud instead of the alert. TTS says exactly the text.
Results are cached, so a repeated alert plays instantly.
"""
import asyncio
import io
import wave
from collections import OrderedDict

from google import genai
from google.genai import types

from . import config, trace

_client: genai.Client | None = None
_cache: "OrderedDict[str, bytes]" = OrderedDict()
_inflight: dict[str, asyncio.Future] = {}
CACHE_SIZE = 64
OUT_RATE = 24000


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
    return _client


def _to_pcm16(data: bytes, mime: str) -> bytes:
    """TTS models return either a WAV file or raw L16 PCM."""
    if data[:4] == b"RIFF":
        with wave.open(io.BytesIO(data)) as w:
            if w.getsampwidth() != 2 or w.getnchannels() != 1:
                raise ValueError(f"unexpected audio format: {w.getnchannels()} ch, {w.getsampwidth() * 8} bit")
            if w.getframerate() != OUT_RATE:
                trace.log("tts_warning", note=f"sample rate {w.getframerate()} Hz, expected {OUT_RATE}")
            return w.readframes(w.getnframes())
    return data  # raw PCM16 (the page plays it at 24 kHz)


async def _synthesize(text: str) -> bytes:
    response = await _get_client().aio.models.generate_content(
        model=config.TTS_MODEL,
        contents=text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=config.VOICE))
            ),
        ),
    )
    blob = response.candidates[0].content.parts[0].inline_data
    return _to_pcm16(blob.data, blob.mime_type or "")


async def synthesize(text: str) -> bytes:
    """PCM16 24 kHz mono for `text`. Cached; concurrent requests for the same text share one call."""
    key = text.strip().lower()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    if key in _inflight:
        return await asyncio.shield(_inflight[key])
    fut: asyncio.Future = asyncio.get_running_loop().create_future()
    _inflight[key] = fut
    try:
        pcm = await _synthesize(text)
        _cache[key] = pcm
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
        fut.set_result(pcm)
        return pcm
    except Exception as exc:
        fut.set_exception(exc)
        fut.exception()  # mark retrieved so asyncio does not warn when nobody else was waiting
        raise
    finally:
        _inflight.pop(key, None)


def is_cached(text: str) -> bool:
    return text.strip().lower() in _cache
