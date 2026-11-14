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

from . import config, phrases, speak, tools, trace, turns, watch

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
GREEK = re.compile(r"[Ͱ-Ͽ]")


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
    return _client


_live_model_cache: str | None = None


async def _pick_live_model() -> str:
    """The preferred Live model if it can be opened, else the fallback. Checked once per server run, then remembered."""
    global _live_model_cache
    if _live_model_cache:
        return _live_model_cache
    candidates = [config.LIVE_MODEL] + ([config.LIVE_FALLBACK_MODEL] if config.LIVE_FALLBACK_MODEL and config.LIVE_FALLBACK_MODEL != config.LIVE_MODEL else [])
    last: Exception | None = None
    for model in candidates:
        try:
            async with _get_client().aio.live.connect(model=model, config=_live_config([])):
                pass
            _live_model_cache = model
            trace.log("live_model", model=model, fallback=model != config.LIVE_MODEL)
            return model
        except Exception as exc:
            last = exc
            trace.log("live_model_unavailable", model=model, error=f"{type(exc).__name__}: {exc}"[:200])
    raise last or RuntimeError("no live model available")


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
    frames: deque = field(default_factory=lambda: deque(maxlen=40))  # (time, jpeg bytes): recent frames (about 10 s at the top rate)
    attention: watch.Attention = field(default_factory=watch.Attention)
    last_live_frame: float = 0.0      # when a frame was last forwarded to the Live model (at most about 1 per second)
    policy: watch.AlertPolicy = field(default_factory=watch.AlertPolicy)
    recent_alerts: deque = field(default_factory=lambda: deque(maxlen=4))  # (time, key, message)
    turn: turns.TurnTracker = field(default_factory=turns.TurnTracker)   # when the user's turn starts and ends
    expect_interrupt: bool = False    # we interrupted the model ourselves for an alert; do not forward the resulting event
    model_speaking: bool = False       # the Live model is still generating speech
    audible_until: float = 0.0         # when the phone is expected to finish playing what has been sent (fast models send faster than real time)
    drop_audio_since: float = 0.0     # >0 while old speech is being thrown away after an alert
    lang: str = "English"
    last_judged_frame: float = 0.0
    extra_funcs: dict = field(default_factory=dict)  # tools that need this connection's state
    motion: deque = field(default_factory=lambda: deque(maxlen=12))   # (time, motion score) sent by the page with each frame
    last_look_at: float = 0.0
    last_look_silent: bool = True
    imu: dict | None = None           # latest phone motion sensors reported by the page (gyro, walking, pitch)
    imu_at: float = 0.0
    client_tts: bool = True           # the page can speak an uncached urgent alert itself, with no wait

    async def send(self, payload: dict) -> None:
        await self.socket.send_json(payload)

    def audible(self, now: float) -> bool:
        """Is the assistant (probably) still audible on the phone? Speech arrives faster than it plays, so this can stay true
        for seconds after the model has finished generating."""
        return now < self.audible_until

    def sent_audio(self, nbytes: int, now: float) -> None:
        """Account for PCM16 24 kHz mono sent to the phone (48000 bytes per second of speech)."""
        self.audible_until = max(self.audible_until, now) + nbytes / 48000


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
                        state.sent_audio(len(data), now)
                        await socket.send_bytes(data)
                if sc.output_transcription and sc.output_transcription.text:
                    said += sc.output_transcription.text
                if sc.interrupted:
                    trace.log("interrupted", by="alert" if state.expect_interrupt else "user")
                    state.model_speaking = False
                    state.audible_until = 0.0
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
                        trace.log("reply", text=said.strip() or None, silent=not said.strip(), model=_live_model_cache or config.LIVE_MODEL)
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


