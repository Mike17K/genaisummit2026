"""Pitch-preserving speed-up (WSOLA) + silence trimming for 24 kHz mono PCM16 speech.

Used for emergency guidance so "Turn right 30 degrees. Box one step ahead." is delivered at a fast pace
without the chipmunk effect of simply playing the audio faster.
"""
import numpy as np

RATE = 24000
_FRAME = 960      # 40 ms analysis/synthesis window
_HOP = _FRAME // 2
_TOL = 240        # +-10 ms similarity search


def trim_silence(pcm: bytes, threshold: int = 500, keep_ms: int = 25) -> bytes:
    """Drop leading/trailing near-silence (TTS adds ~0.3-0.6 s of it), keeping a tiny margin."""
    x = np.frombuffer(pcm[: len(pcm) - (len(pcm) % 2)], dtype=np.int16)
    if x.size == 0:
        return pcm
    loud = np.flatnonzero(np.abs(x.astype(np.int32)) > threshold)
    if loud.size == 0:
        return pcm
    keep = RATE * keep_ms // 1000
    start = max(0, int(loud[0]) - keep)
    end = min(x.size, int(loud[-1]) + keep)
    return x[start:end].tobytes()


def speed_up(pcm: bytes, rate: float) -> bytes:
    """Time-compress speech by `rate` (1.3 = 30 % faster) keeping the original pitch (WSOLA)."""
    if rate <= 1.01:
        return pcm
    x = np.frombuffer(pcm[: len(pcm) - (len(pcm) % 2)], dtype=np.int16).astype(np.float32)
    if x.size < _FRAME * 3:
        return pcm
    ha = int(round(_HOP * rate))
    win = np.hanning(_FRAME).astype(np.float32)
    xp = np.concatenate([np.zeros(_TOL, np.float32), x, np.zeros(_FRAME + _TOL + ha, np.float32)])
    n_frames = max(1, (x.size - _FRAME) // ha + 1)
    out = np.zeros(n_frames * _HOP + _FRAME, np.float32)
    norm = np.zeros_like(out)

    prev = _TOL  # position (in xp) of the previously copied segment
    for k in range(n_frames):
        target = _TOL + k * ha
        if k == 0:
            pos = target
        else:
            natural = xp[prev + _HOP: prev + _HOP + _FRAME]
            lo = max(0, target - _TOL)
            region = xp[lo: target + _TOL + _FRAME]
            if region.size < _FRAME or natural.size < _FRAME:
                pos = target
            else:
                corr = np.correlate(region, natural, mode="valid")
                pos = lo + int(np.argmax(corr))
        seg = xp[pos: pos + _FRAME]
        if seg.size < _FRAME:
            break
        o = k * _HOP
        out[o: o + _FRAME] += seg * win
        norm[o: o + _FRAME] += win
        prev = pos

    norm[norm < 1e-3] = 1.0
    y = out / norm
    end = int(x.size / rate)
    return np.clip(y[:end], -32768, 32767).astype(np.int16).tobytes()


def fast_speech(pcm: bytes, rate: float) -> bytes:
    """Trim silence, then speed up: what emergency guidance actually plays."""
    return speed_up(trim_silence(pcm), rate)
