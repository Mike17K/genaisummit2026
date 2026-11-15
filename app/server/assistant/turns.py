"""Turn-taking: decides when the user's turn starts and ends. Pure logic with an injectable clock."""
from dataclasses import dataclass, field

BYTES_PER_S = 32000          # PCM16 mono 16 kHz
END_WAIT_FLOOR_S = 0.4
BARGE_IN_S = 0.45
SHORT_S = 1.0
SHORT_EXTRA_S = 0.4
MAX_TURN_S = 8.0             # Safety cap so continuous loud-room noise can never trap a turn open forever


def parse_chunk(chunk: bytes) -> tuple[bytes, int]:
    """Return (pcm, voice_flag). An odd length means a leading flag byte (PCM16 chunks are always even)."""
    if len(chunk) % 2 == 1:
        return chunk[1:], 1 if chunk[0] else 0
    return chunk, 1 if chunk.strip(b"\x00") else 0


@dataclass
class TurnTracker:
    end_wait: float = 0.9
    active: bool = False
    hold_open: bool = False
    last_voice: float = 0.0
    voiced_s: float = 0.0
    _onset: list = field(default_factory=list)
    _onset_s: float = 0.0

    def __post_init__(self) -> None:
        self.end_wait = max(END_WAIT_FLOOR_S, self.end_wait)

    def hold_for_alert(self) -> None:
        """An alert interrupted the assistant: keep that turn open until the user speaks."""
        self.active, self.hold_open, self.voiced_s = True, True, 0.0

    def feed(self, chunk: bytes, now: float, model_speaking: bool) -> list[tuple]:
        """One audio chunk in; actions out: ("start",), ("audio", pcm), ("end", silence_seconds)."""
        pcm, flag = parse_chunk(chunk)
        voice = flag == 1
        dur = len(pcm) / BYTES_PER_S
        out: list[tuple] = []
        if voice:
            self.last_voice = now
            if self.active:
                self.hold_open = False
                self.voiced_s += dur
            else:
                if model_speaking:
                    self._onset.append(pcm)
                    self._onset_s += dur
                    if self._onset_s < BARGE_IN_S:
                        return out
                    held, self._onset, self._onset_s = self._onset, [], 0.0
                else:
                    held = [pcm]
                self.active, self.voiced_s = True, sum(len(p) for p in held) / BYTES_PER_S
                out.append(("start",))
                out.extend(("audio", p) for p in held)
                return out
        else:
            self._onset, self._onset_s = [], 0.0
        if self.active and not self.hold_open:
            out.append(("audio", pcm))
            if self.voiced_s >= MAX_TURN_S:
                self.active = False
                out.append(("end", 0.0))
            elif not voice:
                wait = self.end_wait + (SHORT_EXTRA_S if self.voiced_s < SHORT_S else 0.0)
                if now - self.last_voice >= wait:
                    self.active = False
                    out.append(("end", round(now - self.last_voice, 2)))
        return out
