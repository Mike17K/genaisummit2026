"""Centralized core decision router coordinating VoxEye's parallel pipelines:

1. Voice Command, Memory & Answer Decision (`decide_user_command` / `apply_command_decision`):
   - Classifies every heard utterance into `ignore` (background noise), `answer` (question / inquiry),
     or `command` (explicit goal/note memory update or system mode/language command).
   - Decides strictly whether to keep a memory (`keep_memory=True` ONLY on explicit goals, notes, or clears;
     never on routine visual questions).
   - Guarantees every valid question or command receives a spoken answer (`should_answer=True` + fallback).

2. Session Event Dispatch (`handle_audio_chunk`, `handle_client_message`):
   - Routes incoming WebSocket audio chunks, camera frames, IMU/GPS telemetry and hold-scan depth probes
     across `assistant`, `safety`, and `depth` modules.
"""
import base64
from dataclasses import dataclass
import re
import time
from typing import Literal

from ..audio import phrases
from ..depth import center_probe, local_depth
from ..utils import config, trace
from . import memory
from .state import State

MIN_VOICE_PCM_BYTES = 4800  # ~150 ms of 16 kHz mono PCM16
MIN_VOICED_S = 0.20         # Ignore sub-200 ms room clicks/blips

GREEK_RE = re.compile(r"[\u0370-\u03ff\u1f00-\u1fff]")
LATIN_RE = re.compile(r"[A-Za-z]")
OTHER_SCRIPT_RE = re.compile(
    r"[\u0400-\u052f\u0590-\u06ff\u0900-\u0d7f\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]"
)
_REPEATED_NONE_RE = re.compile(r"^(?:NONE[\s,.;:-]*)+", re.IGNORECASE)

# Deterministic voice command & explicit memory patterns (English + Greek)
_LANG_GREEK_RE = re.compile(
    r"\b(speak\s+(?:in\s+)?greek|switch\s+to\s+greek|in\s+greek\s+please)\b|"
    r"(μίλα\s+(?:μου\s+)?ελληνικά|γύρνα\s+(?:το\s+)?στα\s+ελληνικά|στα\s+ελληνικά\s+παρακαλώ)",
    re.IGNORECASE,
)
_LANG_ENGLISH_RE = re.compile(
    r"\b(speak\s+(?:in\s+)?english|switch\s+to\s+english|in\s+english\s+please)\b|"
    r"(μίλα\s+(?:μου\s+)?αγγλικά|γύρνα\s+(?:το\s+)?στα\s+αγγλικά|στα\s+αγγλικά\s+παρακαλώ)",
    re.IGNORECASE,
)
_CLEAR_ALL_MEM_RE = re.compile(
    r"\b(forget\s+everything|clear\s+(?:all\s+)?(?:my\s+)?memor(?:y|ies)|erase\s+memor(?:y|ies))\b|"
    r"(ξέχνα\s+τα\s+όλα|καθάρισε\s+τη\s+μνήμη|σβήσε\s+τη\s+μνήμη)",
    re.IGNORECASE,
)
_CLEAR_GOAL_RE = re.compile(
    r"\b(i\s+found\s+it|goal\s+complete|stop\s+looking\s+for\s+it)\b|(το\s+βρήκα|βρήκα\s+αυτό\s+που\s+έψαχνα)",
    re.IGNORECASE,
)
_EXPLICIT_NOTE_RE = re.compile(
    r"^(?:please\s+)?(?:remember(?:\s+that)?|keep\s+in\s+mind(?:\s+that)?)\s+(.{3,80})$|"
    r"^(?:παρακαλώ\s+)?(?:θυμήσου(?:\s+ότι)?|να\s+θυμάσαι(?:\s+ότι)?)\s+(.{3,80})$",
    re.IGNORECASE,
)
_EXPLICIT_GOAL_RE = re.compile(
    r"^(?:i\s+am|i'm|im)\s+(?:trying\s+to|looking\s+for)\s+(.{3,80})$|"
    r"^help\s+me\s+((?:find|reach|get\s+to)\s+.{3,80})$|"
    r"^(?:ψάχνω(?:\s+να\s+βρω)?|προσπαθώ\s+να\s+(?:βρω|φτάσω|πάω)|θέλω\s+να\s+(?:βρω|πάω))\s+(.{3,80})$",
    re.IGNORECASE,
)

