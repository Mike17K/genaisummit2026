# Motion styles

HTML + GSAP looks for brag. They render with the product-native pipeline (`runtime/timeline.js` + `gsap.js` + `motion.js`, exported by `tools/export-dom.mjs`), so they can show the real product UI and use every effect in `references/motion.md`. The drawn canvas styles (cut-paper, riso, …) live in `engine/styles/`.

Ten styles here are adapted from [lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) by LemoLab (MIT): the style briefs were rewritten for brag and the code is new. No demo films or CC BY assets from that repo are included.

Four more (2026-11-08), `kinetic-reel`, `chart-room`, `manim-explainer` and `morph-ui`, were written for brag after a survey of the prompt-motion.com gallery (`_prompt-motion-survey.md`). Only ideas were taken from it, with credits in each STYLE.md. No prompt text or media was copied. Their demos are 16:9.

## A style folder

```
motion-styles/<name>/
  STYLE.md       the brief: what it is, when to use it, palette (hex), type, layout grid, textures,
                 motion grammar (which fx effects + the style's own moves, tempo), transitions, do / don't
  style.css      everything visual, scoped under  #stage.ms-<name>  (tokens as CSS variables first)
  kit.js         BRAG.styles['<name>'] = { … }: the style's own components and moves, built on BRAG.tl / BRAG.fx
  assets/        fonts (OFL / free licences only, with their licence file), SVGs, textures; all local, < 3 MB
  demo/index.html  a 6 s, 1080×1920, 30 fps demo that shows the style moving (product: "Brag", see below)
  preview.mp4    the demo at 360×640, no audio, ~6 s: what the style picker shows
  sample.png     540×960 settled frame from the demo (the still gallery and the reel poster)
```

## Using one in a composition

```html
<link rel="stylesheet" href="styles/<name>/style.css">       <!-- copy the style folder into composition/styles/ -->
<div id="stage" class="ms-<name>"> … </div>
<script src="gsap.js"></script><script src="timeline.js"></script><script src="motion.js"></script>
<script src="styles/<name>/kit.js"></script>
<script>BRAG.build((tl, fx) => { const S = BRAG.styles['<name>']; … });</script>
```

## Rules for kits
- Deterministic: everything on `BRAG.tl` (or `BRAG.onFrame`), no timers, no CSS transitions, no `Date`. `Math.random` is seeded by timeline.js; prefer explicit hashes anyway.
- Kit functions take an absolute time `at` and return the time they finish, like `BRAG.fx`.
- Build DOM in `BRAG.build` (fonts are loaded by then). Don't depend on the network.
- Every frame of the demo must look like the style on its own (a paused frame is a poster).
