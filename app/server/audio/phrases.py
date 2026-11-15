"""Standard spoken phrases (compass guidance cues, lookup filler) in English and Greek.

Every code in `ACTION_CODES` is pre-synthesized at server startup (`speak.warm_common`) for 0 ms playback.
"""
from pathlib import Path
import re

from ..utils import config

SUPPORTED_LANGS = ("English", "Greek")
_LANG_FILE = config.APP_DIR / ".last_lang"
_last_lang_cache: str | None = None

ACTION_CODES: dict[str, tuple[str, str]] = {
    "COMPASS_ALIGNED": ("You are facing your target direction, straight ahead.", "Είσαι στη σωστή κατεύθυνση, ακριβώς μπροστά σου."),
    "COMPASS_SLIGHT_LEFT": ("Your target direction is slightly front-left.", "Η κατεύθυνσή σου είναι λίγο αριστερά μπροστά σου."),
    "COMPASS_LEFT": ("Your target direction is to your left.", "Η κατεύθυνσή σου είναι αριστερά σου."),
    "COMPASS_SLIGHT_RIGHT": ("Your target direction is slightly front-right.", "Η κατεύθυνσή σου είναι λίγο δεξιά μπροστά σου."),
    "COMPASS_RIGHT": ("Your target direction is to your right.", "Η κατεύθυνσή σου είναι δεξιά σου."),
    "COMPASS_BEHIND": ("Your target direction is behind you.", "Η κατεύθυνσή σου είναι πίσω σου."),
    # Spoken while the place tools run so the user is never left in silence
    "LOOKUP_FILLER": ("One moment, I'm looking at what's around you.", "Μια στιγμή, κοιτάζω τι υπάρχει γύρω σου."),
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
    return cleaned if cleaned in ACTION_CODES else ""


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