# Compass direction table: check intercardinals BEFORE cardinals so "βορειοανατολικά" matches NE (45°) first.
_COMPASS_WINDS: tuple[tuple[int, str, str, str, re.Pattern[str]], ...] = (
    (
        45,
        "NE",
        "Northeast",
        "Βορειοανατολικά",
        re.compile(r"\b(northeast|north[-\s]+east|ne)\b|(βορειοανατολικ[άαοόήη]\w*)", re.IGNORECASE),
    ),
    (
        135,
        "SE",
        "Southeast",
        "Νοτιοανατολικά",
        re.compile(r"\b(southeast|south[-\s]+east|se)\b|(νοτιοανατολικ[άαοόήη]\w*)", re.IGNORECASE),
    ),
    (
        225,
        "SW",
        "Southwest",
        "Νοτιοδυτικά",
        re.compile(r"\b(southwest|south[-\s]+west|sw)\b|(νοτιοδυτικ[άαοόήη]\w*)", re.IGNORECASE),
    ),
    (
        315,
        "NW",
        "Northwest",
        "Βορειοδυτικά",
        re.compile(r"\b(northwest|north[-\s]+west|nw)\b|(βορειοδυτικ[άαοόήη]\w*)", re.IGNORECASE),
    ),
    (
        0,
        "N",
        "North",
        "Βόρεια",
        re.compile(r"\bnorth\b|(βόρει[αο]\w*|βορει[αο]\w*|\bβορρά[ςν]?\b|\bβορρα[ςν]?\b)", re.IGNORECASE),
    ),
    (
        90,
        "E",
        "East",
        "Ανατολικά",
        re.compile(r"\beast\b|(ανατολικ[άαοό]\w*|\bανατολή\b|\bανατολη\b)", re.IGNORECASE),
    ),
    (
        180,
        "S",
        "South",
        "Νότια",
        re.compile(r"\bsouth\b|(νότι[αο]\w*|νοτι[αο]\w*|\bνότο[ςν]?\b|\bνοτο[ςν]?\b)", re.IGNORECASE),
    ),
    (
        270,
        "W",
        "West",
        "Δυτικά",
        re.compile(r"\bwest\b|(δυτικ[άαοό]\w*|\bδύση\b|\bδυση\b)", re.IGNORECASE),
    ),
)
_ORDERED_WINDS_8: tuple[tuple[str, str, str], ...] = (
    ("N", "North", "Βόρεια"),
    ("NE", "Northeast", "Βορειοανατολικά"),
    ("E", "East", "Ανατολικά"),
    ("SE", "Southeast", "Νοτιοανατολικά"),
    ("S", "South", "Νότια"),
    ("SW", "Southwest", "Νοτιοδυτικά"),
    ("W", "West", "Δυτικά"),
    ("NW", "Northwest", "Βορειοδυτικά"),
)
_DEG_SPEC_RE = re.compile(r"\b(\d{1,3})\s*(?:degrees?|deg|°|μοίρες|μοιρες)\b", re.IGNORECASE)
_BARE_DEG_RE = re.compile(r"^\s*(\d{1,3})\s*°?\s*$")
_COMPASS_CLEAR_RE = re.compile(
    r"\b(stop\s+(?:the\s+)?compass|clear\s+(?:the\s+)?compass|cancel\s+(?:the\s+)?(?:compass|direction|heading)|"
    r"turn\s+off\s+(?:the\s+)?compass|stop\s+guiding\s+me)\b|"
    r"((?:σταμάτα|σταματα|κλείσε|κλεισε|σβήσε|σβησε|ακύρωσε|ακυρωσε|βγάλε|βγαλε)\s+(?:την\s+)?(?:πυξίδα|πυξιδα|κατεύθυνση|κατευθυνση)|"
    r"σταμάτα\s+να\s+με\s+κατευθύνεις)",
    re.IGNORECASE,
)
# "Which way / how many degrees am I facing?" Greek part tolerates the frequent STT slip μοίρες -> μέρες.
_COMPASS_FACING_QUERY_RE = re.compile(
    r"\b(what\s+(?:direction|way|heading)\s+am\s+i\s+(?:facing|looking|heading|pointing)|"
    r"which\s+(?:way|direction)\s+am\s+i\s+(?:facing|looking|heading|pointing)|"
    r"where\s+am\s+i\s+(?:facing|looking|pointing)|"
    r"how\s+many\s+degrees\s+am\s+i(?:\s+(?:facing|looking|pointing|at))?|"
    r"what(?:'s|\s+is)\s+my\s+(?:heading|bearing|compass(?:\s+heading)?|direction)|"
    r"what\s+does\s+the\s+compass\s+say)\b|"
    r"((?:πόσες|ποσες)\s+(?:μοίρες|μοιρες|μέρες|μερες)|"
    r"(?:μοίρες|μοιρες)\s+(?:κοιτ|βλέπ|βλεπ|δείχν|δειχν|έχω|εχω)|"
    r"(?:προς\s+τα\s+)?(?:πού|που)\s+(?:κοιτάω|κοιταω|κοιτάζω|κοιταζω|βλέπω|βλεπω)|"
    r"(?:ποια|ποιά|τι)\s+κατεύθυνση\s+(?:κοιτ|βλέπ|βλεπ|έχω|εχω|είμαι|ειμαι)|"
    r"(?:σε|προς)\s+(?:ποια|ποιά)\s+κατεύθυνση\s+(?:κοιτ|βλέπ|βλεπ|είμαι|ειμαι|πάω|παω)|"
    r"τι\s+(?:δείχνει|δειχνει)\s+η\s+(?:πυξίδα|πυξιδα))",
    re.IGNORECASE,
)
_COMPASS_NAV_INTENT_RE = re.compile(
    r"\b(go|head|walk|guide\s+me|lead\s+me|take\s+me|direct\s+me|point\s+me|"
    r"i\s+want\s+to\s+(?:go|head|walk)|set\s+(?:compass|direction|heading)|towards?)\b|"
    r"(θέλω\s+να\s+(?:πάω|κινηθώ|περπατήσω|κατευθυνθώ)|θελω\s+να\s+(?:παω|κινηθω|περπατησω|κατευθυνθω)|"
    r"πήγαιν[εέ]\s+με|πηγαιν[εε]\s+με|κατεύθυν[εέ]\s+με|κατευθυν[εε]\s+με|"
    r"οδήγησ[εέ]\s+με|οδηγησ[εε]\s+με|πάμε|παμε|βάλε\s+(?:πυξίδα|κατεύθυνση)|"
    r"προς\s+(?:τα\s+|τον\s+|την\s+|τη\s+)?(?:βόρεια|βορει|νότια|νοτι|ανατολικ|δυτικ|βορρά|νότο|ανατολή|δύση))",
    re.IGNORECASE,
)


