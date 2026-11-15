"""Streaming multimodal command/answer pipeline + depth emergency-stop guidance."""
import asyncio
from dataclasses import dataclass
import io
import json
import re
import time
import wave

from google.genai import types
from PIL import Image

from ..audio import phrases, speak
from ..core import memory, router
from ..core.state import ActiveSpeech, State
from ..geo import service as geo_service
from ..safety import steering
from ..utils import config, trace
from . import agent, geo_tools, tools

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
- Frequent questions to recognise even when muffled (transcribe them exactly): "Πόσες μοίρες κοιτάω;" (NOT "μέρες"), "Προς τα πού κοιτάω;", "Σε ποια κατεύθυνση κοιτάω;", "Θέλω να πάω νότια.", "How many degrees am I facing?", "Which way am I facing?".
- The user ONLY speaks English or Greek (often in a noisy venue with crowd chatter). Always transcribe the foreground user's English or Greek speech even if there is background room noise or slight mic muffling; ONLY output HEARD: NONE, INTENT: IGNORE, and REPLY: SILENT when there is no foreground English or Greek speech at all.
- If HEARD is Greek, reply in Greek. If HEARD is English, reply in English (unless the user explicitly asks to switch between English and Greek).
DECISION & RESPONSE RULES:
- Decide `INTENT:` for every turn:
  * `ANSWER` when the user asks a question, greets you, or asks what is visible / readable — you MUST answer clearly aloud!
  * `COMMAND` when the user gives an explicit goal, asks to remember/forget something, or changes settings (alerts / language) — execute and confirm aloud!
  * `IGNORE` ONLY when `HEARD: NONE` (background noise with no user speech).
- Whenever `INTENT` is `ANSWER` or `COMMAND`, NEVER output `SILENT` — ALWAYS give a helpful spoken `REPLY:`.
- Start with a short, natural 4-7 word opening clause followed by a comma or period so speech starts fast.
- Keep answers to 1-3 short spoken sentences (tour-guide place descriptions may use up to 5). Never use markdown, bullet points, asterisks, or emojis.
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
- PLACES & TOUR GUIDE (tools: where_am_i, nearby_places, place_details, guide_to_place):
  * Call them ONLY when the user asks where they are, what is around, about a specific place/sight, the nearest X, or to be taken somewhere. Never for questions answerable from the camera.
  * For such questions you MUST call the tool in this same turn before answering. Never reply "I can check" or "let me look" without calling it.
  * When you call guide_to_place, set `COMPASS: NONE` (the tool already aims the compass at the place).
  * "Describe the area / be my guide / τι υπάρχει γύρω μου / ξενάγησέ με": call where_am_i and nearby_places (category "attractions" or "any"), then speak like a warm, vivid tour guide for a blind person: where they are (street/area), 2-3 notable places with what makes them special (history, atmosphere, sounds or smells you can expect), each with the tool's exact distance in steps or metres and `direction_from_you`. Offer to take them to one.
  * Always use the tool's `direction_from_you` and distances verbatim; never compute directions yourself. Mention a wheelchair-accessible entrance or opening status when the tool gives it.
  * "Take me to X / πήγαινέ με στο X": call guide_to_place, then say the distance, the direction and the first walking step if given; compass cues will continue guiding.
  * If a tool returns `error: no_location`, tell the user to allow location on the phone. Never invent places, ratings or history not in the tool result or common knowledge about a famous landmark.
  * After a tool result, continue directly with the spoken reply text (do NOT repeat HEARD/INTENT/MEMORY/COMPASS).
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

