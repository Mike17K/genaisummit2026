# Morph UI

One black shape on a warm grey ground keeps reshaping itself into the product's parts: a button, a loader, a card, a toggle, a slider, a chart, a toast, a window. A cursor does the clicking and a camera frames each state.

## When to use
- Feature tours and launch videos for apps with clear interface parts (settings, controls, lists, charts); "everything in one place" messages; 10 to 20 s, 16:9 or square.
- Great as the middle of a film: it shows components, then hands over to the real product in a window.
- Not for brand stories with people or photos, and not for dense data screens.

## Energy
`lively`. Fast springs (0.5 s) with a small overshoot, a state change every 1.0 to 1.4 s. It can go `calm` with 0.8 s morphs; avoid `hype`.

## Palette
| Token | Hex | Use |
|---|---|---|
| `--ground` | `#E7E5E0` | warm grey background, with a faint 80 px dot grid |
| `--ink` | `#121212` | the shape in every state |
| `--paper` | `#FFFFFF` | knobs, product window, text on ink |
| `--mute` | `#8B887F` | captions |
| `--accent` | `#FF5A1F` | one thing per state: a loader arc, an "on" toggle, the highlighted bar, a check |

Black, white and grey carry the film; the accent is the single optional colour.

## Type
Geist (variable, OFL, `assets/geist.ttf`), weight 500 to 600, tracking -2 to -4 %. Labels inside states are 28 to 58 px; headings inside the card 84 px; small caps captions 22 to 24 px, 0.06 em tracking.

## Layout
- The shape is always centred on the frame (it is the camera's subject); states are 220 to 1240 px wide, so the camera zooms between 0.9 and 1.35 to make each fill the frame comfortably.
- A state may move off-centre only to follow a UI convention (a toast sits low); the camera follows it.
- Nothing else is on the stage except the cursor and the dot grid.

## Textures
A faint dot grid on the ground (16 % ink). It pans with the camera so scale changes read as zooms. No shadows under the shape.

## Motion grammar
- **Morph:** width, height, radius and colour animate together with `back.out(1.25)` (a spring with minimal overshoot, 0.55 s); the old face leaves in 0.14 s, the new one arrives at 40 % of the move. Exits are faster than entrances.
- **Kit moves** (`BRAG.styles['morph-ui']`, all `(target, at, opts) -> end time`):
  - `init(shape, face, state)` places the first state (on the master timeline at 0).
  - `morph(shape, face, {w,h,r,bg,x,y}, at)` the signature: the shape becomes the next state.
  - `cursorTo(cursor, x, y, at)` an eased path; `click(cursor, ripple, at, {x,y})` press to 0.82 with an accent ripple.
  - `camera(world, at, {scale,x,y})` frames the new state (`power3.inOut`).
  - `items(els, at)` children of a state pop in quickly after it settles (small, 14 px).
  - `spin(el, start, end)` linear loader rotation locked to the timeline.
- **Transitions:** the morph is the transition; no scene cuts, no film transitions inside the run. A final `cut` to a title card is fine.
- **Tempo:** about 120 BPM; one state per two beats. The cursor clicks 0.2 to 0.4 s before a state changes, and the change happens on the press.
- **Emphasis:** the accent in one place per state; one ripple per click. No pulses.

## Showing a real product UI
The real UI appears in the last kind of state: the shape grows into a bezel (16 px of ink) and the UI sits inside it untouched. The UI moves only with the product's own animations: replay its real durations and easings with `fx.ui` / `fx.uiAnim`, or let it change instantly if the app has none (the demo flips one badge instantly). The style's own effects (the shape's morph into the bezel, the camera push, the cursor, the ripple) belong to the layer around the UI. Never morph, spring or crossfade the UI's inner elements, and never replace the product's own components with the style's stand-in faces when the film claims to show the real app: the stand-in states (button, toggle, slider, chart) are illustrations of parts, so either label them as such or build them from the product's real components.

## Do / don't
- Do keep the shape's centre and the camera locked together, and let the click cause the morph.
- Do keep the same black for every state so it reads as one object.
- Don't add a second shape, a drop shadow, a gradient or a second accent.
- Don't bounce utility actions (a toggle gets one small overshoot, not an elastic wobble); don't morph more than once a second.

## Inspired by (described, not copied)
prompt-motion.com entries: Shape morphing through UI states by @twoclipping (one monochrome shape becoming interface components, cursor-driven, spring motion, warm grey ground), Launch video remake comparison by @notdwd (cursor click leading into a moving camera, UI states in sequence), Sahi trading terminal reveal by @dale_vaz (camera scale changes carrying the story). The shape, states, kit and code here are original; the entries' prompts and assets were not used.
