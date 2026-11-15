---
name: brag
description: Make a short, polished video about a project, product, website or idea, in code (no AI video generation). The user picks the video type (launch promo, feature walkthrough, explainer, release notes, social teaser, story), the style (product-native, i.e. the real UI animated, or a drawn style such as cut-paper, crosshatch, riso, sketchbook, math, pixel, isometric, or a custom look matched from references), the duration, format and tone. Then they review and edit a storyboard of real frames, with the on-screen script and a notes box per panel, before anything is animated. Use when someone says "/brag", "let's brag about this", "make a launch video / promo / demo video / walkthrough video / explainer video / teaser", "turn this into a video", or wants to show off what they built.
argument-hint: "[what to make] [--type launch|walkthrough|explainer|release|teaser|story] [--style <name>] [--duration <s>] [--format 16:9|9:16|1:1|4:5] [--tone <preset>] [--voice] [--refs <path|url>]"
---

# /brag

You built it. Now let's brag about it, in whatever shape the user wants, and with them steering at the storyboard.

Every video is code: an HTML page (product-native) or a canvas piece (drawn styles) where every frame is a pure function of time. A headless browser renders the frames and ffmpeg makes the MP4. There's no AI video generator involved.

**The one hard rule: no animating before the storyboard is approved.** The user approves real key frames, with the exact on-screen words, on a review page. Only then does the build start.

`<skill-dir>` is the directory containing this file (Claude Code prints it as "Base directory for this skill"; in Gemini/Antigravity or Cursor, resolve it relative to this `SKILL.md`, e.g. `.agents/skills/brag`). Don't guess it.

### Cross-Agent Tool Equivalents (Claude Code · Gemini/Antigravity · Cursor)

| Capability | Claude Code | Gemini / Antigravity | Cursor (Composer / Agent) |
|---|---|---|---|
| **Structured user questions** | `AskUserQuestion` | `ask_question` | `ask_question` or concise numbered plain-text prompt |
| **Open preview / review URL** | `preview_start` (`url`) or `open <url>` | `open <url>` (via `run_command`) | `open <url>` (via terminal command) or Simple Browser |
| **Deliver files / images to user** | `SendUserFile` | Markdown `[file](file:///abs/path)` links & Artifacts | Markdown file links (`[file](path)`) in chat response |

## Options

Flags or plain language. Anything not given is asked at intake or inferred.

| Option | Values | Default |
|---|---|---|
| `--type` | `launch` · `walkthrough` · `explainer` · `release` · `teaser` · `story` · freeform | asked |
| `--style` | `product-native` · `cut-paper` · `crosshatch` · `riso` · `sketchbook` · `math` · `pixel` · `isometric` · `custom` · a project style name | asked |
| `--duration` | seconds | the type's default ([video-types.md](references/video-types.md)) |
| `--format` | `16:9` · `9:16` · `1:1` · `4:5` (comma-separate for several) | the type's default |
| `--tone` | `default` · `polished` · `yc-parody` · `chaotic` · `deadpan` · `cinematic` · `app-store` · freeform | inferred |
| `--voice` | flag: narrated voice-over | off |
| `--music <file>` / `--no-music` / `--no-sfx` | audio choices | bundled music + sfx |
| `--refs <path or url>` | references: a look to match, a video to borrow structure from, assets | none |
| `--title` | string | inferred |
| `--no-storyboard` | skip the review (only if the user explicitly asks) | review on |
| `--quick` | ask nothing, use defaults, but still show the storyboard | off |

## Output

Write to `brag-output/` in the current directory, or `brag-output-YYYY-MM-DD-HHmmss/` if that already exists. Pick the name once at the start and use it for the whole run. Call it `<output-dir>`.

```
<output-dir>/
  brag-plan.md        the plan: angle, hook, beats, claims + sources
  storyboard/         storyboard.json (+ versions), panels/, feedback-v*.json, index.html
  composition/        product-native: index.html, timeline.js, assets/, audio.json
  piece/              drawn styles: piece.json, src/, index.html (engine)
  work/               scratch: gallery, frames, downloads
  brag.mp4  brag.jpg  share-copy.txt
```

## Requirements

Check first: `node -v` (18+), `ffmpeg -version`, and Playwright (`node -e "require('playwright')"`, or a global install). If Playwright is missing, offer to run `npm i -g playwright && npx playwright install chromium`. If ffmpeg is missing: `brew install ffmpeg`. A voice-over also wants `pip install faster-whisper` (optional; without it word timings are estimated).

---

## Step 1: Inspect the source

