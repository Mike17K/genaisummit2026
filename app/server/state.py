"""Per-connection runtime state shared between the Live voice bridge and safety watcher."""
from collections import deque
from dataclasses import dataclass, field
import time

from fastapi import WebSocket

from . import turns
from .attention import Attention
from .policy import AlertPolicy


@dataclass
class State:
    """Everything tracked for a single browser WebSocket session."""

    socket: WebSocket
    conn_id: str = "-"
    started_at: float = field(default_factory=time.time)
    session: object = None
    assistant_enabled: bool = True

    # Camera & watcher state
    frames: deque = field(default_factory=lambda: deque(maxlen=40))
    attention: Attention = field(default_factory=Attention)
    last_live_frame: float = 0.0
    policy: AlertPolicy = field(default_factory=AlertPolicy)
    recent_alerts: deque = field(default_factory=lambda: deque(maxlen=4))
    last_judged_frame: float = 0.0
    motion: deque = field(default_factory=lambda: deque(maxlen=12))
    last_look_at: float = 0.0
    last_look_silent: bool = True
    imu: dict | None = None
    imu_at: float = 0.0
    danger_frame_jpeg: bytes | None = None

    # Voice turn & playback tracking
    turn: turns.TurnTracker = field(default_factory=turns.TurnTracker)
    expect_interrupt: bool = False
    model_speaking: bool = False
    audible_until: float = 0.0
    drop_audio_since: float = 0.0
    lang: str = "English"
    extra_funcs: dict = field(default_factory=dict)
    client_tts: bool = True

    async def send(self, payload: dict) -> None:
        await self.socket.send_json(payload)

    def audible(self, now: float) -> bool:
        """True while previously streamed 24 kHz PCM16 speech is still playing on the client."""
        return now < self.audible_until

    def sent_audio(self, nbytes: int, now: float) -> None:
        """Account for PCM16 24 kHz mono sent to the browser (48,000 bytes/s)."""
        self.audible_until = max(self.audible_until, now) + nbytes / 48000
