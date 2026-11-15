# dark-keynote

A near-black software keynote: hairline grid, soft cool light, one lime accent, UI that snaps onto a 48 px module.

## When to use
- Launch, release notes, feature reveal, teaser for **software** (the interface is the hero, no physical product).
- Walkthrough only when it is short and one decision per scene. Explainers and stories: poor fit (too cold, too few words per screen).
- Recommended energy: **lively**, punchy for teasers. Never calm: precision needs a pulse.

## Palette
| Role | Hex |
|---|---|
| Stage | `#05060A`, radial lift `rgba(120,150,255,.13)` top centre |
| Surfaces (3 steps) | `#0B0D14` `#11141D` `#181C28`, 1 px border `rgba(255,255,255,.08)`, 1 px inner top highlight |
| Text | `#F2F4F8` / `#9AA3B5` / `#5D6679` |
| Accent (one only) | lime `#B7F34A` with glow `rgba(183,243,74,.38)`. Alternatives per film: violet `#8B7CFF`, orange `#FF7A1A` |
| Problem colour | `#FF6B5A`, only while the problem exists; after the turn it never returns |

Accent = what the product is or does (the key number, the confirm button, the turned-good badge). If two things are accent, one is wrong.

## Type
- Inter 600 for headlines (tracking -4.5 %), Inter Tight 600 for the giant number, JetBrains Mono for labels, badges, file names (wide tracking, small caps labels).
- One line (or one short block) per screen. The giant number gets its own screen; its caption sits below, not over it.

## Layout
- **9:16 (1080x1920):** 96 px side margin, 48 px module. Kicker label at y 400, headline block centred around y 800, product window 888 px wide in the middle third, notification or button in the lower third (y 1400-1500). Keep the bottom 200 px for captions.
- **16:9 (1920x1080):** 144 px margins, headline left-aligned in the left 45 %, window on the right 50 %; the giant number centred, 520 px tall.
- Generous negative space; one focal element.

## Textures
Hairline grid (every 4th line stronger), faded to the edges by a mask; 50-55 % corner vignette; no grain, no scanlines. The stage never moves on its own.

## Motion grammar
- Easing: fast-out with one small overshoot (`back.out(1.7)`) and an immediate settle. No floaty sine drift except a +-6 px hover on a held card.
- **Kit moves** (`BRAG.styles['dark-keynote']`, all take `at`, return end time):
  - `sweep(at)`: a cool light band crosses the stage.
  - `lightReveal(el, at)`: text sits at ~7 % until the light edge passes (needs class `dk-lit`).
  - `snapIn(els, at, {gap, dy})`: short typed spawn, drop + bounce, 0.28 s each.
  - `ping(at, {x, y})`: grid hairlines light up in a ring from a point (events, clicks, arrivals).
  - `expand(at, src)`: UI-expand transition. A pill/tile grows from the element that caused it to fill the frame, scene cuts under it, a lit edge releases. Pair with `fx.scenes` `out: 'cut'`.
  - `cursor(at, path, {out})`: eased cursor with press and ring.
  - `bigNumber(el, to, at)`: lone number slams in with a glow flare and counts up.
  - `collapse(el, at)`: designed disappearance, squash to a line then gone.
- From `BRAG.fx`: `text` rise / chars / blur, `drift` (<= 1.04), `zoom` as dive transition, `pulse` on a key number. Avoid fade, blur-crossfade, bars, glitch, flash: they break the precision.
- Tempo: one move per beat; start moves one frame early so the beat frame is already 80 % there. Every scene change is an expand or a zoom: no hard cuts, no blank frames.

## Do / Don't
- Do let light be the reveal; keep unlit pixels a few percent, not zero.
- Do reserve the accent and the problem colour as above.
- Don't use traffic-light buttons, menu bars, docks or stock icons; windows have a glyph and a title only.
- Don't caption over the big number. Don't put a second accent on screen. Don't tilt UI more than ~24 degrees.
- Don't put more than one hero move on a screen.

## Showing a real product UI
Redraw the real UI as `dk-window` cards (real labels, real data) or place a screenshot inside a `dk-window` with 36 px radius. Pick the one component that matters (a row list, a button) and spawn it with `snapIn`; the cursor performs the single decisive action and the state change answers on the same frame (badges turn accent). Push in with `fx.drift` or the `zoom` transition on the detail, never a tour of the whole screen.

Adapted from lemo-opuscar `dark-keynote` by LemoLab (MIT). Rewritten for brag.
