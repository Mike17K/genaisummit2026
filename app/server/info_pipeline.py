"""Streaming text-token information pipeline with clause-by-clause TTS and danger cut/explain/resume.

Architecture:
  1. User voice turn (16 kHz PCM16) + latest camera JPEG go directly into `generate_content_stream`
     (`MINIMAL` thinking) — zero separate STT roundtrip.
  2. Streamed text tokens are split eagerly into spoken clauses (`split_next_clause`).
  3. Each clause launches `speak.stream_tts(clause)` concurrently so Clause N+1 synthesizes while
     Clause N is playing on the phone, eliminating inter-clause silence gaps.
  4. On a danger signal from the safety guardrail:
     - `cancel_for_danger(state, now)` aborts LLM + TTS generation immediately (0 ms) and computes
       the exact `spoken_so_far` words heard by the user up to `now` from `clause_timeline`.
     - While `"Stop!"` plays aloud, `explain_after_alert(...)` starts streaming in parallel:
       first explaining *why* the user had to stop (what & where the obstacle is), and if an
       answer was interrupted, smoothly continuing from right where it was cut off.
"""
import asyncio
import io
import re
import time
import wave

from google.genai import types

from . import agent, compose, config, memory, phrases, speak, tools, trace
from .policy import WatchDecision
from .state import ActiveSpeech, InterruptedSpeech, State

GREEK = re.compile(r"[\u0370-\u03ff\u1f00-\u1fff]")
LATIN = re.compile(r"[A-Za-z]")
OTHER_SCRIPT = re.compile(
    r"[\u0400-\u052f\u0590-\u06ff\u0900-\u0d7f\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]"
)

STANDARD_CODES_DOC = (
    "Standard movement/sliding codes (ALWAYS emit the bracketed code instead of custom sliding/turning words — "
    "the system maps each code to standard words in the user's language):\n"
    "  [SLIDE_LEFT] [SLIDE_RIGHT] [SLIGHT_LEFT] [SLIGHT_RIGHT] [KEEP_LEFT] [KEEP_RIGHT] "
    "[TURN_LEFT] [TURN_RIGHT] [TURN_BACK] [CHECK_CANE]"
)

INFO_SYSTEM = f"""You are Eyes, a warm, concise voice assistant for a blind or low-vision person.
STRICT LANGUAGE RULE:
- You ONLY understand and speak English or Greek (Ελληνικά). NEVER output any other language (never Spanish, French, German, Italian, Turkish, Russian, Arabic, etc.).
- The user ONLY speaks English or Greek (often in a noisy venue with crowd chatter). Always transcribe the foreground user's English or Greek speech even if there is background room noise or slight mic muffling; ONLY output HEARD: NONE and REPLY: SILENT when there is no foreground English or Greek speech at all (or only background foreign chatter/noise).
- If HEARD is Greek, reply in Greek. If HEARD is English, reply in English.
Rules:
- Start with a short, natural 4-7 word opening clause followed by a comma or period so speech starts fast.
- Keep answers to 1-3 short spoken sentences. Never use markdown, bullet points, asterisks, or emojis.
- Give object locations using clock positions and rough step distances ("wooden desk at 12 o'clock, two steps ahead").
- {STANDARD_CODES_DOC}
- Read text verbatim when asked to read. If the image is dark or blurry, say so and suggest how to aim.
- Never claim a street crossing is safe. Never invent details not visible.
- Use `Current user memory` naturally as background context (for example, if the user is trying to find a door or keys and you see it, mention it first; do NOT repeat their memory back to them unless relevant).
- MINIMAL EXPLICIT MEMORY RULE:
  Keep `MEMORY:` strictly minimal — ONLY record what the user EXPLICITLY tells you when they state something worth remembering:
  * `GOAL: <=10 words` ONLY when the user explicitly tells you what they are trying to do, find, or reach (e.g., "I'm looking for the exit", "Ψάχνω την κουζίνα").
  * `NOTE: <=10 words` ONLY when the user explicitly tells you a fact, item location, or preference worth keeping (e.g., "Remember my bag is by the couch", "Avoid stairs").
  * `CLEAR_GOAL` when the user explicitly says they found/finished their goal, or `CLEAR` when they ask to forget everything.
  * `NONE` for ALL normal visual questions ("What is ahead?", "Read this", "What color?"), greetings, "OK", "Thanks", or anything guessed from the camera that the user did not explicitly state.
- Output format MUST be three sections in order:
HEARD: <exact transcription in English or Greek, or NONE if only noise/silence>
MEMORY: <NONE | GOAL: ... | NOTE: ... | CLEAR_GOAL | CLEAR>
REPLY: <your spoken reply in English or Greek, or SILENT if nothing to say>"""

