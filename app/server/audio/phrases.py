"""Spatial obstacle-location codes and fixed alert phrases in English and Greek.

Every spatial hazard code (`ACTION_CODES`) and common alert phrase describes WHERE the obstacle is
(direction + distance in steps, never imperative movement commands) and is pre-synthesized at server
startup (`speak.warm_common`) for 0 ms playback.
"""
from pathlib import Path
import re

from ..utils import config

SUPPORTED_LANGS = ("English", "Greek")
_LANG_FILE = config.APP_DIR / ".last_lang"
_last_lang_cache: str | None = None

LOCAL = {
    "vehicle": ("Careful, vehicle right ahead of you.", "Πρόσεχε, όχημα ακριβώς μπροστά σου."),
    "bike": ("Careful, bicycle ahead of you.", "Πρόσεχε, ποδήλατο μπροστά σου."),
    "person": ("Careful, person ahead of you.", "Πρόσεχε, άτομο μπροστά σου."),
    "animal": ("Careful, animal ahead of you.", "Πρόσεχε, ζώο μπροστά σου."),
    "obstacle": ("Careful, obstacle right ahead of you.", "Πρόσεχε, εμπόδιο ακριβώς μπροστά σου."),
}

ACTION_CODES: dict[str, tuple[str, str]] = {
    "AHEAD_3": ("Careful, ahead of you in three steps.", "Πρόσεχε, μπροστά σου σε τρία βήματα."),
    "LEFT_3": ("Careful, front-left in three steps.", "Πρόσεχε, αριστερά μπροστά σου σε τρία βήματα."),
    "RIGHT_3": ("Careful, front-right in three steps.", "Πρόσεχε, δεξιά μπροστά σου σε τρία βήματα."),
    "AHEAD_2": ("Careful, ahead of you in two steps.", "Πρόσεχε, μπροστά σου σε δύο βήματα."),
    "LEFT_2": ("Careful, front-left in two steps.", "Πρόσεχε, αριστερά μπροστά σου σε δύο βήματα."),
    "RIGHT_2": ("Careful, front-right in two steps.", "Πρόσεχε, δεξιά μπροστά σου σε δύο βήματα."),
    "STAIRS_2": ("Careful, stairs ahead of you in two steps.", "Πρόσεχε, σκαλιά μπροστά σου σε δύο βήματα."),
    "AHEAD_1": ("Careful, right ahead of you in one step.", "Πρόσεχε, ακριβώς μπροστά σου σε ένα βήμα."),
    "LEFT_1": ("Careful, front-left in one step.", "Πρόσεχε, αριστερά μπροστά σου σε ένα βήμα."),
    "RIGHT_1": ("Careful, front-right in one step.", "Πρόσεχε, δεξιά μπροστά σου σε ένα βήμα."),
    "STAIRS_1": ("Careful, stairs right ahead of you.", "Πρόσεχε, σκαλιά ακριβώς μπροστά σου."),
    "AHEAD_NOW": ("Careful, obstacle right in front of you.", "Πρόσεχε, εμπόδιο ακριβώς μπροστά σου."),
    "LEFT_NOW": ("Careful, obstacle right on your front-left.", "Πρόσεχε, εμπόδιο ακριβώς αριστερά μπροστά σου."),
    "RIGHT_NOW": ("Careful, obstacle right on your front-right.", "Πρόσεχε, εμπόδιο ακριβώς δεξιά μπροστά σου."),
    "COMPASS_ALIGNED": ("You are facing your target direction, straight ahead.", "Είσαι στη σωστή κατεύθυνση, ακριβώς μπροστά σου."),
    "COMPASS_SLIGHT_LEFT": ("Your target direction is slightly front-left.", "Η κατεύθυνσή σου είναι λίγο αριστερά μπροστά σου."),
    "COMPASS_LEFT": ("Your target direction is to your left.", "Η κατεύθυνσή σου είναι αριστερά σου."),
    "COMPASS_SLIGHT_RIGHT": ("Your target direction is slightly front-right.", "Η κατεύθυνσή σου είναι λίγο δεξιά μπροστά σου."),
    "COMPASS_RIGHT": ("Your target direction is to your right.", "Η κατεύθυνσή σου είναι δεξιά σου."),
    "COMPASS_BEHIND": ("Your target direction is behind you.", "Η κατεύθυνσή σου είναι πίσω σου."),
}

GUIDANCE_CODES = frozenset({
    "AHEAD_3",
    "LEFT_3",
    "RIGHT_3",
    "AHEAD_2",
    "LEFT_2",
    "RIGHT_2",
    "STAIRS_2",
})