@dataclass
class CommandDecision:
    """Centralized decision for how to respond to a user utterance and whether to keep memory."""

    heard: str
    intent: Literal["ignore", "answer", "command"]
    should_answer: bool
    keep_memory: bool
    memory_directive: str = "NONE"
    action: str = ""


def is_valid_en_el_heard(text: str) -> bool:
    """Return True only if transcribed speech contains English or Greek letters and no foreign scripts."""
    if not text:
        return False
    up = text.strip().upper()
    if up == "NONE" or up.startswith("NONENONE"):
        return False
    cleaned = _REPEATED_NONE_RE.sub("", text).strip()
    if not cleaned or OTHER_SCRIPT_RE.search(cleaned):
        return False
    return bool(GREEK_RE.search(cleaned) or LATIN_RE.search(cleaned))


def cardinal_labels(deg: float) -> tuple[str, str, str]:
    """Return 8-wind `(code, en_label, el_label)` for azimuth `deg` (`0..359`, `0=North`)."""
    idx = int(round((float(deg) % 360.0) / 45.0)) % 8
    return _ORDERED_WINDS_8[idx]


def compass_delta_deg(target_deg: float, current_deg: float) -> float:
    """Signed shortest turn angle in `(-180, +180]`: `+` means target is to the right, `-` to the left."""
    d = ((float(target_deg) - float(current_deg) + 540.0) % 360.0) - 180.0
    return 180.0 if d == -180.0 else d


def _relative_turn_phrase_en(delta: float) -> str:
    ad = abs(delta)
    if ad <= 16:
        return f"straight ahead ({delta:+.0f}°)"
    if ad >= 140:
        return f"behind ({delta:+.0f}°)"
    side = "right" if delta > 0 else "left"
    qual = "slightly " if ad < 50 else ""
    return f"{qual}{side} ({delta:+.0f}°)"


def relative_turn_words(delta: float, lang: str) -> str:
    """Spoken relative direction for a signed delta (+ right): 'right 40 degrees' / 'δεξιά 40 μοίρες'."""
    is_gr = phrases.normalize_lang(lang) == "Greek"
    ad = abs(round(delta))
    if ad <= 12:
        return "ακριβώς μπροστά σου" if is_gr else "straight ahead of you"
    if ad >= 160:
        return "πίσω σου" if is_gr else "behind you"
    if is_gr:
        return f"{'δεξιά' if delta > 0 else 'αριστερά'} σου, {ad} μοίρες"
    return f"{ad} degrees to your {'right' if delta > 0 else 'left'}"


def current_compass_deg(state: "State", now: float | None = None, max_age_s: float = 20.0) -> float | None:
    now = time.time() if now is None else now
    imu = state.imu if isinstance(state.imu, dict) and (now - state.imu_at) <= max_age_s else None
    comp = imu.get("compassDeg") if imu else None
    return float(comp) % 360.0 if isinstance(comp, (int, float)) else None


def facing_reply(state: "State", lang: str) -> str:
    """Exact spoken answer to "which way / how many degrees am I facing?" straight from the phone compass."""
    is_gr = phrases.normalize_lang(lang) == "Greek"
    comp = current_compass_deg(state)
    if comp is None:
        return (
            "Η πυξίδα του κινητού δεν στέλνει δεδομένα ακόμα. Κράτα το κινητό όρθιο και κούνησέ το λίγο."
            if is_gr
            else "The phone compass is not sending data yet. Hold the phone upright and move it a little."
        )
    deg = round(comp) % 360
    _, en_l, el_l = cardinal_labels(deg)
    text = f"Κοιτάς {deg} μοίρες, {el_l.lower()}." if is_gr else f"You are facing {deg} degrees, {en_l.lower()}."
    if state.target_bearing_deg is not None:
        t = round(state.target_bearing_deg) % 360
        _, t_en, t_el = cardinal_labels(t)
        rel = relative_turn_words(compass_delta_deg(t, deg), lang)
        text += (
            f" Ο στόχος σου, {t_el.lower()} ({t} μοίρες), είναι {rel}."
            if is_gr
            else f" Your target, {t_en.lower()} ({t} degrees), is {rel}."
        )
    return text


