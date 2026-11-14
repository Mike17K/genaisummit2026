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

# Live (realtime voice) model. Verified on this key via the v1beta endpoint, which also hosts the TTS models.
LIVE_MODEL = os.environ.get("GEMINI_LIVE_MODEL", "gemini-2.5-flash-native-audio-latest")
VOICE = os.environ.get("GEMINI_VOICE", "Kore")  # try Aoede, Puck, Charon, Fenrir, Leda, Zephyr

# Wait after the user stops talking before the assistant answers (ms). The page can override it with ?silence=.
SILENCE_MS = int(os.environ.get("EYES_SILENCE_MS", "900"))

# ---- proactive safety watcher ----
WATCH_MODEL = os.environ.get("GEMINI_WATCH_MODEL", "gemini-3.5-flash-lite")  # decides from the last 3 frames, ~1.5 s per call
WATCH_S = float(os.environ.get("EYES_WATCH_S", "2.0"))            # look about every N seconds (each look is one model call)
ALERT_MIN_CONF = float(os.environ.get("EYES_ALERT_MIN_CONF", "0.75"))      # low urgency needs at least this confidence
ALERT_MIN_CONF_HIGH = float(os.environ.get("EYES_ALERT_MIN_CONF_HIGH", "0.6"))
ALERT_COOLDOWN_S = float(os.environ.get("EYES_ALERT_COOLDOWN_S", "6"))     # min gap between low-urgency alerts
ALERT_COOLDOWN_HIGH_S = float(os.environ.get("EYES_ALERT_COOLDOWN_HIGH_S", "1.5"))
ALERT_DEDUPE_S = float(os.environ.get("EYES_ALERT_DEDUPE_S", "25"))        # same hazard is not repeated within this time
ALERT_MAX_PER_MIN = int(os.environ.get("EYES_ALERT_MAX_PER_MIN", "6"))

# Alerts are spoken by a TTS model (exact words, no instruction leakage), not by the Live model.
TTS_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts")  # ~1.7-2.2 s for a short sentence, cached after

# ---- many connections at once ----
MAX_CONNECTIONS = int(os.environ.get("EYES_MAX_CONNECTIONS", "10"))          # more are told "busy"; protects the API quota
MAX_PARALLEL_CALLS = int(os.environ.get("EYES_MAX_PARALLEL_CALLS", "6"))     # watcher and alert-voice calls running at once

# ---- adaptive attention: how often the camera sends images and the watcher looks ----
# The watcher model says how closely to watch ("normal", "elevated", "high"); these map that to rates.
FPS = {
    "normal": float(os.environ.get("EYES_FPS_NORMAL", "1")),        # images per second sent by the phone
    "elevated": float(os.environ.get("EYES_FPS_ELEVATED", "2.5")),
    "high": float(os.environ.get("EYES_FPS_HIGH", "4")),
}
LOOK_S = {                                                           # seconds between watcher looks
    "normal": WATCH_S,
    "elevated": float(os.environ.get("EYES_LOOK_ELEVATED_S", "1.2")),
    "high": float(os.environ.get("EYES_LOOK_HIGH_S", "0.8")),
}
SPACING_S = {"normal": 1.0, "elevated": 0.7, "high": 0.5}           # gap between the 3 frames the watcher is shown
ATTENTION_HOLD_S = {"elevated": 5.0, "high": 8.0}                    # stay at a level at least this long after last needed
ATTENTION_MAX_S = float(os.environ.get("EYES_ATTENTION_MAX_S", "30"))        # cost guard: longest stretch above normal
ATTENTION_COOLDOWN_S = float(os.environ.get("EYES_ATTENTION_COOLDOWN_S", "12"))  # then forced back to normal for this long

# ---- fast warnings (phone sensors, on-device alerts, instant voice) ----
WATCH_THINKING = os.environ.get("GEMINI_WATCH_THINKING", "LOW")   # thinking_level for the watcher (MINIMAL, LOW, MEDIUM, HIGH or empty).
# thinking_budget=0 is rejected (HTTP 400) by gemini-3.5-flash-lite; if the model refuses any setting we retry without one.
ALERT_FAST_CONF = float(os.environ.get("EYES_ALERT_FAST_CONF", "0.88"))            # a low-urgency hazard seen once is announced if at least this sure
ALERT_FAST_CONF_MOVING = float(os.environ.get("EYES_ALERT_FAST_CONF_MOVING", "0.80"))  # same, when the user is walking
PAN_DEG_S = float(os.environ.get("EYES_PAN_DEG_S", "65"))        # camera turning faster than this (deg/s): skip looks, motion is not real
SENSOR_MAX_AGE_S = 1.5                                            # phone sensor readings older than this are ignored
