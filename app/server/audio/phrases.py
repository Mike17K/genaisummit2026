"""Standard spoken phrases (obstacle locations, compass cues, depth emergency stop) in English and Greek.

Every code in `ACTION_CODES` is pre-synthesized at server startup (`speak.warm_common`) for 0 ms playback.
"""
from pathlib import Path
import re

from ..utils import config

SUPPORTED_LANGS = ("English", "Greek")
_LANG_FILE = config.APP_DIR / ".last_lang"
_last_lang_cache: str | None = None

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
    # Depth-triggered emergency stop: "Stop!" instantly, then the turn (degrees first), then what is ahead
    "DEPTH_STOP": ("Stop!", "Σταμάτα!"),
    "DEPTH_STOP_FALLBACK": ("Turn slowly to find open space.", "Γύρνα αργά να βρεις ελεύθερο χώρο."),
    "GUIDE_AROUND": ("Turn around.", "Γύρνα πίσω."),
    "GUIDE_WAIT": ("Wait, it is moving.", "Περίμενε, κινείται."),
    "GUIDE_STAY": ("Stay stopped.", "Μείνε ακίνητος."),
    # Spoken while the place tools run so the user is never left in silence
    "LOOKUP_FILLER": ("One moment, I'm looking at what's around you.", "Μια στιγμή, κοιτάζω τι υπάρχει γύρω σου."),
}

# Pre-cached "turn <side> <deg> degrees" instructions (degrees snapped to 15 deg steps)
TURN_DEGREES = (15, 30, 45, 60, 75, 90)
for _deg in TURN_DEGREES:
    ACTION_CODES[f"TURN_LEFT_{_deg}"] = (f"Turn left {_deg} degrees.", f"Στρίψε αριστερά {_deg} μοίρες.")
    ACTION_CODES[f"TURN_RIGHT_{_deg}"] = (f"Turn right {_deg} degrees.", f"Στρίψε δεξιά {_deg} μοίρες.")

GUIDE_CODES = frozenset(
    {"DEPTH_STOP", "DEPTH_STOP_FALLBACK", "GUIDE_AROUND", "GUIDE_WAIT", "GUIDE_STAY"}
    | {f"TURN_{side}_{d}" for side in ("LEFT", "RIGHT") for d in TURN_DEGREES}
)


def turn_code(action: str, side: str, deg: float | int | None) -> str:
    """Map the model's {action, side, deg} to a pre-cached guidance code (degrees snapped to 15 deg steps)."""
    action = (action or "").strip().lower()
    if action == "wait":
        return "GUIDE_WAIT"
    if action == "stay":
        return "GUIDE_STAY"
    try:
        d = abs(float(deg))
    except (TypeError, ValueError):
        d = 45.0
    if d >= 135.0 or action == "around":
        return "GUIDE_AROUND"
    snapped = min(TURN_DEGREES, key=lambda v: abs(v - d))
    side_up = "LEFT" if str(side or "").strip().lower().startswith("l") else "RIGHT"
    return f"TURN_{side_up}_{snapped}"

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

_CODE_TAG_RE = re.compile(r"\[([A-Za-z0-9_\- ]{3,20})\]")


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


def all_phrases() -> list[str]:
    """Every standard phrase worth pre-synthesizing at startup for 0 ms playback."""
    out: list[str] = []
    for en, el in ACTION_CODES.values():
        out.append(en)
        out.append(el)
    return list(dict.fromkeys(out))