def compass_target_from_goal(goal: str) -> float | None:
    """A memory goal like "να πάω νότια" / "go north-east" implies a compass bearing to guide toward."""
    g = re.sub(r"[.!?;]+$", "", (goal or "").strip())
    if not g:
        return None
    parsed = parse_compass_spec(g)
    if parsed is None:
        return None
    words = [w for w in g.split() if w]
    if len(words) <= 4 or _COMPASS_NAV_INTENT_RE.search(g) or re.match(r"^(?:να\s+)?(?:πάω|παω|go|head|walk)\b", g, re.I):
        return float(parsed[0])
    return None


async def sync_goal_compass_target(state: "State", by: str = "goal") -> None:
    """Keep `target_bearing_deg` consistent with a direction stored in the memory goal (set, change or clear).

    A goal like "να πάω νότια" sets the target; replacing/clearing that goal clears a goal-derived target.
    An explicit voice/tool target is only replaced when the goal names a different direction.
    """
    deg = compass_target_from_goal(state.memory.goal)
    if deg is not None:
        if state.target_bearing_deg is None or abs(compass_delta_deg(deg, state.target_bearing_deg)) > 1:
            await apply_compass_target(state, deg, by=by)
    elif state.target_from_goal and state.target_bearing_deg is not None:
        await apply_compass_target(state, None, by=by)


def parse_compass_spec(spec: str) -> tuple[int, str, str, str] | None:
    """Parse a cardinal/intercardinal name, code, or degree spec into `(deg, code, en_label, el_label)`."""
    s = (spec or "").strip()
    if not s:
        return None
    m_bare = _BARE_DEG_RE.match(s)
    if m_bare:
        val = int(m_bare.group(1))
        if 0 <= val <= 360:
            deg = val % 360
            code, en_l, el_l = cardinal_labels(deg)
            return deg, code, en_l, el_l
    m_deg = _DEG_SPEC_RE.search(s)
    if m_deg:
        val = int(m_deg.group(1))
        if 0 <= val <= 360:
            deg = val % 360
            code, en_l, el_l = cardinal_labels(deg)
            return deg, code, en_l, el_l
    for deg, code, en_l, el_l, pat in _COMPASS_WINDS:
        if pat.search(s):
            return deg, code, en_l, el_l
    return None


def detect_compass_action(heard_text: str, raw_compass: str = "") -> str:
    """Detect user request to start or stop compass directional guidance (`compass:<deg>:<code>` or `compass:clear`)."""
    txt = (heard_text or "").strip()
    raw_up = (raw_compass or "").strip().upper()
    if txt and _COMPASS_CLEAR_RE.search(txt):
        return "compass:clear"
    if raw_up in ("CLEAR", "STOP", "OFF", "CANCEL"):
        return "compass:clear"
    # Orientation questions ("Πόσες μοίρες κοιτάω;", "Which way am I facing?") are answered from the
    # compass deterministically and never set a target
    if txt and _COMPASS_FACING_QUERY_RE.search(txt):
        return "compass:facing"
    if raw_up and raw_up not in ("NONE", "NO", "N/A", "-", "NULL"):
        parsed = parse_compass_spec(raw_compass)
        if parsed is not None:
            deg, code, _, _ = parsed
            return f"compass:{deg}:{code}"
    if not txt or "?" in txt or ";" in txt:
        return ""
    if _COMPASS_NAV_INTENT_RE.search(txt):
        parsed = parse_compass_spec(txt)
        if parsed is not None:
            deg, code, _, _ = parsed
            return f"compass:{deg}:{code}"
    return ""


def compass_context_text(state: State, now: float | None = None) -> str:
    """Format live phone compass heading + relative bearings so the Q&A model answers accurately without mental-math errors."""
    now = time.time() if now is None else now
    imu = state.imu if state.imu and (now - state.imu_at) <= 20.0 else None
    comp = imu.get("compassDeg") if isinstance(imu, dict) else None
    parts: list[str] = []
    if isinstance(comp, (int, float)):
        deg = round(float(comp)) % 360
        code, en_l, el_l = cardinal_labels(deg)
        card_rel = ", ".join(
            f"{lbl}({b}°): {_relative_turn_phrase_en(compass_delta_deg(b, deg))}"
            for b, lbl in ((0, "North/Βόρεια"), (90, "East/Ανατολικά"), (180, "South/Νότια"), (270, "West/Δυτικά"))
        )
        parts.append(
            f"Phone compass: the user is facing EXACTLY {deg} degrees ({code} / {en_l} / {el_l}); quote this number "
            f"when asked which way or how many degrees they face. Relative bearings now: {card_rel}."
        )
        if state.target_bearing_deg is not None:
            t_deg = round(state.target_bearing_deg) % 360
            delta = compass_delta_deg(t_deg, deg)
            parts.append(
                f"Active target direction: {state.target_bearing_label or f'{t_deg}°'} ({t_deg}°), "
                f"currently {_relative_turn_phrase_en(delta)}."
            )
    else:
        parts.append("Phone compass: sensor reading not available right now.")
        if state.target_bearing_deg is not None:
            t_deg = round(state.target_bearing_deg) % 360
            parts.append(f"Active target direction: {state.target_bearing_label or f'{t_deg}°'} ({t_deg}°).")
    return " ".join(parts)