DEPTH_STOP_SYSTEM = """You are the eyes of a blind pedestrian's phone. The depth sensor found something very close at the
CENTER of the camera image; the user has been told "Stop!". Report ONLY what you SEE. Do NOT decide the turn and do
NOT do any compass math: the phone computes the turn from your answer.
Image coordinates: x = 0.0 is the LEFT edge of the image (the user's left), 0.5 the center, 1.0 the RIGHT edge.
Fields:
- "a": "turn" (default), "wait" (a person, animal or vehicle that is moving and will clear by itself), or "stay"
  (no walkable floor anywhere and nothing will clear).
- "left": x (0.0-0.5) of the nearest open walkable floor wide enough for a person on the LEFT of the obstacle,
  0.0 if open floor continues past the left edge, null if the left side is blocked.
- "right": x (0.5-1.0) of the nearest such open floor on the RIGHT of the obstacle, 1.0 if it continues past the
  right edge, null if the right side is blocked.
- "more_open": "left" or "right": which side looks more open overall (used when both are blocked in view).
- "what": what is ahead and how far, at most 5 words, in the requested Language (English or Greek), e.g.
  "Box one step ahead." / "Κουτί ένα βήμα μπροστά." (1 step is about 0.7 m). Never invent details.
Output ONLY JSON: {"a":"turn","left":null,"right":0.85,"more_open":"right","what":"Box one step ahead."}"""

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


def interrupt_everything(state: State, reason: str) -> bool:
    """The user started talking: cancel EVERYTHING the assistant is saying or doing so it can listen.

    Cuts the answer stream (thinking or speaking), stop guidance after "Stop!", compass cues and any queued audio.
    Returns True if something was actually cut.
    """
    now = time.time()
    cut = cancel_for_user(state)
    emergency = state.emergency_task
    if emergency is not None and not emergency.done() and now >= state.stop_phrase_until:
        emergency.cancel()
        cut = True
    if state.audible(now) or state.explain_lock_until > now:
        cut = True
    state.audible_until = 0.0
    state.explain_lock_until = 0.0
    if cut:
        trace.log("barge_in", reason=reason)
    return cut


def cancel_for_user(state: State) -> bool:
    """Cancel active assistant speech when the user barges in with a new question."""
    was_active = bool((state.info_task and not state.info_task.done()) or state.audible(time.time()))
    if state.info_task and not state.info_task.done():
        state.info_task.cancel()
    state.info_task = None
    state.active_speech = None
    state.explaining_alert = False
    state.model_speaking = False
    state.audible_until = 0.0
    return was_active


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


MAX_TOOL_ROUNDS = 3
_KEY_RE = re.compile(r"(key=)[^&\s]+", re.IGNORECASE)
_HEADER_PREFIXES = ("HEARD:", "INTENT:", "MEMORY:", "COMPASS:", "REPLY:")


@dataclass
class ToolPending:
    """Marker in the model text stream: the model called tools and we are waiting for their results."""

    names: list[str]

    @property
    def slow(self) -> bool:
        return any(n in geo_tools.SLOW_TOOLS for n in self.names)


async def _run_tool_call(state: State, fc) -> dict:
    name, args = fc.name, dict(fc.args or {})
    t0 = time.time()
    try:
        if name in geo_tools.SLOW_TOOLS:
            res = await asyncio.wait_for(geo_tools.run(state, name, args), 9.0)
        else:
            fn = {f.__name__: f for f in [*tools.ALL, *state.extra_funcs.values()]}.get(name)
            res = fn(**args) if fn is not None else {"error": f"unknown tool {name}"}
            if name == "remember_place" and args.get("name"):
                if state.memory.add_note(f"{args.get('name')}: {args.get('note', '')}"):
                    memory.save_persisted(state.memory)
                    await state.send({"type": "memory", **state.memory.to_dict()})
    except asyncio.TimeoutError:
        res = {"error": "timeout", "say": "The place lookup is taking too long."}
    except Exception as exc:
        res = {"error": _KEY_RE.sub(r"\1***", f"{type(exc).__name__}: {exc}")[:180]}
    if not isinstance(res, dict):
        res = {"result": res}
    trace.log("tool_call", tool=name, args=args, ms=round((time.time() - t0) * 1000), ok="error" not in res,
              error=res.get("error"), count=res.get("count"))
    await state.send({"type": "tool", "name": name, "args": args})
    return res


