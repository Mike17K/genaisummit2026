# Whiteboard

Whiteboard-explainer motion style: marker strokes draw themselves on a glossy dry-erase board while a floating marker (no hand) follows each stroke tip, headlines are hand-written, ideas are doodles, and one accent colour marks what matters.

## When to use
- **Best for:** explainer, feature walkthrough ("here is how it works"), story told as a sequence of simple pictures, release notes with 2-4 ideas.
- **Works for:** launch (friendly, founder-voice), teaser with one doodle. **Weak for:** premium / luxury, dense data, anything that must show a polished UI first.
- **Energy:** `lively` is home (drawing is continuous motion). `calm` suits long explainers. `punchy` works if scenes are short and every one ends on a whip. Keep `hype` away.
- **Length:** 15-60 s. A doodle takes 0.6-1.2 s to draw; a headline 1-1.5 s to write. Plan beats around what the pen has to write.

## Look
- **Board:** warm white (`#fbfaf6` to `#f1efe7`), a soft top-left light, a faint brushed texture, a diagonal glossy sheen drifting across at a different rate than the drawing, an inner vignette and a light aluminium edge. A few "ghost marks" (old circles, arrows, plus signs at 7 %) remind you the board was used.
- **Three markers, each with a fixed meaning:** ink `#23262c` (things and text), blue `#2a5cb3` (structure, safe, the process), orange `#d97757` (the thing that matters: urgency, the key number). Never add a fourth. Strokes multiply where they cross, width 9 px, round caps.
- **Fonts:** Caveat Bold (headlines, numbers, key words), Patrick Hand (small labels). Both OFL, in `assets/`. Each letter gets a deterministic 1.6 degree tilt and 2.5 px baseline jitter so the writing looks like a hand, not a font.
- **Type scale (1080 wide):** headline 130-150 px, hero word up to 280 px, numbers 110-190 px, labels 60-70 px.

## Layout
- **9:16:** headline top-left in 2-3 lines from y 130 (width 950), one big doodle or a three-row list below. Rows are 300 px apart: icon doodle at the left (190 px), label and value stacked to its right. Leave the bottom 12 % free.
- **16:9:** headline left third, doodle right two-thirds; for lists use a single column of rows or a two-column board with an arrow between regions. Keep camera moves on the board as pushes or whips, not cuts.
- **One region per idea.** A new scene is a new part of the board (whip), not a new slide.

## Motion grammar
- **Everything is drawn.** Text is written left to right, line by line, the marker tip riding the writing edge with a little bob. Nothing fades in as a block; no UI card flies in without a drawn frame.
- **Kit moves** (`BRAG.styles.whiteboard`):
  - `layer(parent)`, `ghosts(layer, seed)`, `pen(layer, color)`: build the SVG layer, the faint old marks, and a marker (one per colour per scene; parks off the right edge).
  - `stroke(pen, d, at)`: marker hops to the start (lifted, shadow grows), then draws the path slow-fast-slow while the tip follows. `strokes`, `hop`, `park`.
  - `write(pen, el, at, {cps})`: handwriting reveal with the marker following; `doodle(pen, name, x, y, scale, at)` icons: `fridge`, `face`, `cup`, `leaf`, `feta`, `pot`, `steam`, `clock` (add your own as a list of M/L/C strokes in a 0-100 box).
  - Hand-made emphasis paths: `loop` / `circleWord` (circle a word with an overshoot), `underline` / `underlineWord` (wavy, optional double), `arrow`, `check`, `burst` (rays), `swipe` (marker highlight band).
- **Transitions:** `whip-left` (the camera swings to the next region), `zoom` (push into the symbol), `push-up` for a "below" step. No fades, no wipes with hard edges. Pens park before the move so none are caught mid-stroke.
- **fx menu that fits:** `fx.parallax` on the sheen, `fx.drift` 1.03-1.05, `fx.count` for a real number, `fx.pulse` once on the key number. Skip glitch, flash, flip, scramble, slam.
- **Tempo:** two or three markers can work in parallel (ink writes, blue draws, orange circles) but only one stroke per marker at a time. Emphasis (circle, underline, burst) always comes after the thing it marks, 0.1-0.2 s later.

## Do
- Draw the simplest picture that carries the idea; one sentence, one drawing.
- Use orange for exactly the thing the viewer must remember (urgency, the key number).
- Let the pen overshoot circles and not quite close; that is the charm.
- Hold the finished board 0.6 s or more before leaving it.

## Don't
- No hands, arms or cursors. No clip-art or filled colour shapes (swipe highlights excepted). No drop shadows except the marker's.
- No more than three marker colours, no gradients inside drawings, no neat fonts for drawn labels.
- Don't write text faster than it can be read (0.3 s per word minimum once complete).

## Showing a real product UI
Tape it to the board. Put the screenshot or live DOM in a `.wb-shot` card (white, rounded, hand-inked 3 px frame, soft shadow) and have a marker **draw the frame edge first** (a slightly wobbly rectangle with `stroke`), then fade the card up inside it. Annotate like a teacher: orange circles around the buttons or numbers that matter (`circleWord` accepts any rect from `rectOf(el)`), arrows from handwritten labels (`arrow`), checks and bursts. For a multi-screen flow, put each screen in its own region of the board and connect them with a drawn arrow instead of cutting.

Adapted from lemo-opuscar `whiteboard` by LemoLab (MIT). Rewritten for brag.