def detect_system_action(heard_text: str) -> str:
    """Detect explicit language-switch commands in English or Greek."""
    txt = (heard_text or "").strip()
    if not txt:
        return ""
    if _LANG_GREEK_RE.search(txt):
        return "lang:Greek"
    if _LANG_ENGLISH_RE.search(txt):
        return "lang:English"
    return ""


def _infer_explicit_memory_from_speech(heard_text: str) -> str:
    """Fallback detector for unmistakable explicit memory/goal commands when LLM header omits `MEMORY:`."""
    cleaned = re.sub(r"[.!?]+$", "", (heard_text or "").strip()).strip()
    if not cleaned or "?" in heard_text or ";" in heard_text:
        # Questions ("Where did I leave my keys?", "Πού είναι η έξοδος;") are inquiries, not memory writes
        return "NONE"
    if _CLEAR_ALL_MEM_RE.search(cleaned):
        return "CLEAR"
    if _CLEAR_GOAL_RE.search(cleaned):
        return "CLEAR_GOAL"
    m_note = _EXPLICIT_NOTE_RE.match(cleaned)
    if m_note:
        body = (m_note.group(1) or m_note.group(2) or "").strip()
        if body:
            return f"NOTE: {body}"
    m_goal = _EXPLICIT_GOAL_RE.match(cleaned)
    if m_goal:
        body = (m_goal.group(1) or m_goal.group(2) or m_goal.group(3) or "").strip()
        if body:
            # Pure compass bearing requests ("θέλω να πάω βόρεια") are handled by target_bearing_deg, not disk memory
            if detect_compass_action(cleaned) and len(body.split()) <= 2 and parse_compass_spec(body) is not None:
                return "NONE"
            if re.match(r"^(?:i\s+am|i'm|im)\s+looking\s+for\b", cleaned, re.IGNORECASE):
                return f"GOAL: find {body}"
            return f"GOAL: {body}"
    return "NONE"


def decide_user_command(
    heard_text: str,
    *,
    raw_intent: str = "",
    raw_memory: str = "",
    raw_compass: str = "",
) -> CommandDecision:
    """Centralized decision: classify command vs question vs noise, and whether to keep memory."""
    cleaned_heard = (heard_text or "").strip()
    if not is_valid_en_el_heard(cleaned_heard):
        return CommandDecision(
            heard="",
            intent="ignore",
            should_answer=False,
            keep_memory=False,
            memory_directive="NONE",
            action="",
        )

    action = detect_system_action(cleaned_heard) or detect_compass_action(cleaned_heard, raw_compass)

    mem_dir = re.sub(r"\s+", " ", (raw_memory or "")).strip()
    if not mem_dir or mem_dir.upper() in ("NONE", "NO", "N/A", "-", "NULL"):
        mem_dir = _infer_explicit_memory_from_speech(cleaned_heard)

    words = [w for w in re.split(r"\s+", cleaned_heard) if w]
    if mem_dir != "NONE" and len(words) < 2 and not mem_dir.upper().startswith("CLEAR"):
        mem_dir = "NONE"

    keep_mem = mem_dir.upper() not in ("", "NONE", "NO", "N/A", "-", "NULL")
    intent_up = (raw_intent or "").strip().upper()
    if intent_up == "IGNORE":
        return CommandDecision(
            heard="",
            intent="ignore",
            should_answer=False,
            keep_memory=False,
            memory_directive="NONE",
            action="",
        )

    intent: Literal["answer", "command"] = (
        "command" if (action or keep_mem or intent_up == "COMMAND") else "answer"
    )
    return CommandDecision(
        heard=cleaned_heard,
        intent=intent,
        should_answer=True,
        keep_memory=keep_mem,
        memory_directive=mem_dir if keep_mem else "NONE",
        action=action,
    )


def fallback_reply(decision: CommandDecision, lang: str = "English") -> str:
    """Guaranteed spoken response if the user asked a question or gave a command and the model omitted `REPLY:`."""
    if not decision.should_answer:
        return ""
    is_gr = phrases.normalize_lang(lang) == "Greek"
    if decision.action.startswith("lang:"):
        target = decision.action.split(":", 1)[1]
        return "Μιλάω ελληνικά τώρα." if target == "Greek" else "Switched to English."
    if decision.action == "compass:clear":
        return "Έκλεισα την καθοδήγηση πυξίδας." if is_gr else "Compass guidance turned off."
    if decision.action == "compass:facing":
        return ""  # answered deterministically by facing_reply() with live compass data
    if decision.action.startswith("compass:"):
        parts = decision.action.split(":")
        deg = int(parts[1]) if len(parts) >= 2 and parts[1].isdigit() else 0
        _, en_l, el_l = cardinal_labels(deg)
        return (
            f"Εντάξει, σε κατευθύνω {el_l.lower()} ({deg} μοίρες)."
            if is_gr
            else f"Got it, guiding you {en_l.lower()} ({deg} degrees)."
        )
    if decision.keep_memory:
        if decision.memory_directive.upper().startswith("CLEAR"):
            return "Εντάξει, καθάρισα τη μνήμη." if is_gr else "Got it, memory cleared."
        return "Εντάξει, το κρατάω στη μνήμη." if is_gr else "Got it, I will remember that."
    return (
        "Σας ακούω. Κρατήστε την κάμερα σταθερά μπροστά και πείτε μου ξανά."
        if is_gr
        else "I hear you. Hold the camera steady ahead and ask me again."
    )


