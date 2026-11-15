# /brag: videos in code, with a storyboard you approve first

A Claude Code skill that turns a project, website, or idea into a short video, made entirely in code (HTML/canvas frames rendered by a headless browser and stitched with ffmpeg). It doesn't use an AI video generator.

You choose:
- **Type:** launch promo, feature walkthrough, explainer, release notes, social teaser, or story/history
- **Style**, picked from a reel of every style moving: `product-native` (your real UI, animated), one of fourteen motion styles (dark-keynote, glass-product, living-screencast, swiss-motion, kinetic-reel, chart-room, manim-explainer, morph-ui, caption-news, game-show, halftone-dossier, blueprint, whiteboard, telestrator), or a drawn style: cut-paper, crosshatch, riso, sketchbook, math, pixel, isometric, or `custom` (matched from your references)
- **Duration, format** (16:9, 9:16, 1:1, 4:5), **tone**, and **audio** (bundled music + sfx, your own track, or a voice-over)

Before anything is animated, Claude opens a **storyboard review page**. Each panel is a real frame of the video, with its on-screen script (which you can edit directly), Keep / Change / Cut buttons, a duration field, and a notes box. It revises until you approve, then builds.

## Install

1. Unzip into your Claude Code skills folder so you get `~/.claude/skills/brag/SKILL.md`:
   ```bash
   unzip brag-skill.zip -d ~/.claude/skills/
   ```
2. Install the requirements:
   ```bash
   npm i -g playwright && npx playwright install chromium
   brew install ffmpeg          # or your platform's package manager
   pip install faster-whisper   # optional: word timing for voice-overs
   ```
   If Playwright's Chromium download fails, the tools fall back to an installed Google Chrome or Edge.
3. If you have the original `brag` plugin installed, disable it so `/brag` resolves to this skill:
   ```bash
   claude plugin disable brag@brag
   ```

## Use

In the project you want to show off:

```
/brag
/brag a 45s walkthrough of the export flow --style product-native --voice
/brag --type explainer --style crosshatch --duration 60 --format 9:16
/brag https://example.com --type teaser
```

Output goes to `brag-output/` in the current directory.

## What's inside

| path | what |
|---|---|
| `SKILL.md` | the workflow Claude follows |
| `references/` | video types, intake, storyboard loop, product-native rules, audio, tones |
| `tools/` | panel renderer, review page + server, product-native exporter |
| `runtime/timeline.js` | makes an HTML composition seekable frame by frame |
| `runtime/gsap.js`, `runtime/motion.js` | GSAP + plugins, and `BRAG.fx`: text effects, emphasis, ambient motion and transitions (see `references/motion.md`) |
| `motion-styles/` | fourteen HTML + GSAP styles (kinetic-reel, chart-room, manim-explainer, morph-ui, dark-keynote, glass-product, living-screencast, swiss-motion, caption-news, game-show, halftone-dossier, blueprint, whiteboard, telestrator) |
| `styles.json`, `tools/style-reel.mjs` | the style picker: every style's moving preview in one numbered reel |
| `engine/` | the drawn-style engine (styles, kit, build/export/review tools) |
| `assets/` | bundled music tracks (with beat cues) and sound effects |

## Credits and licences

- Workflow, tones, and bundled audio from [latent-spaces/brag](https://github.com/latent-spaces/brag) by Shunit Haviv Hakimi, MIT (`assets/LICENSE-brag`).
- Drawn-style engine from [cth9191/animate](https://github.com/cth9191/animate), MIT (`engine/LICENSE`; the vendored commit is in `engine/UPSTREAM`). Minor changes: a product-native gallery tile and a Chrome fallback for browser launch.
- [GSAP](https://gsap.com) 3.13 with SplitText, CustomEase, CustomWiggle, DrawSVG, MorphSVG and MotionPath, under GreenSock's standard no-charge licence (`runtime/gsap.js`).
- Motion styles adapted from [lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) by LemoLab, MIT: the style briefs were rewritten and the code is new; none of its demo films or CC BY assets are included.
- Sound effects: [Kenney](https://kenney.nl/), CC0.
- Music: "Happy Beats / Business Moves" series from [ende.app](https://ende.app/en), bundled by the brag project. Check ende.app's licence terms before publishing videos commercially or redistributing the tracks.
