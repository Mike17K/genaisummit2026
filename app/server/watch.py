"""Proactive safety watcher.

Every couple of seconds a fast vision model looks at the last 3 camera frames and DECIDES whether the user
needs to be told something. A strict policy then decides whether the model's wish to speak is allowed through
(confidence, confirmation, cooldowns, de-duplication, rate limit, never talking over the user).
The model is told to stay silent by default: silence is the normal, correct answer.
"""
import re
import time
from collections import deque
from typing import Literal

from google.genai import types
from pydantic import BaseModel

from . import agent, config


class WatchDecision(BaseModel):
    notify: bool = False
    urgency: Literal["low", "high"] = "low"
    confidence: float = 0.0
    hazard_key: str = ""
    message: str = ""
    reason: str = ""


WATCH_SYSTEM = """You are the silent safety watcher for a blind person who is walking or standing somewhere. A phone camera on them gives you the last 3 frames, oldest first, about one second apart. You only decide whether to interrupt them. Silence is the normal answer.

Interrupt (notify=true) ONLY when, comparing the frames, there is a real, current danger or obstacle that the person probably does not know about:
- something in or next to their path that they are about to reach: steps up or down, a curb, a hole or drop-off, a pole, wall, glass door, parked vehicle, low branch or sign, an open door or cabinet at head height, a wet floor
- something moving toward them that is getting closer or bigger across the frames: car, bike, scooter, person on a collision course, animal
- a hot, sharp or dangerous object within reach
- a clear threat

Do NOT interrupt for: ordinary scenery, things far away or off to the side that are not coming toward them, static objects that are not in their path, things already announced recently (listed below), shops, signs, people just standing or walking away, vague unease, blurry or dark frames you cannot read (stay silent), or anything that you cannot see changing or blocking the way. If unsure, stay silent. A false alarm is worse than a missed minor detail, but never miss something that is clearly about to hurt them.

urgency: "high" only if impact or a fall is likely within about 3 seconds (vehicle closing in, drop-off or step right ahead, something about to hit them). Otherwise "low".
confidence: 0.0 to 1.0, how sure you are that this is real and relevant.
hazard_key: 2 or 3 lowercase words joined by hyphens, object then direction, e.g. car-right, step-down, pole-ahead. Use the same key for the same hazard across checks.
message: at most 8 words, spoken aloud, minimal, with a clock position or direction and distance when you can tell. Examples: "Car from the right, stop." "Step down, two steps ahead." "Pole at twelve o'clock." Write it in the language requested below. Do not describe the scene.
reason: one short sentence for the log.
If notify is false, leave message and hazard_key empty."""


def _age(now: float, t: float) -> str:
    return f"{now - t:.0f}s ago"