STOP_CODES = frozenset({
    "AHEAD_1",
    "LEFT_1",
    "RIGHT_1",
    "STAIRS_1",
    "AHEAD_NOW",
    "LEFT_NOW",
    "RIGHT_NOW",
})

CODE_TO_LEVEL: dict[str, int] = {
    "AHEAD_3": 2,
    "LEFT_3": 2,
    "RIGHT_3": 2,
    "AHEAD_2": 3,
    "LEFT_2": 3,
    "RIGHT_2": 3,
    "STAIRS_2": 3,
    "AHEAD_1": 4,
    "LEFT_1": 4,
    "RIGHT_1": 4,
    "STAIRS_1": 4,
    "AHEAD_NOW": 5,
    "LEFT_NOW": 5,
    "RIGHT_NOW": 5,
}

SOFTEN_CODE: dict[str, str] = {
    "AHEAD_1": "AHEAD_2",
    "LEFT_1": "LEFT_2",
    "RIGHT_1": "RIGHT_2",
    "STAIRS_1": "STAIRS_2",
    "AHEAD_NOW": "AHEAD_2",
    "LEFT_NOW": "LEFT_2",
    "RIGHT_NOW": "RIGHT_2",
}

LEVEL_TO_CODE = {
    1: "AHEAD_3",
    2: "AHEAD_3",
    3: "AHEAD_2",
    4: "AHEAD_1",
    5: "AHEAD_NOW",
}

DANGER_LEVEL = {
    "English": {lvl: ACTION_CODES[code][0] for lvl, code in LEVEL_TO_CODE.items()},
    "Greek": {lvl: ACTION_CODES[code][1] for lvl, code in LEVEL_TO_CODE.items()},
}

STEER = {
    "English": {
        "left": ACTION_CODES["LEFT_2"][0],
        "right": ACTION_CODES["RIGHT_2"][0],
    },
    "Greek": {
        "left": ACTION_CODES["LEFT_2"][1],
        "right": ACTION_CODES["RIGHT_2"][1],
    },
}

_ALIASES = {
    "AHEAD": "AHEAD_2",
    "CENTER": "AHEAD_2",
    "CENTER_3": "AHEAD_3",
    "CENTER_2": "AHEAD_2",
    "CENTER_1": "AHEAD_1",
    "CENTER_NOW": "AHEAD_NOW",
    "LEFT": "LEFT_2",
    "FRONT_LEFT": "LEFT_2",
    "RIGHT": "RIGHT_2",
    "FRONT_RIGHT": "RIGHT_2",
    "STAIRS": "STAIRS_1",
    "STAIRS_AHEAD": "STAIRS_1",
    "CAREFUL": "AHEAD_3",
    "SLOW_DOWN": "AHEAD_3",
    "SLOW_NOW": "AHEAD_2",
    "STOP": "AHEAD_1",
    "STOP_NOW": "AHEAD_NOW",
    "SLIGHT_LEFT": "RIGHT_2",
    "SLIDE_LEFT": "RIGHT_2",
    "TURN_LEFT": "AHEAD_2",
    "KEEP_LEFT": "RIGHT_3",
    "SLIGHT_RIGHT": "LEFT_2",
    "SLIDE_RIGHT": "LEFT_2",
    "TURN_RIGHT": "AHEAD_2",
    "KEEP_RIGHT": "LEFT_3",
    "TURN_BACK": "AHEAD_1",
    "CHECK_CANE": "STAIRS_1",
}

WATCHER = {
    "English": [
        "Careful, vehicle ahead of you in two steps!",
        "Careful, bicycle ahead of you in two steps.",
        "Careful, person ahead of you in two steps.",
        "Careful, step down ahead of you.",
        "Careful, wall ahead of you in two steps.",
        "Careful, pillar ahead of you in two steps.",
        "Careful, door ahead of you in two steps.",
    ],
    "Greek": [
        "Πρόσεχε, όχημα μπροστά σου σε δύο βήματα!",
        "Πρόσεχε, ποδήλατο μπροστά σου σε δύο βήματα.",
        "Πρόσεχε, άτομο μπροστά σου σε δύο βήματα.",
        "Πρόσεχε, σκαλί μπροστά σου.",
        "Πρόσεχε, τοίχος μπροστά σου σε δύο βήματα.",
        "Πρόσεχε, κολώνα μπροστά σου σε δύο βήματα.",
        "Πρόσεχε, πόρτα μπροστά σου σε δύο βήματα.",
    ],
}

