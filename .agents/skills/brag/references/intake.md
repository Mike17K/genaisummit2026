# Intake

Ask only what the invocation, flags, and source don't already answer. Use `AskUserQuestion` (Claude Code), `ask_question` (Gemini/Antigravity), or a concise multi-choice prompt (Cursor) — at most 4 questions per call, each with at most 4 options; the user can always type "Other". Put the recommended option first and mark it "(Recommended)". If the user said "just make it" or similar, use every default and list what you picked in one line.

Before asking, inspect the source (SKILL.md step 1) so the recommendations fit this project.

## Call 1: what are we making

1. **Type**: which kind of video? Offer the 3 types that fit best plus whatever the request hints at. See [video-types.md](video-types.md).
   - Launch promo · Feature walkthrough · Explainer · Release notes · Social teaser · Story / history
2. **Style**: build and show the gallery first:
   ```bash
   node <skill-dir>/engine/tools/gallery.mjs <output-dir>/work/styles.png [<project>/styles]
   ```
   Show the image with `SendUserFile` (display: render) in Claude Code, or a clickable `file://` image link / artifact in Gemini/Antigravity and Cursor. Then ask, offering the 3 best fits for this type and subject:
   - `product-native`: the product's own UI, fonts, and colours, animated (recommended when there's a real product to show)
   - `cut-paper` · `crosshatch` · `riso` · `sketchbook` · `math` · `pixel` · `isometric`
   - Any style the user made before (`<project>/styles/<name>/`)
   - `custom`: matched to the user's references (see Call 2, question 7)

   Hints: walkthroughs and release notes → product-native. Explainers → crosshatch, isometric, or math. Histories → cut-paper or pixel. Softer, editorial feel → riso or sketchbook. Devices and infrastructure → isometric.
   Drawn styles can still show the real product: screenshots get framed in the style (engine `drawAsset`).
3. **Duration**: offer the type's default plus one shorter and one longer option (see the table in video-types.md).
4. **Format** (multi-select; the first one picked is the main format): 16:9 · 9:16 · 1:1 · 4:5. Recommend the type's default.

## Call 2: how it should feel

5. **Tone**: offer 3 presets that fit (see [tones.md](tones.md)): default · polished · yc-parody · chaotic · deadpan · cinematic · app-store. Freeform direction ("a 2016 Series A launch") is welcome; map it to the nearest preset for pacing.
6. **Audio**:
   - Music + sound effects (bundled track or a composed score) (recommended for ≤ 30s)
   - Voice-over + music: you write the script, the voice comes from the ElevenLabs connector or the user's recording (recommended for walkthroughs and explainers)
   - My own track: ask for the file path and the start point
   - Silent / sound effects only
7. **References**: anything to match or include?
   - None (recommended unless they mentioned some)
   - A look to match: images, a video, or a URL. For a drawn style this becomes a **custom style** (`engine/new-style.md`). For product-native it becomes a **treatment**: palette, type scale, motion and cut rhythm measured from the reference and written into `brag-plan.md`.
   - Composition to borrow: a video whose structure and pacing to follow with this project's content. Measure its cuts (`engine/tools/measure/shotlog.py`) and map its beats onto the panels.
   - Assets to include: a logo, screenshots, a demo clip. Copy them into the piece's `assets/`.
8. **Focus** *(ask only when the project is big or the type is walkthrough/release)*: which feature, flow, or version? Offer what you found in the source.

## Confirm

Before planning, read back one line:

> **A 45s feature walkthrough of the export flow, product-native, 16:9, polished, voice-over + music. References: none.**

Then continue. Don't ask again for anything already answered.

## Defaults when unanswered

Type: inferred (launch if unsure). Style: product-native if there's a product UI, otherwise crosshatch. Duration: the type's default. Format: the type's default. Tone: inferred (`default` if unsure). Audio: music + sfx. References: none.