def build_contents(frames: list[tuple[float, bytes]], recent: list[tuple[float, str, str]], lang: str) -> list:
    now = time.time()
    parts: list = []
    labels = ["oldest", "middle", "newest"]
    labels = labels[-len(frames):] if len(frames) < 3 else labels
    for label, (t, jpeg) in zip(labels, frames):
        parts.append(types.Part.from_text(text=f"Frame ({label}, {_age(now, t)}):"))
        parts.append(types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"))
    if recent:
        listed = "; ".join(f'{key or "alert"} ("{msg}", {_age(now, t)})' for t, key, msg in recent)
        parts.append(types.Part.from_text(text=f"Already announced recently (do not repeat unless it got clearly worse): {listed}"))
    else:
        parts.append(types.Part.from_text(text="Nothing announced recently."))
    parts.append(types.Part.from_text(text=f"Language for the message: {lang}. Decide now."))
    return [types.Content(role="user", parts=parts)]


async def judge(frames: list[tuple[float, bytes]], recent: list[tuple[float, str, str]], lang: str) -> tuple[WatchDecision, dict]:
    response = await agent._get_client().aio.models.generate_content(
        model=config.WATCH_MODEL,
        contents=build_contents(frames, recent, lang),
        config=types.GenerateContentConfig(
            system_instruction=WATCH_SYSTEM,
            response_mime_type="application/json",
            response_schema=WatchDecision,
            temperature=0.1,
        ),
    )
    decision = response.parsed if isinstance(getattr(response, "parsed", None), WatchDecision) else WatchDecision.model_validate_json(response.text)
    decision.message = re.sub(r"\s+", " ", decision.message.replace('"', "")).strip()[:90]
    decision.hazard_key = re.sub(r"[^a-z0-9\- ]", "", decision.hazard_key.lower()).strip().replace(" ", "-")[:40]
    usage = getattr(response, "usage_metadata", None)
    return decision, {
        "prompt_tokens": getattr(usage, "prompt_token_count", None),
        "output_tokens": getattr(usage, "candidates_token_count", None),
    }


_SYNONYMS = {
    "car": "vehicle", "vehicle": "vehicle", "truck": "vehicle", "bus": "vehicle", "van": "vehicle", "taxi": "vehicle", "motorcycle": "vehicle",
    "bike": "bike", "bicycle": "bike", "cyclist": "bike", "scooter": "bike",
    "person": "person", "pedestrian": "person", "people": "person", "man": "person", "woman": "person", "child": "person",
    "step": "step", "steps": "step", "stairs": "step", "stair": "step", "curb": "step", "kerb": "step", "drop": "step", "dropoff": "step",
    "pole": "pole", "post": "pole", "sign": "pole", "signpost": "pole",
    "dog": "animal", "animal": "animal", "cat": "animal",
}
_DIRECTIONS = {"ahead", "front", "left", "right", "behind", "up", "down"}


def _tokens(key: str) -> list[str]:
    return [_SYNONYMS.get(t, t) for t in re.split(r"[-_ ]+", key) if t]


def same_hazard(a: str, b: str) -> bool:
    """Keys from the model vary a little between looks, so compare loosely: same kind of object, or mostly the same words."""
    if not a or not b:
        return False
    if a == b:
        return True
    ta, tb = _tokens(a), _tokens(b)
    objects_a = [t for t in ta if t not in _DIRECTIONS]
    objects_b = [t for t in tb if t not in _DIRECTIONS]
    if objects_a and objects_b and objects_a[0] == objects_b[0]:
        return True
    sa, sb = set(ta), set(tb)
    return len(sa & sb) / max(1, len(sa | sb)) >= 0.5


class AlertPolicy:
    """Decides whether the model's wish to speak is allowed. Pure logic with an injectable clock, so it is testable."""

    MODES = ("normal", "urgent_only", "off")

    def __init__(self) -> None:
        self.mode = "normal"
        self.alert_times: deque[float] = deque(maxlen=50)
        self.last_alert_at = float("-inf")
        self.alerted: list[tuple[float, str, str]] = []  # (time, key, urgency)
        self.sightings: list[tuple[float, str]] = []     # (time, key) of notify candidates seen

    def _recently_seen(self, key: str, now: float, within: float) -> bool:
        return any(same_hazard(k, key) and now - t <= within for t, k in self.sightings)

    def decide(self, d: WatchDecision, now: float, user_voice_age: float) -> tuple[bool, str]:
        """Return (speak, reason). Call `record` when speaking."""
        if self.mode == "off":
            return False, "mode_off"
        if not d.notify or not d.message:
            return False, "silent"
        high = d.urgency == "high"
        if self.mode == "urgent_only" and not high:
            return False, "urgent_only_mode"
        if d.confidence < (config.ALERT_MIN_CONF_HIGH if high else config.ALERT_MIN_CONF):
            self._see(d, now)
            return False, "low_confidence"

        # Low-urgency hazards must be seen on two checks in a row before they are announced.
        seen_before = self._recently_seen(d.hazard_key, now, within=config.WATCH_S * 3 + 2)
        self._see(d, now)
        if not high and not seen_before:
            return False, "needs_confirmation"

        # Do not repeat the same hazard unless it just became urgent.
        for t, key, urgency in reversed(self.alerted):
            if same_hazard(key, d.hazard_key) and now - t < config.ALERT_DEDUPE_S:
                if high and urgency == "low":
                    break  # escalation: allowed through
                return False, "duplicate"

        gap = now - self.last_alert_at
        if gap < (config.ALERT_COOLDOWN_HIGH_S if high else config.ALERT_COOLDOWN_S):
            return False, "cooldown"
        recent = sum(1 for t in self.alert_times if now - t < 60)
        if recent >= (config.ALERT_MAX_PER_MIN * 2 if high else config.ALERT_MAX_PER_MIN):
            return False, "rate_limit"
        if not high and user_voice_age < 1.5:
            return False, "user_speaking"
        return True, "ok"

    def _see(self, d: WatchDecision, now: float) -> None:
        self.sightings = [(t, k) for t, k in self.sightings if now - t < 30] + [(now, d.hazard_key)]

    def record(self, d: WatchDecision, now: float) -> None:
        self.last_alert_at = now
        self.alert_times.append(now)
        self.alerted = [(t, k, u) for t, k, u in self.alerted if now - t < 120] + [(now, d.hazard_key, d.urgency)]
