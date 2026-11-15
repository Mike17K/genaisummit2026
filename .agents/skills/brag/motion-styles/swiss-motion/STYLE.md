# Swiss Motion

International Typographic Style in motion: a modular grid, one grotesk, paper / ink / grey and a single signal colour. Type lays itself out on the grid; everything snaps, nothing bounces.

## When to use
- Launch and release videos for tools with a rigorous, design-literate audience (identity, dev tools, finance, studios); explainers where structure is the message ("five rules", "three steps").
- Walkthroughs work if the UI is shown as a flat artifact on a paper card, not a glossy device.
- Not for playful, warm or emotional stories, and not for anything that needs depth, glow or gradients.

## Energy
`lively` by default (push, wipe, rise, stepped bars). Can go `punchy` by cutting every 0.5 s on a 120 BPM grid. Never `calm` fades or `hype` glitch: the style is exact, not soft or noisy.

## Palette
| Token | Hex | Use |
|---|---|---|
| `--page` | `#EAE9E5` | the ground |
| `--paper` | `#FFFFFF` | cards that carry a product artifact |
| `--ink` | `#111111` | all type, rules, bars |
| `--grey1/2/3` | `#D9D8D3` `#B9B8B2` `#8A8983` | grid lines, tracks, small notes |
| `--signal` | `#E30613` | **one thing per scene**: the protagonist. Swap for orange `#FF5A00` or ultramarine `#1F3FFF` per topic, never two. |

No gradients, shadows, glow or grain. Black type on the signal colour is allowed (overprint).

## Type
Archivo (variable, OFL, `assets/archivo.ttf`), one family only. Headlines weight 800-900, letter-spacing about -4 %, flush left, ragged right, may be lowercase. Notes: 22 px uppercase, weight 600, wide stretch (110 %), grey with the key word in ink. Giant numerals (600+ px, weight 900) are optically flush left (offset by the side bearing, about -24 px).

## Layout
- **9:16 (1080x1920):** 6 columns of 136 px, 24 px gutters, 72 px margins, 24 px baseline. Column guides drawn as 2 px grey lines. Header notes at y 72 (columns 1 and 4), a 6 px ink rule at y 216, folio ("02 / 04") at y 1760. Headline blocks sit low or at column starts; the empty space above or below is part of the layout.
- **16:9 (1920x1080):** 12 columns, 96 px margins, 24 px gutters. Use it as a spread: the left page carries numeral, headline and notes; the right page carries the artifact (a list, a card, a bar field).
- Bars and numerals get mass from the module size; avoid many thin columns that read as a chart.

## Motion grammar
- **Text in:** `fx.text(el, 'rise', at)` (words out of line masks) is the voice of the style; `lines` for captions. `chars`, `pop`, `slam`, `flip` are off-style.
- **Kit moves** (`BRAG.styles['swiss-motion']`, all `(el, at, opts) -> end time`):
  - `grid(scope, at)` draws the column guides of a scene top-down.
  - `snap(el, at, {from, dist, stagger, fade})` locks an element onto its grid position, expo ease, no overshoot.
  - `bar(el, at, {steps})` / `column(...)` grow a rule or bar in whole modules (`steps()` easing): the style's signature.
  - `ticker(el, to, at, {steps})` a numeral that counts in whole steps like a mechanical counter.
  - `offGrid(el, at, {dx, dy, rot})` the one exception: the signal element slips a few px and degrees off the grid after it locked in.
  - `sweep(el, at)` a ruler hairline crossing the page.
  - `scenes(fx, list)` wrapper around `fx.scenes` (see Notes).
- **Transitions:** `wipe`, `push-up/left`, `cut` on the beat. Occasionally `bars` in ink. No blur, zoom, glitch, flash or flip.
- **Tempo:** starts on a 0.25 s grid (120 BPM half beats); moves 0.4-0.6 s; hold at least 0.3 s per word. During holds use `fx.drift` at 1.02-1.04 only.
- **Emphasis:** one signal element per scene; `fx.pulse` at most 1.08. Underlines and highlights are off; use a rule instead.

## Showing a real product UI
Flatten it. Put the screenshot or a rebuilt UI on a white `.paper` block that sits on a column edge, no radius or shadow, with a 6 px ink rule over it and an uppercase caption beside it. Zoom by cropping to whole modules (clip-path with `steps()`), never by smooth push-ins. Mark the one thing that matters with the signal colour (a bar, a number, a single outline).

## Do / don't
- Do snap every edge to a column or baseline; make scale contrast extreme (760 px numeral next to a 22 px note).
- Do let the single signal colour be the only inexact element.
- Don't use bounce, springs, elastic, rotation spins, drop shadows, emoji, or a second accent colour.
- Don't centre type. Don't place text over photos.

## Notes
`S.scenes(fx, list)` is a thin alias of `fx.scenes`. Demo: `demo/index.html` (6 s, 1080x1920).

Adapted from lemo-opuscar `swiss-motion` by LemoLab (MIT). Rewritten for brag.
