"""Streaming multimodal command/answer pipeline with centralized memory decisions & danger resume."""
import asyncio
import io
import re
import time
import wave

from google.genai import types

from ..audio import phrases, speak
from ..core import memory, router
from ..core.state import ActiveSpeech, InterruptedSpeech, State
from ..safety.policy import WatchDecision
from ..utils import compose, config, trace
from . import agent, tools

GREEK = router.GREEK_RE
LATIN = router.LATIN_RE
OTHER_SCRIPT = router.OTHER_SCRIPT_RE
_REPEATED_NONE_RE = router._REPEATED_NONE_RE

STANDARD_CODES_DOC = (
    "Obstacle style rule: NEVER give imperative movement commands like 'stop', 'turn left', or 'slide right' "
    "unless the user explicitly asks which way to turn. Instead, always tell the user WHERE the obstacle is "
    "relative to them and roughly how many steps away (e.g., 'Πρόσεχε, καρέκλα δεξιά μπροστά σου σε δύο βήματα', "
    "'Careful, chair front-right in two steps')."
)

INFO_SYSTEM = f"""You are Eyes, a warm, concise voice assistant for a blind or low-vision person.
STRICT LANGUAGE RULE:
- You ONLY understand and speak English or Greek (Ελληνικά). NEVER output any other language (never Spanish, French, German, Italian, Turkish, Russian, Arabic, etc.).
- The user ONLY speaks English or Greek (often in a noisy venue with crowd chatter). Always transcribe the foreground user's English or Greek speech even if there is background room noise or slight mic muffling; ONLY output HEARD: NONE, INTENT: IGNORE, and REPLY: SILENT when there is no foreground English or Greek speech at all.
- If HEARD is Greek, reply in Greek. If HEARD is English, reply in English (unless the user explicitly asks to switch between English and Greek).
DECISION & RESPONSE RULES:
- Decide `INTENT:` for every turn:
  * `ANSWER` when the user asks a question, greets you, or asks what is visible / readable — you MUST answer clearly aloud!
  * `COMMAND` when the user gives an explicit goal, asks to remember/forget something, or changes settings (alerts / language) — execute and confirm aloud!
  * `IGNORE` ONLY when `HEARD: NONE` (background noise with no user speech).
- Whenever `INTENT` is `ANSWER` or `COMMAND`, NEVER output `SILENT` — ALWAYS give a helpful spoken `REPLY:`.
- Start with a short, natural 4-7 word opening clause followed by a comma or period so speech starts fast.
- Keep answers to 1-3 short spoken sentences. Never use markdown, bullet points, asterisks, or emojis.
- Give object locations using natural relative directions (front-left, ahead of you, front-right / αριστερά μπροστά σου, μπροστά σου, δεξιά μπροστά σου) and step distances ("wooden desk front-right in two steps").
- {STANDARD_CODES_DOC}
- Read text verbatim when asked to read. If the image is dark or blurry, say so and suggest how to aim.
- Never claim a street crossing is safe. Never invent details not visible.
- Use `Current user memory` naturally as background context (if the user is trying to find an object/exit and you see it, mention where it is first).
- COMPASS & DIRECTIONAL GUIDANCE (`COMPASS:`):
  * You receive live `Phone compass:` telemetry with the user's current heading in degrees/cardinal and exact relative bearings (`straight ahead`, `slightly left/right`, `left/right`, `behind`).
  * Always trust those pre-computed relative bearings — never guess left vs right mentally.
  * When the user only asks what direction they are facing or where North/South/East/West is, answer clearly using `Phone compass` and keep `COMPASS: NONE`.
  * When the user asks to go, walk, or be guided toward a specific direction ("Θέλω να πάω βόρεια", "Κατεύθυνέ με ανατολικά", "Guide me southwest", "Head to 180 degrees"), set `COMPASS: <N | NE | E | SE | S | SW | W | NW | 0..359>` and tell them calmly in `REPLY:` where that direction is relative to them right now so continuous compass cues can guide them.
  * When the user asks to stop or cancel compass guidance ("Σταμάτα την πυξίδα", "Stop compass"), set `COMPASS: CLEAR`.
  * If `Phone compass` says the sensor reading is not available and the user asks for compass orientation, say briefly that the phone's compass sensor is not sending data yet.
- MINIMAL EXPLICIT MEMORY RULE (`MEMORY:`):
  Keep `MEMORY:` strictly minimal — ONLY keep what the user EXPLICITLY states is worth remembering:
  * `GOAL: <=10 words` ONLY when the user explicitly states what they are trying to do, find, or reach ("I'm looking for the exit", "Ψάχνω την κουζίνα"). Do NOT write pure compass directions into `MEMORY:` (use `COMPASS:` instead).
  * `NOTE: <=10 words` ONLY when the user explicitly tells you a fact, item location, or preference worth keeping ("Remember my bag is by the couch", "Avoid stairs").
  * `CLEAR_GOAL` when the user explicitly says they found/finished their goal, or `CLEAR` when they ask to forget everything.
  * `NONE` for ALL normal visual questions ("What is ahead?", "Read this", "Can you hear me?"), greetings, "OK", "Thanks", or anything guessed from the camera.
- Output format MUST be five sections in order:
HEARD: <exact transcription in English or Greek, or NONE if only noise/silence>
INTENT: <ANSWER | COMMAND | IGNORE>
MEMORY: <NONE | GOAL: ... | NOTE: ... | CLEAR_GOAL | CLEAR>
COMPASS: <NONE | N | NE | E | SE | S | SW | W | NW | 0..359 | CLEAR>
REPLY: <your spoken reply in English or Greek, or SILENT ONLY if HEARD is NONE>"""

