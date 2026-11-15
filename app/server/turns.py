"""Turn-taking: decides when the user's turn starts and ends. Pure logic with an injectable clock, so it is testable.

Audio chunks arrive from the page either as raw PCM16 (older pages) or with a 1-byte flag in front:
  flag 1 = voice (the page's noise gate is open), flag 0 = quiet (silence, or the short tail kept after you stop so
  word endings are not cut). The server counts silence from the last VOICE chunk, so the page's tail no longer adds
  dead time before the assistant answers, yet the tail audio is still forwarded to Gemini.

Rules (found by analysing real phone sessions, where 300 ms waits and noise split speech into fragments that
cancelled each other's answers):
  * the wait after you stop talking never goes below END_WAIT_FLOOR_S
  * a short utterance (under SHORT_S of voice) gets extra patience, because people pause after the first words
  * while the assistant is speaking, it takes BARGE_IN_S of sustained voice to cut it off (echo and noise bursts do not)
"""
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
    return chunk, 1 if chunk.strip(b"\x00") else 0   # older pages: any sound counts as voice


@dataclass
class TurnTracker:
    end_wait: float = 0.9
    active: bool = False          # Gemini has been told the user is talking
    hold_open: bool = False       # an alert's interrupt turn stays open until the user really speaks
    last_voice: float = 0.0
    voiced_s: float = 0.0         # seconds of voice in the current turn
    _onset: list = field(default_factory=list)
    _onset_s: float = 0.0

    def __post_init__(self) -> None:
        self.end_wait = max(END_WAIT_FLOOR_S, self.end_wait)

    def hold_for_alert(self) -> None:
        """An alert interrupted the assistant: keep that turn open so Gemini waits for the user instead of resuming."""
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
                if model_speaking:                      # barge-in must be sustained
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
            self._onset, self._onset_s = [], 0.0        # the voice stopped before it was sustained enough
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