async def apply_compass_target(state: State, deg: float | None, label: str = "", by: str = "voice_router") -> None:
    """Set or clear the active compass guidance bearing on `state` and notify the browser."""
    now = time.time()
    state.target_from_goal = by == "goal"
    if not by.startswith("place"):
        state.target_place = None  # a new/cleared direction replaces any place guidance
    if deg is None:
        state.target_bearing_deg = None
        state.target_bearing_label = ""
        state.compass_aligned_announced = False
        trace.log("compass_target", active=False, by=by)
        await state.send({"type": "compass_target", "deg": 0, "label": ""})
        return
    norm_deg = float(deg) % 360.0
    code, en_l, el_l = cardinal_labels(norm_deg)
    if not label:
        is_gr = phrases.normalize_lang(state.lang) == "Greek"
        label = f"{code} · {el_l if is_gr else en_l}"
    state.target_bearing_deg = norm_deg
    state.target_bearing_label = label
    state.last_compass_cue_at = now
    comp_now = state.imu.get("compassDeg") if isinstance(state.imu, dict) and (now - state.imu_at) <= 20.0 else None
    if isinstance(comp_now, (int, float)):
        state.compass_aligned_announced = abs(compass_delta_deg(norm_deg, float(comp_now))) <= config.COMPASS_ALIGNED_DEG
    else:
        state.compass_aligned_announced = False
    trace.log("compass_target", active=True, deg=round(norm_deg), label=label, by=by)
    await state.send({"type": "compass_target", "deg": round(norm_deg), "label": label})


def _place_target_just_set(state: State, window_s: float = 20.0) -> bool:
    tp = state.target_place
    return bool(tp and time.time() - float(tp.get("set_at") or 0) < window_s)


async def apply_command_decision(state: State, decision: CommandDecision) -> bool:
    """Apply system actions and explicit memory updates from `decision` onto `state`. Returns True if memory changed."""
    if decision.intent == "ignore":
        return False

    if decision.action.startswith("lang:"):
        target_lang = phrases.normalize_lang(decision.action.split(":", 1)[1])
        changed_lang = state.lang != target_lang
        state.lang = target_lang
        phrases.save_last_lang(target_lang)
        if changed_lang:
            trace.log("lang_set", lang=target_lang, by="voice_router")
            await state.send({"type": "lang", "lang": target_lang})
    elif decision.action == "compass:clear":
        await apply_compass_target(state, None, by="voice_router")
    elif decision.action == "compass:facing":
        pass
    elif decision.action.startswith("compass:") and _place_target_just_set(state):
        # guide_to_place just aimed the compass at a place; a bearing echoed in the COMPASS header must not replace it
        trace.log("compass_header_ignored", action=decision.action, place=state.target_place.get("name"))
    elif decision.action.startswith("compass:"):
        parts = decision.action.split(":")
        deg_val = float(int(parts[1]) % 360) if len(parts) >= 2 and parts[1].isdigit() else 0.0
        await apply_compass_target(state, deg_val, by="voice_router")

    mem_changed = False
    if decision.keep_memory and state.memory.apply_directive(decision.memory_directive, decision.heard):
        mem_changed = True
        memory.save_persisted(state.memory)
        trace.log("memory_update", **state.memory.to_dict())
        await state.send({"type": "memory", **state.memory.to_dict()})
        if not decision.action.startswith("compass:") or decision.action == "compass:facing":
            await sync_goal_compass_target(state)

    trace.log(
        "command_decision",
        intent=decision.intent,
        should_answer=decision.should_answer,
        keep_memory=decision.keep_memory,
        memory_saved=mem_changed,
        action=decision.action or None,
    )
    return mem_changed


async def run_depth_probe(state: State, b64_data: str, seq: int = 0, disp: float | None = None) -> None:
    """Metric center-crop anchor / fast pipelined fallback (up to 3 concurrent staggered calls)."""

    def wanted() -> bool:
        # Hold-to-scan, or the always-on stereo sonar
        return state.depth_mode_active or state.sonar_active

    if state.depth_probes_inflight >= 3 or not wanted():
        return
    state.depth_probes_inflight += 1
    try:
        jpeg = base64.b64decode(b64_data)
        t0 = time.time()
        dist = await center_probe.estimate_center_distance(jpeg)
        ms = round((time.time() - t0) * 1000)
        if wanted() and dist is not None:
            if seq and seq < state.depth_probe_latest_seq:
                return
            if seq:
                state.depth_probe_latest_seq = seq
            trace.log("depth_probe", dist_m=dist, ms=ms, seq=seq or None, hold=state.depth_mode_active)
            payload: dict = {"type": "depth_result", "dist_m": dist, "source": "center-crop", "ms": ms}
            if seq:
                payload["seq"] = seq
            if isinstance(disp, (int, float)) and disp > 0:
                payload["disp"] = float(disp)
            await state.send(payload)
    finally:
        state.depth_probes_inflight = max(0, state.depth_probes_inflight - 1)


