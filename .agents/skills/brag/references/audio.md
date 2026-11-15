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
1. Script → `<composition>/voice/script.json` in the engine's format (`{ "lead", "tail", "lines": [{ "id", "text", "file", "after" }] }`, line ids = panel ids).
2. While building, `node <skill-dir>/engine/tools/voice.mjs <composition> --scratch` makes a timing voice with macOS `say` (never ship it).
3. Real takes: the ElevenLabs connector if the user has it (let them pick from 2–3 voices on one line; say the credit cost before generating everything), or the user's own recording, one file per line in `voice/`.
4. `voice.mjs` writes `voice/voice.wav` and `voice.json` (each line's and word's start/end). Re-time panels to the voice: a panel starts ~0.3s after the previous line ends. Then set `"voice": { "file": "voice/voice.wav" }` in `audio.json`.

Word timing uses faster-whisper if installed (`pip install faster-whisper`); without it, times are estimated.