EXPLAIN_SYSTEM = """You are Eyes, the laconic spatial hazard voice guide for a blind pedestrian.
STRICT LANGUAGE RULE:
- Speak ONLY in English or Greek (Ελληνικά), strictly matching the requested Language field. NEVER use any other language.
Style Rules:
- NEVER tell the user what action to take (NEVER say "Stop!", "Σταμάτα!", "Turn left", "Στρίψε", "Κάνε δεξιά").
- State ONLY what & where the obstacle is relative to the user and how many steps away in 4-8 words, ending with a period. Never use markdown, lists, or emojis.
- Examples (English):
  Careful, chair front-right in two steps.
  Careful, pillar right ahead of you in one step.
  Careful, closed door ahead of you in two steps.
  Careful, stairs ahead of you in two steps.
- Examples (Greek):
  Πρόσεχε, καρέκλα δεξιά μπροστά σου σε δύο βήματα.
  Πρόσεχε, κολώνα ακριβώς μπροστά σου σε ένα βήμα.
  Πρόσεχε, κλειστή πόρτα μπροστά σου σε δύο βήματα.
  Πρόσεχε, σκαλιά μπροστά σου σε δύο βήματα."""

_SENTENCE_END = re.compile(r"([.!?]+)(?:\s+|$)")
_CLAUSE_SEP = re.compile(r"([,;:·—–-]+)\s+")
_HEADER_TAG_RE = re.compile(r"(?:^|\n)\s*(HEARD|INTENT|MEMORY|COMPASS)\s*:\s*", re.IGNORECASE)


def normalize_lang(lang: str) -> str:
    """Guarantee session language is strictly 'English' or 'Greek'."""
    return phrases.normalize_lang(lang)


def detect_text_lang(text: str, current_lang: str = "English") -> str:
    """Detect whether English or Greek was spoken while keeping `current_lang` on short ambiguous words."""
    current = normalize_lang(current_lang)
    if not text:
        return current
    greek_count = len(GREEK.findall(text))
    if greek_count >= 2 or (greek_count >= 1 and not LATIN.search(text)):
        return "Greek"
    stripped_ok = re.sub(r"\b(ok|okay)\b", "", text, flags=re.IGNORECASE)
    latin_count = len(LATIN.findall(stripped_ok))
    if latin_count >= 4 and greek_count == 0:
        return "English"
    return current


async def update_session_lang(state: State, new_lang: str, source: str = "speech") -> str:
    """Set and persist the active language ('English' or 'Greek') and notify the client on change."""
    canon = normalize_lang(new_lang)
    changed = state.lang != canon
    state.lang = canon
    phrases.save_last_lang(canon)
    if changed:
        trace.log("lang_set", lang=canon, by=source)
        await state.send({"type": "lang", "lang": canon})
    return canon


def is_valid_en_el_heard(text: str) -> bool:
    """Return True only if transcribed speech contains English or Greek letters and no foreign scripts."""
    return router.is_valid_en_el_heard(text)


