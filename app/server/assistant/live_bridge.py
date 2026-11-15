"""Optional Gemini Live native-audio session bridge."""
import re
import time

from google import genai
from google.genai import types

from ..core.state import State
from ..utils import config, trace
from . import tools

LIVE_SYSTEM = """You are Eyes, a voice assistant for a blind or low-vision person. They cannot see anything, they only hear you.
You receive their voice and a camera picture about once per second.
Rules:
- Speak warmly and naturally, in one or two short sentences. Never use lists or markdown.
- Give directions with clock positions and rough distances ("door at 2 o'clock, about 3 steps").
- Put warnings first (steps, obstacles, traffic, hot or sharp things), then the answer.
- Read text exactly as written when asked to read. Explain bills and letters in plain language.
- If the picture is blurry, dark, cut off, or you are not sure, say so and say what to do: move closer, add light, hold still. Never guess.
- Never state the current time or date: you do not know them. Never invent details that are not visible or audible.
- Never say a road or crossing is safe. You support a cane or guide dog, you do not replace them.
- Tools: remember_place, recall_places, call_contact. Use call_contact only if asked to call someone. If a tool result says simulated, say it is a demo call.
- Reply in the language the user speaks (Greek or English)."""

GREEK = re.compile(r"[Ͱ-Ͽ]")

_client: genai.Client | None = None
_live_model_cache: str | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
    return _client


def _tool_declarations(extra: list) -> list[types.Tool]:
    api_client = get_client()._api_client
    decls = [types.FunctionDeclaration.from_callable(client=api_client, callable=f) for f in [*tools.ALL, *extra]]
    return [types.Tool(function_declarations=decls)]


def live_config(extra_tools: list | None = None) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=LIVE_SYSTEM,
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=config.VOICE)
            )
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        tools=_tool_declarations(extra_tools or []),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True),
            activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        ),
        context_window_compression=types.ContextWindowCompressionConfig(sliding_window=types.SlidingWindow()),
    )


async def pick_live_model() -> str:
    """Select the primary Live model if reachable, otherwise fall back cleanly."""
    global _live_model_cache
    if _live_model_cache:
        return _live_model_cache
    candidates = [config.LIVE_MODEL]
    if config.LIVE_FALLBACK_MODEL and config.LIVE_FALLBACK_MODEL != config.LIVE_MODEL:
        candidates.append(config.LIVE_FALLBACK_MODEL)
    last: Exception | None = None
    for model in candidates:
        try:
            async with get_client().aio.live.connect(model=model, config=live_config([])):
                pass
            _live_model_cache = model
            trace.log("live_model", model=model, fallback=model != config.LIVE_MODEL)
            return model
        except Exception as exc:
            last = exc
            trace.log("live_model_unavailable", model=model, error=f"{type(exc).__name__}: {exc}"[:200])
    raise last or RuntimeError("no live model available")


async def gemini_to_browser(state: State) -> None:
    """Forward Gemini Live audio, transcriptions, and tool calls back to the browser."""
    session, socket = state.session, state.socket
    funcs = {f.__name__: f for f in tools.ALL}
    funcs.update(state.extra_funcs)
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
                        if not data or not state.assistant_enabled:
                            continue
                        now = time.time()
                        if state.drop_audio_since:
                            if now - state.drop_audio_since > 1.5:
                                state.drop_audio_since = 0.0
                            else:
                                continue
                        state.model_speaking = True
                        if not first_audio_logged and last_heard_at:
                            first_audio_logged = True
                            trace.log("first_audio", latency_ms=round((now - last_heard_at) * 1000))
                        state.sent_audio(len(data), now)
                        await socket.send_bytes(data)
                if sc.output_transcription and sc.output_transcription.text:
                    said += sc.output_transcription.text
                if sc.interrupted:
                    trace.log("interrupted", by="alert" if state.expect_interrupt else "user")
                    state.model_speaking = False
                    state.audible_until = 0.0
                    state.drop_audio_since = 0.0
                    if state.expect_interrupt:
                        state.expect_interrupt = False
                    else:
                        await socket.send_json({"type": "interrupted"})
                    said = ""
                if sc.turn_complete:
                    state.model_speaking = False
                    if heard.strip():
                        trace.log("heard", text=heard.strip())
                        if GREEK.search(heard):
                            state.lang = "Greek"
                        elif re.search(r"[A-Za-z]{3}", heard):
                            state.lang = "English"
                        await socket.send_json({"type": "heard", "text": heard.strip()})
                    if said.strip() or heard.strip():
                        trace.log(
                            "reply",
                            text=said.strip() or None,
                            silent=not said.strip(),
                            model=_live_model_cache or config.LIVE_MODEL,
                        )
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
