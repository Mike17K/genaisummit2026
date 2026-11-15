# Audio

Music, sound effects, and voice get written as one piece: effects in the same key and space as the music, sitting softly under it. Use a basic, proper mix: nothing harsh, and repeated small sounds stay in the background. Final loudness is −14 LUFS (phone and social playback).

## Drawn styles (engine)

The engine handles audio itself: a score composed in code (`src/score.js`), the user's own track (`piece.json` `"music"`, beat-mapped with `engine/tools/beats.mjs`), and a voice-over (`engine/tools/voice.mjs`). Follow `engine/ENGINE.md` → Voice-over / Music. The bundled tracks below also work as `"music"`: copy one into the piece's `audio/`.

## Product-native: `audio.json`

`tools/export-dom.mjs` reads `<composition>/audio.json` and mixes it with ffmpeg:

```json
{
  "music": { "file": "assets/track.mp3", "start": 0, "gain": 0, "fadeIn": 0.2, "fadeOut": 1.5 },
  "voice": { "file": "voice/voice.wav", "gain": 0, "musicUnderVoice": -10 },
  "sfx": [
    { "file": "<skill-dir>/assets/sfx/impact/impactSoft_medium_001.ogg", "t": 2.5, "gain": -8 },
    { "file": "<skill-dir>/assets/sfx/interface/click_003.ogg", "t": 6.1, "gain": -12 }
  ],
  "lufs": -14
}
```

Paths are relative to the composition or absolute. Every block is optional; with no `audio.json` the video is silent.
- `music.start`: where in the track the video begins (seconds). `gain` in dB.
- `voice.musicUnderVoice`: how far the music ducks while the voice speaks (dB, sidechain).
- `sfx[].t`: when the sound starts on the video's timeline. Put clicks on the cursor's press frame and impacts on hard cuts.

## Bundled music

`<skill-dir>/assets/music/`: five upbeat business/tech tracks ("Happy Beats / Business Moves", ende.app). Pre-analysed beat grids and strong cue times are in `assets/music/cues/<track>.music-cues.md`. Read one to put cuts on its beats and the payoff on a strong hit. For other tracks, `node <skill-dir>/engine/tools/beats.mjs <track> <dir> --dur <seconds>` writes a `beats.json` with tempo, beats, bars, hits, and the loudest moment.

| track | length | tempo |
|---|---|---|
| vol-1 | 2:44 | ~120 BPM |
| vol-9 | 1:54 | ~115 BPM |
| vol-10 | 1:00 | ~110 BPM |
| vol-11 | 1:28 | ~115 BPM |
| vol-12 | 1:58 | ~110 BPM |

They're all in the same upbeat family. You can't listen to them, so say which track you picked and offer to swap. For a deadpan or serious tone, consider a composed score, the user's own track, or no music instead.

## Bundled sound effects

`<skill-dir>/assets/sfx/` (Kenney, CC0): `ui/`, `interface/`, `keyboard/`, `impact/`, `casino/`. Read `assets/sfx/sfx-analysis.md` first: it rates each file's brightness and high-frequency risk. Prefer low-risk files for polished videos; keep bright ones for tiny accents.

## Voice-over

Ask at intake. With a voice, **the voice is the clock**: write one line per storyboard panel (the panel's `voiceover`), ≤ 3 words/s.
1. Script → `<composition>/voice/script.json` in the engine's format (`{ "lang", "lead", "tail", "lines": [{ "id", "text", "file", "after" }] }`, line ids = panel ids). `lang` is the script's language code (`en`, `el`, `ro`, `bg`; default `en`).
2. While building, `node <skill-dir>/engine/tools/voice.mjs <composition> --scratch` makes a timing voice with macOS `say` (never ship it).
3. Real takes, one file per line in `voice/`. Ask which, recommended first:
   - **OmniVoice** (local, free, no account; see below).
   - **The ElevenLabs connector** if the user has it (let them pick from 2–3 voices on one line; say the credit cost before generating everything).
   - **The user's own recording.**
4. `BRAG_PYTHON=~/.venvs/omnivoice/bin/python node <skill-dir>/engine/tools/voice.mjs <composition>` writes `voice/voice.wav` and `voice.json` (each line's and word's start/end). Re-time panels to the voice: a panel starts ~0.3s after the previous line ends. Then set `"voice": { "file": "voice/voice.wav" }` in `audio.json`.

Word timing uses faster-whisper (`BRAG_PYTHON` = a Python that has it; the OmniVoice venv does); without it, times are estimated. For a non-English script it uses the multilingual `small` model in the script's `lang`.

### OmniVoice takes

[k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice) (Apache-2.0): a local text-to-speech model, 600+ languages (Greek and Bulgarian well covered; Romanian thinly, so expect weaker takes), runs on Apple Silicon. About 5 s per line on an M3 Pro after a ~3 s model load.

**Setup, once** (ask before installing: ~1.6 GB of packages, then ~6 GB of OmniVoice weights and ~1 GB of Whisper `small` downloaded on first use):
```bash
python3 -m venv ~/.venvs/omnivoice
~/.venvs/omnivoice/bin/pip install torch torchaudio omnivoice faster-whisper "av<16"
```
`av<16`: faster-whisper 1.2 breaks on PyAV 16+ (`open() got an unexpected keyword argument 'metadata_errors'`).

**Make the takes:** `~/.venvs/omnivoice/bin/python <skill-dir>/engine/tools/omnivoice_takes.py <composition> <voice>` writes `voice/<id>.wav` for every line without a take and sets `file` on it. Pick the voice:
- `--ref voice/ref.wav --ref-text "what the clip says"`: **clone** a 3–10 s clip in the script's language. The best results, and the only steady voice for non-English scripts. Only a voice whose owner agreed (the user's own, a teammate who said yes); never one fetched from the web.
- `--instruct "female, middle-aged, moderate pitch, british accent"`: **design** a voice from attributes: `male`/`female`; `child`, `teenager`, `young adult`, `middle-aged`, `elderly`; `very low pitch` … `very high pitch`; `whisper`; an English accent (`american`, `british`, `australian`, `canadian`, `indian` …). Trained on English and Chinese only, so for Greek prefer `--ref`.
- Neither: the model picks a voice per line. Tests only.

Options: `--only open,close` re-takes those lines (others keep their files); `--force` redoes all; `--fit` makes a line last its `"dur"` (seconds, set on the line) — approximate, the trimmed take lands a few tenths short; `--seed` changes the delivery.

**You can't hear the takes.** Generate the first line in 2 candidate voices, send both to the user and let them pick before doing every line. Then check each take by ear through the user, and with faster-whisper: if it transcribes a word wrong, the user should listen to it. Brand names come out worst (in the tests Whisper heard "Skroutz" as "Scouts"): if the user says one is mispronounced, spell it the way it's said in that line's `text` (e.g. "Σκρουτζ") and re-take it with `--only`.