async def run_local_depth_probe(state: State, b64_data: str, seq: int = 0) -> None:
    """Run Depth-Anything-V2-Small locally on the laptop/server via ONNX Runtime (hold-to-scan sonar)."""

    def wanted() -> bool:
        # Hold-to-scan, or the always-on stereo sonar
        return state.depth_mode_active or state.sonar_active

    if not wanted():
        await state.send({"type": "depth_local_skip", "seq": seq})
        return
    try:
        jpeg = base64.b64decode(b64_data)
        stats, provider, ms = await local_depth.predict_center_disparity(jpeg)
        if not wanted():
            await state.send({"type": "depth_local_skip", "seq": seq})
            return
        if stats is None:
            await state.send({"type": "depth_local_skip", "seq": seq, "provider": provider})
            return
        if state.depth_mode_active:  # continuous sonar would flood the trace at ~4 Hz
            trace.log("depth_local", center_disp=stats["center_disp"], provider=provider, ms=ms, seq=seq or None)
        await state.send({
            "type": "depth_local",
            "seq": seq,
            "center_disp": stats["center_disp"],
            "p10": stats["p10"],
            "p90": stats["p90"],
            "sector_disp": stats.get("sector_disp"),
            "depth_thumb": stats.get("depth_thumb"),
            "provider": provider,
            "ms": ms,
        })
    except Exception as exc:
        trace.log("depth_local_error", error=f"{type(exc).__name__}: {exc}"[:160])
        await state.send({"type": "depth_local_skip", "seq": seq})


async def handle_gps(state: State, msg: dict) -> None:
    """Store the phone's GPS fix (browser geolocation) and keep place guidance aimed at the target."""
    from ..geo import service
    from ..safety import alerts

    try:
        lat, lon = float(msg["lat"]), float(msg["lon"])
    except (KeyError, TypeError, ValueError):
        return
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return
    acc = msg.get("acc")
    first = state.gps is None
    state.gps = {"lat": lat, "lon": lon, "acc": float(acc) if isinstance(acc, (int, float)) else None}
    state.gps_at = time.time()
    if first:
        trace.log("gps_first_fix", acc_m=round(state.gps["acc"] or 0))
    arrival = await service.on_gps_update(state)
    if arrival:
        trace.log("place_arrived", text=arrival)
        alerts.spawn(alerts.speak_notice(state, arrival))


PTT_MAX_S = 30.0  # safety cap for one push-to-talk turn


async def ptt_start(state: State) -> None:
    """Push-to-talk pressed: stop everything VoxEye is saying or doing and start collecting the user's words."""
    from ..assistant import info_pipeline

    if not state.assistant_enabled:
        return
    was_cut = info_pipeline.interrupt_everything(state, "push_to_talk")
    state.reset_mic_turn()
    state.ptt_active = True
    state.ptt_started_at = time.time()
    state.turn_frame_jpeg = state.frames[-1][1] if state.frames else None
    trace.log("user_turn", state="start", mode="push_to_talk", cut_assistant=was_cut)
    if was_cut:
        await state.send({"type": "interrupted"})


async def ptt_end(state: State) -> None:
    """Push-to-talk released: answer what was said right away (no silence timeout)."""
    from ..assistant import info_pipeline, turns
    from ..safety import alerts

    if not state.ptt_active:
        return
    state.ptt_active = False
    pcm_bytes = bytes(state.mic_turn_pcm)
    state.mic_turn_pcm.clear()
    frame_jpeg = state.turn_frame_jpeg or (state.frames[-1][1] if state.frames else None)
    state.turn_frame_jpeg = None
    held_s = round(time.time() - state.ptt_started_at, 1)
    trace.log("user_turn", state="end", mode="push_to_talk", held_s=held_s,
              audio_s=round(len(pcm_bytes) / turns.BYTES_PER_S, 1))
    if len(pcm_bytes) >= MIN_VOICE_PCM_BYTES:
        info_pipeline.cancel_for_user(state)
        state.info_task = alerts.spawn(info_pipeline.answer_user_audio(state, pcm_bytes, frame_jpeg))
    else:
        await state.send({"type": "heard_ignored"})


