"""Per-connection runtime state shared between the voice assistant and movement-gated safety pipeline."""
import asyncio
from collections import deque
from dataclasses import dataclass, field
import time

from fastapi import WebSocket

from ..assistant import turns
from ..safety.attention import Attention
from ..safety.policy import AlertPolicy
from .memory import UserMemory


@dataclass
class ActiveSpeech:
    """Tracks clause-by-clause playback timing while the assistant is speaking."""

    kind: str  # "answer" | "explain_resume"
    user_question: str = ""
    generated_text: str = ""
    # List of [play_start_epoch, play_end_epoch, clause_text]
    clause_timeline: list[list] = field(default_factory=list)


@dataclass
class InterruptedSpeech:
    """Preserves what the assistant was answering when cut off by a danger alert."""

    user_question: str
    spoken_so_far: str
    draft_reply: str
    created_at: float = field(default_factory=time.time)


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
    last_watch_idle_at: float = 0.0
    watch_inflight: int = 0
    watch_seq: int = 0
    watch_applied_seq: int = 0
    last_alert_fired_at: float = 0.0
    imu: dict | None = None
    imu_at: float = 0.0
    target_bearing_deg: float | None = None
    target_bearing_label: str = ""
    compass_aligned_announced: bool = False
    last_compass_cue_at: float = 0.0
    danger_frame_jpeg: bytes | None = None

    # Streaming information pipeline & turn state
    turn: turns.TurnTracker = field(default_factory=turns.TurnTracker)
    mic_turn_pcm: bytearray = field(default_factory=bytearray)
    turn_frame_jpeg: bytes | None = None
    chat_history: deque = field(default_factory=lambda: deque(maxlen=8))
    info_task: asyncio.Task | None = None
    active_speech: ActiveSpeech | None = None
    interrupted_speech: InterruptedSpeech | None = None

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

    def alert_locked(self, now: float) -> bool:
        """True while an alert + its 'why' explanation are generating/playing, plus 0.5 s after."""
        return self.explaining_alert or now < self.explain_lock_until

    def reset_mic_turn(self) -> None:
        """Clear any partial user voice turn so pre-alert speech or speaker echo cannot cut explanations."""
        self.turn.active = False
        self.turn.hold_open = False
        self.mic_turn_pcm.clear()
        self.turn_frame_jpeg = None

    def sent_audio(self, nbytes: int, now: float) -> None:
        """Account for PCM16 24 kHz mono sent to the browser (48,000 bytes/s)."""
        self.audible_until = max(self.audible_until, now) + nbytes / 48000
