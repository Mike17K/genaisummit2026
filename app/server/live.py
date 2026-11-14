"""Realtime voice bridge: browser <-> server <-> Gemini Live API, plus a proactive safety watcher.

Browser -> server: binary frames = PCM16 mono 16 kHz microphone audio; JSON {"type":"frame","data":<b64 jpeg>}
                   and {"type":"mode","mode":"normal|urgent_only|off"}.
Server -> browser: binary frames = PCM16 mono 24 kHz model speech; JSON events (heard, reply, interrupted, tool,
                   watch, alert, suppressed, mode, ready, error, go_away).
Gemini does the voice activity detection, so the user just talks and can interrupt at any time.

Proactive alerts: every couple of seconds a vision model looks at the last 3 frames and DECIDES whether to speak
(see watch.py). A strict policy gates it. When an alert is approved it cuts whatever the assistant is saying and
says the alert instead.
"""
import asyncio
import base64
import json
import re
import time
import uuid
from collections import deque
from dataclasses import dataclass, field

from fastapi import WebSocket
from google import genai
from google.genai import types

from . import config, speak, tools, trace, watch

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
- Tools: remember_place, recall_places, call_contact, set_alert_mode. Use call_contact only if asked to call someone. If a tool result says simulated, say it is a demo call.
- A separate safety watcher looks at the camera for you and speaks its own short alerts (for example "Car ahead, stop!"). You will see notes in parentheses starting with "Note:" telling you what it said. Never answer or repeat those notes. If the user asks what the alert was, tell them in your own words.
- If the user asks for fewer or more alerts, or says to be quiet, call set_alert_mode: normal, urgent_only (only serious dangers) or off.
- Reply in the language the user speaks (Greek or English)."""

_client: genai.Client | None = None

_active_connections = 0                       # open /live connections right now
_watch_slots: asyncio.Semaphore | None = None  # limits parallel watcher calls across all connections
CLIENT_HANG_S = 0.8   # keep in step with GATE_HANG_MS in static/app.js
GREEK = re.compile(r"[Ͱ-Ͽ]")


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
    return _client


def _tool_declarations(extra: list) -> list[types.Tool]:
    api_client = _get_client()._api_client
    decls = [types.FunctionDeclaration.from_callable(client=api_client, callable=f) for f in [*tools.ALL, *extra]]
    return [types.Tool(function_declarations=decls)]


def _live_config(extra_tools: list | None = None) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=LIVE_SYSTEM,
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=config.VOICE))
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        tools=_tool_declarations(extra_tools or []),
        # Voice activity is controlled by THIS server, not by Gemini: the page's noise gate sends silence when the user is
        # quiet, so the server marks "user started" / "user stopped" itself. Manual control also lets an alert be a hard
        # barge-in: an activity signal interrupts whatever the model is saying, which a plain message does not.
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True),
            activity_handling=types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        ),
        # Without this, audio+video sessions end after about 2 minutes.
        context_window_compression=types.ContextWindowCompressionConfig(sliding_window=types.SlidingWindow()),
    )


@dataclass
class State:
    """Everything the bridge tracks for one browser connection."""
    socket: WebSocket
    session: object = None
    frames: deque = field(default_factory=lambda: deque(maxlen=3))   # (time, jpeg bytes): the last 3 frames
    policy: watch.AlertPolicy = field(default_factory=watch.AlertPolicy)
    recent_alerts: deque = field(default_factory=lambda: deque(maxlen=4))  # (time, key, message)
    last_user_voice: float = 0.0
    user_active: bool = False         # we told Gemini the user is currently talking
    hold_open: bool = False           # the interrupt turn from an alert stays open until the user really speaks
    expect_interrupt: bool = False    # we interrupted the model ourselves for an alert; do not forward the resulting event
    model_speaking: bool = False
    drop_audio_since: float = 0.0     # >0 while old speech is being thrown away after an alert
    lang: str = "English"
    last_judged_frame: float = 0.0
    extra_funcs: dict = field(default_factory=dict)  # tools that need this connection's state

    async def send(self, payload: dict) -> None:
        await self.socket.send_json(payload)


async def _gemini_to_browser(state: State) -> None:
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
                        if not data:
                            continue
                        now = time.time()
                        if state.drop_audio_since:
                            if now - state.drop_audio_since > 1.5:
                                state.drop_audio_since = 0.0  # safety net: never mute the assistant for good
                            else:
                                continue  # old speech that an alert just cancelled
                        state.model_speaking = True
                        if not first_audio_logged and last_heard_at:
                            first_audio_logged = True
                            trace.log("first_audio", latency_ms=round((now - last_heard_at) * 1000))
                        await socket.send_bytes(data)
                if sc.output_transcription and sc.output_transcription.text:
                    said += sc.output_transcription.text
                if sc.interrupted:
                    trace.log("interrupted", by="alert" if state.expect_interrupt else "user")
                    state.model_speaking = False
                    state.drop_audio_since = 0.0   # the old speech is over; what comes next is wanted
                    if state.expect_interrupt:
                        state.expect_interrupt = False  # the page already stopped playing when the alert was announced
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


async def _fire_alert(state: State, d: watch.WatchDecision) -> None:
    """Cut whatever is being said, then speak the alert (TTS) in its place."""
    now = time.time()
    state.policy.record(d, now)
    state.recent_alerts.append((now, d.hazard_key, d.message))
    was_speaking = state.model_speaking
    cached = speak.is_cached(d.message)
    trace.log("alert", urgency=d.urgency, key=d.hazard_key, text=d.message, confidence=d.confidence,
              cut_speech=was_speaking, voice_cached=cached)
    # Start making the spoken version right away; it is prepared while the cut happens.
    synth = asyncio.create_task(speak.synthesize(d.message))
    # 1) tell the page now: it stops playing, buzzes and beeps
    await state.send({"type": "alert", "urgency": d.urgency, "text": d.message})
    # 2) silence the Live model if it is talking. A manual activity signal is a hard barge-in; a plain message would only
    #    queue behind the current speech. Old audio still in flight is thrown away until the interrupt arrives.
    if was_speaking and not state.user_active:
        state.drop_audio_since = now
        state.expect_interrupt = True
        # Leave the turn OPEN: ending it would make Gemini answer the old request again (the story just carried on).
        # The server's normal voice logic closes it after the user's next words.
        state.user_active = True
        state.hold_open = True
        await state.session.send_realtime_input(activity_start=types.ActivityStart())
    # 3) let the model know what was said, without making it reply (turn_complete=False)
    await state.session.send_client_content(
        turns=types.Content(role="user", parts=[types.Part(
            text=f'(Note: your safety watcher just told the user: "{d.message}". Do not repeat it and do not respond to this note.)')]),
        turn_complete=False,
    )
    # 4) speak the alert
    try:
        pcm = await asyncio.wait_for(synth, 8)
    except Exception as exc:
        trace.log("alert_voice_failed", error=f"{type(exc).__name__}: {exc}"[:150])
        await state.send({"type": "speak_text", "text": d.message})   # the page falls back to its own voice
        return
    for i in range(0, len(pcm), 9600):
        await state.socket.send_bytes(pcm[i:i + 9600])
    trace.log("alert_spoken", ms=round((time.time() - now) * 1000), audio_s=round(len(pcm) / 48000, 1))


async def _warm_voice(text: str) -> None:
    try:
        await speak.synthesize(text)
    except Exception:
        pass


async def _watch_loop(state: State) -> None:
    while True:
        started = time.time()
        try:
            await _watch_once(state, started)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            trace.log("watch_error", error=f"{type(exc).__name__}: {exc}"[:200])
        await asyncio.sleep(max(0.2, config.WATCH_S - (time.time() - started)))


async def _watch_once(state: State, now: float) -> None:
    if state.policy.mode == "off":
        return
    frames = [f for f in state.frames if now - f[0] < 6]
    if len(frames) < 2 or frames[-1][0] <= state.last_judged_frame:
        return  # nothing new to look at
    global _watch_slots
    if _watch_slots is None:
        _watch_slots = asyncio.Semaphore(config.MAX_PARALLEL_CALLS)
    if _watch_slots.locked():
        trace.log("watch_skipped", reason="all model slots busy")   # never queue up: the next look uses a fresher frame
        return
    state.last_judged_frame = frames[-1][0]
    t0 = time.time()
    async with _watch_slots:
        d, info = await watch.judge(frames, list(state.recent_alerts), state.lang)
    ms = round((time.time() - t0) * 1000)
    fire, why = state.policy.decide(d, time.time(), time.time() - state.last_user_voice)
    outcome = "ALERT" if fire else ("silent" if not d.notify else "held: " + why)
    trace.log("watch", outcome=outcome, notify=d.notify, urgency=d.urgency, confidence=d.confidence,
              key=d.hazard_key, message=d.message or None, reason=d.reason[:100], ms=ms, **info)
    await state.send({"type": "watch", "outcome": outcome, "urgency": d.urgency, "confidence": d.confidence,
                      "key": d.hazard_key, "ms": ms})
    if fire:
        await _fire_alert(state, d)
    elif d.notify:
        await state.send({"type": "suppressed", "reason": why, "key": d.hazard_key})
        if why == "needs_confirmation" and d.message:
            # likely to fire on the next look: make the voice now so it plays instantly
            asyncio.create_task(_warm_voice(d.message))


async def run(socket: WebSocket) -> None:
    """Serve one browser connection with one Live session."""
    global _active_connections
    await socket.accept()
    conn_id = uuid.uuid4().hex[:6]
    trace.set_conn(conn_id)          # every trace event in this connection (and its tasks) carries this id
    tools.use_new_memory()           # this connection's own remembered places
    if _active_connections >= config.MAX_CONNECTIONS:
        trace.log("rejected_busy", active=_active_connections, limit=config.MAX_CONNECTIONS)
        await socket.send_json({"type": "error", "text": "The assistant is busy right now. Please try again in a minute."})
        await socket.close()
        return
    _active_connections += 1
    try:
        await _serve(socket, conn_id)
    finally:
        _active_connections -= 1
        trace.log("live_disconnect", active=_active_connections)


async def _serve(socket: WebSocket, conn_id: str) -> None:
    # The page can pass ?silence=<ms>; clamp it to a sane range.
    try:
        silence_ms = int(socket.query_params.get("silence", config.SILENCE_MS))
    except ValueError:
        silence_ms = config.SILENCE_MS
    silence_ms = max(300, min(4000, silence_ms))
    trace.log("live_connect", silence_ms=silence_ms, active=_active_connections)
    if not config.API_KEY:
        await socket.send_json({"type": "error", "text": "The model is not connected yet."})
        await socket.close()
        return

    state = State(socket=socket)
    # The page keeps sending real (quiet) audio for CLIENT_HANG_S after you stop, so only the rest of the wait is added here.
    end_wait = max(0.25, silence_ms / 1000 - CLIENT_HANG_S)

    def set_alert_mode(mode: str) -> dict:
        """Change how often camera safety alerts interrupt the user. mode: 'normal', 'urgent_only' (only serious dangers) or 'off'."""
        if mode not in watch.AlertPolicy.MODES:
            return {"error": f"mode must be one of {watch.AlertPolicy.MODES}"}
        state.policy.mode = mode
        trace.log("alert_mode", mode=mode, by="voice")
        asyncio.get_running_loop().create_task(state.send({"type": "mode", "mode": mode}))
        return {"status": "ok", "mode": mode}

    state.extra_funcs = {"set_alert_mode": set_alert_mode}
    try:
        async with _get_client().aio.live.connect(model=config.LIVE_MODEL, config=_live_config([set_alert_mode])) as session:
            state.session = session
            await socket.send_json({"type": "ready", "conn": conn_id})
            downstream = asyncio.create_task(_gemini_to_browser(state))
            watcher = asyncio.create_task(_watch_loop(state))
            mic_bytes = frames = 0
            try:
                while True:
                    message = await socket.receive()
                    if message["type"] == "websocket.disconnect":
                        break
                    if message.get("bytes"):
                        chunk = message["bytes"]
                        if mic_bytes == 0:
                            trace.log("first_mic_audio", bytes=len(chunk))
                        mic_bytes += len(chunk)
                        now = time.time()
                        voice = bool(chunk.strip(b"\x00"))   # the page sends pure silence below its noise gate
                        if voice:
                            state.last_user_voice = now
                            state.hold_open = False   # the user really spoke: back to the normal turn logic
                            if not state.user_active:
                                state.user_active = True
                                trace.log("user_turn", state="start", model_speaking=state.model_speaking)
                                await session.send_realtime_input(activity_start=types.ActivityStart())
                        if state.user_active and not state.hold_open:
                            await session.send_realtime_input(audio=types.Blob(data=chunk, mime_type="audio/pcm;rate=16000"))
                            if not voice and now - state.last_user_voice >= end_wait:
                                state.user_active = False
                                trace.log("user_turn", state="end", silence_s=round(now - state.last_user_voice, 2))
                                await session.send_realtime_input(activity_end=types.ActivityEnd())
                    elif message.get("text"):
                        msg = json.loads(message["text"])
                        kind = msg.get("type")
                        if kind == "frame":
                            jpeg = base64.b64decode(msg["data"])
                            if frames == 0:
                                trace.log("first_frame", bytes=len(jpeg))
                            frames += 1
                            state.frames.append((time.time(), jpeg))
                            await session.send_realtime_input(video=types.Blob(data=jpeg, mime_type="image/jpeg"))
                        elif kind == "mode" and msg.get("mode") in watch.AlertPolicy.MODES:
                            state.policy.mode = msg["mode"]
                            trace.log("alert_mode", mode=msg["mode"], by="button")
                    if downstream.done():  # Gemini side ended or failed
                        downstream.result()
                        break
            finally:
                downstream.cancel()
                watcher.cancel()
                trace.log("live_input_totals", mic_kb=round(mic_bytes / 1024), frames=frames)
    except Exception as exc:
        trace.log("error", error=f"{type(exc).__name__}: {exc}"[:300])
        try:
            await socket.send_json({"type": "error", "text": "Voice connection lost. Tap to restart."})
        except Exception:
            pass
