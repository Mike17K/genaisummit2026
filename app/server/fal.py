"""fal API access. The key stays on the server; the phone page must call fal through a route in this app.

Model in use: fal-ai/elevenlabs/tts/eleven-v3 (text to speech). Input: text (required), voice, stability, language_code,
output_format. Output: {"audio": {"url": ...}}. See https://fal.ai/models/fal-ai/elevenlabs/tts/eleven-v3/llms.txt

For other endpoints use run(). For long jobs use submit() and keep the request id; a second submit is a new billable job.
"""
from urllib.parse import urlparse

import fal_client
import httpx

from . import config

_client: fal_client.AsyncClient | None = None


def available() -> bool:
    return bool(config.FAL_KEY)


def _get_client() -> fal_client.AsyncClient:
    global _client
    if _client is None:
        if not config.FAL_KEY:
            raise RuntimeError("FAL_API_KEY is not set in app/.env")
        _client = fal_client.AsyncClient(key=config.FAL_KEY)
    return _client


async def run(endpoint: str, arguments: dict) -> dict:
    """Call a fal endpoint and wait for the result."""
    return await _get_client().subscribe(endpoint, arguments=arguments)


async def submit(endpoint: str, arguments: dict) -> str:
    """Queue a job and return its request id (poll with status()/result())."""
    handle = await _get_client().submit(endpoint, arguments=arguments)
    return handle.request_id


async def status(endpoint: str, request_id: str):
    return await _get_client().status(endpoint, request_id)


async def result(endpoint: str, request_id: str) -> dict:
    return await _get_client().result(endpoint, request_id)


def _is_fal_url(url: str) -> bool:
    u = urlparse(url)
    host = u.hostname or ""
    return u.scheme == "https" and (host == "fal.media" or host.endswith(".fal.media") or host == "fal.run" or host.endswith(".fal.run"))


async def tts(text: str) -> bytes:
    """Speak `text` with ElevenLabs v3. Returns raw PCM16 mono 24 kHz (what the page plays), no header."""
    out = await run(config.FAL_TTS_MODEL, {"text": text, "voice": config.FAL_TTS_VOICE, "output_format": "pcm_24000"})
    url = out["audio"]["url"]
    if not _is_fal_url(url):
        raise RuntimeError("fal returned an audio URL outside the fal domain")
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.get(url)
        r.raise_for_status()
    return r.content
