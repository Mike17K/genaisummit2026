"""Realtime voice bridge: browser <-> server <-> Gemini Live API.

Browser -> server: binary frames = PCM16 mono 16 kHz microphone audio; JSON {"type":"frame","data":<b64 jpeg>}.
Server -> browser: binary frames = PCM16 mono 24 kHz model speech; JSON events (heard, reply, interrupted, tool).
Gemini does the voice activity detection, so the user just talks and can interrupt at any time.
"""
import asyncio
import base64
import json
import time

from fastapi import WebSocket
from google import genai
from google.genai import types

from . import config, tools, trace

LIVE_SYSTEM = """You are Eyes, a voice assistant for a blind or low-vision person. They cannot see anything, they only hear you.
You receive their voice and a camera picture about once per second.
Rules:
- Speak warmly and naturally, in one or two short sentences. Never use lists or markdown.
- Give directions with clock positions and rough distances ("door at 2 o'clock, about 3 steps").
- Put warnings first (steps, obstacles, traffic, hot or sharp things), then the answer.
- Read text exactly as written when asked to read. Explain bills and letters in plain language.
- If the picture is blurry, dark, cut off, or you are not sure, say so and say what to do: move closer, add light, hold still. Never guess.
- Never say a road or crossing is safe. You support a cane or guide dog, you do not replace them.
- Tools: remember_place, recall_places, call_contact. Use call_contact only if asked to call someone. If a tool result says simulated, say it is a demo call.
- Reply in the language the user speaks (Greek or English)."""

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
    return _client


def _tool_declarations() -> list[types.Tool]:
    api_client = _get_client()._api_client
    decls = [types.FunctionDeclaration.from_callable(client=api_client, callable=f) for f in tools.ALL]
    return [types.Tool(function_declarations=decls)]


def _live_config(silence_ms: int) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=LIVE_SYSTEM,
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=config.VOICE))
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        tools=_tool_declarations(),
        # How long to wait after the user stops talking before the assistant answers.
        # A longer wait avoids cutting in during a pause. LOW end sensitivity also makes it less eager to end the turn.
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                end_of_speech_sensitivity=(
                    types.EndSensitivity.END_SENSITIVITY_LOW if silence_ms >= 900 else types.EndSensitivity.END_SENSITIVITY_HIGH
                ),
                silence_duration_ms=silence_ms,
            )
        ),
        # Without this, audio+video sessions end after about 2 minutes.
        context_window_compression=types.ContextWindowCompressionConfig(sliding_window=types.SlidingWindow()),
    )


async def _gemini_to_browser(session, socket: WebSocket) -> None:
    funcs = {f.__name__: f for f in tools.ALL}
    heard, said = "", ""
    last_heard_at = 0.0
    first_audio_logged = False
    while True:
        async for msg in session.receive():
            sc = msg.server_content
            if sc:
                if sc.input_transcription and sc.input_transcription.text:
                    heard += sc.input_transcription.text
                    last_heard_at = time.time()
                    first_audio_logged = False
                if sc.model_turn:
                    for part in sc.model_turn.parts or []:
                        data = part.inline_data.data if part.inline_data else None
                        if data:
                            if not first_audio_logged and last_heard_at:
                                first_audio_logged = True
                                trace.log("first_audio", latency_ms=round((time.time() - last_heard_at) * 1000))
                            await socket.send_bytes(data)
                if sc.output_transcription and sc.output_transcription.text:
                    said += sc.output_transcription.text
                if sc.interrupted:
                    trace.log("interrupted")
                    await socket.send_json({"type": "interrupted"})
                    said = ""
                if sc.turn_complete:
                    if heard.strip():
                        trace.log("heard", text=heard.strip())
                        await socket.send_json({"type": "heard", "text": heard.strip()})
                    trace.log("reply", text=said.strip() or None, silent=not said.strip(), model=config.LIVE_MODEL)
                    await socket.send_json({"type": "reply", "text": said.strip()})
                    heard, said = "", ""
            if msg.tool_call:
                responses = []
                for call in msg.tool_call.function_calls or []:
                    fn = funcs.get(call.name)
                    try:
                        result = fn(**(call.args or {})) if fn else {"error": f"unknown tool {call.name}"}
                    except Exception as exc:
                        result = {"error": str(exc)}
                    await socket.send_json({"type": "tool", "name": call.name, "args": call.args})
                    responses.append(types.FunctionResponse(id=call.id, name=call.name, response={"result": result}))
                await session.send_tool_response(function_responses=responses)
            if msg.go_away:
                trace.log("go_away", time_left=str(msg.go_away.time_left))
                await socket.send_json({"type": "go_away"})


async def run(socket: WebSocket) -> None:
    """Serve one browser connection with one Live session."""
    await socket.accept()
    # The page can pass ?silence=<ms>; clamp it to a sane range.
    try:
        silence_ms = int(socket.query_params.get("silence", config.SILENCE_MS))
    except ValueError:
        silence_ms = config.SILENCE_MS
    silence_ms = max(300, min(4000, silence_ms))
    trace.log("live_connect", silence_ms=silence_ms)
    if not config.API_KEY:
        await socket.send_json({"type": "error", "text": "The model is not connected yet."})
        await socket.close()
        return
    try:
        async with _get_client().aio.live.connect(model=config.LIVE_MODEL, config=_live_config(silence_ms)) as session:
            await socket.send_json({"type": "ready"})
            downstream = asyncio.create_task(_gemini_to_browser(session, socket))
            mic_bytes = frames = 0
            try:
                while True:
                    message = await socket.receive()
                    if message["type"] == "websocket.disconnect":
                        break
                    if message.get("bytes"):
                        if mic_bytes == 0:
                            trace.log("first_mic_audio", bytes=len(message["bytes"]))
                        mic_bytes += len(message["bytes"])
                        await session.send_realtime_input(
                            audio=types.Blob(data=message["bytes"], mime_type="audio/pcm;rate=16000")
                        )
                    elif message.get("text"):
                        msg = json.loads(message["text"])
                        if msg.get("type") == "frame":
                            if frames == 0:
                                trace.log("first_frame", bytes=len(msg["data"]))
                            frames += 1
                            await session.send_realtime_input(
                                video=types.Blob(data=base64.b64decode(msg["data"]), mime_type="image/jpeg")
                            )
                    if downstream.done():  # Gemini side ended or failed
                        downstream.result()
                        break
            finally:
                downstream.cancel()
                trace.log("live_input_totals", mic_kb=round(mic_bytes / 1024), frames=frames)
    except Exception as exc:
        trace.log("error", error=f"{type(exc).__name__}: {exc}"[:300])
        try:
            await socket.send_json({"type": "error", "text": "Voice connection lost. Tap to restart."})
        except Exception:
            pass
    trace.log("live_disconnect")