EXPLAIN_SYSTEM = f"""You are Eyes, the laconic navigation voice guide for a blind pedestrian who was just told to stop or slow down.
STRICT LANGUAGE RULE:
- Speak ONLY in English or Greek (Ελληνικά), strictly matching the requested Language field. NEVER use any other language.
Style & Standard Code Rules:
- Be LACONIC (4-7 words for the obstacle, zero filler words). Never use markdown, lists, or emojis. Do NOT repeat "Stop!" / "Σταμάτα!".
- State ONLY what & where the obstacle is (clock + steps, ending with a period), followed IMMEDIATELY by ONE standard bracketed movement code (NEVER write custom sliding/turning words):
  {STANDARD_CODES_DOC}
- Examples (English):
  Chair at 12, one step. [SLIDE_RIGHT]
  Pillar ahead, two steps. [SLIGHT_LEFT]
  Wall ahead. [TURN_RIGHT]
  Stairs ahead. [CHECK_CANE]
- Examples (Greek):
  Καρέκλα στις 12, ένα βήμα. [SLIDE_RIGHT]
  Κολώνα μπροστά, δύο βήματα. [SLIGHT_LEFT]
  Τοίχος μπροστά. [TURN_RIGHT]
  Σκαλιά μπροστά. [CHECK_CANE]
- Safety: NEVER direct into unseen space, stairs, drop-offs, or traffic — use [TURN_BACK] or [CHECK_CANE] when no clear bypass is visible.
- If `User context` states what the person is trying to do or avoid, prefer a safe standard redirect code aligned with that context."""

_SENTENCE_END = re.compile(r"([.!?]+)(?:\s+|$)")
_CLAUSE_SEP = re.compile(r"([,;:·—–-]+)\s+")


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
    # Strip universal loanword 'ok'/'okay' so saying 'OK' during a Greek session doesn't flip to English
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


_REPEATED_NONE_RE = re.compile(r"^(?:NONE[\s,.;:-]*)+", re.IGNORECASE)


def is_valid_en_el_heard(text: str) -> bool:
    """Return True only if transcribed speech contains English or Greek letters and no foreign scripts."""
    if not text:
        return False
    up = text.strip().upper()
    if up == "NONE" or up.startswith("NONENONE"):
        return False
    cleaned = _REPEATED_NONE_RE.sub("", text).strip()
    if not cleaned:
        return False
    if OTHER_SCRIPT.search(cleaned):
        return False
    return bool(GREEK.search(cleaned) or LATIN.search(cleaned))