def parse_command_header(head_part: str) -> tuple[str, str, str, str]:
    """Parse `HEARD:`, optional `INTENT:`, `MEMORY:`, and `COMPASS:` from the pre-`REPLY:` header block."""
    sections: dict[str, str] = {}
    matches = list(_HEADER_TAG_RE.finditer(head_part or ""))
    if not matches:
        heard_raw = (head_part or "").strip()
    else:
        for idx, m in enumerate(matches):
            key = m.group(1).upper()
            end_pos = matches[idx + 1].start() if idx + 1 < len(matches) else len(head_part)
            sections[key] = head_part[m.end():end_pos].strip()
        heard_raw = sections.get("HEARD", "")

    heard_text = re.sub(r"^\s*HEARD\s*:\s*", "", heard_raw, flags=re.IGNORECASE).strip()
    if heard_text.upper().startswith("NONENONE"):
        heard_text = "NONE"
    else:
        stripped_none = _REPEATED_NONE_RE.sub("", heard_text).strip()
        heard_text = stripped_none if stripped_none else "NONE"

    intent_raw = sections.get("INTENT", "").strip()
    mem_directive = sections.get("MEMORY", "NONE").strip() or "NONE"
    compass_raw = sections.get("COMPASS", "NONE").strip() or "NONE"
    return heard_text, intent_raw, mem_directive, compass_raw


def parse_header_block(head_part: str) -> tuple[str, str]:
    """Backward-compatible wrapper returning `(heard_text, mem_directive)`."""
    heard_text, _, mem_directive, _ = parse_command_header(head_part)
    return heard_text, mem_directive


