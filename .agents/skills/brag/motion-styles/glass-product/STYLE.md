# glass-product

A premium product hero on black: frosted glass slabs, strip-light sweeps, ice-blue-to-violet light, ultra-thin type. All CSS (gradients, blend modes, masks, backdrop blur), no 3D engine.

## When to use
- Launch, teaser, release hero, brand/story films for a product that should feel **precious**: a flagship feature, a device-like app, a name reveal.
- Weak for dense walkthroughs and data-heavy explainers (glass wants few, large things).
- Recommended energy: **calm to lively**. The camera always drifts; cuts are rare and slow, so avoid punchy/hype.

## Palette
| Role | Hex |
|---|---|
| Stage | `#020306` with a dark-grey radial sweep `rgba(70,84,120,.34)` behind the hero; floor fades into black, no horizon line |
| Glass fill | `rgba(255,255,255,.065)` gradient, edge `rgba(255,255,255,.16)`, top highlight `rgba(255,255,255,.35)` |
| Text | `#EEF1F7` / `#AAB2C2` / `#6C7385` |
| Light accent (reserved for light only) | ice blue `#7FB8FF` drifting to violet `#A98BFF`; alternatives amber to rose, green to cyan |

The world is neutral. The accent is only ever *light*: the edge line, the lit dots, caustic rings, the glow inside frosted glass. Never an accent-coloured surface or text.

## Type
- **Inter Tight** only. Titles weight 200, 100-140 px (9:16: 112 px), tracking `.02em` after the entrance (wide `.16em` before), centred in the upper third, set with explicit line breaks (`white-space: nowrap`).
- A diagonal **glint** crosses the letters once per title, in sync with the strip light on the object.
- Kickers/captions: weight 300-400, tracked caps (18-36 px, `.3-.4em`). Subtitles are a **glass slab** (blurred, thin highlight stroke, accent line), weight 300, ~42 px.
- The product name and slogan are title cards, not subtitle lines.

## Layout
- **9:16:** title block top third (y 230-650), hero slab in the middle/lower third (y 700-1700), floor caustics below it (y 1500-1800), glass subtitle at y ~1380-1600. Hero never touches the frame edge (>= 90 px margin).
- **16:9:** hero slab centred at 40 % width; title on one line above or left; subtitle slab bottom-centre. One hero per shot, centred or on a strong diagonal.

## Textures
Backdrop blur 22 px + slight brightening inside slabs; 1.5 px gradient edge (bright top-left, violet bottom-right); 55 % corner vignette; caustic floor (concentric rings with a pinkish-blue fringe, blurred 1.5 px, `mix-blend-mode: screen`). Frosted glass needs something bright inside or behind it (the glowing core, a gradient) or it reads as grey plastic. No grain.

## Motion grammar
- Easing: ease-in-out for the camera, `expo.out` for lifts, never bouncy. Everything drifts: no locked-off frame.
- **Kit moves** (`BRAG.styles['glass-product']`):
  - `glass(el)`: build once; makes a slab with sheen and edge line.
  - `sheen(el, at, {dur, dir})`: a strip light slides across the slab (signature move, 1.0-1.2 s).
  - `edge(el, at)`: the dispersion line on the top edge draws on and stays lit.
  - `title(el, at, {a0})`: tracking collapses from wide while it sharpens; a glint crosses. `glint(el, at)` repeats it later.
  - `lift(els, at)`: objects rise from the dark tilted toward the camera and settle upright.
  - `orbit(el, start, end)`: slow rotateY/rotateX + 4 % push on a slab (the always-drifting camera).
  - `caustic(at, {x, y})`: a ring spreads on the floor, the filament pool brightens (use on arrivals and impacts).
  - `sweepCut(at)`: the transition. Black dips in, a bright strip crosses, the scene cuts under it (returns cut time; use `fx.scenes` `out: 'cut'` with `end` = that time).
- From `BRAG.fx`: `drift`, `float` (tiny), `fade`/`blur` text. Avoid wipes, dissolves, whips, glitch, bars, flash, and every pop/slam text effect.
- Tempo: 1.0-2.0 s per beat, hold titles >= 1.2 s, light events (sheen, caustic) land with a lift.

## Do / Don't
- Do keep the background black and let light define edges; sheens pass once, not on loop.
- Do give every slab content or a core of light; fewer, larger slabs.
- Don't use more than one accent family; don't tint glass; don't put dispersion rainbows on type.
- Don't cut without a light event; don't use drop shadows on text; don't tilt beyond ~10 degrees at rest.

## Showing a real product UI
Place the UI **inside a slab**: rows become sub-rows with hairline dividers (`gp-row`), badges become glass pills whose dot lights (`.hot`) when the light passes. Screenshots go inside a slab with 44 px radius and are revealed by a sheen. Zoom with `orbit` scale (<= 1.08) or `lift`; the same slab can carry the whole film, only its content changing.

Adapted from lemo-opuscar `glass-product` by LemoLab (MIT). Rewritten for brag.