def parse_header_block(head_part: str) -> tuple[str, str]:
    """Parse `HEARD:` and optional `MEMORY:` from the pre-`REPLY:` header block."""
    if "MEMORY:" in head_part:
        heard_raw, mem_raw = head_part.split("MEMORY:", 1)
    else:
        heard_raw, mem_raw = head_part, "NONE"
    heard_text = re.sub(r"^\s*HEARD\s*:\s*", "", heard_raw, flags=re.IGNORECASE).strip()
    if heard_text.upper().startswith("NONENONE"):
        heard_text = "NONE"
    else:
        stripped_none = _REPEATED_NONE_RE.sub("", heard_text).strip()
        heard_text = stripped_none if stripped_none else "NONE"
    mem_directive = mem_raw.strip()
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
    # 1. Sentence boundary (. ! ? \n)
    nl = buffer.find("\n")
    if nl != -1:
        head, tail = _clean_clause(buffer[:nl]), buffer[nl + 1:]
        if len(head.split()) >= 2:
            return head, tail

    for m in _SENTENCE_END.finditer(buffer):
        end_idx = m.end(1)
        # Require whitespace after punctuation so we don't split inside "3.5" before next char arrives
        if m.end() == len(buffer):
            continue
        head = _clean_clause(buffer[:end_idx])
        if len(head.split()) >= (2 if is_first else 3):
            return head, buffer[m.end():]

    # 2. Clause boundary (, ; : —) for fast first-audio start
    min_words = 4 if is_first else 7
    for m in _CLAUSE_SEP.finditer(buffer):
        head = _clean_clause(buffer[:m.end(1)])
        if len(head.split()) >= min_words:
            return head, buffer[m.end():]

    # 3. Safety valve for long unpunctuated runs
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
            # Keep original interrupted question while appending newly heard progress
            prev = state.interrupted_speech.spoken_so_far
            state.interrupted_speech.spoken_so_far = f"{prev} {spoken}".strip()

    if task_running:
        state.info_task.cancel()
    state.info_task = None
    state.active_speech = None
    state.model_speaking = False
    state.audible_until = 0.0

    # Expire stale interrupted context older than 45 seconds
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
    lock_why_mode: str | None = None,  # None | "all" | "first_sentence"
    t0: float,
) -> tuple[str, str]:
    """Consume LLM text stream, pipeline clause TTS concurrently, and stream PCM16 in order."""
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
                # All "why" + standard redirect audio has been sent; keep explain_lock_until (why_end + 0.5s)
                # and drop the open-ended generation flag before speaking the resumed answer.
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
        """Expand completed `[CODE]` tags and hold back any trailing unclosed `[CODE` fragment."""
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
                    heard_text, mem_directive = parse_header_block(head_part)
                    if not is_valid_en_el_heard(heard_text):
                        aborted_noise = True
                        break
                    detected = detect_text_lang(heard_text, state.lang)
                    await update_session_lang(state, detected, source="heard")
                    active.user_question = heard_text
                    trace.log("heard", text=heard_text)
                    await state.send({"type": "heard", "text": heard_text})
                    if state.memory.apply_directive(mem_directive, heard_text):
                        memory.save_persisted(state.memory)
                        trace.log("memory_update", **state.memory.to_dict())
                        await state.send({"type": "memory", **state.memory.to_dict()})
                    in_reply = True
                    reply_buf = after.lstrip()
                    active.generated_text = reply_buf
                continue

            reply_buf += piece
            active.generated_text = phrases.expand_codes(active.generated_text + piece, state.lang)
            if active.generated_text.strip().upper().startswith("SILENT"):
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
            # Fallback if model omitted HEARD:/REPLY: markers
            if not in_reply and raw_buf.strip():
                tail = _clean_clause(raw_buf.replace("HEARD:", ""), state.lang)
                if tail and not tail.upper().startswith("NONE"):
                    active.generated_text = tail
                    reply_buf = tail
            tail_clause = _clean_clause(reply_buf, state.lang)
            if tail_clause and not tail_clause.upper().startswith("SILENT"):
                is_why = _next_is_why(tail_clause)
                pcm_q, p_task = _start_clause_tts(tail_clause)
                producer_tasks.append(p_task)
                await clause_queue.put((tail_clause, pcm_q, p_task, is_why))

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
    """Stream multimodal answer to user's spoken audio + camera frame clause by clause."""
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
    user_parts: list = []
    if frame_jpeg:
        user_parts.append(types.Part.from_bytes(data=frame_jpeg, mime_type="image/jpeg"))
    user_parts.append(types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"))
    user_parts.append(
        types.Part.from_text(
            text=(
                f"Default language: {lang}. Current user memory: {mem_ctx or 'none'}. "
                "Transcribe ONLY in English or Greek, update MEMORY only if the user explicitly stated a goal/note worth keeping (otherwise NONE), "
                "and reply ONLY in English or Greek."
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
            # Also capture explicit language switches ("Speak Greek" -> Greek reply) and persist
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

    # Build 3-frame sequential trajectory strip (oldest 1 -> NEW) so model sees walking direction & clear space
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
    is_guidance_alert = d.action_code in phrases.GUIDANCE_CODES or d.steer in ("left", "right")
    next_hint = f" Watcher suggested redirect code: [{d.next_code}]." if d.next_code else ""
    hazard_desc = f"{d.hazard_key or 'obstacle'}" + (f" ({d.reason})" if d.reason else "")
    if has_interrupted:
        first_step = (
            "1) First sentence (LACONIC, max 6 words, ending with '.'): briefly name the side-front obstacle they steered past (do NOT repeat a movement code).\n"
            if is_guidance_alert
            else (
                "1) First: state obstacle + clock/steps in <= 6 words ending with '.', followed by ONE standard bracketed code "
                "([SLIDE_LEFT], [SLIDE_RIGHT], [SLIGHT_LEFT], [SLIGHT_RIGHT], [KEEP_LEFT], [KEEP_RIGHT], [TURN_LEFT], [TURN_RIGHT], [TURN_BACK], or [CHECK_CANE]).\n"
            )
        )
        prompt = (
            f"Language: {lang} ONLY (strictly English or Greek, never any other language).\n"
            f"Visual input: {visual_note}\n"
            f"{motion_line}"
            f"{mem_line}"
            f'Alert spoken: "{d.message}" (code={d.action_code or "-"}, level {d.danger_level}/5) for: {hazard_desc}.{next_hint}\n'
            f'Interrupted question: "{interrupted.user_question}".\n'
            f'Already heard by user: "{interrupted.spoken_so_far or "(none yet)"}".\n'
            f'Earlier draft: "{interrupted.draft_reply}".\n'
            "Task:\n"
            f"{first_step}"
            "2) Next sentence: start with 'Continuing,' (or 'Συνεχίζοντας,') and finish the interrupted answer concisely."
        )
    else:
        prompt = (
            f"Language: {lang} ONLY (strictly English or Greek, never any other language).\n"
            f"Visual input: {visual_note}\n"
            f"{motion_line}"
            f"{mem_line}"
            f'Alert spoken: "{d.message}" (code={d.action_code or "-"}, level {d.danger_level}/5) for: {hazard_desc}.{next_hint}\n'
            "Output ONLY: <obstacle + clock/steps in <= 6 words>. <[STANDARD_CODE]> (never custom sliding/turning words)."
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