async def _fire_alert(state: State, d: watch.WatchDecision, source: str = "watch") -> None:
    """Cut whatever is being said, then speak the alert in its place.

    Voice: if it is already made (cached) it is streamed at once. If it is not, an urgent alert is spoken by the PHONE
    immediately (no network wait) while the better voice is made in the background for next time; other alerts wait
    for the better voice."""
    now = time.time()
    state.policy.record(d, now)
    state.recent_alerts.append((now, d.hazard_key, d.message))
    was_speaking = state.model_speaking
    cached = speak.is_cached(d.message)
    client_voice = state.client_tts and d.urgency == "high" and not cached
    trace.log("alert", urgency=d.urgency, key=d.hazard_key, text=d.message, confidence=d.confidence,
              cut_speech=was_speaking, voice_cached=cached, client_voice=client_voice, source=source)
    # Make the better voice now (it plays this time if nobody spoke it yet, and is cached for next time).
    synth = asyncio.create_task(speak.synthesize(d.message))
    # 1) tell the page now: it stops playing, buzzes and beeps (and speaks, if it was asked to)
    await state.send({"type": "alert", "urgency": d.urgency, "text": d.message, "voice_cached": cached,
                      "client_voice": client_voice, "source": source})
    # 2) silence the Live model if it is talking. A manual activity signal is a hard barge-in; a plain message would only
    #    queue behind the current speech. Old audio still in flight is thrown away until the interrupt arrives.
    if was_speaking and not state.turn.active:
        state.drop_audio_since = now
        state.expect_interrupt = True
        # Leave the turn OPEN: ending it would make Gemini answer the old request again (the story just carried on).
        # The server's normal voice logic closes it after the user's next words.
        state.turn.hold_for_alert()
        await state.session.send_realtime_input(activity_start=types.ActivityStart())
    # 3) let the model know what was said, without making it reply (turn_complete=False)
    await state.session.send_client_content(
        turns=types.Content(role="user", parts=[types.Part(
            text=f'(Note: your safety watcher just told the user: "{d.message}". Do not repeat it and do not respond to this note.)')]),
        turn_complete=False,
    )
    # 4) speak the alert
    if client_voice:
        trace.log("alert_spoken", ms=round((time.time() - now) * 1000), by="phone")
        return    # the phone is already speaking it; the better voice finishes in the background and is cached
    try:
        pcm = await asyncio.wait_for(synth, 8)
    except Exception as exc:
        trace.log("alert_voice_failed", error=f"{type(exc).__name__}: {exc}"[:150])
        await state.send({"type": "speak_text", "text": d.message})   # the page falls back to its own voice
        return
    state.audible_until = 0.0            # the page already stopped what was playing when the alert was announced
    state.sent_audio(len(pcm), time.time())
    for i in range(0, len(pcm), 9600):
        await state.socket.send_bytes(pcm[i:i + 9600])
    trace.log("alert_spoken", ms=round((time.time() - now) * 1000), audio_s=round(len(pcm) / 48000, 1), by="server")


def _spawn(coro) -> asyncio.Task:
    """Run a background task, and record in the trace if it fails (an unretrieved task error is otherwise invisible)."""
    task = asyncio.create_task(coro)

    def _done(t: asyncio.Task) -> None:
        if not t.cancelled() and t.exception() is not None:
            trace.log("task_error", error=f"{type(t.exception()).__name__}: {t.exception()}"[:300])

    task.add_done_callback(_done)
    return task


async def _local_alert(state: State, msg: dict) -> None:
    """An alert raised by the phone's own on-device detector (an object in the path is getting rapidly closer)."""
    label = str(msg.get("label", "object"))[:30]
    key, text = phrases.local_alert(label, state.lang)
    now = time.time()
    try:
        confidence = max(0.0, min(1.0, float(msg.get("confidence", 0.92))))
    except (TypeError, ValueError):
        confidence = 0.92
    d = watch.WatchDecision(notify=True, urgency="high", confidence=confidence, hazard_key=key, message=text,
                            reason="on-device looming", attention="high", hazard_type="moving")
    imu = state.imu if state.imu and now - state.imu_at <= config.SENSOR_MAX_AGE_S else None
    if imu and imu.get("panning"):
        trace.log("local_alert", label=label, outcome="held: camera panning", key=key)
        return
    fire, why = state.policy.decide(d, now, now - state.turn.last_voice, fast_confirm=True,
                                    user_moving=watch.user_moving(imu))
    trace.log("local_alert", label=label, outcome="ALERT" if fire else "held: " + why, key=key,
              growth=msg.get("growth"), dist_m=msg.get("distM"), confidence=confidence)
    if fire:
        if state.attention.update("high", now, alerted=True):
            await _announce_rate(state, "on-device alert")
        await _fire_alert(state, d, source="local")


async def _announce_rate(state: State, why: str) -> None:
    """Tell the page how fast to send camera images now."""
    a = state.attention
    trace.log("attention", level=a.level, fps=a.fps, look_s=a.look_s, why=why)
    await state.send({"type": "rate", "fps": a.fps, "attention": a.level, "look_s": a.look_s})


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
        await asyncio.sleep(max(0.15, state.attention.look_s - (time.time() - started)))


