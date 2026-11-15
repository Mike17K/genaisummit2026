# Manim Explainer

A dark board where explanations draw themselves: strokes are created, labels are written, shapes transform, the thing being discussed is indicated. The visual language of maths explainers, applied to a product's logic.

## When to use
- Explainers of how something works ("how matching works", "how sync decides", "three steps"), algorithm and data-flow walkthroughs, release notes about a mechanism rather than a screen.
- 20 to 90 s, calm to lively. Voice-over or captions fit it well; so does pure motion.
- Not for loud launches, for emotion, or for products whose story is the UI itself (show a product scene instead, see below).

## Energy
`calm` by default (everything eases in and out, nothing bounces); `lively` with 0.3 s shorter draws. Not `punchy` or `hype`.

## Palette
| Token | Hex | Use |
|---|---|---|
| `--ground` | `#1B1C21` | the board |
| `--plane` / `--axis` | `#2A2C34` / `#4A4D59` | coordinate grid and axes |
| `--text` | `#ECECEC` | titles, default strokes |
| `--mute` | `#8D909C` | captions, tick labels |
| `--blue` `--green` `--yellow` `--red` | `#58C4DD` `#83C167` `#FFE45C` `#FC6255` | **roles**, not decoration |

Give each colour a job and keep it for the whole film: for example blue = what you have, green = the result, yellow = the thing to look at now, red = missing or wrong. Fills are the same hue at 16 to 18 % opacity.

## Type
Source Serif 4 (variable, OFL, `assets/SourceSerif4.ttf`) for titles, equations and labels, weight 400, so maths feels like maths; JetBrains Mono (OFL, `assets/JetBrainsMono.ttf`) for small captions and tags in `--mute`. Titles 110 to 130 px, scene headings 64 px, equations 118 px with fractions at 82 px.

## Layout
- 16:9 (1920x1080) on a faint 120 px plane that grows from the centre at the start of each scene. Scene headings top-left at (120, 90); the diagram or equation sits on the centre line or the left third; labels sit on the shapes they name.
- Inputs on the left, the thing they feed on the right, arrows between: read left to right.
- Strokes 5 px, round caps; arrows are curves, not straight lines.

## Textures
The coordinate plane (hairlines, optional axes) is the only texture. It is a quiet ground, never a graphic.

## Motion grammar
- **Easing:** `power1.inOut` ("smooth") on every stroke and camera move; text and fades use `power2.out`. No springs, no overshoot.
- **Transitions:** `fade` between scenes (a FadeOut / FadeIn), at 0.5 s. No pushes, wipes or flashes.
- **Kit moves** (`BRAG.styles['manim-explainer']`, `(target, at, opts) -> end time`):
  - `plane(host)` + `planeIn(lines, at)` build the grid and grow it from the centre.
  - `write(el, at)` each glyph appears as an outline and fills, left to right (titles, equations, labels).
  - `create(shapes, at, {stagger})` a stroke draws itself (path, line, circle, rect; DrawSVG).
  - `fadeIn(el, at, {y})` / `fadeOut` with a small shift, for labels and tiles.
  - `fillIn(el, at)` the fill arrives after the outline was created.
  - `morph(path, d, at)` Transform: one outline becomes another (MorphSVG). The element must be a `<path>`.
  - `indicate(el, at)` the target grows 15 to 20 % and flashes yellow; use it once per idea.
  - `slide(el, from, to, at)` a dot travelling along a number line; `camera(world, at, {scale,x,y})` a slow smooth push on the part being explained.
- **Tempo:** one new object every 0.4 to 0.8 s; the equation is built in the order it is read. Hold the finished picture for 1 s.
- **Emphasis:** `indicate` on the one term or number, yellow only.

## Showing a real product UI
Place the real UI as a still or live panel on the board, framed by a thin 2 px stroke that `create` draws around it, with labels and arrows pointing at parts of it. The UI itself moves only with the product's own animations: replay its real durations and easings with `fx.ui` / `fx.uiAnim`, or leave it instant if the app has none. Everything this style adds (written labels, drawn arrows and braces, indicate pulses, camera pushes, the plane) lives on the layer around the UI. Never write-on, morph, indicate-scale or fade pieces of the UI itself; point at them instead.

## Do / don't
- Do build a diagram in reading order and name every shape on it.
- Do keep one colour per idea for the whole film.
- Don't use more than four colours, textures, glow, or decorative icons.
- Don't animate several unrelated things at once; the eye follows one stroke at a time.

## Inspired by (described, not copied)
prompt-motion.com entries about explainers, read for the Manim-like grammar and the way a short explainer is structured: Derivative concept explainer by @LinearUncle (a Manim lesson), Mathematics motion showreel by @Math_files, Animated business explainer by @alex_prompter (problem, offer, three steps, proof, name), Recursion explained in genres by @emollick (self-referential explainer), DeFi Saver stop-motion explainer by @_nikolajankovic. The look, the Source Serif setup and all code are original here; the palette roles follow common maths-video practice and nothing is copied from the entries.
