# Kinetic Reel

Giant condensed type that lands with weight, on flat colour fields that cut on the beat. One word (or one number) per beat; the screen is the word. A showreel energy for launches, with a paper / ink / hot palette.

## When to use
- Launch teasers, release-notes openers, social cut-downs and "what's new" reels where the copy is short punchy words: 8 to 20 s, music-driven.
- Hook, stat and sign-off scenes of a longer film. Pair it with a quiet product scene (see below) rather than running 60 s of slams.
- Not for explanations that need sentences, charts or small print, and not for calm or premium tones: it is loud on purpose.

## Energy
`punchy` by default; `hype` when every cut sits on a 120 BPM beat (0.5 s) and impacts get `fx.shake`. Not `calm`.

## Palette
| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F1EEE6` | light field, also type on ink |
| `--ink` | `#101010` | dark field, also type on paper |
| `--hot` | `#FF4A1C` | the third field and the one accent word / number / scribble per scene |
| `--mute` | `#8C877B` | tiny notes only |

Fields are flat: no gradients, shadows (except the hard offset block under a product frame), glow or grain. Swap `--hot` for one other saturated colour (acid `#C8FF2E`, cobalt `#2B3BFF`) per film, never two.

## Type
Anton (OFL, `assets/anton.ttf`) uppercase for every big word; Archivo (variable, OFL, `assets/archivo.ttf`) for notes, tags and product UI copy. Words are **fitted to the frame** with `S.fit(el, width)`: a short word fills 1500 to 1700 px, a long one is allowed to be smaller but never below 160 px. Notes: 22 px, weight 700, uppercase, wide stretch, 0.08 em tracking.

## Layout
- 16:9 (1920x1080): the word is centred on the frame or on a half; 96 px margins. Notes sit in the corners (index top right, product name top left).
- Two-word scenes stack: the short word above, the long one below, both fitted to different widths for contrast.
- Split scenes: a numeral (700+ px) on the left, a three-line stack on the right.
- 9:16: same grammar, fit width 920 px and break phrases into one word per card.

## Textures
None. Flat colour is the texture. Rows of marquee type (outlined and filled words alternating) are the only "pattern", and they are type, not decoration.

## Motion grammar
- **Cuts:** `cut` on the beat is the default transition. One `push-up` or `wipe` per film for contrast. No fades, blurs, zooms.
- **Kit moves** (`BRAG.styles['kinetic-reel']`, all `(el, at, opts) -> end time`):
  - `fit(el, width)` sets the font-size so the word is that wide (call in `BRAG.build`).
  - `slam(el, at, {from})` the signature: the word falls or slides in stretched, lands squashed and settles with a short elastic. `from`: `top`, `bottom`, `left`, `right`.
  - `stack(lines, at)` lines of a multi-line block rise out of their own masks, 0.1 s apart.
  - `marquee(row, at, end, {dir, offset})` repeated words scroll for the whole scene; alternate directions per row.
  - `scribble(path, at)` a thick hand stroke draws under a word (DrawSVG).
  - `block(el, at, {from})` a flat colour block or product frame wipes in.
  - `hold(el, start, end)` a 1.0 to 1.04 push so the word is never frozen; `hit(el, at)` a 2-frame flash of the hot colour.
- **Tempo:** a new idea every 0.5 to 1.5 s. The three-word hook is three colours in 1.5 s.
- **Emphasis:** the hot colour on one word, `fx.shake` on the final slam, `fx.count` for the one number.

## Showing a real product UI
Real product UI appears only inside a hard-edged `.kr-frame` (6 px ink border, 18 px offset block) on a calm scene, with big type beside it. Inside the frame the UI moves only with the product's own animations: replay its real durations and easings with `fx.ui` / `fx.uiAnim`, or let state changes happen instantly if the app has none (the demo flips one badge instantly). The style's own effects (slam, stack, block wipe, hold, tag) go on the layer around the frame: the headline, the frame's entrance as a whole, the corner tag. Never slam, squash, shake or marquee anything inside the UI.

## Do / don't
- Do keep one idea per card and let a colour cut be the transition.
- Do fit words to the frame; scale contrast is the whole look.
- Don't use more than three fields in a row without a product or number scene to breathe.
- Don't use lowercase, drop shadows, emoji, gradients or a second accent colour.
- Don't put product UI in a marquee or slam it.

## Inspired by (described, not copied)
prompt-motion.com entries, read for the grammar of "bold type plus hard colour switches plus a new idea every beat": Paper-style product launch film by @ik_builds (condensed display type, hard light/dark switches, an idea every 1.5 to 2 s); the showreel family (Claude motion designer showreel by @stephanlivera, Bold kinetic type showreel by @shneural, Abstract motion design reel by @ajith_io, Motion design showreel by @samuel_spitz, Claude motion reel by @codeSTACKr); Lightspark social promo by @davidmarcus (punchy social length). All code, copy and layout here are original; no prompt text or assets were taken.
