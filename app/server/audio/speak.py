"""Speak alerts and streaming assistant clauses with TTS (raw PCM16 mono 24 kHz)."""
import asyncio
from collections import OrderedDict
from collections.abc import AsyncIterator
import io
import time
import wave

from google import genai
from google.genai import types

from ..utils import config, trace
from . import fal, phrases

_client: genai.Client | None = None
_cache: "OrderedDict[str, bytes]" = OrderedDict()
_inflight: dict[str, asyncio.Future] = {}
_slots: asyncio.Semaphore | None = None
CACHE_SIZE = 160
OUT_RATE = 24000


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
    return _client


def _tts_config() -> types.GenerateContentConfig:
    return types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=config.VOICE)
            )
        ),
    )


def _to_pcm16(data: bytes, mime: str) -> bytes:
    """TTS models return either a WAV file or raw L16 PCM."""
    if data[:4] == b"RIFF":
        with wave.open(io.BytesIO(data)) as w:
            if w.getsampwidth() != 2 or w.getnchannels() != 1:
                raise ValueError(f"unexpected audio format: {w.getnchannels()} ch, {w.getsampwidth() * 8} bit")
            if w.getframerate() != OUT_RATE:
                trace.log("tts_warning", note=f"sample rate {w.getframerate()} Hz, expected {OUT_RATE}")
            return w.readframes(w.getnframes())
    return data


def _store_cache(key: str, pcm: bytes) -> None:
    if not pcm:
        return
    _cache[key] = pcm
    _cache.move_to_end(key)
    while len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)


async def _synthesize(text: str) -> bytes:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(config.MAX_PARALLEL_CALLS)
    async with _slots:
        if config.TTS_PROVIDER == "fal":
            return await fal.tts(text)
        response = await _call(text)
    blob = response.candidates[0].content.parts[0].inline_data
    return _to_pcm16(blob.data, blob.mime_type or "")


async def _call(text: str):
    return await _get_client().aio.models.generate_content(
        model=config.TTS_MODEL,
        contents=text,
        config=_tts_config(),
    )


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
        _store_cache(key, pcm)
        fut.set_result(pcm)
        return pcm
    except Exception as exc:
        fut.set_exception(exc)
        fut.exception()
        raise
    finally:
        _inflight.pop(key, None)


async def stream_tts(text: str) -> AsyncIterator[bytes]:
    """Stream 24 kHz mono PCM16 chunks for `text` with ~465 ms time-to-first-audio."""
    cleaned = text.strip()
    if not cleaned:
        return
    key = cleaned.lower()
    if key in _cache:
        _cache.move_to_end(key)
        cached_pcm = _cache[key]
        for i in range(0, len(cached_pcm), 9600):
            yield cached_pcm[i:i + 9600]
        return

    if config.TTS_PROVIDER == "fal":
        pcm = await synthesize(cleaned)
        for i in range(0, len(pcm), 9600):
            yield pcm[i:i + 9600]
        return

    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(config.MAX_PARALLEL_CALLS)

    collected = bytearray()
    carry = b""
    first = True
    async with _slots:
        stream = await _get_client().aio.models.generate_content_stream(
            model=config.TTS_MODEL,
            contents=cleaned,
            config=_tts_config(),
        )
        async for chunk in stream:
            for cand in chunk.candidates or []:
                if not cand.content:
                    continue
                for part in cand.content.parts or []:
                    inline = getattr(part, "inline_data", None)
                    data = inline.data if inline else None
                    if not data:
                        continue
                    if first:
                        first = False
                        if data[:4] == b"RIFF" and len(data) > 44:
                            data = data[44:]
                    buf = carry + data
                    if len(buf) % 2 == 1:
                        carry = buf[-1:]
                        buf = buf[:-1]
                    else:
                        carry = b""
                    if buf:
                        collected.extend(buf)
                        yield buf
    if collected:
        _store_cache(key, bytes(collected))


def is_cached(text: str) -> bool:
    return text.strip().lower() in _cache


_warmed = False


async def warm_common() -> None:
    """Pre-synthesize standard action codes first, then remaining alert phrases in the background."""
    global _warmed
    if _warmed:
        return
    _warmed = True
    started = time.time()
    priority_codes = [p for pair in phrases.ACTION_CODES.values() for p in pair if not is_cached(p)]

    async def one(text: str) -> None:
        try:
            await synthesize(text)
        except Exception as exc:
            trace.log("tts_warm_failed", text=text, error=f"{type(exc).__name__}: {exc}"[:120])

    if priority_codes:
        await asyncio.gather(*[one(t) for t in priority_codes])
    rest = [t for t in phrases.all_phrases() if not is_cached(t)]
    if rest:
        await asyncio.gather(*[one(t) for t in rest])
    trace.log("tts_warm", phrases=len(priority_codes) + len(rest), ms=round((time.time() - started) * 1000))