_GROUP = {
    "car": "vehicle", "truck": "vehicle", "bus": "vehicle", "motorcycle": "vehicle", "train": "vehicle",
    "bicycle": "bike",
    "person": "person",
    "dog": "animal", "cat": "animal", "horse": "animal", "cow": "animal", "sheep": "animal",
}

_CODE_TAG_RE = re.compile(r"\[([A-Za-z0-9_\- ]{3,20})\]")


def group_of(label: str) -> str:
    return _GROUP.get(label.lower().strip(), "obstacle")


def is_supported_lang(raw: str | None) -> bool:
    """Return True if `raw` explicitly designates English or Greek."""
    if not raw:
        return False
    val = raw.strip().lower()
    return val in ("english", "en", "en-us", "en-gb", "greek", "el", "el-gr", "ελληνικά", "ελληνικα")


def normalize_lang(raw: str | None) -> str:
    """Strictly clamp any language string to the only two supported languages: 'English' or 'Greek'."""
    if not raw:
        return "English"
    val = raw.strip().lower()
    if val in ("greek", "el", "el-gr", "ελληνικά", "ελληνικα"):
        return "Greek"
    return "English"


def get_last_lang(path: Path | None = None) -> str:
    """Load the persisted language from the last user conversation ('English' or 'Greek')."""
    global _last_lang_cache
    target = path or _LANG_FILE
    if path is None and _last_lang_cache in SUPPORTED_LANGS:
        return _last_lang_cache
    try:
        if target.exists():
            loaded = normalize_lang(target.read_text(encoding="utf-8").strip())
            if path is None:
                _last_lang_cache = loaded
            return loaded
    except OSError:
        pass
    return "English"


def save_last_lang(lang: str, path: Path | None = None) -> str:
    """Persist the active conversation language ('English' or 'Greek') for future sessions."""
    global _last_lang_cache
    canon = normalize_lang(lang)
    target = path or _LANG_FILE
    if path is None:
        _last_lang_cache = canon
    try:
        target.write_text(canon, encoding="utf-8")
    except OSError:
        pass
    return canon


def normalize_code(raw: str | None) -> str:
    """Normalize a raw code string (e.g. 'right-2', '[LEFT_2]', 'ahead_1') into a canonical ACTION_CODES key."""
    if not raw:
        return ""
    cleaned = re.sub(r"[^A-Z0-9_]", "", raw.strip().upper().replace("-", "_").replace(" ", "_")).strip("_")
    if not cleaned or cleaned in ("NONE", "CLEAR", "NULL"):
        return ""
    if cleaned in ACTION_CODES:
        return cleaned
    return _ALIASES.get(cleaned, "")


def code_phrase(code: str, lang: str = "English") -> str:
    """Map a standard ACTION_CODES key to its exact standard English or Greek words."""
    canon = normalize_code(code)
    if not canon:
        return ""
    en, el = ACTION_CODES[canon]
    return el if lang == "Greek" else en


def expand_codes(text: str, lang: str = "English") -> str:
    """Replace any bracketed standard codes like `[SLIDE_RIGHT]` with their standard spoken phrase."""
    def _repl(m: re.Match) -> str:
        phrase = code_phrase(m.group(1), lang)
        return f" {phrase} " if phrase else ""

    return _CODE_TAG_RE.sub(_repl, text)


def local_alert(label: str, lang: str = "English") -> tuple[str, str]:
    """(hazard_key, spoken text) for an on-device detection of `label` directly ahead."""
    group = group_of(label)
    english, greek = LOCAL[group]
    return f"{group}-ahead", greek if lang == "Greek" else english


def danger_phrase(level: int, lang: str = "English") -> str:
    """Return the calibrated warning phrase for danger level 1..5."""
    clamped = max(1, min(5, int(level)))
    bank = DANGER_LEVEL.get(lang) or DANGER_LEVEL["English"]
    return bank[clamped]


def steer_phrase(direction: str, lang: str = "English") -> str:
    """Return the calibrated slight-turn phrase ('left' or 'right') in English or Greek."""
    side = "left" if direction == "left" else "right"
    bank = STEER.get(lang) or STEER["English"]
    return bank[side]


def all_phrases() -> list[str]:
    """Every unique phrase worth pre-synthesizing, ordered with standard action codes first."""
    out: list[str] = []
    for en, el in ACTION_CODES.values():
        out.append(en)
        out.append(el)
    out.extend(p for pair in LOCAL.values() for p in pair)
    for items in WATCHER.values():
        out.extend(items)
    return list(dict.fromkeys(out))


def prefer_list(lang: str) -> str:
    items = WATCHER.get(lang) or WATCHER["English"]
    return " | ".join(items)
