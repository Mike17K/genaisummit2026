"""Load .env without extra dependencies and expose centralized runtime configuration."""
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[2]


def load_env() -> None:
    path = APP_DIR / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()

# ---- API keys & core models ----
API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
HARD_MODEL = os.environ.get("GEMINI_HARD_MODEL", "gemini-3.8-flash")

# ---- Realtime conversational voice model ----
LIVE_MODEL = os.environ.get("GEMINI_LIVE_MODEL", "gemini-3.8-live")
LIVE_FALLBACK_MODEL = os.environ.get("GEMINI_LIVE_FALLBACK_MODEL", "gemini-2.5-flash-native-audio-latest")
VOICE = os.environ.get("GEMINI_VOICE", "Kore")

# Fixed default silence wait after user stops talking (400 ms).
SILENCE_MS = int(os.environ.get("EYES_SILENCE_MS", "400"))

# ---- Center-crop metric depth probe (Gemini anchor for the on-device depth calibration) ----
DEPTH_PROBE_MODEL = os.environ.get("GEMINI_DEPTH_PROBE_MODEL", os.environ.get("GEMINI_WATCH_MODEL", "gemini-3.5-flash-lite"))
DEPTH_PROBE_THINKING = os.environ.get("GEMINI_DEPTH_PROBE_THINKING", "MINIMAL")

# ---- Places / maps (tour guide) ----
# Google Maps Platform key with Places API (New), Geocoding API and Routes API enabled. Without it the free
# OpenStreetMap fallback (Nominatim + Overpass) is used. EYES_GEO_PROVIDER=osm forces the fallback.
# The Gemini key is reused when it is a standard Google Cloud key (AIza...) from a project with those APIs enabled.
GOOGLE_MAPS_API_KEY = (
    os.environ.get("GOOGLE_MAPS_API_KEY")
    or os.environ.get("GOOGLE_PLACES_API_KEY")
    or (API_KEY if API_KEY.startswith("AIza") and os.environ.get("EYES_GEO_USE_GEMINI_KEY", "1") != "0" else "")
)
GEO_PROVIDER = os.environ.get("EYES_GEO_PROVIDER", "auto").strip().lower()

# ---- Compass guidance ----
SENSOR_MAX_AGE_S = 5.0
COMPASS_CUE_COOLDOWN_S = float(os.environ.get("EYES_COMPASS_COOLDOWN_S", "5.5"))
COMPASS_ALIGNED_DEG = float(os.environ.get("EYES_COMPASS_ALIGNED_DEG", "16.0"))
COMPASS_DRIFT_DEG = float(os.environ.get("EYES_COMPASS_DRIFT_DEG", "26.0"))

# ---- Concurrency & TTS ----
MAX_CONNECTIONS = int(os.environ.get("EYES_MAX_CONNECTIONS", "10"))
MAX_PARALLEL_CALLS = int(os.environ.get("EYES_MAX_PARALLEL_CALLS", "6"))
TTS_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts")
TTS_PROVIDER = os.environ.get("EYES_TTS_PROVIDER", "gemini")
FAL_KEY = os.environ.get("FAL_API_KEY") or os.environ.get("FAL_KEY", "")
FAL_TTS_MODEL = os.environ.get("FAL_TTS_MODEL", "fal-ai/elevenlabs/tts/eleven-v3")
FAL_TTS_VOICE = os.environ.get("FAL_TTS_VOICE", "Rachel")