async def _model_pieces(state: State, contents: list, cfg: types.GenerateContentConfig):
    """Stream model text; run tool calls, feed results back and keep streaming the continuation.

    Yields text pieces, plus a `ToolPending` marker whenever tools run. Instant side-effect tools (language,
    alert mode, compass, remember) that came with a spoken reply do not trigger a second model round.
    """
    client = agent._get_client()
    contents = list(contents)
    used_geo = False
    for round_i in range(MAX_TOOL_ROUNDS + 1):
        stream = await client.aio.models.generate_content_stream(model=config.MODEL, contents=contents, config=cfg)
        model_parts: list = []
        calls: list = []
        text_seen = False
        round_text = ""
        async for chunk in stream:
            for cand in chunk.candidates or []:
                for part in (cand.content.parts if cand.content else None) or []:
                    model_parts.append(part)
                    if getattr(part, "function_call", None):
                        calls.append(part.function_call)
                    elif getattr(part, "text", None) and not getattr(part, "thought", False):
                        text_seen = True
                        round_text += part.text
                        yield part.text
        if not calls:
            if round_i == 0 and not used_geo and _needs_place_tool(round_text):
                # Safety net: a place question answered without the tools ("I can check...") -> force a tool round
                trace.log("geo_tool_forced", heard=_heard_of(round_text)[:80])
                contents += [
                    types.Content(role="model", parts=model_parts),
                    types.Content(role="user", parts=[types.Part.from_text(text=(
                        "System: that was a places question. Call the right places tool now (where_am_i, "
                        "nearby_places, place_details or guide_to_place), then continue the spoken reply in the "
                        "same language as HEARD. Do not repeat the header."
                    ))]),
                ]
                cfg = cfg.model_copy(update={"tool_config": types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(
                        mode=types.FunctionCallingConfigMode.ANY,
                        allowed_function_names=sorted(geo_tools.SLOW_TOOLS),
                    ))})
                yield ToolPending(["nearby_places"])
                continue
            return
        names = [c.name for c in calls]
        used_geo = used_geo or any(n in geo_tools.SLOW_TOOLS for n in names)
        if used_geo and cfg.tool_config is not None:
            cfg = cfg.model_copy(update={"tool_config": None})  # forced round done: let it answer freely
        needs_answer = (any(n in geo_tools.SLOW_TOOLS for n in names) or not text_seen) and round_i < MAX_TOOL_ROUNDS
        if needs_answer:
            yield ToolPending(names)
        results = await asyncio.gather(*[_run_tool_call(state, c) for c in calls])
        if not needs_answer:
            return
        contents += [
            types.Content(role="model", parts=model_parts),
            types.Content(role="user", parts=[
                types.Part.from_function_response(name=c.name, response=r) for c, r in zip(calls, results)
            ]),
        ]


# Questions that clearly need the places tools (English + Greek). Deliberately strict: a bare "near me" /
# "γύρω μου" can be a camera question ("is anyone near me?"), so it only counts together with a place word.
_PLACE_STRONG_RE = re.compile(
    r"\b(where\s+am\s+i|tour\s+guide|(?:describe|tell\s+me\s+about)\s+(?:the|this)\s+(?:area|neighbou?rhood|street|place)|"
    r"take\s+me\s+to|guide\s+me\s+to|how\s+(?:do|can)\s+i\s+get\s+to|directions?\s+to|nearest|closest)\b|"
    r"(πού\s+είμαι|που\s+ειμαι|ξενάγ|ξεναγ|περιοχή|περιοχη|πήγαινέ\s+με|πηγαινε\s+με|πάμε\s+στ|παμε\s+στ|"
    r"οδήγησέ\s+με\s+στ|οδηγησε\s+με\s+στ|πώς\s+(?:θα\s+)?πάω|πως\s+(?:θα\s+)?παω|πιο\s+κοντιν)",
    re.IGNORECASE,
)
_PLACE_NOUN_RE = re.compile(
    r"\b(caf[eé]s?|coffee|restaurants?|food|pharmac(?:y|ies)|chemist|shops?|stores?|supermarkets?|bus|metro|subway|"
    r"stations?|train|taxi|atms?|banks?|toilets?|restrooms?|museums?|parks?|church(?:es)?|hospitals?|doctors?|"
    r"hotels?|bars?|bakery|bakeries|markets?|attractions?|sights?|monuments?)\b|"
    r"(καφετ|καφέ|καφε|εστιατ|φαγητ|φαρμακ|μαγαζ|σούπερ|σουπερ|στάση|σταση|λεωφορ|μετρό|μετρο|σταθμ|ταξί|ταξι|"
    r"τράπεζ|τραπεζ|atm|τουαλέτ|τουαλετ|μουσεί|μουσει|πάρκ|παρκ|εκκλησ|νοσοκομ|γιατρ|ξενοδοχ|φούρν|φουρν|"
    r"αξιοθέατ|αξιοθεατ|μνημεί|μνημει)",
    re.IGNORECASE,
)
_PLACE_LOCATIVE_RE = re.compile(
    r"\b(near|nearby|around|close|here|any|is\s+there|are\s+there|find|look(?:ing)?\s+for)\b|"
    r"(κοντά|κοντα|γύρω|γυρω|εδώ|εδω|υπάρχ|υπαρχ|βρω|ψάχν|ψαχν)",
    re.IGNORECASE,
)


