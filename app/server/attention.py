"""Adaptive camera/watcher rate controller and phone IMU motion helpers."""
from . import config


class Attention:
    """Controls camera FPS and watcher frequency.

    Rises immediately when hazard attention increases, steps down gradually after a hold window
    to prevent flapping, and enforces a cost-guard cap + cooldown on sustained elevated stretches.
    """

    ORDER = ("normal", "elevated", "high")

    def __init__(self) -> None:
        self.level = "normal"
        self.since = float("-inf")
        self.above_since: float | None = None
        self.cooldown_until = float("-inf")

    def _rank(self, level: str) -> int:
        return self.ORDER.index(level)

    def update(self, model_level: str, now: float, *, alerted: bool = False, held: bool = False) -> bool:
        """Update attention from one watcher cycle. Returns True when the level changed."""
        want = model_level if model_level in self.ORDER else "normal"
        if alerted:
            want = "high"
        elif held and self._rank(want) < self._rank("elevated"):
            want = "elevated"
        if now < self.cooldown_until and not alerted:
            want = "normal"

        old = self.level
        if self._rank(want) > self._rank(self.level):
            self.level, self.since = want, now
        elif self._rank(want) == self._rank(self.level):
            if self.level != "normal":
                self.since = now
        elif now - self.since >= config.ATTENTION_HOLD_S[self.level]:
            self.level = self.ORDER[self._rank(self.level) - 1]
            self.since = now

        if self.level != "normal":
            if self.above_since is None:
                self.above_since = now
            elif now - self.above_since > config.ATTENTION_MAX_S:
                self.level, self.above_since = "normal", None
                self.cooldown_until = now + config.ATTENTION_COOLDOWN_S
        else:
            self.above_since = None
        return self.level != old

    @property
    def fps(self) -> float:
        return config.FPS[self.level]

    @property
    def look_s(self) -> float:
        return config.LOOK_S[self.level]

    @property
    def spacing(self) -> float:
        return config.SPACING_S[self.level]


def sensors_text(imu: dict | None) -> str:
    """Format phone IMU state into a compact one-line note for the watcher prompt."""
    if not imu:
        return ""
    speed = imu.get("angularSpeed")
    walking = imu.get("walking")
    if imu.get("panning"):
        state = "panning fast"
    elif walking is True:
        state = "walking"
    elif walking is False:
        state = "stationary"
    else:
        state = "movement unknown"
    bits = [f"user {state}"] if state != "movement unknown" else ["movement unknown"]
    if speed is not None:
        bits.append(f"gyro {speed} deg/s")
    if imu.get("pitchDeg") is not None:
        bits.append(f"phone pitch {imu['pitchDeg']} deg")
    return ", ".join(bits)


def user_moving(imu: dict | None) -> bool | None:
    """Return True if walking, False if stationary, or None when unknown."""
    if not imu:
        return None
    walking = imu.get("walking")
    return walking if isinstance(walking, bool) else None
