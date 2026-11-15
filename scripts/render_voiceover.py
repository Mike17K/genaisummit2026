"""Synthesize the 60s VoxEye video voiceover track (voice.wav) using Fal.ai ElevenLabs v3 (or Gemini fallback).

Usage:
  1. Paste your FAL_API_KEY in app/.env
  2. Run: python3 scripts/render_voiceover.py
"""
import asyncio
import shutil
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))

from server.audio import fal, speak  # noqa: E402
from server.utils import config  # noqa: E402

CUES = [
    ("c0", 0.35, "en", "Two hundred eighty-five million people live with vision loss. White canes miss high branches, smart glasses cost four thousand euros, and voice A.I. is too slow."),
    ("c1", 7.15, "en", "Meet VoxEye: a personal agent that replaces your phone's default assistant, using only a chest-mounted phone and stereo earphones."),
    ("c2", 15.10, "en", "Why does Sonar Vision work? Like a car's parking sensor in stereo, closer obstacles beep faster in your left, center, or right ear."),
    ("c3_el", 22.10, "el", "Πού είναι το φαρμακείο;"),
    ("c3_en", 23.80, "en", "Unlike standard assistants, VoxEye remembers your goal, filters out street clutter, and guides you with simple clock directions."),
    ("c4", 31.00, "en", "As you turn your body, your phone's compass and Google Maps keep every direction locked to the real world."),
    ("c5_a", 38.90, "en", "Here is our live prototype: on the left, the camera sees a close obstacle in warm yellow; on the right, you hear fast center beeps."),
    ("c5_b", 46.20, "en", "Step left. Pharmacy door at twelve o'clock, three steps ahead."),
    ("c6", 53.70, "en", "Next, we will test with real blind users, fine-tune the sonar sounds for comfort, and launch as a default Android assistant."),
]


def write_pcm24k_wav(path: Path, pcm: bytes) -> float:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm)
    return len(pcm) / (24000 * 2)


async def main() -> None:
    use_fal = fal.available()
    provider_label = f"Fal.ai ElevenLabs v3 ({config.FAL_TTS_MODEL}, voice={config.FAL_TTS_VOICE})" if use_fal else f"Gemini Neural TTS ({config.TTS_MODEL})"
    print(f"Using TTS provider: {provider_label}")
    if not use_fal:
        print("NOTE: FAL_API_KEY is empty in app/.env — paste your key in app/.env to use ElevenLabs v3.")

    tmp_dir = ROOT / "brag-output" / "work" / "vo_cues"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    inputs = []
    filter_parts = []
    mix_labels = []

    for idx, (cid, start_s, lang, text) in enumerate(CUES):
        wav_path = tmp_dir / f"{cid}.wav"
        if use_fal:
            pcm = await fal.tts(text)
        else:
            voice = "Aoede" if lang == "el" else config.VOICE
            pcm = await speak.tts(text, voice=voice)
        dur = write_pcm24k_wav(wav_path, pcm)
        print(f"  [{cid}] start={start_s:5.2f}s  dur={dur:4.2f}s  end={start_s+dur:5.2f}s  ({text[:48]}...)")
        inputs.extend(["-i", str(wav_path)])
        delay_ms = int(round(start_s * 1000))
        filter_parts.append(f"[{idx}:a]aresample=48000,adelay={delay_ms}|{delay_ms}[c{idx}]")
        mix_labels.append(f"[c{idx}]")

    out_piece = ROOT / "brag-output" / "piece" / "voice" / "voice.wav"
    out_piece.parent.mkdir(parents=True, exist_ok=True)
    filter_complex = ";".join(filter_parts) + f";{''.join(mix_labels)}amix=inputs={len(CUES)}:normalize=0,apad,atrim=0:60.0[out]"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", filter_complex, "-map", "[out]", "-ar", "48000", "-ac", "1", str(out_piece)],
        check=True,
    )
    print(f"Wrote {out_piece}")

    out_gs = ROOT / "brag-output" / "game-show" / "voice" / "voice.wav"
    if out_gs.parent.exists():
        shutil.copy2(out_piece, out_gs)
        print(f"Copied to {out_gs}")


if __name__ == "__main__":
    asyncio.run(main())
