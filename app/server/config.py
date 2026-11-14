"""Load .env without extra dependencies. Real environment variables win over the file."""
import os
from pathlib import Path


def load_env() -> None:
    path = Path(__file__).resolve().parent.parent / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()

API_KEY = os.environ.get("GEMINI_API_KEY", "")
# IDs verified against this key on 2026-11-14 (models.list). 2.5-flash is retired for new users.
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
HARD_MODEL = os.environ.get("GEMINI_HARD_MODEL", "gemini-3.8-flash")  # not wired in yet: planned for hard reading