Work out what the video is about:
- **A project** (no URL, and the current directory is one): read the code, README, routes, key components, styles (exact colours and fonts), and the CHANGELOG/git log for release notes.
- **A website** (a URL or bare domain): load it in a headless browser, dismiss overlays, scroll section by section, and collect copy, colours, fonts, logo, screenshots, and demo videos into `<output-dir>/work/`.
- **A topic** (an idea to explain, a history): note what must be true and plan to web-check every claim.
- If the user points at one part (a feature, a version, a flow), that's the focus.

Then answer for yourself: What is it, in one sentence? Who is it for, and what does it do for them? What sets it apart? What's the most impressive (or funniest) true claim? What's the visual hook? Which real UI or flow should be shown? What tone fits? What would the share caption be?

## Step 2: Intake

**Read:** [references/intake.md](references/intake.md), [references/video-types.md](references/video-types.md)

Ask what isn't known (type, style, duration, format; then tone, audio, references, focus) with `AskUserQuestion` (Claude Code), `ask_question` (Gemini/Antigravity), or an interactive multi-choice prompt (Cursor), showing the style gallery image first (`SendUserFile` in Claude Code, or clickable `file://` image link / artifact in Gemini/Antigravity and Cursor). Read back the one-line spec. With `--quick` or "just make it", skip the questions and state the defaults you picked.

## Step 3: Plan

**Read:** [references/tones.md](references/tones.md) for the tone. For drawn styles, also read `engine/grammar/FORMATS.md`, `engine/grammar/STORY.md`, and `engine/craft.md`.

Write `<output-dir>/brag-plan.md`:
- The spec line (type · style · duration · format · tone · audio · references).
- The angle in one sentence, and the hook. Plan the hook before anything else.
- The beats, following the type's shape in video-types.md. Each beat: time range, what's on screen (the exact words), what moves, the sound, and the transition into the next. Durations sum to the target.
- For drawn styles: the engine format (F1–F8) and why, the hero, the bridges.
- For references: what was measured (palette, type, motion, cut rhythm) and how it's applied.
- Claims shown on screen, each with its source (web-check facts, and never claim "first" without a source).

Then write `<output-dir>/storyboard/storyboard.json` (version 1) from the beats, following the schema in [references/storyboard.md](references/storyboard.md). One panel per beat; `onscreen` holds the exact visible words.

**Optional beats check:** for pieces over ~40s, or when the angle is a gamble, run one quick text-only review (`"kind": "beats"`, no images) before drawing. Skip it for short pieces.

## Step 4: Look (custom references only)

When the style is `custom` (references to match):
- **Drawn:** follow `engine/new-style.md`. Measure the references, draw 2–4 matched frames, and make compare sheets with `engine/tools/compare.mjs`. Review them as a `"kind": "look"` round on the review page (storyboard.md → Other kinds). Save the style to `<project>/styles/<name>/` after the video is approved.
- **Product-native treatment:** measure palette, type scale, motion, and cut rhythm from the reference, and apply them to the product's real UI. The first storyboard round doubles as the look check.

Skip this step for shipped styles. The storyboard shows the look.

## Step 5: Storyboard review (the gate)

**Read:** [references/storyboard.md](references/storyboard.md) and, by style:
- product-native → [references/product-native.md](references/product-native.md)
- drawn styles → `engine/ENGINE.md` (steps 2–3 for setting up the piece from the style's demo; the style's `STYLE.md`; `engine/grammar/FRAME.md`)

1. **Make the key frames real.** Build the composition or piece far enough that every panel's settled frame renders from real code: real UI and copy (product-native), or the style's kit (drawn). Motion can wait.
   - Product-native: `composition/index.html` + a copy of `<skill-dir>/runtime/timeline.js`.
   - Drawn: `piece/` started from `engine/styles/<style>/demo/` (or `engine/templates/`), built with `node <skill-dir>/engine/tools/build.mjs <output-dir>/piece`.
