# Telestrator

Sports-analysis motion style: play the footage, freeze it with a flash and a punch, then draw on the picture with fluorescent marker lines, rings and a spotlight; cut with a yellow packaging band; split the screen to compare. Here the "footage" is the real product UI (HTML), so the analysis happens on the actual app.

## When to use
- **Best for:** feature walkthrough ("watch this, now look at what it does"), release notes, before/after comparisons, explaining a decision the product makes, "what you may have missed" teasers.
- **Works for:** launch (confident, studio energy), story told as a replay. **Weak for:** calm, premium or whimsical tones.
- **Energy:** `punchy` is home; `lively` works; `hype` fits if every freeze lands on a beat. Avoid `calm`.
- **Length:** 12-45 s. One piece of action = live play (0.8-1.2 s), freeze (1.8-2.4 s), one finding. Two to four freezes per piece; more than four, replay.

## Look
- **Footage first.** The product UI fills the frame (full bleed, dark), graded slightly: a soft vignette. A freeze desaturates it to 55 %, adds a cool cast and a heavier vignette, then creeps 1.4 % while it holds.
- **Colour roles (never change them mid-film):** yellow `#ffd400` = what we follow and the main marker lines; cyan `#3fd8ff` = the others (comparison, safe, "no action"); red `#ff3b30` = space / problem / expiring (fill 0.34 + dashed edge); chalk `#f4f1e8` = traced lines and neutral marks; board `#0c1411` = show board; label card `rgba(8,12,14,.92)`.
- **Fonts:** Barlow Condensed ExtraBold Italic (labels, numbers, the bug), Barlow Condensed SemiBold (UI text, second line of labels, tracked caps), IBM Plex Mono Medium (clock, frame counter). All OFL, in `assets/`. No handwriting anywhere.
- **Packaging, always on:** corner bug top right (show name on a yellow block, mode line LIVE with red dot / ANALYSIS yellow / REPLAY cyan / SPLIT), source clock top left (`II 01.00s F30`, `> 1/2` in slow motion). Both are in every frame from frame 1.

## Layout
- **9:16 (1080x1920):** bug top right (y 56-190), clock top left (y 70-130). Labels sit in empty UI space under them (y 170 for the headline label) or in the lower third (y 1330+), never over what they describe. Spotlight shapes hug the region of interest. Split screen = two stacked 1080x960 windows with a 8 px yellow divider at y 957.
- **16:9 (1920x1080):** bug top right, clock top left, labels bottom left; split screen is two 960x1080 windows side by side. Board pages (data card) use a dark grid board with a left text column and the drawing on the right.
- A label's left bar takes the colour of what it names.

## Motion grammar
- **Order inside a piece of action:** play, freeze, draw (ring = who, then area or line = what happened, then label = the finding, 0.3-0.6 s apart), hold, cut. The explanation never comes before the play.
- **Kit moves** (`BRAG.styles.telestrator`):
  - `footage(parent)`, `play(f, from, to, dy)`: build the product screen as footage and scroll it live.
  - `freeze(f, at)`: white flash 0.6, punch 1.035 to 1.0 in 0.35 s, desaturate, vignette, slow creep. Annotations live inside the footage so they share its transform.
  - `spotlight(f, focus, at)`: everything outside a rounded rect / ellipse darkens to 0.4, the hole closes in from wide.
  - `ring(f, {cx,cy,rx,ry}, at, {color})`: marker ellipse (dark outline + glowing core + white highlight) drawn clockwise, then a rotating dashed outer ring. `box(f, rect, at)`: the same for a card. `markerLine(f, d, at, {head})`: any path, optional arrowhead that pops at the end. `patch(f, rect, at)`: red space patch.
  - `label(parent, {text, sub, color, x, y}, at)`: black card, role-coloured bar, left-to-right reveal. `stopwatch(el, to, at)`: counting number inside a label.
  - `band(a, b, at)`: the yellow slanted packaging wipe; the next scene is revealed behind its centre line (0.38 s). `split(wa, wb, at)`: two windows wipe in, divider draws from the centre. `stamp(el, at)`: yellow card drops from 1.7x with overshoot and a flash (once per film). `cycle(el, times)`: mode line and clock states.
- **Transitions:** only the packaging band between segments; hard cuts inside a segment; split screen for comparison. No dissolves, no blur.
- **fx menu that fits:** `fx.pulse` on a label, `fx.count` for the big number, `fx.shake` on the stamp, `fx.drift` on board pages. Skip scramble, flip, glitch.
- **Tempo:** a freeze is never longer than 2.4 s without a second action inside it; keep something drawing (a ring spinning, a counter running, the creep).

## Do
- Show the product moving first, then freeze on the exact frame that proves the point; one freeze, one finding.
- Draw on the picture where the thing is (ring the chip, box the card), count real numbers, name the finding in one label line.
- Keep role colours fixed; use red only for the problem, cyan for the contrast.

## Don't
- No more than two groups of lines per freeze. No handwriting, no soft pastel colours, no dissolves.
- Don't put labels over the thing they describe. Don't hold a frozen picture longer than 2.5 s without a second action.
- Never copy a real broadcaster's logo, colours or ident.

## Showing a real product UI
This style is built for it: the UI **is** the footage. Build the screen as real HTML (or a `<video>` of the app) inside `.ts-footage`, play it (scroll, tap, state change) for about a second, `freeze` on the decisive frame, then annotate in the footage's SVG layer (`ring`, `box`, `patch`, `spotlight`, `markerLine`). Get coordinates from the DOM (`getBoundingClientRect`) or from known layout constants (`card(i)`). For comparisons use `split` with two windows of the same UI (before and after, device A and B) and ring the same element in both.

Adapted from lemo-opuscar `telestrator` by LemoLab (MIT). Rewritten for brag.
