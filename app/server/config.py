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

# ---- Parallel stateless safety watcher (low-latency tuned) ----
WATCH_MODEL = os.environ.get("GEMINI_WATCH_MODEL", "gemini-3.5-flash-lite")
WATCH_S = float(os.environ.get("EYES_WATCH_S", "0.65"))
WATCH_TIMEOUT_S = float(os.environ.get("EYES_WATCH_TIMEOUT_S", "1.5"))
WATCH_THINKING = os.environ.get("GEMINI_WATCH_THINKING", "MINIMAL")
WATCH_MEDIA_RES = os.environ.get("GEMINI_WATCH_MEDIA_RES", "MEDIA_RESOLUTION_MEDIUM")

# Inspect at most 3 frames tiled into one compact contact-sheet image.
WATCH_FRAMES = int(os.environ.get("EYES_WATCH_FRAMES", "3"))
WATCH_COMPOSE = os.environ.get("EYES_WATCH_COMPOSE", "1") != "0"
COMPOSE_FRAMES = int(os.environ.get("EYES_COMPOSE_FRAMES", "3"))
COMPOSE_TILE_W = int(os.environ.get("EYES_COMPOSE_TILE_W", "224"))

# ---- Alert policy thresholds ----
ALERT_MIN_CONF = float(os.environ.get("EYES_ALERT_MIN_CONF", "0.75"))
ALERT_MIN_CONF_HIGH = float(os.environ.get("EYES_ALERT_MIN_CONF_HIGH", "0.60"))
ALERT_FAST_CONF = float(os.environ.get("EYES_ALERT_FAST_CONF", "0.85"))
ALERT_FAST_CONF_MOVING = float(os.environ.get("EYES_ALERT_FAST_CONF_MOVING", "0.80"))
ALERT_COOLDOWN_S = float(os.environ.get("EYES_ALERT_COOLDOWN_S", "6.0"))
ALERT_COOLDOWN_HIGH_S = float(os.environ.get("EYES_ALERT_COOLDOWN_HIGH_S", "1.0"))
STEER_COOLDOWN_S = float(os.environ.get("EYES_STEER_COOLDOWN_S", "1.5"))
ALERT_DEDUPE_S = float(os.environ.get("EYES_ALERT_DEDUPE_S", "25.0"))
ALERT_MAX_PER_MIN = int(os.environ.get("EYES_ALERT_MAX_PER_MIN", "6"))
EXPLAIN_POST_WINDOW_S = float(os.environ.get("EYES_EXPLAIN_POST_WINDOW_S", "0.5"))

# ---- Scene motion & post-trigger similarity latch ----
PAN_DEG_S = float(os.environ.get("EYES_PAN_DEG_S", "160"))
SENSOR_MAX_AGE_S = 1.5
STATIC_SKIP = os.environ.get("EYES_STATIC_SKIP", "1") != "0"
STATIC_MOTION = float(os.environ.get("EYES_STATIC_MOTION", "0.012"))
STATIC_MAX_SKIP_S = float(os.environ.get("EYES_STATIC_MAX_SKIP_S", "4.0"))
DANGER_SIMILARITY_DIFF = float(os.environ.get("EYES_DANGER_SIM_DIFF", "0.12"))
MIN_ALERT_MOVEMENT = float(os.environ.get("EYES_MIN_ALERT_MOVEMENT", "0.095"))
MIN_STOP_MOVEMENT = float(os.environ.get("EYES_MIN_STOP_MOVEMENT", "0.120"))
MIN_STEP_MOVEMENT = float(os.environ.get("EYES_MIN_STEP_MOVEMENT", "0.055"))

# ---- Adaptive camera & watcher rates ----
FPS = {
    "normal": float(os.environ.get("EYES_FPS_NORMAL", "3")),
    "elevated": float(os.environ.get("EYES_FPS_ELEVATED", "4")),
    "high": float(os.environ.get("EYES_FPS_HIGH", "5")),
}
LOOK_S = {
    "normal": WATCH_S,
    "elevated": float(os.environ.get("EYES_LOOK_ELEVATED_S", "0.5")),
    "high": float(os.environ.get("EYES_LOOK_HIGH_S", "0.4")),
}
SPACING_S = {"normal": 0.5, "elevated": 0.4, "high": 0.35}
ATTENTION_HOLD_S = {"elevated": 5.0, "high": 8.0}
ATTENTION_MAX_S = float(os.environ.get("EYES_ATTENTION_MAX_S", "30"))
ATTENTION_COOLDOWN_S = float(os.environ.get("EYES_ATTENTION_COOLDOWN_S", "4"))

# ---- Concurrency & TTS ----
MAX_CONNECTIONS = int(os.environ.get("EYES_MAX_CONNECTIONS", "10"))
MAX_PARALLEL_CALLS = int(os.environ.get("EYES_MAX_PARALLEL_CALLS", "6"))
TTS_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts")
TTS_PROVIDER = os.environ.get("EYES_TTS_PROVIDER", "gemini")
FAL_KEY = os.environ.get("FAL_API_KEY") or os.environ.get("FAL_KEY", "")
FAL_TTS_MODEL = os.environ.get("FAL_TTS_MODEL", "fal-ai/elevenlabs/tts/eleven-v3")
FAL_TTS_VOICE = os.environ.get("FAL_TTS_VOICE", "Rachel")

# ---- Debug trigger artifacts ----
DEBUG_TRIGGERS_ENABLED = os.environ.get("EYES_DEBUG_TRIGGERS", "1") != "0"
