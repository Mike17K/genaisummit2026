"""Watcher structured schema, 1-5 danger level mapping, and alert gating policy."""
import re
from collections import deque
from typing import Literal

from pydantic import BaseModel

from . import config, phrases


class WatchDecision(BaseModel):
    notify: bool = False
    danger_level: int = 0
    urgency: Literal["low", "high"] = "low"
    confidence: float = 0.0
    hazard_key: str = ""
    message: str = ""
    reason: str = ""
    attention: Literal["normal", "elevated", "high"] = "normal"
    hazard_type: Literal["moving", "static"] = "static"


def apply_danger_level(d: WatchDecision, lang: str = "English") -> WatchDecision:
    """Normalize a 1..5 danger_level into calibrated short phrase, urgency, and confidence."""
    level = max(0, min(5, int(getattr(d, "danger_level", 0) or 0)))
    d.danger_level = level
    if level >= 1:
        d.notify = True
        d.message = phrases.danger_phrase(level, lang)
        d.urgency = "high" if level >= 3 else "low"
        d.confidence = max(d.confidence, 0.90)
        if level >= 3:
            d.attention = "high"
        elif d.attention == "normal":
            d.attention = "elevated"
        if not d.hazard_key:
            d.hazard_key = f"obstacle-lvl-{level}"
    return d


_SYNONYMS = {
    "car": "vehicle", "vehicle": "vehicle", "truck": "vehicle", "bus": "vehicle",
    "van": "vehicle", "taxi": "vehicle", "motorcycle": "vehicle",
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
    """Loosely match two hazard keys so minor wording shifts do not re-trigger duplicates."""
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
    """Pure, clock-injectable policy gating whether a WatchDecision speaks aloud."""

    MODES = ("normal", "urgent_only", "off")

    def __init__(self) -> None:
        self.mode = "normal"
        self.alert_times: deque[float] = deque(maxlen=50)
        self.last_alert_at = float("-inf")
        self.alerted: list[tuple[float, str, str]] = []  # (time, key, urgency)
        self.alerted_levels: list[tuple[float, str, int]] = []  # (time, key, danger_level)
        self.sightings: list[tuple[float, str]] = []     # (time, key)

    def _recently_seen(self, key: str, now: float, within: float) -> bool:
        return any(same_hazard(k, key) and now - t <= within for t, k in self.sightings)

    def _prev_level(self, key: str, now: float) -> int:
        for t, k, lvl in reversed(self.alerted_levels):
            if same_hazard(k, key) and now - t < config.ALERT_DEDUPE_S:
                return lvl
        return 0

    def decide(
        self,
        d: WatchDecision,
        now: float,
        user_voice_age: float,
        *,
        fast_confirm: bool = False,
        user_moving: bool | None = None,
    ) -> tuple[bool, str]:
        """Return (speak, reason). Call `record` when speaking."""
        if d.danger_level >= 1 and (not d.notify or not d.message):
            apply_danger_level(d)
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

        if not high and user_moving is False and d.hazard_type == "static":
            self._see(d, now)
            return False, "user_stationary"

        seen_before = self._recently_seen(d.hazard_key, now, within=max(8.0, config.WATCH_S * 3 + 2))
        self._see(d, now)
        sure = d.confidence >= (config.ALERT_FAST_CONF_MOVING if user_moving else config.ALERT_FAST_CONF)
        if not high and not seen_before and not (fast_confirm or sure):
            return False, "needs_confirmation"

        prev_lvl = self._prev_level(d.hazard_key, now)
        for t, key, urgency in reversed(self.alerted):
            if same_hazard(key, d.hazard_key) and now - t < config.ALERT_DEDUPE_S:
                if (high and urgency == "low") or (d.danger_level > prev_lvl and d.danger_level >= 4):
                    break  # escalation allowed through
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
        self.alerted_levels = [
            (t, k, lvl) for t, k, lvl in self.alerted_levels if now - t < 120
        ] + [(now, d.hazard_key, d.danger_level)]

    def clear_resolved(self) -> None:
        """Reset active hazard deduplication once the user turns/moves into a confirmed clear path."""
        self.alerted.clear()
        self.alerted_levels.clear()
