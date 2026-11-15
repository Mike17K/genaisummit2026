# Product-native style

The video is made from the product itself: its real components, CSS, fonts, colours, copy, and screenshots, animated as an HTML page and recorded frame by frame. Use it for launch promos, walkthroughs, and release notes of anything with a UI.

## Gather the material

| Input | How to recognise it | Where the material comes from |
|---|---|---|
| Project | No URL given and the current directory is a project | The code: main page, styles (exact colours and fonts), README, routes, key components |
| Website | An `http(s)://` URL or a bare domain | The live site, rendered in a headless browser (many sites are empty shells without JS). Dismiss overlays and scroll section by section. |
| Topic | Neither (an explainer about an idea) | Use a drawn style instead, or ask for a site/screens |

Collect:
- **Copy:** headline, tagline, feature names, CTAs, empty states, real labels on the buttons in the flow you're showing.
- **Identity:** exact colours from CSS, the fonts it loads (load the same files from the project, or the same Google Fonts), logo.
- **The product in use:** the 2–6 moments that matter for this type (entry → action → result). For a walkthrough, find the real flow in the routes/components.
- **Screens:** `node <skill-dir>/engine/tools/capture.mjs <url> <composition>/assets/<name>.png [--selector css] [--full] [--dark]` for the user's own site only. Prefer **re-rendering the real markup and CSS** over panning across flat screenshots: copy the component's HTML/CSS into the composition so you can animate its parts.

## The composition

```
<output-dir>/composition/
  index.html      the video: one page, one #stage of exactly TIMELINE.width × height
  timeline.js     copied from <skill-dir>/runtime/timeline.js
  assets/         fonts, logo, screenshots, demo clips (copied in, all local)
  audio.json      the mix (see audio.md)
```

Skeleton:

```html
<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face { font-family: Brand; src: url(assets/brand.woff2); }
  #stage { font-family: Brand, system-ui, sans-serif; background: #0b0b0f; color: #fff; }
  /* a scene is visible from --t0 for --d seconds: fill-mode none, so it's hidden before and after */
  .scene { position: absolute; inset: 0; visibility: hidden; animation: show var(--d) step-end var(--t0); }
  @keyframes show { 0%, 100% { visibility: visible } }
  /* every move inside a scene: a @keyframes animation, animation-delay = its time on the timeline, fill-mode both */
  .scene#hook h1 { animation: rise .6s cubic-bezier(.2,.8,.2,1) .3s both; }
  @keyframes rise { from { opacity: 0; transform: translateY(40px) } }
</style></head>
<body><div id="stage">
  <section class="scene" id="hook" style="--t0: 0s; --d: 2.5s"> … </section>
  …
</div>
<script>window.TIMELINE = { width: 1920, height: 1080, fps: 30, duration: 20 };</script>
<script src="timeline.js"></script>
</body></html>
```

Rules that make it renderable (frames are seeked, not played):
- **Every visible change is a function of time.** Use CSS `@keyframes` with `animation-delay` for timing and `animation-fill-mode: both`, Web Animations created at load, or `BRAG.onFrame((t) => …)` for anything computed: typing, counters, a cursor path, scroll position. No CSS transitions, timers, `Math.random()`, `Date`, or class toggling at runtime.
- **One scene per storyboard panel**, with the panel's `id` as the element id, so a revision touches one block.
- **Sizes in px for the stage size.** For several formats, make one composition per format, or branch on `TIMELINE.format` with layouts made for each shape (never crop).
- **Demo clips:** `<video src="assets/demo.mp4" data-start="6.0" muted playsinline>` is seeked to `t - 6.0`.
- **Fonts and images local** (`assets/`), so frames don't depend on the network.
- Preview by opening `index.html`: it plays and loops; space pauses; `?t=12.5` freezes a frame.

## Storyboard stage

Before animating, make each scene's **settled** layout real: the scene element shown at its `--t0`, with real text, real UI, and the final positions. Motion can be absent. That's enough for `tools/panels.mjs` to render honest panels. Add the motion only after approval.

## Make it alive (build stage)

- A cursor that moves on an eased path, presses (scale 0.9) on the click, and the UI responds on the same frame.
- Typing reveals per character at a human rate (12–20 chars/s) with the caret.
- Push-ins: scale the stage region that matters by 1.15–1.4 over the step, and dim or blur the rest.
- Lists and cards appear one by one (60–120ms stagger), not all at once.
- Transitions: hard cuts on the beat by default; a stagger-out, then stagger-in, for busy layouts. Avoid crossfades between two busy layouts: they turn to mud.
- Springs (`BRAG.ease.spring`, `back`) for UI; `inOut` for camera.

## Render

```bash
node <skill-dir>/tools/export-dom.mjs <output-dir>/composition --out <output-dir>/brag.mp4 --poster <t>
```

It seeks every frame, screenshots the stage, mixes `audio.json`, and muxes the MP4 with ffmpeg. `--from/--to` render a range; `--workers 4` is the default.

## Creative laws (all types)

- **Clear to a stranger.** After one viewing they know what it is, who it's for, and how to get it.
- **The hook is everything.** Plan the first 2 seconds first.
- **Show the thing.** Use the real product doing its job. Invented claims, numbers, or testimonials are not allowed. Small illustrative UI text (a filename, a toast) is fine.
- **Specific.** Use the project's own copy. "Streamline your workflow" and similar generic SaaS lines are banned.
- **Readable.** Pace comes from motion and cuts, never from pulling text early. A line stays fully settled for ≥ 0.3s per word (a short label ≥ 0.8s).
- **Every frame postable.** Any frozen frame should be worth sharing.
- **Funny earns its place.** Humour comes from the project's own absurdity, not from trying.