2. **Render the panels:** `node <skill-dir>/tools/panels.mjs <composition-or-piece> <output-dir>/storyboard/storyboard.json`.
3. **Check them yourself** (look at the images) and fix what's broken before the user sees it.
4. **Open the review page:** start `node <skill-dir>/tools/review-server.mjs <output-dir>/storyboard` **in the background**, open the printed URL in the browser pane (`preview_start` with `url` in Claude Code, or `open <url>` via shell command in Gemini/Antigravity and Cursor), and tell the user briefly how to use it. **Stop and wait.**
5. When the server exits, read `feedback-v<N>.json` (or the user's chat reply). If it's `approve`, go on to step 6. Otherwise apply it exactly as storyboard.md says: kept panels are locked, edited words are used verbatim, cuts and durations re-time the piece. Write v<N+1>, re-render only the changed panels (`--only`), and go back to 4.

## Step 6: Build

Animate exactly what was approved: same scenes, same words, same order and timing.

- **Product-native:** add the motion described in each panel (see product-native.md → Make it alive). Write `composition/audio.json` ([references/audio.md](references/audio.md)). Preview stills at mid-transition points with `panels.mjs` on a scratch storyboard, or open `index.html` and scrub.
- **Drawn styles:** `engine/ENGINE.md` step 4: animate scenes, bridges, and score; `tile.mjs` across every cut and morph; `export.mjs`; `review.mjs` until it passes.
- **Long pieces (≥ 45s):** split scenes across parallel agents as ENGINE.md → Parallel agents describes (works for product-native too: one scene file per agent, you own the shared head and the timeline).
- **Voice-over:** audio.md → Voice-over. Re-time panels to the voice.

**Verify against the board:** re-render the panels from the finished build (`panels.mjs` into a scratch copy of the approved storyboard) and compare them with the approved images. A panel that drifted (different words, layout, or order) gets fixed. Also check mid-transition frames for overflow, collisions, low contrast, and muddy crossfades.

## Step 7: Render and deliver

- Product-native: `node <skill-dir>/tools/export-dom.mjs <output-dir>/composition --out <output-dir>/brag.mp4 --poster <t>`
- Drawn: `node <skill-dir>/engine/tools/export.mjs <output-dir>/piece --share` (add `--formats …` for several shapes), then copy `piece/renders/share.mp4` to `<output-dir>/brag.mp4`. Pick the poster with `engine/tools/still.mjs` into `brag.jpg`.
- **Poster:** the strongest *settled* frame (all text in, not mid-transition) becomes `brag.jpg` and is baked in as frame 0.
- **`share-copy.txt`:** 1–3 sentences, postable as-is, specific, matching the tone. No "excited to share".
- **Tell the user:** where the video is (send it with `SendUserFile` in Claude Code, or provide clickable `[brag.mp4](file:///.../brag.mp4)` / `[brag.jpg](file:///.../brag.jpg)` file links and artifacts in Gemini/Antigravity and Cursor), the angle in one sentence, what the checks caught, the weakest moment, and what you couldn't verify (you can't hear the audio). Offer changes **by panel number**: they go back through the storyboard loop as a new version, and only the affected scenes are rebuilt.

## Creative laws (every type, every style)

- **Clear to a stranger.** After one viewing, someone new knows what it is, who it's for, and how to get it.
- **The hook is everything.** The first 2 seconds decide whether anyone keeps watching.
- **Show the thing.** Use the real product, real copy, and real flows. Invented claims, numbers, testimonials, or fake UI presented as real are not allowed.
- **Specific.** It must feel made for this exact project. Generic SaaS language ("streamline your workflow") is banned.
- **Readable.** Pace comes from motion and cuts, not from pulling text early. Every line the viewer must read stays settled for ≥ 0.3s per word.
- **One constant.** A colour means one thing; a hero, a token, or the product's own shape carries through.
- **Every frame postable.** Any frozen frame should be worth sharing.
- **Funny earns its place.** Humour comes from the project's own absurdity.
- **Deterministic.** Seeded randomness only; no clocks, no `Math.random()`. Frames must render the same every time.

## Files

| path | what |
|---|---|
| [references/video-types.md](references/video-types.md) | the six types: shapes, lengths, formats, styles |
| [references/intake.md](references/intake.md) | intake questions and defaults |
| [references/storyboard.md](references/storyboard.md) | storyboard.json schema and the review loop |
| [references/product-native.md](references/product-native.md) | the product-native renderer and its rules |
| [references/audio.md](references/audio.md) | audio.json, bundled music/sfx, voice-over |
| [references/tones.md](references/tones.md) | the seven tones |
| `runtime/timeline.js` | makes an HTML composition seekable (copy into `composition/`) |
| `tools/panels.mjs` | renders storyboard panels from either renderer |
| `tools/review-server.mjs` + `tools/review.html` | the review page; writes feedback and exits |
| `tools/export-dom.mjs` | product-native → MP4 with mixed audio and baked poster |
| `engine/` | the drawn-style engine (from cth9191/animate, MIT): `ENGINE.md`, `styles/`, `kit/`, `tools/`, `grammar/`, `craft.md`, `new-style.md` |
| `assets/music/`, `assets/sfx/` | bundled tracks (with beat cues) and Kenney CC0 sound effects |

Credits: the brag workflow comes from [latent-spaces/brag](https://github.com/latent-spaces/brag) (MIT, `assets/LICENSE-brag`); the drawn-style engine from [cth9191/animate](https://github.com/cth9191/animate) (MIT, `engine/LICENSE`).
