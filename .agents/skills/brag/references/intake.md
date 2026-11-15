# Intake

Ask only what the invocation, flags, and source don't already answer. Use AskUserQuestion (at most 4 questions per call, each with at most 4 options; the user can always type "Other"). Put the recommended option first and mark it "(Recommended)". If the user said "just make it" or similar, use every default and list what you picked in one line.

Before asking, inspect the source (SKILL.md step 1) so the recommendations fit this project.

## Call 1: what are we making

1. **Type**: which kind of video? Offer the 3 types that fit best plus whatever the request hints at. See [video-types.md](video-types.md).
   - Launch promo · Feature walkthrough · Explainer · Release notes · Social teaser · Story / history
2. **Style: show them moving, then ask.** The picker is **prebuilt**: never render it, run `style-reel.mjs`, or read style files at intake. One call shows it:
   - **Open the published picker:** `Artifact` action `open` with the URL in `<skill-dir>/assets/style-previews/PICKER.md` (works on the phone; every clip moving, numbered, with what each is for).
   - If that's unavailable, SendUserFile `<skill-dir>/assets/style-previews/style-reel.mp4` (display: render): the same clips as one numbered grid video.
   - Only if the project has its own saved styles (`<project>/styles/*/preview.mp4`), add a small reel of just those: `node <skill-dir>/tools/style-reel.mjs <output-dir>/work/styles <project>/styles --only <their names>`.
   - **Then shortlist**: name the 3 best fits for this type and subject, by number and name, with one line each on why; then ask with AskUserQuestion (those 3, plus "another number from the reel" via Other, plus `custom` from references).
   - If the user wants a closer look at two or three, send their clips from `<skill-dir>/assets/style-previews/clips/<name>.mp4` (already rendered).
   - Styles: `product-native` (the product's own UI, recommended when there's a real product to show); motion styles `dark-keynote` · `glass-product` · `living-screencast` · `swiss-motion` · `caption-news` · `game-show` · `halftone-dossier` · `blueprint` · `whiteboard` · `telestrator` · `kinetic-reel` · `chart-room` · `manim-explainer` · `morph-ui`; drawn styles `cut-paper` · `crosshatch` · `riso` · `sketchbook` · `math` · `pixel` · `isometric`; any style the user made before (`<project>/styles/<name>/`); `custom` from references (Call 2, question 8).

   Hints: launches → product-native, dark-keynote, glass-product, kinetic-reel. Real numbers worth showing (usage, growth, benchmarks) → chart-room. How it works (an algorithm, a formula, a pipeline) → manim-explainer. Interaction and design-system stories → morph-ui. Walkthroughs and release notes → product-native, living-screencast, telestrator. Viral or social shorts (9:16) → caption-news, halftone-dossier, telestrator, game-show. Explainers → whiteboard, blueprint, crosshatch, isometric or math. Brand and design-led → swiss-motion, riso. Histories → cut-paper or pixel. Devices and infrastructure → blueprint, isometric.
   Every style can still show the real product: motion styles put real UI markup inside their look, drawn styles frame screenshots (engine `drawAsset`).
3. **Duration**: offer the type's default plus one shorter and one longer option (see the table in video-types.md).
4. **Format** (multi-select; the first one picked is the main format): 16:9 · 9:16 · 1:1 · 4:5. Recommend the type's default.

## Call 2: how it should feel

Up to five questions here, but a call takes four: when Focus (9) is needed too, ask it in a short third call.

5. **Tone**: offer 3 presets that fit (see [tones.md](tones.md)): default · polished · yc-parody · chaotic · deadpan · cinematic · app-store. Freeform direction ("a 2016 Series A launch") is welcome; map it to the nearest preset for pacing.
6. **Energy**: how much moves? Recommend the tone's default (motion.md table) and offer one step up and one down.
   - `calm`: slow reveals, fades, long holds
   - `lively`: every cut is a designed transition, text animates in, gentle drift
   - `punchy`: kinetic type, whips and zooms, emphasis on every key word
   - `hype`: constant motion, beat-synced hits, glitches and flashes
7. **Audio**:
   - Music + sound effects (bundled track or a composed score) (recommended for ≤ 30s)
   - Voice-over + music: you write the script, the voice comes from the ElevenLabs connector or the user's recording (recommended for walkthroughs and explainers)
   - My own track: ask for the file path and the start point
   - Silent / sound effects only
8. **References**: anything to match or include?
   - None (recommended unless they mentioned some)
   - A look to match: images, a video, or a URL. For a drawn style this becomes a **custom style** (`engine/new-style.md`). For product-native it becomes a **treatment**: palette, type scale, motion and cut rhythm measured from the reference and written into `brag-plan.md`.
   - Composition to borrow: a video whose structure and pacing to follow with this project's content. Measure its cuts (`engine/tools/measure/shotlog.py`) and map its beats onto the panels.
   - Assets to include: a logo, screenshots, a demo clip. Copy them into the piece's `assets/`.
9. **Focus** *(ask only when the project is big or the type is walkthrough/release)*: which feature, flow, or version? Offer what you found in the source.

## Confirm

Before planning, read back one line:

> **A 45s feature walkthrough of the export flow, product-native, 16:9, polished, lively, voice-over + music. References: none.**

Then continue. Don't ask again for anything already answered.

## Defaults when unanswered

Type: inferred (launch if unsure). Style: product-native if there's a product UI, otherwise crosshatch. Duration: the type's default. Format: the type's default. Tone: inferred (`default` if unsure). Energy: the tone's default. Audio: music + sfx. References: none.