def pcm16_to_wav(pcm: bytes, rate: int = 16000) -> bytes:
    """Wrap raw mono 16-bit PCM into an in-memory WAV container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def _clean_clause(text: str, lang: str = "English") -> str:
    expanded = phrases.expand_codes(text, lang)
    cleaned = OTHER_SCRIPT.sub("", re.sub(r"[*_`#>]+", "", expanded))
    return re.sub(r"\s+", " ", cleaned).strip()


def split_next_clause(buffer: str, *, is_first: bool = False) -> tuple[str | None, str]:
    """Pop one speakable clause from `buffer` when ready, returning (clause, remainder)."""
    nl = buffer.find("\n")
    if nl != -1:
        head, tail = _clean_clause(buffer[:nl]), buffer[nl + 1:]
        if len(head.split()) >= 2:
            return head, tail

    for m in _SENTENCE_END.finditer(buffer):
        end_idx = m.end(1)
        if m.end() == len(buffer):
            continue
        head = _clean_clause(buffer[:end_idx])
        if len(head.split()) >= (2 if is_first else 3):
            return head, buffer[m.end():]

    min_words = 4 if is_first else 7
    for m in _CLAUSE_SEP.finditer(buffer):
        head = _clean_clause(buffer[:m.end(1)])
        if len(head.split()) >= min_words:
            return head, buffer[m.end():]

    words = buffer.split()
    max_words = 11 if is_first else 16
    if len(words) > max_words:
        cut = " ".join(words[:max_words - 1])
        idx = buffer.find(words[max_words - 1])
        return _clean_clause(cut), buffer[idx:] if idx != -1 else " ".join(words[max_words - 1:])

    return None, buffer


def _compute_spoken_so_far(active: ActiveSpeech, now: float) -> str:
    heard_parts: list[str] = []
    for p_start, p_end, text in active.clause_timeline:
        if now <= p_start:
            break
        if now >= p_end:
            heard_parts.append(text)
        else:
            words = text.split()
            frac = (now - p_start) / max(0.05, p_end - p_start)
            n = max(1, round(len(words) * frac))
            heard_parts.append(" ".join(words[:n]))
            break
    return " ".join(heard_parts).strip()


def cancel_for_user(state: State) -> bool:
    """Cancel active assistant speech when the user barges in with a new question."""
    was_active = bool((state.info_task and not state.info_task.done()) or state.audible(time.time()))
    if state.info_task and not state.info_task.done():
        state.info_task.cancel()
    state.info_task = None
    state.active_speech = None
    state.interrupted_speech = None
    state.explaining_alert = False
    state.model_speaking = False
    state.audible_until = 0.0
    return was_active


def cancel_for_danger(state: State, now: float | None = None) -> tuple[bool, InterruptedSpeech | None]:
    """Immediately abort LLM + TTS streaming on danger and snapshot exact spoken progress."""
    now = time.time() if now is None else now
    task_running = state.info_task is not None and not state.info_task.done()
    was_speaking = task_running or state.model_speaking or state.audible(now)

    active = state.active_speech
    if active is not None:
        spoken = _compute_spoken_so_far(active, now)
        if active.kind == "answer" and (active.user_question or active.generated_text):
            state.interrupted_speech = InterruptedSpeech(
                user_question=active.user_question,
                spoken_so_far=spoken,
                draft_reply=active.generated_text.strip(),
                created_at=now,
            )
        elif active.kind == "explain_resume" and state.interrupted_speech is not None and spoken:
            prev = state.interrupted_speech.spoken_so_far
            state.interrupted_speech.spoken_so_far = f"{prev} {spoken}".strip()

    if task_running:
        state.info_task.cancel()
    state.info_task = None
    state.active_speech = None
    state.model_speaking = False
    state.audible_until = 0.0

    if state.interrupted_speech and now - state.interrupted_speech.created_at > 45.0:
        state.interrupted_speech = None
    return was_speaking, state.interrupted_speech


def _start_clause_tts(clause_text: str) -> tuple[asyncio.Queue, asyncio.Task]:
    """Start streaming TTS for `clause_text` immediately into a queue in the background."""
    q: asyncio.Queue[bytes | Exception | None] = asyncio.Queue()

    async def _produce() -> None:
        try:
            async for pcm_chunk in speak.stream_tts(clause_text):
                await q.put(pcm_chunk)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await q.put(exc)
        finally:
            await q.put(None)

    return q, asyncio.create_task(_produce())


async def _stream_clauses_and_speak(
    state: State,
    token_stream,
    active: ActiveSpeech,
    *,
    parse_heard_header: bool = False,
    gate_audio_on: asyncio.Event | None = None,
    lock_why_mode: str | None = None,
    t0: float,
) -> tuple[str, str]:
    """Consume LLM text stream, evaluate centralized command/memory decision, and stream clause TTS."""
    clause_queue: asyncio.Queue[tuple[str, asyncio.Queue, asyncio.Task, bool] | None] = asyncio.Queue()
    producer_tasks: list[asyncio.Task] = []
    first_audio_logged = False

    async def _consumer() -> None:
        nonlocal first_audio_logged
        if gate_audio_on is not None:
            await gate_audio_on.wait()
        while True:
            item = await clause_queue.get()
            if item is None:
                break
            c_text, pcm_q, _, is_why_clause = item
            if lock_why_mode in ("first_sentence", "until_continue") and not is_why_clause:
                state.explaining_alert = False
            timeline_entry: list | None = None
            while True:
                chunk = await pcm_q.get()
                if chunk is None:
                    break
                if isinstance(chunk, Exception):
                    trace.log("clause_tts_failed", clause=c_text[:60], error=str(chunk)[:140])
                    if is_why_clause:
                        est_s = max(1.0, len(c_text.split()) / 2.6)
                        state.explain_lock_until = max(
                            state.explain_lock_until, time.time() + est_s + config.EXPLAIN_POST_WINDOW_S
                        )
                    await state.send({"type": "speak_text", "text": c_text})
                    break
                if not state.assistant_enabled:
                    continue
                now = time.time()
                if not first_audio_logged:
                    first_audio_logged = True
                    trace.log("first_audio", mode=active.kind, latency_ms=round((now - t0) * 1000))
                play_start = max(state.audible_until, now)
                state.model_speaking = True
                state.sent_audio(len(chunk), now)
                if is_why_clause:
                    state.explain_lock_until = max(
                        state.explain_lock_until, state.audible_until + config.EXPLAIN_POST_WINDOW_S
                    )
                if timeline_entry is None:
                    timeline_entry = [play_start, state.audible_until, c_text]
                    active.clause_timeline.append(timeline_entry)
                else:
                    timeline_entry[1] = state.audible_until
                await state.socket.send_bytes(chunk)

    consumer_task = asyncio.create_task(_consumer())
    heard_text = ""
    decision: router.CommandDecision | None = None
    reply_buf = ""
    raw_buf = ""
    in_reply = not parse_heard_header
    aborted_noise = False
    is_first_clause = True
    still_in_why = lock_why_mode in ("all", "first_sentence", "until_continue")
    _resume_re = re.compile(r"^(continuing|συνεχίζοντας)\b", re.IGNORECASE)

    def _next_is_why(clause_str: str) -> bool:
        nonlocal still_in_why
        if not still_in_why:
            return False
        if lock_why_mode == "until_continue" and _resume_re.search(clause_str.strip()):
            still_in_why = False
            return False
        if lock_why_mode == "first_sentence" and clause_str.rstrip().endswith((".", "!", "?")):
            still_in_why = False
        return True

    def _split_ready_buffer(buf: str) -> tuple[str, str]:
        expanded = phrases.expand_codes(buf, state.lang)
        last_open = expanded.rfind("[")
        if last_open != -1 and "]" not in expanded[last_open:]:
            return expanded[:last_open], expanded[last_open:]
        return expanded, ""

    try:
        async for chunk in token_stream:
            piece = ""
            for cand in chunk.candidates or []:
                if cand.content:
                    for part in cand.content.parts or []:
                        if getattr(part, "text", None):
                            piece += part.text
                        elif getattr(part, "function_call", None):
                            fc = part.function_call
                            f_args = dict(fc.args or {})
                            tool_map = {f.__name__: f for f in [*tools.ALL, *state.extra_funcs.values()]}
                            fn = tool_map.get(fc.name)
                            if fn is not None:
                                try:
                                    fn(**f_args)
                                except Exception as exc:
                                    trace.log("tool_error", tool=fc.name, error=str(exc)[:120])
                            if fc.name == "remember_place" and f_args.get("name"):
                                if state.memory.add_note(f"{f_args.get('name')}: {f_args.get('note', '')}"):
                                    memory.save_persisted(state.memory)
                                    await state.send({"type": "memory", **state.memory.to_dict()})
                            await state.send({"type": "tool", "name": fc.name, "args": f_args})
            if not piece:
                continue

            if not in_reply:
                raw_buf += piece
                if "REPLY:" in raw_buf:
                    head_part, after = raw_buf.split("REPLY:", 1)
                    parsed_heard, raw_intent, mem_directive, raw_compass = parse_command_header(head_part)
                    decision = router.decide_user_command(
                        parsed_heard,
                        raw_intent=raw_intent,
                        raw_memory=mem_directive,
                        raw_compass=raw_compass,
                    )
                    if not decision.should_answer:
                        heard_text = parsed_heard
                        aborted_noise = True
                        break
                    heard_text = decision.heard
                    if not decision.action.startswith("lang:"):
                        detected = detect_text_lang(heard_text, state.lang)
                        await update_session_lang(state, detected, source="heard")
                    active.user_question = heard_text
                    trace.log("heard", text=heard_text, intent=decision.intent)
                    await state.send({"type": "heard", "text": heard_text})
                    await router.apply_command_decision(state, decision)
                    in_reply = True
                    reply_buf = after.lstrip()
                    active.generated_text = reply_buf
                continue

            reply_buf += piece
            active.generated_text = phrases.expand_codes(active.generated_text + piece, state.lang)
            if active.generated_text.strip().upper().startswith("SILENT"):
                if decision is not None and decision.should_answer:
                    reply_buf = ""
                    active.generated_text = ""
                    break
                aborted_noise = True
                break

            ready_part, held_bracket = _split_ready_buffer(reply_buf)
            while True:
                clause, rem = split_next_clause(ready_part, is_first=is_first_clause)
                if clause is None:
                    break
                clause = _clean_clause(clause, state.lang)
                ready_part = rem
                if not clause:
                    continue
                is_first_clause = False
                is_why = _next_is_why(clause)
                pcm_q, p_task = _start_clause_tts(clause)
                producer_tasks.append(p_task)
                await clause_queue.put((clause, pcm_q, p_task, is_why))
            reply_buf = ready_part + held_bracket

        if aborted_noise:
            trace.log("heard_ignored", raw_heard=(heard_text or raw_buf.strip())[:80])
            await state.send({"type": "heard_ignored"})
        else:
            if not in_reply and raw_buf.strip():
                tail = _clean_clause(raw_buf.replace("HEARD:", ""), state.lang)
                if tail and not tail.upper().startswith("NONE"):
                    active.generated_text = tail
                    reply_buf = tail
            tail_clause = _clean_clause(reply_buf, state.lang)
            if tail_clause and not tail_clause.upper().startswith("SILENT"):
                is_first_clause = False
                is_why = _next_is_why(tail_clause)
                pcm_q, p_task = _start_clause_tts(tail_clause)
                producer_tasks.append(p_task)
                await clause_queue.put((tail_clause, pcm_q, p_task, is_why))
            elif decision is not None and decision.should_answer and is_first_clause:
                # Guarantee a spoken answer whenever the user asked a question or gave a command
                guaranteed = router.fallback_reply(decision, state.lang)
                if guaranteed:
                    active.generated_text = guaranteed
                    pcm_q, p_task = _start_clause_tts(guaranteed)
                    producer_tasks.append(p_task)
                    await clause_queue.put((guaranteed, pcm_q, p_task, False))

        await clause_queue.put(None)
        await consumer_task
        return heard_text, _clean_clause(active.generated_text, state.lang)
    except asyncio.CancelledError:
        consumer_task.cancel()
        for t in producer_tasks:
            t.cancel()
        raise
    finally:
        state.model_speaking = False
        if not consumer_task.done():
            consumer_task.cancel()
        for t in producer_tasks:
            if not t.done():
                t.cancel()


def _llm_config(system_instruction: str, extra_tools: list | None = None) -> types.GenerateContentConfig:
    kwargs: dict = {
        "system_instruction": system_instruction,
        "temperature": 0.25,
        "media_resolution": types.MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        "thinking_config": types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL),
    }
    if extra_tools is not None:
        kwargs["tools"] = [*tools.ALL, *extra_tools]
    return types.GenerateContentConfig(**kwargs)


async def answer_user_audio(state: State, pcm16_16k: bytes, frame_jpeg: bytes | None) -> None:
    """Stream multimodal answer/command execution to user's spoken audio + camera frame."""
    if not state.assistant_enabled:
        return
    t0 = time.time()
    active = ActiveSpeech(kind="answer")
    state.active_speech = active
    wav_bytes = pcm16_to_wav(pcm16_16k, 16000)

    contents: list = []
    for role, txt in list(state.chat_history)[-6:]:
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=txt)]))

    lang = normalize_lang(state.lang)
    state.lang = lang
    mem_ctx = state.memory.context_text(tools.peek_places())
    compass_ctx = router.compass_context_text(state, t0)
    user_parts: list = []
    if frame_jpeg:
        user_parts.append(types.Part.from_bytes(data=frame_jpeg, mime_type="image/jpeg"))
    user_parts.append(types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"))
    user_parts.append(
        types.Part.from_text(
            text=(
                f"Default language: {lang}. Current user memory: {mem_ctx or 'none'}. {compass_ctx} "
                "Transcribe ONLY in English or Greek, set INTENT (ANSWER | COMMAND | IGNORE), "
                "update MEMORY only if the user explicitly stated a goal/note/clear (otherwise NONE), "
                "set COMPASS if the user asked to be guided toward a direction or stop compass guidance (otherwise NONE), "
                "and ALWAYS reply aloud in English or Greek when INTENT is ANSWER or COMMAND."
            )
        )
    )
    contents.append(types.Content(role="user", parts=user_parts))

    try:
        stream = await agent._get_client().aio.models.generate_content_stream(
            model=config.MODEL,
            contents=contents,
            config=_llm_config(INFO_SYSTEM, list(state.extra_funcs.values())),
        )
        heard, full_reply = await _stream_clauses_and_speak(
            state, stream, active, parse_heard_header=True, t0=t0
        )
        if heard:
            state.chat_history.append(("user", heard))
        if full_reply:
            reply_lang = detect_text_lang(full_reply, state.lang)
            await update_session_lang(state, reply_lang, source="reply")
            state.chat_history.append(("model", full_reply))
            trace.log("reply", text=full_reply, model=config.MODEL, ms=round((time.time() - t0) * 1000))
            await state.send({"type": "reply", "text": full_reply})
    except asyncio.CancelledError:
        trace.log("info_stream_cancelled", mode="answer")
        raise
    except Exception as exc:
        trace.log("info_error", error=f"{type(exc).__name__}: {exc}"[:200])
        try:
            await state.send({"type": "heard_ignored", "reason": "error"})
        except Exception:
            pass
    finally:
        if state.active_speech is active:
            state.active_speech = None


async def explain_after_alert(
    state: State,
    d: WatchDecision,
    frame_jpeg: bytes | None,
    interrupted: InterruptedSpeech | None,
    alert_audio_done: asyncio.Event,
    *,
    trajectory_frames: list[tuple[float, bytes]] | None = None,
    sensors_desc: str = "",
) -> None:
    """In parallel with 'Stop!', stream laconic obstacle + where-to-head cue (+ resume interrupted answer)."""
    if not state.assistant_enabled:
        state.explaining_alert = False
        return
    t0 = time.time()
    lang = normalize_lang(state.lang)
    state.lang = lang
    active = ActiveSpeech(
        kind="explain_resume",
        user_question=interrupted.user_question if interrupted else "",
    )
    state.active_speech = active
    has_interrupted = bool(interrupted and (interrupted.user_question or interrupted.draft_reply))

    visual_jpeg = frame_jpeg
    visual_note = "Single current camera frame."
    if trajectory_frames and len(trajectory_frames) >= 2:
        try:
            sheet = await asyncio.to_thread(compose.compose, trajectory_frames[-3:], t0, 288, 3, 68)
            if sheet:
                visual_jpeg = sheet
                visual_note = f"Sequential tiles 1..{min(3, len(trajectory_frames))} (oldest -> NEW) showing where the user is heading."
        except Exception:
            pass

    motion_bits = []
    if d.user_direction:
        motion_bits.append(f"frame motion/rotation={d.user_direction}")
    if sensors_desc:
        motion_bits.append(sensors_desc)
    motion_line = f"Person movement/heading: {'; '.join(motion_bits)}.\n" if motion_bits else ""
    mem_ctx = state.memory.context_text(tools.peek_places())
    mem_line = f"User context: {mem_ctx}.\n" if mem_ctx else ""
    hazard_desc = f"{d.hazard_key or 'obstacle'}" + (f" ({d.reason})" if d.reason else "")
    if has_interrupted:
        prompt = (
            f"Language: {lang} ONLY (strictly English or Greek, never any other language).\n"
            f"Visual input: {visual_note}\n"
            f"{motion_line}"
            f"{mem_line}"
            f'Alert already spoken: "{d.message}" (code={d.action_code or "-"}, level {d.danger_level}/5) for: {hazard_desc}.\n'
            f'Interrupted question: "{interrupted.user_question}".\n'
            f'Already heard by user: "{interrupted.spoken_so_far or "(none yet)"}".\n'
            f'Earlier draft: "{interrupted.draft_reply}".\n'
            "Task:\n"
            "1) First sentence (max 7 words, ending with '.'): briefly name what the obstacle is and where it is in steps (do NOT give movement commands).\n"
            "2) Next sentence: start with 'Continuing,' (or 'Συνεχίζοντας,') and finish the interrupted answer concisely."
        )
    else:
        prompt = (
            f"Language: {lang} ONLY (strictly English or Greek, never any other language).\n"
            f"Visual input: {visual_note}\n"
            f"{motion_line}"
            f"{mem_line}"
            f'Alert spoken: "{d.message}" (code={d.action_code or "-"}, level {d.danger_level}/5) for: {hazard_desc}.\n'
            "Output ONLY: <what & where the obstacle is relative to the user in steps, <= 7 words> (never movement commands)."
        )

    parts: list = []
    if visual_jpeg:
        parts.append(types.Part.from_bytes(data=visual_jpeg, mime_type="image/jpeg"))
    parts.append(types.Part.from_text(text=prompt))

    try:
        stream = await agent._get_client().aio.models.generate_content_stream(
            model=config.MODEL,
            contents=[types.Content(role="user", parts=parts)],
            config=_llm_config(EXPLAIN_SYSTEM),
        )
        _, full_reply = await _stream_clauses_and_speak(
            state,
            stream,
            active,
            parse_heard_header=False,
            gate_audio_on=alert_audio_done,
            lock_why_mode="until_continue" if has_interrupted else "all",
            t0=t0,
        )
        state.explaining_alert = False
        if full_reply:
            state.interrupted_speech = None
            state.chat_history.append(("model", full_reply))
            trace.log(
                "explain_resume",
                resumed=has_interrupted,
                text=full_reply,
                lock_left_s=round(max(0.0, state.explain_lock_until - time.time()), 2),
                ms=round((time.time() - t0) * 1000),
            )
            await state.send({"type": "reply", "text": full_reply})
    except asyncio.CancelledError:
        trace.log("info_stream_cancelled", mode="explain_resume")
        raise
    except Exception as exc:
        trace.log("explain_error", error=f"{type(exc).__name__}: {exc}"[:200])
    finally:
        state.explaining_alert = False
        if state.active_speech is active:
            state.active_speech = None
