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
- **Motion:** how the app itself moves. Run `node <skill-dir>/tools/ui-motion.mjs <project-dir | url> --out <composition>/ui-motion.js`. It inventories the app's CSS transitions, `@keyframes` animations, motion tokens (`--dur-*`, `--ease-*`, springs as `linear()`), and lists the JS that animates (`.animate()`, View Transitions, Framer Motion, GSAP) with file:line. The printed summary is enough to start. For each interaction in the flow you show, grep the file for its selector, or read the listed JS lines. The file can be large, so don't read all of it. Note what each interaction does in the app: what moves, how long it takes, and its curve. Write "instant" when nothing animates.
- **Screens:** `node <skill-dir>/engine/tools/capture.mjs <url> <composition>/assets/<name>.png [--selector css] [--full] [--dark]` for the user's own site only. Prefer **re-rendering the real markup and CSS** over panning across flat screenshots: copy the component's HTML/CSS into the composition so you can animate its parts.

## The composition

```
<output-dir>/composition/
  index.html      the video: one page, one #stage of exactly TIMELINE.width × height
  gsap.js         copied from <skill-dir>/runtime/ (GSAP + plugins)
  timeline.js     copied from <skill-dir>/runtime/timeline.js
  motion.js       copied from <skill-dir>/runtime/motion.js (BRAG.fx, see motion.md)
  ui-motion.js    the app's own motion (tools/ui-motion.mjs); load it before motion.js
  assets/         fonts, logo, screenshots, demo clips (copied in, all local)
  audio.json      the mix (see audio.md)
```

Skeleton (CSS-only timing; for real motion add GSAP and `fx.scenes` as [motion.md](motion.md) → Setup shows, and drop the `.scene` visibility rule):

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
- **Every visible change is a function of time.** Use GSAP tweens on `BRAG.tl` inside `BRAG.build` (preferred: motion.js effects, springs, SplitText), CSS `@keyframes` with `animation-delay` and `animation-fill-mode: both`, Web Animations created at load, or `BRAG.onFrame((t) => …)` for anything computed. No CSS transitions, timers, `Math.random()`, `Date`, or class toggling at runtime.
- **One scene per storyboard panel**, with the panel's `id` as the element id, so a revision touches one block.
- **Sizes in px for the stage size.** For several formats, make one composition per format, or branch on `TIMELINE.format` with layouts made for each shape (never crop).
- **Demo clips:** `<video src="assets/demo.mp4" data-start="6.0" muted playsinline>` is seeked to `t - 6.0`.
- **Fonts and images local** (`assets/`), so frames don't depend on the network.
- Preview by opening `index.html`: it plays and loops; space pauses; `?t=12.5` freezes a frame.

## Storyboard stage

Before the review, make each scene's **settled** layout real: real text, real UI, and the final positions. At `lively` energy and up, also write the planned motion (it's a line per effect with motion.js) and render panels with `--strip`, so the user approves the movement too. At `calm`, motion can wait until after approval.

## The UI moves like the UI

The product's own animations are part of what you're showing. When brag invents motion for the UI, such as springy buttons, staggered lists or headings rising word by word, the product looks like a different, worse app. So a composition has two layers:

| Layer | What it is | How it moves |
|---|---|---|
| **The product** | everything inside the app window or device: screens, buttons, sheets, lists, toasts, its headings and copy | **only as the app does.** `fx.ui(el, at, toVars)` replays the app's transition for that element (its duration and easing, springs included) from `ui-motion.js`. `fx.uiAnim(el, name, at)` plays one of its `@keyframes`. Motion that lives in the app's JS goes through `fx.ui(…, { dur, ease })` with the values read from that code. If the app has no animation for a change, the change is instant. |
| **The film** | the camera on the window, scene transitions, titles and captions outside the app, overlays, cursor, mascot, background | brag's motion menu ([motion.md](motion.md)) and the energy level |

Rules:
- **No `fx.text`, emphasis, `float`, staggers or springs on elements inside the product** unless the app does exactly that. Emphasise a product element from the film layer instead: a camera push-in, a callout or ring drawn over it, or a caption.
- **Cause and effect at the app's speed.** A click changes state on the same frame, then the UI animates with the app's own timing. Don't slow it down or add flourishes. To give the viewer time, hold on the result or slow the camera, never the UI.
- **The app's mount animations:** keyframe animations in the copied CSS (a card that rises in when it renders) play from t=0. Re-time them with `fx.uiAnim(el, name, at)` at the moment the element appears.
- **CSS transitions are off** in compositions (timeline.js turns them off; they run on the wall clock). The real CSS can be copied as it is: `fx.ui` replays its transitions on the timeline.
- **Screen changes** use the app's own transition if it has one: a View Transition, a slide or a sheet, replayed with `fx.ui`/`fx.uiAnim`. A film transition (push, whip, zoom) is for a cut between chapters, not for the app navigating.
- **Same property, one owner.** Don't animate one element's `transform` with both `fx.uiAnim` (a CSS animation wins over inline styles) and `fx.ui`/camera tweens. Move the camera on a wrapper around the window.
- **A motion style changes the film layer only.** Its palette, type and kit moves frame the product; they don't restyle or re-animate it.

## Make it alive (build stage)

Follow [motion.md](motion.md) for the film layer: the energy level's rules, text effects, emphasis, ambient motion and transitions. Follow the section above for the product.

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
- **Readable.** Pace comes from motion and cuts, never from pulling text early. A line stays fully settled for ≥ 0.3s per word (a short label ≥ 0.8s); the scene around it can keep drifting.
- **Every frame postable.** Any frozen frame should be worth sharing.
- **Funny earns its place.** Humour comes from the project's own absurdity, not from trying.
