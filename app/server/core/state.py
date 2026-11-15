"""Per-connection runtime state for the voice assistant, compass/places guidance and the hold-to-scan depth sonar."""
import asyncio
from collections import deque
from dataclasses import dataclass, field
import time

from fastapi import WebSocket

from ..assistant import turns
from .memory import UserMemory


@dataclass
class ActiveSpeech:
    """Tracks clause-by-clause playback timing while the assistant is speaking."""

    kind: str  # "answer"
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

    # Streaming information pipeline & turn state
    turn: turns.TurnTracker = field(default_factory=turns.TurnTracker)
    mic_turn_pcm: bytearray = field(default_factory=bytearray)
    ptt_active: bool = False      # push-to-talk: the user is holding the button and talking
    ptt_started_at: float = 0.0
    turn_frame_jpeg: bytes | None = None
    chat_history: deque = field(default_factory=lambda: deque(maxlen=8))
    info_task: asyncio.Task | None = None
    active_speech: ActiveSpeech | None = None

    expect_interrupt: bool = False
    model_speaking: bool = False
    audible_until: float = 0.0
    depth_mode_active: bool = False
    sonar_active: bool = False  # phone runs the always-on stereo depth sonar (needs depth probes answered)
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
        """User speech is ignored only while the user holds the depth-sonar scan."""
        return self.depth_mode_active

    def reset_mic_turn(self) -> None:
        """Clear any partial user voice turn so pre-alert speech or speaker echo cannot cut explanations."""
        self.turn.active = False
        self.turn.hold_open = False
        self.mic_turn_pcm.clear()
        self.turn_frame_jpeg = None

    def sent_audio(self, nbytes: int, now: float) -> None:
        """Account for PCM16 24 kHz mono sent to the browser (48,000 bytes/s)."""
        self.audible_until = max(self.audible_until, now) + nbytes / 48000