async def _watch_once(state: State, now: float) -> None:
    if state.policy.mode == "off":
        if state.attention.level != "normal":
            state.attention = watch.Attention()
            await _announce_rate(state, "alerts off")
        return
    frames = watch.select_frames(state.frames, state.attention.spacing, now, n=config.WATCH_FRAMES)
    if len(frames) < 2 or frames[-1][0] <= state.last_judged_frame:
        return  # nothing new to look at
    global _watch_slots
    if _watch_slots is None:
        _watch_slots = asyncio.Semaphore(config.MAX_PARALLEL_CALLS)
    if _watch_slots.locked():
        trace.log("watch_skipped", reason="all model slots busy")   # never queue up: the next look uses a fresher frame
        return
    # Phone motion sensors: while the camera is swinging, apparent motion is not real, so do not look (saves a model call too).
    imu = state.imu if state.imu and now - state.imu_at <= config.SENSOR_MAX_AGE_S else None
    if imu and imu.get("panning"):
        trace.log("watch_skipped", reason="camera panning", deg_s=imu.get("angularSpeed"))
        return
    if watch.scene_is_static(list(state.motion), now, state.last_look_at, state.attention.level, state.last_look_silent):
        return    # nothing is changing; the next look is at most STATIC_MAX_SKIP_S away (not logged: this happens every second)
    user_moving = watch.user_moving(imu)
    state.last_judged_frame = frames[-1][0]
    state.last_look_at = now
    t0 = time.time()
    async with _watch_slots:
        d, info = await watch.judge(frames, list(state.recent_alerts), state.lang, watch.sensors_text(imu))
    ms = round((time.time() - t0) * 1000)
    state.last_look_silent = not d.notify
    fire, why = state.policy.decide(d, time.time(), time.time() - state.turn.last_voice, user_moving=user_moving)
    outcome = "ALERT" if fire else ("silent" if not d.notify else "held: " + why)
    # Adaptive attention: the model's own sense of how closely to watch, plus our own signals (an alert just fired,
    # or a suspected hazard is being held back). This raises the camera rate and the look rate, then eases back.
    held = d.notify and not fire and why in ("needs_confirmation", "low_confidence", "cooldown", "rate_limit", "user_speaking")
    changed = state.attention.update(d.attention, time.time(), alerted=fire, held=held)
    trace.log("watch", outcome=outcome, notify=d.notify, urgency=d.urgency, confidence=d.confidence,
              key=d.hazard_key, message=d.message or None, reason=d.reason[:100], ms=ms,
              attention=d.attention, level=state.attention.level, fps=state.attention.fps,
              hazard_type=d.hazard_type, moving=user_moving, **info)
    await state.send({"type": "watch", "outcome": outcome, "urgency": d.urgency, "confidence": d.confidence,
                      "key": d.hazard_key, "ms": ms, "attention": state.attention.level})
    if changed:
        await _announce_rate(state, f"model said {d.attention}" + (", alert fired" if fire else "") + (f", held ({why})" if held else ""))
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
    silence_ms = max(int(turns.END_WAIT_FLOOR_S * 1000), min(4000, silence_ms))
    trace.log("live_connect", silence_ms=silence_ms, active=_active_connections)
    if not config.API_KEY:
        await socket.send_json({"type": "error", "text": "The model is not connected yet."})
        await socket.close()
        return

    state = State(socket=socket)
    state.client_tts = socket.query_params.get("client_tts", "1") != "0"
    asyncio.create_task(speak.warm_common())   # common alert voices, made once per server run, in the background
    # The page tags its audio as voice or quiet, so the wait is counted from the true end of your voice.
    state.turn = turns.TurnTracker(end_wait=silence_ms / 1000)

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
        live_model = await _pick_live_model()
        async with _get_client().aio.live.connect(model=live_model, config=_live_config([set_alert_mode])) as session:
            state.session = session
            await socket.send_json({"type": "ready", "conn": conn_id})
            await _announce_rate(state, "start")
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
                        now_c = time.time()
                        for action in state.turn.feed(chunk, now_c, state.audible(now_c) or state.model_speaking):
                            if action[0] == "start":
                                was_audible = state.audible(now_c)
                                trace.log("user_turn", state="start", model_speaking=state.model_speaking, audible=was_audible)
                                if was_audible:
                                    # You are talking over the answer: stop it on the phone now (the model may have finished generating it)
                                    state.audible_until = 0.0
                                    await state.send({"type": "interrupted"})
                                await session.send_realtime_input(activity_start=types.ActivityStart())
                            elif action[0] == "audio":
                                await session.send_realtime_input(audio=types.Blob(data=action[1], mime_type="audio/pcm;rate=16000"))
                            elif action[0] == "end":
                                trace.log("user_turn", state="end", silence_s=action[1], voiced_s=round(state.turn.voiced_s, 1))
                                await session.send_realtime_input(activity_end=types.ActivityEnd())
                    elif message.get("text"):
                        msg = json.loads(message["text"])
                        kind = msg.get("type")
                        if kind == "frame":
                            jpeg = base64.b64decode(msg["data"])
                            if frames == 0:
                                trace.log("first_frame", bytes=len(jpeg))
                            frames += 1
                            now_f = time.time()
                            state.frames.append((now_f, jpeg))   # the watcher can use every frame
                            if isinstance(msg.get("imu"), dict):
                                state.imu, state.imu_at = msg["imu"], now_f
                            if isinstance(msg.get("motion"), (int, float)):
                                state.motion.append((now_f, float(msg["motion"])))
                            # The Live model only needs about 1 per second, except a fresh picture at the moment you start talking.
                            if msg.get("fresh") and now_f - state.last_live_frame < 0.95:
                                trace.log("fresh_frame")   # sent early on purpose: you just started talking
                            if msg.get("fresh") or now_f - state.last_live_frame >= 0.95:
                                state.last_live_frame = now_f
                                await session.send_realtime_input(video=types.Blob(data=jpeg, mime_type="image/jpeg"))
                        elif kind == "local_alert":
                            _spawn(_local_alert(state, msg))   # never block the audio loop
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
