"""Synthesize the shared 60s VoxEye video voiceover track (brag-output/piece/voice/voice.wav).

By default, if voice.wav already exists and matches the current script + provider, it is reused
immediately without making any API calls! Pass `--force` to regenerate (e.g. after adding FAL_API_KEY).

Usage:
  python3 scripts/render_voiceover.py           # reuses cached voice.wav if already generated
  python3 scripts/render_voiceover.py --force   # forces fresh synthesis
"""
import asyncio
import hashlib
import json
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))
sys.path.insert(0, str(ROOT / "app" / "server" / "utils"))

import config  # noqa: E402


def _has_fal() -> bool:
    return bool(config.FAL_KEY)

# Era boundaries in scenes.js & game-show/index.html:
#   Era 0:  0.00 -  6.80s
#   Era 1:  6.80 - 13.60s
#   Era 2: 13.60 - 21.80s
#   Era 3: 21.80 - 30.50s
#   Era 4: 30.50 - 38.20s
#   Era 5: 38.20 - 53.50s
#   Era 6: 53.50 - 60.00s
CUES = [
    ("c0",    0.20,  6.55, "en", "Canes miss high branches, smart glasses cost 4,000 euros, and cloud A.I. is too slow."),
    ("c1",    7.05, 13.35, "en", "Meet VoxEye: a personal agent that replaces your phone's assistant, using only your phone and stereo earphones."),
    ("c2",   14.00, 21.45, "en", "Why Sonar Vision? Like a car parking sensor in stereo, closer obstacles beep faster in your left or right ear."),
    ("c3_el",22.05, 23.55, "el", "Πού είναι το φαρμακείο;"),
    ("c3_en",23.85, 30.20, "en", "VoxEye remembers your goal, filters out street clutter, and guides you with simple clock directions."),
    ("c4",   30.80, 37.90, "en", "As you turn your body, your phone's compass and Google Maps keep every direction locked to the real world."),
    ("c5_a", 38.60, 45.80, "en", "In our live prototype: the left view sees a close obstacle in warm yellow; on the right, you hear fast center beeps."),
    ("c5_b", 46.40, 52.80, "en", "Step left. Pharmacy door at twelve o'clock, three steps ahead."),
    ("c6",   53.70, 59.75, "en", "Next, we'll test with blind users, fine-tune the sonar sounds, and launch as a default Android assistant."),
]


def write_pcm24k_wav(path: Path, pcm: bytes) -> float:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm)
    return len(pcm) / (24000 * 2)


def compute_signature(use_fal: bool) -> str:
    payload = {
        "provider": "fal" if use_fal else "gemini",
        "model": config.FAL_TTS_MODEL if use_fal else config.TTS_MODEL,
        "voice": config.FAL_TTS_VOICE if use_fal else config.VOICE,
        "cues": CUES,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


async def main() -> None:
    force = "--force" in sys.argv
    use_fal = _has_fal()
    sig = compute_signature(use_fal)

    out_piece = ROOT / "brag-output" / "piece" / "voice" / "voice.wav"
    meta_file = ROOT / "brag-output" / "piece" / "voice" / "voice.meta.json"

    if out_piece.exists() and not force:
        if meta_file.exists():
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            if meta.get("signature") == sig:
                print(f"Reusing existing cached voiceover: {out_piece} (provider={meta.get('provider')}, zero API calls)")
                return
        elif not use_fal:
            # Already generated v8 Gemini voice.wav on disk — record metadata and reuse without calling TTS API
            meta_file.write_text(json.dumps({"signature": sig, "provider": "gemini"}, indent=2), encoding="utf-8")
            print(f"Reusing existing cached voiceover: {out_piece} (zero API calls)")
            return

    from server.audio import fal, speak  # lazy import only when actually synthesizing

    provider_label = f"Fal.ai ElevenLabs v3 ({config.FAL_TTS_MODEL}, voice={config.FAL_TTS_VOICE})" if use_fal else f"Gemini Neural TTS ({config.TTS_MODEL})"
    print(f"Synthesizing voiceover once via: {provider_label}")

    tmp_dir = ROOT / "brag-output" / "work" / "vo_cues"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    inputs = []
    filter_parts = []
    mix_labels = []

    for idx, (cid, start_s, max_end_s, lang, text) in enumerate(CUES):
        raw_path = tmp_dir / f"{cid}_raw.wav"
        wav_path = tmp_dir / f"{cid}.wav"
        text_hash_file = tmp_dir / f"{cid}.hash"
        cue_sig = hashlib.sha256(f"{use_fal}:{lang}:{text}".encode("utf-8")).hexdigest()[:12]
        if raw_path.exists() and text_hash_file.exists() and text_hash_file.read_text().strip() == cue_sig:
            with wave.open(str(raw_path), "rb") as wf:
                raw_dur = wf.getnframes() / float(wf.getframerate())
        else:
            if use_fal:
                pcm = await fal.tts(text)
            else:
                voice = "Aoede" if lang == "el" else config.VOICE
                pcm = await speak.tts(text, voice=voice)
            raw_dur = write_pcm24k_wav(raw_path, pcm)
            text_hash_file.write_text(cue_sig)
        # Trim leading/trailing silence generated by ElevenLabs so cues land right on beat
        subprocess.run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(raw_path),
                "-af", "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-42dB:stop_periods=-1:stop_duration=0.08:stop_threshold=-42dB",
                str(wav_path),
            ],
            check=True,
        )
        with wave.open(str(wav_path), "rb") as wf:
            dur = wf.getnframes() / float(wf.getframerate())

        avail_dur = max_end_s - start_s
        if dur > avail_dur:
            # Gentle tempo adjustment (typically 1.02x - 1.12x) ONLY if needed so it never bleeds into the next scene
            ratio = min(1.18, (dur / avail_dur) * 1.02)
            fit_path = tmp_dir / f"{cid}_fit.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav_path), "-af", f"atempo={ratio:.3f}", str(fit_path)],
                check=True,
            )
            fit_path.replace(wav_path)
            with wave.open(str(wav_path), "rb") as wf:
                dur = wf.getnframes() / float(wf.getframerate())
            print(f"  [{cid}] start={start_s:5.2f}s  raw={raw_dur:4.2f}s -> fit={dur:4.2f}s (atempo={ratio:.2f}x)  end={start_s+dur:5.2f}s <= {max_end_s:5.2f}s ✓")
        else:
            print(f"  [{cid}] start={start_s:5.2f}s  raw={raw_dur:4.2f}s -> trim={dur:4.2f}s (1.00x)          end={start_s+dur:5.2f}s <= {max_end_s:5.2f}s ✓")

        inputs.extend(["-i", str(wav_path)])
        delay_ms = int(round(start_s * 1000))
        filter_parts.append(f"[{idx}:a]aresample=48000,adelay={delay_ms}|{delay_ms}[c{idx}]")
        mix_labels.append(f"[c{idx}]")

    out_piece.parent.mkdir(parents=True, exist_ok=True)
    filter_complex = ";".join(filter_parts) + f";{''.join(mix_labels)}amix=inputs={len(CUES)}:normalize=0,apad,atrim=0:60.0[out]"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", filter_complex, "-map", "[out]", "-ar", "48000", "-ac", "1", str(out_piece)],
        check=True,
    )
    meta_file.write_text(json.dumps({"signature": sig, "provider": "fal" if use_fal else "gemini"}, indent=2), encoding="utf-8")
    print(f"Saved shared master voiceover to {out_piece}")


if __name__ == "__main__":
    asyncio.run(main())
