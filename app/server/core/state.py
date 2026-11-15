"""Per-connection runtime state shared between the voice assistant and the depth emergency-stop pipeline."""
import asyncio
from collections import deque
from dataclasses import dataclass, field
import time

from fastapi import WebSocket

from ..assistant import turns
from .memory import UserMemory

ALERT_MODES = ("normal", "urgent_only", "off")


@dataclass
class ActiveSpeech:
    """Tracks clause-by-clause playback timing while the assistant is speaking."""

    kind: str  # "answer" | "depth_stop"
    user_question: str = ""
    generated_text: str = ""
    # List of [play_start_epoch, play_end_epoch, clause_text]
    clause_timeline: list[list] = field(default_factory=list)


@dataclass
class State:
    """Everything tracked for a single browser WebSocket session."""

    socket: WebSocket
    conn_id: str = "-"
    started_at: float = field(default_factory=time.time)
    session: object = None
    assistant_enabled: bool = True

    # Camera, sensors & compass guidance
    frames: deque = field(default_factory=lambda: deque(maxlen=12))
    alert_mode: str = "normal"
    imu: dict | None = None
    imu_at: float = 0.0
    target_bearing_deg: float | None = None
    target_bearing_label: str = ""
    target_from_goal: bool = False  # target came from a direction in the memory goal ("να πάω νότια")
    compass_aligned_announced: bool = False
    last_compass_cue_at: float = 0.0

    # Phone GPS + places (tour guide tools)
    gps: dict | None = None          # {"lat", "lon", "acc", "heading"?, "speed"?}
    gps_at: float = 0.0
    geo_area: dict | None = None     # cached reverse-geocode of the current spot
    geo_places: list = field(default_factory=list)  # last places results, to resolve "the second one"
    target_place: dict | None = None  # {"name","lat","lon"} while guide_to_place is active

    # Depth-triggered emergency stop: while active, the answering pipeline is blocked
    emergency_active: bool = False
    emergency_task: asyncio.Task | None = None
    last_emergency_at: float = 0.0
    stop_phrase_until: float = 0.0  # only the "Stop!" itself cannot be talked over; everything after it can

    # Streaming information pipeline & turn state
    turn: turns.TurnTracker = field(default_factory=turns.TurnTracker)
    mic_turn_pcm: bytearray = field(default_factory=bytearray)
    turn_frame_jpeg: bytes | None = None
    chat_history: deque = field(default_factory=lambda: deque(maxlen=8))
    info_task: asyncio.Task | None = None
    active_speech: ActiveSpeech | None = None

    expect_interrupt: bool = False
    model_speaking: bool = False
    audible_until: float = 0.0
    explaining_alert: bool = False
    explain_lock_until: float = 0.0
    depth_mode_active: bool = False
    depth_device: str = "mobile"
    depth_probes_inflight: int = 0
    depth_probe_latest_seq: int = 0
    drop_audio_since: float = 0.0
    lang: str = "English"
    memory: UserMemory = field(default_factory=UserMemory)
    extra_funcs: dict = field(default_factory=dict)
    client_tts: bool = True

    async def send(self, payload: dict) -> None:
        await self.socket.send_json(payload)

    def audible(self, now: float) -> bool:
        """True while previously streamed 24 kHz PCM16 speech is still playing on the client."""
        return now < self.audible_until

    def mic_blocked(self, now: float) -> bool:
        """User speech is ignored only while holding the depth scan or while "Stop!" itself plays."""
        return self.depth_mode_active or now < self.stop_phrase_until

    def alert_locked(self, now: float) -> bool:
        """True while a depth emergency stop + its guidance are generating/playing (plus a short tail)."""
        return self.emergency_active or self.explaining_alert or now < self.explain_lock_until

    def reset_mic_turn(self) -> None:
        """Clear any partial user voice turn so pre-alert speech or speaker echo cannot cut explanations."""
        self.turn.active = False
        self.turn.hold_open = False
        self.mic_turn_pcm.clear()
        self.turn_frame_jpeg = None

    def sent_audio(self, nbytes: int, now: float) -> None:
        """Account for PCM16 24 kHz mono sent to the browser (48,000 bytes/s)."""
        self.audible_until = max(self.audible_until, now) + nbytes / 48000