async def handle_audio_chunk(state: State, chunk: bytes) -> None:
    """Collect push-to-talk audio; legacy always-on clients still use the voice-activity turn tracker."""
    from ..assistant import info_pipeline, turns
    from ..safety import alerts

    if not state.assistant_enabled:
        return
    if state.ptt_active:
        pcm, _flag = turns.parse_chunk(chunk)
        if len(state.mic_turn_pcm) < PTT_MAX_S * turns.BYTES_PER_S:
            state.mic_turn_pcm.extend(pcm)
        return
    now_c = time.time()
    if state.mic_blocked(now_c):
        # The user is holding the depth-sonar scan
        state.reset_mic_turn()
        return
    info_generating = state.info_task is not None and not state.info_task.done()
    assistant_busy = state.audible(now_c) or state.model_speaking or info_generating
    for action in state.turn.feed(chunk, now_c, assistant_busy):
        if action[0] == "start":
            # The user is talking: stop whatever the assistant is saying or doing and listen
            was_cut = info_pipeline.interrupt_everything(state, "user_turn")
            trace.log("user_turn", state="start", cut_assistant=was_cut)
            if was_cut:
                await state.send({"type": "interrupted"})
            state.mic_turn_pcm.clear()
            state.turn_frame_jpeg = state.frames[-1][1] if state.frames else None
        elif action[0] == "audio":
            state.mic_turn_pcm.extend(action[1])
        elif action[0] == "end":
            pcm_bytes = bytes(state.mic_turn_pcm)
            state.mic_turn_pcm.clear()
            frame_jpeg = state.turn_frame_jpeg or (state.frames[-1][1] if state.frames else None)
            state.turn_frame_jpeg = None
            voiced_s = state.turn.voiced_s
            trace.log(
                "user_turn",
                state="end",
                silence_s=action[1],
                voiced_s=round(voiced_s, 1),
                pcm_kb=round(len(pcm_bytes) / 1024, 1),
            )
            if len(pcm_bytes) >= MIN_VOICE_PCM_BYTES and voiced_s >= MIN_VOICED_S:
                info_pipeline.cancel_for_user(state)
                state.info_task = alerts.spawn(
                    info_pipeline.answer_user_audio(state, pcm_bytes, frame_jpeg)
                )
            else:
                await state.send({"type": "heard_ignored"})


async def handle_client_message(state: State, msg: dict, frame_count: int) -> int:
    """Route JSON control, camera frames, IMU/GPS and hold-scan depth probes from the browser."""
    from ..assistant import info_pipeline
    from ..safety import alerts

    kind = msg.get("type")
    if kind == "frame":
        jpeg = base64.b64decode(msg["data"])
        if frame_count == 0:
            trace.log("first_frame", bytes=len(jpeg))
        frame_count += 1
        now_f = time.time()
        state.frames.append((now_f, jpeg))
        if isinstance(msg.get("imu"), dict):
            state.imu, state.imu_at = msg["imu"], now_f
        if msg.get("fresh"):
            trace.log("fresh_frame")
            if state.turn.active:
                state.turn_frame_jpeg = jpeg
    elif kind == "ptt_start":
        await ptt_start(state)
    elif kind == "ptt_end":
        await ptt_end(state)
    elif kind == "barge_in":
        # Phone heard the user's voice open while the assistant was busy: it already silenced playback locally
        if state.assistant_enabled and not state.mic_blocked(time.time()):
            if info_pipeline.interrupt_everything(state, "client_voice"):
                await state.send({"type": "interrupted"})
    elif kind == "gps":
        await handle_gps(state, msg)
    elif kind == "imu" and isinstance(msg.get("imu"), dict):
        state.imu, state.imu_at = msg["imu"], time.time()
    elif kind == "assistant":
        enabled = bool(msg.get("enabled", True))
        state.assistant_enabled = enabled
        trace.log("assistant_toggle", enabled=enabled)
        if not enabled and info_pipeline.cancel_for_user(state):
            await state.send({"type": "interrupted"})
    elif kind == "lang" and phrases.is_supported_lang(msg.get("lang")):
        await info_pipeline.update_session_lang(state, msg["lang"], source="client")
    elif kind == "depth_mode":
        active = bool(msg.get("active", False))
        state.depth_mode_active = active
        if active:
            state.depth_probe_latest_seq = 0
        trace.log("depth_mode", active=active, pdaf=msg.get("pdaf"), engine=msg.get("engine"))
        if active:
            if info_pipeline.cancel_for_user(state):
                await state.send({"type": "interrupted"})
            state.reset_mic_turn()
    elif kind == "sonar":
        state.sonar_active = bool(msg.get("active", False))
        trace.log("sonar", active=state.sonar_active)
    elif kind == "depth_device" and msg.get("device") in ("auto", "mobile", "laptop"):
        dev = str(msg["device"])
        mode = str(msg.get("mode") or dev)
        state.depth_device = dev
        trace.log("depth_device", device=dev, mode=mode, reason=msg.get("reason"))
        if dev == "laptop" or mode == "auto":
            prov = await local_depth.warm()
            await state.send({"type": "depth_device_status", "device": dev, "mode": mode, "provider": prov})
    elif kind == "depth_local_probe" and msg.get("data"):
        alerts.spawn(run_local_depth_probe(state, str(msg["data"]), seq=int(msg.get("seq") or 0)))
    elif kind == "depth_probe" and msg.get("data"):
        seq = int(msg.get("seq") or 0)
        disp = msg.get("disp")
        alerts.spawn(
            run_depth_probe(
                state,
                str(msg["data"]),
                seq=seq,
                disp=float(disp) if isinstance(disp, (int, float)) else None,
            )
        )
    elif kind == "memory_clear":
        if state.target_bearing_deg is not None:
            await apply_compass_target(state, None, by="clear")
        if state.memory.clear():
            memory.save_persisted(state.memory)
            trace.log("memory_update", **state.memory.to_dict(), by="clear")
            await state.send({"type": "memory", **state.memory.to_dict()})
    return frame_count
