# Halftone Dossier

A retro print case file: cream archive paper, overprinted halftone dots in flat inks, heavy slab headlines with a misregistered red shadow plate, rubber stamps that slam, typewriter labels and numbered exhibits. The video is a file read out one exhibit at a time.

## When to use
- Deadpan comedy, "case against X" explainers, feature tours as exhibits, release notes as a case file, anything where the grave frame makes a light subject funnier. Good for pets, food, consumer and indie products.
- Walkthrough: each UI element is an exhibit card slapped onto the file with a tag ("Exhibit B"), pinned together with red string.
- Not for slick, futuristic or enterprise-clean tones, and not zine collage (it stays orderly).

## Energy
`lively` to `punchy`: exhibits slap, stamps slam on beats, but the page itself is quiet. Never glitch or flash.

## Palette
| Token | Hex | Use |
|---|---|---|
| `--paper / --paper2` | `#EFE4CB` `#E4D6B6` | the sheet (plus mottling, grain, fold, vignette) |
| `--ink` | `#1E2A44` | outlines, headlines, body text, caption bar (navy) |
| `--red` | `#D8452B` | the misregistered shadow plate, stamps, string, urgent tags |
| `--teal` | `#2A9D8F` | second spot ink: numerals, photos |
| `--yellow` | `#F2B632` | highlights, tags |
| `--pink` | `#E88AA5` | optional third accent |
Halftones multiply onto the paper, so inks overprint. No gradients except as halftone density fields.

## Type
Alfa Slab One (OFL, `assets/alfaslab.ttf`) for headlines, stamps and numbers, uppercase, with a 7 px red offset shadow. Special Elite (Apache 2.0, `assets/specialelite.ttf`) for typewriter labels, chips, exhibit text and the caption bar. Headlines 110-200 px, numerals 600 px+.

## Layout
- **9:16 (1080x1920):** file chip top left (60, 70) and a department chip top right, headline block from y ~190, exhibits mid page (cards 580 wide or 920-wide strips with 200 px pitch, tag 48 px above each), stamp overlapping the lower exhibit, caption bar at y 1140-1250, halftone sun or edge dots filling the bottom. Margin 60.
- **16:9 (1920x1080):** headline left half, exhibit cards on the right, caption bar full width at the bottom (y 860), halftone dots crowding the right and bottom edges.
- Dots, paper and a stamp should be visible in every frame.

## Motion grammar
- **Kit** (`BRAG.styles['halftone-dossier']`, `(el, at, opts) -> end`):
  - `init(root)` injects the paper layer, the rough-edge stamp filter and the halftone structure. Call it first in `BRAG.build`.
  - `stamp(el, at, {rot})` slams from 2.6x with a hard land, small rebound and a page shudder: the style's signature.
  - `exhibit(el, at)` slaps cards in from the side, tilted, with overshoot.
  - `string(path, at, {pins})` draws red string between pins (DrawSVG) and pops the pins.
  - `bloom(el, at, {from,to})` grows the halftone dots from nothing to a density; `breathe` makes the dot field step over a hold.
  - `misregister(el, at)` the red plate slips and settles under a headline.
  - `caption(el, at, {cps, key})` typewriter caption bar with a highlighted keyword.
- **Halftone in CSS:** a `.ht` layer = dot tile + density field (`--f` 0-255, low = big dots), thresholded with `filter: contrast()`, tinted with `--ink-c`, multiplied on the paper. Variants: `.edge` (dots crowd the border), `.linear`, `.glow`. Dot size `--dot`, screen angle `--ang`.
- **fx used:** `fx.text` `rise`/`slam`, `fx.count`, `fx.drift` (1.03). **Transitions:** `push-left/up` (turning pages), `wipe`, hard `cut`. No blur, glitch or zoom.
- **Tempo:** one beat per exhibit, stamp lands on the last beat of a scene; hold 0.3 s per word.

## Showing a real product UI
Print it: put the screenshot (or rebuilt UI) on an `.exh` card with a 7 px ink border and hard print shadow, add a tag ("Exhibit A"), and overlay a `.ht.linear` in a spot ink so the UI looks like a halftone photo; pin related cards with red string, and stamp the verdict.

## Do / don't
- Do put numbered, bureaucratic apparatus (case no., chips, tags) around a light subject.
- Do keep text crisp: the rough filter and line boil are for stamps and characters only, never body text.
- Don't use soft shadows, glow, bounce on text, or more than 4 inks.

## Notes
`S.scenes(fx, list)` is a thin alias of `fx.scenes`. Halftone with `filter: contrast()` is GPU-heavy at 1080x1920 (about 2 s per second of video on the NAS); keep to one or two `.ht` layers per scene.

Adapted from lemo-opuscar `halftone-dossier` by LemoLab (MIT). Rewritten for brag.