def is_place_question(heard: str) -> bool:
    h = heard or ""
    return bool(_PLACE_STRONG_RE.search(h) or (_PLACE_NOUN_RE.search(h) and _PLACE_LOCATIVE_RE.search(h)))


def _heard_of(text: str) -> str:
    m = re.search(r"HEARD:\s*(.+?)(?:\n|INTENT:|$)", text or "", re.IGNORECASE | re.DOTALL)
    return (m.group(1) if m else "").strip()


def _needs_place_tool(round_text: str) -> bool:
    return is_place_question(_heard_of(round_text))


def _strip_repeated_header(buf: str, final: bool = False) -> str | None:
    """After a tool round the model sometimes restarts the HEARD/.../REPLY header: drop it before speaking.

    Returns the speakable text, or None while it is still unclear whether a header is coming.
    """
    m = re.search(r"REPLY:\s*", buf, re.IGNORECASE)
    if m:
        return buf[m.end():]
    head = buf.lstrip().upper()
    if not head:
        return "" if final else None
    maybe_header = any(h.startswith(head[: len(h)]) or head.startswith(h) for h in _HEADER_PREFIXES)
    if maybe_header and not final and len(buf) < 400:
        return None
    if maybe_header:
        return ""  # only a repeated header and no REPLY: nothing to speak
    return buf


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
    deterministic = False
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

    post_tool_buf: str | None = None  # collecting text right after a tool round (may repeat the header)
    held_for_tools: str | None = None  # place question: hold "let me check..." text until the tools have run
    try:
        async for item in token_stream:
            if isinstance(item, ToolPending):
                if item.slow and is_first_clause:
                    # Speak a short pre-cached line so the user is not left in silence while places are looked up
                    filler = phrases.code_phrase("LOOKUP_FILLER", state.lang)
                    is_first_clause = False
                    pcm_q, p_task = _start_clause_tts(filler)
                    producer_tasks.append(p_task)
                    await clause_queue.put((filler, pcm_q, p_task, False))
                if held_for_tools is not None:
                    if held_for_tools.strip():
                        trace.log("pre_tool_text_dropped", text=held_for_tools.strip()[:100])
                    held_for_tools = None
                    reply_buf = ""
                    active.generated_text = ""
                if in_reply:
                    post_tool_buf = ""
                continue
            piece = item
            if held_for_tools is not None:
                held_for_tools += piece
                continue
            if not piece:
                continue
            if in_reply and post_tool_buf is not None:
                post_tool_buf += piece
                ready = _strip_repeated_header(post_tool_buf)
                if ready is None:
                    continue
                piece, post_tool_buf = ready, None
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
                    if is_place_question(heard_text) and decision.action != "compass:facing":
                        # Speak nothing until the places tools have answered (the filler covers the wait)
                        held_for_tools = after.lstrip()
                        continue
                    if decision.action == "compass:facing":
                        # Exact numbers from the live compass, never the model's guess
                        facing = router.facing_reply(state, state.lang)
                        trace.log("compass_facing", text=facing, compass_deg=router.current_compass_deg(state))
                        active.generated_text = facing
                        is_first_clause = False
                        # One TTS stream per sentence so the heading itself starts playing first
                        for sentence in re.split(r"(?<=[.!?;])\s+", facing):
                            if sentence.strip():
                                pcm_q, p_task = _start_clause_tts(sentence.strip())
                                producer_tasks.append(p_task)
                                await clause_queue.put((sentence.strip(), pcm_q, p_task, False))
                        reply_buf = ""
                        deterministic = True
                        break
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
        elif deterministic:
            pass
        else:
            if held_for_tools:
                # No tool round followed after all: speak what the model said
                reply_buf += held_for_tools
                active.generated_text = phrases.expand_codes(active.generated_text + held_for_tools, state.lang)
            if post_tool_buf:
                tail_txt = _strip_repeated_header(post_tool_buf, final=True) or ""
                reply_buf += tail_txt
                active.generated_text = phrases.expand_codes(active.generated_text + tail_txt, state.lang)
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
        aclose = getattr(token_stream, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:
                pass
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
        kwargs["tools"] = [*tools.ALL, *extra_tools, geo_tools.TOOL]
        # We run tools ourselves (async, per connection) and feed results back in `_model_pieces`
        kwargs["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(disable=True)
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
    geo_ctx = geo_service.context_line(state)
    user_parts: list = []
    if frame_jpeg:
        user_parts.append(types.Part.from_bytes(data=frame_jpeg, mime_type="image/jpeg"))
    user_parts.append(types.Part.from_bytes(data=wav_bytes, mime_type="audio/wav"))
    user_parts.append(
        types.Part.from_text(
            text=(
                f"Default language: {lang}. Current user memory: {mem_ctx or 'none'}. {compass_ctx} {geo_ctx} "
                "Transcribe ONLY in English or Greek, set INTENT (ANSWER | COMMAND | IGNORE), "
                "update MEMORY only if the user explicitly stated a goal/note/clear (otherwise NONE), "
                "set COMPASS if the user asked to be guided toward a direction or stop compass guidance (otherwise NONE), "
                "and ALWAYS reply aloud in English or Greek when INTENT is ANSWER or COMMAND."
            )
        )
    )
    contents.append(types.Content(role="user", parts=user_parts))

    try:
        pieces = _model_pieces(state, contents, _llm_config(INFO_SYSTEM, list(state.extra_funcs.values())))
        heard, full_reply = await _stream_clauses_and_speak(
            state, pieces, active, parse_heard_header=True, t0=t0
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


async def _send_speech(state: State, pcm: bytes, active: ActiveSpeech, text: str) -> None:
    """Queue already-synthesized PCM right after whatever is playing and record it on the clause timeline."""
    if not pcm or not state.assistant_enabled:
        return
    now = time.time()
    play_start = max(state.audible_until, now)
    state.sent_audio(len(pcm), now)
    active.clause_timeline.append([play_start, state.audible_until, text])
    state.explain_lock_until = max(state.explain_lock_until, state.audible_until + config.EXPLAIN_POST_WINDOW_S)
    for i in range(0, len(pcm), 9600):
        await state.socket.send_bytes(pcm[i:i + 9600])


def _parse_guidance(raw_text: str) -> dict:
    raw = json.loads((raw_text or "{}").strip())
    if isinstance(raw, list):
        raw = raw[0] if raw and isinstance(raw[0], dict) else {}
    return raw if isinstance(raw, dict) else {}


async def guide_after_depth_stop(
    state: State,
    frame_jpeg: bytes | None,
    dist_m: float,
    stop_audio_done: asyncio.Event,
) -> str:
    """After a depth stop: ask the model (image + compass) for a turn in degrees + what is ahead, then speak
    FIRST the degrees ("Turn right 30 degrees.", pre-cached) and THEN what is ahead, both at a fast pace.

    Runs while `state.emergency_active` blocks the answering pipeline. Returns the spoken text ("" on failure).
    """
    t0 = time.time()
    lang = normalize_lang(state.lang)
    state.lang = lang
    active = ActiveSpeech(kind="depth_stop")
    state.active_speech = active

    steps = max(0.5, round(dist_m / 0.7 * 2) / 2)
    img_w = img_h = None
    if frame_jpeg:
        try:
            with Image.open(io.BytesIO(frame_jpeg)) as im:
                img_w, img_h = im.size
        except Exception:
            pass
    hfov = steering.hfov_for(img_w, img_h)
    compass_deg = router.current_compass_deg(state, t0, max_age_s=config.SENSOR_MAX_AGE_S)
    target_deg = state.target_bearing_deg
    # The model only reports perception; no compass numbers so it cannot "help" with the math
    prompt = (
        f"Language: {lang} ONLY.\n"
        f"Depth sensor: surface at the image center is about {dist_m:.1f} m (~{steps:g} steps) away.\n"
        + ("Camera image attached (what the user is facing)." if frame_jpeg else "No camera image available.")
    )
    parts: list = []
    if frame_jpeg:
        parts.append(types.Part.from_bytes(data=frame_jpeg, mime_type="image/jpeg"))
    parts.append(types.Part.from_text(text=prompt))
    cfg = types.GenerateContentConfig(
        system_instruction=DEPTH_STOP_SYSTEM,
        temperature=0.1,
        response_mime_type="application/json",
        media_resolution=types.MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL),
    )
    try:
        resp = await agent._get_client().aio.models.generate_content(
            model=config.MODEL, contents=[types.Content(role="user", parts=parts)], config=cfg
        )
        g = _parse_guidance(resp.text)
        model_ms = round((time.time() - t0) * 1000)
        turn = steering.decide_turn(g, hfov=hfov, compass_deg=compass_deg, target_deg=target_deg)
        code = turn.code
        turn_text = phrases.code_phrase(code, lang)
        what = _clean_clause(str(g.get("what", "")), lang)[:60].strip()
        if what and not what.endswith((".", "!", "?")):
            what += "."

        # Degrees first (pre-cached, sped up), "what" synthesized in parallel and queued right after
        what_task = asyncio.create_task(speak.synthesize_fast(what)) if what else None
        try:
            turn_pcm = await speak.synthesize_fast(turn_text)
            await stop_audio_done.wait()
            await _send_speech(state, turn_pcm, active, turn_text)
            first_ms = round((time.time() - t0) * 1000)
            spoken = turn_text
            if what_task is not None:
                try:
                    what_pcm = await asyncio.wait_for(what_task, 4.0)
                    await _send_speech(state, what_pcm, active, what)
                    spoken = f"{turn_text} {what}"
                except Exception as exc:
                    trace.log("clause_tts_failed", clause=what, error=f"{type(exc).__name__}: {exc}"[:140])
                    await state.send({"type": "speak_text", "text": what})
                    spoken = f"{turn_text} {what}"
        finally:
            if what_task is not None and not what_task.done():
                what_task.cancel()

        active.generated_text = spoken
        state.chat_history.append(("model", spoken))
        trace.log(
            "depth_stop_guide",
            outcome="spoken",
            code=code,
            side=turn.side or None,
            deg=turn.deg,
            why=turn.reason,
            seen={k: g.get(k) for k in ("a", "left", "right", "more_open")},
            compass_deg=round(compass_deg) if compass_deg is not None else None,
            target_deg=round(target_deg) if target_deg is not None else None,
            hfov=hfov,
            text=spoken,
            dist_m=round(dist_m, 2),
            model_ms=model_ms,
            first_audio_ms=first_ms,
            speech_rate=config.GUIDE_SPEECH_RATE,
        )
        await state.send({"type": "reply", "text": spoken, "turn_code": code})
        return spoken
    except asyncio.CancelledError:
        trace.log("info_stream_cancelled", mode="depth_stop")
        raise
    finally:
        if state.active_speech is active:
            state.active_speech = None
