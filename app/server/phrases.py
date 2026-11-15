"""Standard navigation/safety codes and fixed alert phrases in English and Greek.

Every standard code (`ACTION_CODES`) and common alert phrase is pre-synthesized at server startup
(`speak.warm_common`) so safety stops, sliding/turning cues, and post-stop redirects play in 0 ms
using deterministic, human-verified wording.
"""
from pathlib import Path
import re

SUPPORTED_LANGS = ("English", "Greek")
_LANG_FILE = Path(__file__).resolve().parent.parent / ".last_lang"
_last_lang_cache: str | None = None

LOCAL = {
    "vehicle": ("Vehicle ahead, stop!", "Όχημα μπροστά, σταμάτα!"),
    "bike": ("Bike ahead, stop!", "Ποδήλατο μπροστά, σταμάτα!"),
    "person": ("Person ahead, careful.", "Άτομο μπροστά, προσοχή."),
    "animal": ("Animal ahead, careful.", "Ζώο μπροστά, προσοχή."),
    "obstacle": ("Obstacle ahead, stop.", "Εμπόδιο μπροστά, σταμάτα."),
}

# Standard navigation & danger codes used by both the safety watcher and conversational agent.
# Each code maps deterministically to (English, Greek) standard words (<= 4 words).
ACTION_CODES: dict[str, tuple[str, str]] = {
    # Speed / stop codes (levels 1..5)
    "CAREFUL": ("Careful ahead.", "Προσοχή μπροστά."),
    "SLOW_DOWN": ("Slow down.", "Πιο αργά."),
    "SLOW_NOW": ("Slow down now.", "Επιβράδυνε τώρα."),
    "STOP": ("Stop!", "Σταμάτα!"),
    "STOP_NOW": ("Stop now!", "Σταμάτα τώρα!"),
    # Sliding / sidestepping / steering / turning codes
    "SLIDE_LEFT": ("Slide left.", "Κάνε λίγο αριστερά."),
    "SLIDE_RIGHT": ("Slide right.", "Κάνε λίγο δεξιά."),
    "SLIGHT_LEFT": ("Turn slightly left.", "Στρίψε λίγο αριστερά."),
    "SLIGHT_RIGHT": ("Turn slightly right.", "Στρίψε λίγο δεξιά."),
    "KEEP_LEFT": ("Keep left.", "Κράτα αριστερά."),
    "KEEP_RIGHT": ("Keep right.", "Κράτα δεξιά."),
    "TURN_LEFT": ("Turn left.", "Στρίψε αριστερά."),
    "TURN_RIGHT": ("Turn right.", "Στρίψε δεξιά."),
    "TURN_BACK": ("Turn around.", "Γύρνα πίσω."),
    "CHECK_CANE": ("Check with cane.", "Έλεγξε με το μπαστούνι."),
}

GUIDANCE_CODES = frozenset({
    "SLIDE_LEFT",
    "SLIDE_RIGHT",
    "SLIGHT_LEFT",
    "SLIGHT_RIGHT",
    "KEEP_LEFT",
    "KEEP_RIGHT",
    "TURN_LEFT",
    "TURN_RIGHT",
    "TURN_BACK",
    "CHECK_CANE",
})

STOP_CODES = frozenset({"CAREFUL", "SLOW_DOWN", "SLOW_NOW", "STOP", "STOP_NOW"})

LEVEL_TO_CODE = {
    1: "CAREFUL",
    2: "SLOW_DOWN",
    3: "SLOW_NOW",
    4: "STOP",
    5: "STOP_NOW",
}

DANGER_LEVEL = {
    "English": {lvl: ACTION_CODES[code][0] for lvl, code in LEVEL_TO_CODE.items()},
    "Greek": {lvl: ACTION_CODES[code][1] for lvl, code in LEVEL_TO_CODE.items()},
}

STEER = {
    "English": {
        "left": ACTION_CODES["SLIGHT_LEFT"][0],
        "right": ACTION_CODES["SLIGHT_RIGHT"][0],
    },
    "Greek": {
        "left": ACTION_CODES["SLIGHT_LEFT"][1],
        "right": ACTION_CODES["SLIGHT_RIGHT"][1],
    },
}

_ALIASES = {
    "LEFT": "SLIGHT_LEFT",
    "RIGHT": "SLIGHT_RIGHT",
    "VEER_LEFT": "SLIGHT_LEFT",
    "VEER_RIGHT": "SLIGHT_RIGHT",
    "STEP_LEFT": "SLIDE_LEFT",
    "STEP_RIGHT": "SLIDE_RIGHT",
    "AROUND": "TURN_BACK",
    "BACK": "TURN_BACK",
    "CANE": "CHECK_CANE",
}

WATCHER = {
    "English": [
        "Car ahead, stop!", "Car from the right, stop.", "Car from the left, stop.", "Vehicle approaching, stop!",
        "Bicycle ahead, caution.", "Scooter ahead, caution.", "Person right ahead.",
        "Step down ahead.", "Step up ahead.", "Stairs ahead.", "Stairs ahead, caution.", "Curb ahead, careful.", "Curb ahead, watch your step.",
        "Wall ahead, stop.", "Wall right ahead, stop.", "Pole ahead.", "Pole at twelve o'clock.", "Glass door ahead, stop.", "Door ahead.", "Hole ahead, stop.",
    ],
    "Greek": [
        "Αυτοκίνητο μπροστά, σταμάτα!", "Αυτοκίνητο από δεξιά, σταμάτα.", "Αυτοκίνητο από αριστερά, σταμάτα.", "Πλησιάζει όχημα, σταμάτα!",
        "Ποδήλατο μπροστά, προσοχή.", "Πατίνι μπροστά, προσοχή.", "Άτομο ακριβώς μπροστά.",
        "Σκαλί προς τα κάτω μπροστά.", "Σκαλί προς τα πάνω μπροστά.", "Σκάλες μπροστά.", "Σκάλες μπροστά, προσοχή.",
        "Πεζοδρόμιο μπροστά, προσοχή.", "Τοίχος μπροστά, σταμάτα.", "Τοίχος ακριβώς μπροστά, σταμάτα.", "Κολόνα μπροστά.",
        "Γυάλινη πόρτα μπροστά, σταμάτα.", "Πόρτα μπροστά.", "Λάκκος μπροστά, σταμάτα.",
    ],
}

_GROUP = {
    "car": "vehicle", "truck": "vehicle", "bus": "vehicle", "motorcycle": "vehicle", "train": "vehicle",
    "bicycle": "bike",
    "person": "person",
    "dog": "animal", "cat": "animal", "horse": "animal", "cow": "animal", "sheep": "animal",
}

_CODE_TAG_RE = re.compile(r"\[([A-Za-z_\- ]{3,20})\]")


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
    """Normalize a raw code string (e.g. 'slide-right', '[SLIDE_RIGHT]', 'left') into a canonical ACTION_CODES key."""
    if not raw:
        return ""
    cleaned = re.sub(r"[^A-Z_]", "", raw.strip().upper().replace("-", "_").replace(" ", "_"))
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
