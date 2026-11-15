# Chart Room

A quiet dark room where real numbers are the picture. Lines draw, bars grow, rings sweep, figures count up; one mint accent marks the thing that matters.

## When to use
- Metrics and growth updates ("1M visitors"), release notes with a measurable result, quarterly or milestone videos, fintech and analytics launches, "before / after" proof scenes inside a longer film.
- 10 to 30 s, 16:9 or 9:16, three or four chart scenes plus a closing tile row.
- **Only with real data.** Every figure, axis and label comes from the product's own export or API; if there is no number, use another style. Never invent a statistic, a trend or a customer.
- Not for emotion-led stories, and not when the point is a screen rather than a number.

## Energy
`lively` by default; `calm` works with slower draws (1.5 to 2 s). Not `punchy` or `hype`: charts need time to be read.

## Palette
| Token | Hex | Use |
|---|---|---|
| `--ground` | `#0B1210` | scene background |
| `--panel` | `#111B17` | cards, KPI tiles, callouts |
| `--line` / `--line2` | `#22312A` / `#2F4239` | gridlines, tracks, neutral bars |
| `--text` | `#E8F0EC` | titles, values |
| `--mute` / `--dim` | `#7F9088` / `#4B5B54` | axis labels, notes |
| `--accent` | `#5CF2A8` | the one highlighted series, bar, ring or number per scene |

Neutral series are grey-green, the highlighted one is mint. Use a second hue only if the data has two real series, and then keep it desaturated. A very soft mint gradient under a line is the only gradient. No glow, no shadows.

## Type
Geist (variable, OFL, `assets/geist.ttf`) for titles and hero numbers, weight 600, tracking -3 to -5 %, tabular numerals; JetBrains Mono (OFL, `assets/JetBrainsMono.ttf`) for axis ticks, labels, chips and sources, 22 to 28 px, uppercase labels with 0.08 em tracking. A hero number is 190 to 230 px.

## Layout
- 16:9: 120 px margins. Label (mono, accent index) at y 90; title or hero number in the top band; the chart fills the lower 55 to 65 % of the frame with 90 px of left gutter for y ticks.
- Data-ink first: thick marks (bars 56 % of their slot, lines 5 px), four gridlines at most, direct labels on the data instead of legends.
- One scene, one chart, one message in the title ("Sunday is planning day.").
- A source line (mono, `--dim`) at the bottom of any scene whose data is not obvious.

## Textures
Hairline gridlines only. No grain, glass, or decoration.

## Motion grammar
- **Transitions:** `push-left` between chart scenes, `fade` into the closing scene. No zoom, glitch, flash or flip.
- **Builders** (`BRAG.styles['chart-room']`): `lineChart`, `barChart`, `donut` turn data arrays into SVG / div charts; `frame` is the shared axis box.
- **Moves** (`(target, at, opts) -> end time`):
  - `rise(el, at)` titles and panels lift 24 px and fade, 0.08 s apart.
  - `axes(chart, at)` gridlines draw from the left, ticks fade in.
  - `drawLine(chart, at)` the line draws, the area under it reveals and a dot rides the true path length.
  - `grow(chart, data, at)` bars grow from the baseline while their labels count to the real value.
  - `fill(rows, data, at)` ranked horizontal bars fill and count.
  - `sweepArc(donut, at, {label})` a ring sweeps to its share, its centre label counting in step.
  - `callout(el, at, {leader})` a leader line draws, then the label appears.
  - `count(el, to, at)` the hero number counts with thousands separators.
  - `drift(el, start, end)` a 1.0 to 1.025 push while the chart holds.
- **Tempo:** draw 0.8 to 1.6 s, then hold at least 1 s per chart; one chart per 2.5 to 3 s.
- **Emphasis:** the accent on one mark, one callout per scene, `count` on the one headline figure.

## Showing a real product UI
Put the screenshot or live UI in a `.cr-panel` beside or under the chart (rounded 20 px, 1.5 px hairline border), as a flat artifact. The UI moves only with the product's own animations: replay its real durations and easings with `fx.ui` / `fx.uiAnim`, or keep it still if it has none. Charts, counters, callouts, panel entrances and the camera drift are the style's own layer and go around the UI, never inside it: do not animate the product's own charts with `grow` or `drawLine`. When the real product chart is the subject, show it as the app draws it, and put the callout and number beside it.

## Do / don't
- Do start every axis at zero for bars, label the values on the marks, and say what the unit is.
- Do mark one thing in the accent.
- Don't invent data, smooth a series that is not smooth, or truncate an axis to exaggerate.
- Don't use 3D, pie charts with more than three slices, rainbow palettes, or bouncy easing on data.

## Inspired by (described, not copied)
prompt-motion.com entries tagged Charts / Product UI, read for the idea of metric-led launch videos: MotionSites one million visitors by @viktoroddy (a milestone told as a chart), Dub promo video by @steventey (product plus charts), Stock analysis app promo by @AIStockSavvy, Sahi trading terminal reveal by @dale_vaz (dark, dense, camera-led), Mathematics motion showreel by @Math_files. The charts, tokens and code here are original; the demo's numbers are made up for the demo and say so on screen.
