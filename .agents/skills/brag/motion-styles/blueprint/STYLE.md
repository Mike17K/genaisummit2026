# Blueprint

Engineering-drawing motion style: white technical line work draws itself onto Prussian-blue cyanotype paper, dimension lines count their measurements, parts explode and re-assemble, a revision cloud and a rubber stamp deliver the verdict.

## When to use
- **Best for:** feature walkthrough, explainer, release notes, launch for anything with parts, steps, limits or numbers (hardware, infra, dev tools, logistics, "how it fits together").
- **Works for:** story (a design being drafted), teaser (one drawing building up). **Weak for:** warm consumer lifestyle promos, anything that needs photography to carry it.
- **Energy:** `lively` is the home register (drawing on is calm by nature); `punchy` works if every scene ends on a hard beat (stamp slam, cut-plane wipe). Avoid `hype`: a drawing that shakes stops being a drawing.
- **Length:** 15 s and up; a single figure needs 2 s to draw and 1.5 s to read.

## Look
- **Sheet:** one sheet of cyanotype paper. Radial blue (`#2a58a6` to `#18336b` to `#0f2350`), a 36 px fine grid and a 216 px major grid in white at 7 % / 16 %. A double-rule border at 36 px, centring ticks, and a **title block** along the bottom (title, dwg no, sheet, units, rev, status). The frame stays put while figures slide or wipe underneath, so the whole film feels like one sheet.
- **Ink:** `#e7f0f9` only, varying in weight, never hue: outline 3.4 px, detail 2.2, thin 1.4, hair 1.0. Centre lines are long-short dashes, hidden lines short dashes, assembly guides sparse dashes.
- **The one non-blue colour:** stamp red `#ff5a47`, used once per film for the verdict (APPROVED, VOID, REJECTED). Do not add a second colour.
- **Fonts:** Architects Daughter (hand lettering: headlines, labels, notes), Share Tech Mono (dimension values, figure captions, title-block fields). Both OFL, in `assets/`.
- **Type scale (1080 wide):** headline 92-104 px hand, hero word up to 230 px, notes 42-56 px, figure caption 24 px mono with tracking, dimension values 28-34 px mono.

## Layout
- **9:16 (1080x1920):** border 36 px, title block 168 px at the bottom, so the working area is y 70-1710. Figure caption at the top left (y 96), headline from y 140, drawing in the middle band (y 600-1560), notes beside or under it. One figure per scene. Dimension lines sit 60-100 px outside the part. Keep balloons in the outer 150 px.
- **16:9 (1920x1080):** title block becomes a right-hand column (280 px) or stays a 130 px strip; headline top left, figure right of centre, notes column left. Dimension lines horizontal first.
- **Rhythm:** headline lettered while the figure begins to draw; the drawing finishes just as the headline is readable; dimensions and balloons come last, one per beat.

## Motion grammar
- **Drafting order (always):** centre lines, outlines, detail, hatching, dimensions, balloons, labels. Everything is drawn, nothing fades in as a block.
- **Kit moves** (`BRAG.styles.blueprint`):
  - `draw(els, at, {speed, parallel, span, nib})`: DrawSVG with a glowing nib at the pen point; sequential by default, `parallel` + `span` for hatching.
  - `dashed(line, at, dur)`: centre / hidden lines revealed by a growing clip (DrawSVG would erase the dash pattern).
  - `dimension(svg, {x1,y1,x2,y2,off,count|label,suffix}, at)`: extension lines, a line that grows from its middle, arrowheads that pop, a value that counts up. Use a real number from the product.
  - `balloon(svg, {x,y,tx,ty,n}, at)`: leader line, dot on the feature, numbered circle.
  - `explode(parts, at, {out, hold, back})`: parts leave along vectors with dashed assembly guides; `back` re-assembles.
  - `cloud(svg, rect, at)`: scalloped revision cloud draws around a changed area, delta tag pops. Mark "what's new" with it.
  - `stamp(el, at)`: slams from 1.9x with rotation and an impact shake. `letter(el, at)`: handwriting wipe with a nib. `sectionSweep(at)`: A-A cutting-plane line riding a wipe. `cycle(el, times)`: title-block fields that change per scene. `hatch(...)`, `scenes(...)` helpers.
- **Transitions (named, never a dissolve):** `push-left` (pan across to the next figure, 0.5 s), `wipe` + `sectionSweep` (cutting plane; use for "inside vs outside" or before/after), `bars` (rare), hard `cut` on a beat. The title block's SHEET field changes with each.
- **fx menu that fits:** `fx.drift` (slow push-in, 1.04-1.06), `fx.float` for steam / loose parts, `fx.pulse` on one dimension label, `fx.shake` only on a stamp. Skip slam, glitch, flash, flip, scramble.
- **Tempo:** a figure draws in 1.0-1.5 s, holds 1 s with drift and a scan or a counting dimension, then pans. Nothing sits still: nib travelling, numbers counting, hatch filling, scan line sweeping.

## Do
- Show the product as the *designed thing*: a drawn front elevation, an exploded view, a section. Real numbers go in dimension lines (counts, days, sizes).
- Keep one idea per sheet; let the title block tell the story (REV A to B, FOR REVIEW to APPROVED).
- Letter headlines on, left to right, with the nib.

## Don't
- No glow-HUD / hologram look, no 3D rendering, no gradients inside the drawing, no emoji or icon fonts.
- No second colour besides the single stamp. No drop shadows on parts except the nib glow.
- Don't fade text in as blocks; don't crossfade scenes.

## Showing a real product UI
Print the screen as a **figure**: place the screenshot or live DOM in a `.bp-shot` frame (thin white border). The class turns images into a duotone (grayscale, `mix-blend-mode: screen` on the blue paper) so it reads as a blue-print of the screen. Then annotate it the way a drawing is annotated: dimension lines for sizes or counts, numbered balloons with leader lines pointing at controls, a revision cloud around the new feature, hatch over the area that is out of scope. Draw the frame edge first (`draw`), then fade the screenshot up behind the drawn edge, then add callouts. Exploding the UI into layers (header, list, card, button) with `explode` is the signature "how it is built" shot.

Adapted from lemo-opuscar `blueprint` by LemoLab (MIT). Rewritten for brag.
