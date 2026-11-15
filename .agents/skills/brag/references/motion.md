# Motion

The difference between a slideshow and a video is that **something is always moving** and **every cut is designed**. This file is the motion menu for product-native compositions: GSAP on a paused master timeline (frame-exact, deterministic) plus `runtime/motion.js` (`BRAG.fx`), which gives every effect below a one-line call.

Drawn styles have their own motion (engine cameras, bridges, `engine/craft.md`); the energy rules below still apply to them.

## Energy (pick once, at intake)

Energy decides how much moves. It's separate from tone: tone is the voice, energy is the pulse. Default from the tone, and let the user override with `--energy`.

| Energy | Default for tones | Transitions | Text entrances | Between entrances | Max fully still |
|---|---|---|---|---|---|
| `calm` | deadpan, polished | fade, blur, cut | fade, lines, rise | drift ≤ 1.04 | 1.5s |
| `lively` | default, app-store, cinematic, yc-parody | push, wipe, blur, iris, zoom | rise, chars, blur, type | drift, float, staggered overlays | 1.0s |
| `punchy` | chaotic | whip, zoom, bars, flash, push | chars, slam, flip, pop, scramble | drift + float + emphasis on every key word | 0.5s |
| `hype` | (ask) | whip, glitch, flash, bars, zoom, every cut on a beat | slam, pop, scramble, swap | constant: parallax, pulses on beats, shakes on impacts | 0.3s |

Rules per level:
- **lively and up: every scene change is a named transition** (no unplanned hard cuts). A hard `cut` is allowed when it lands on a beat and is a choice.
- **punchy and up: every scene has an enter, a during and an exit** (see the storyboard fields), and at least one emphasis (highlight, underline, pulse, swap, count) on the key word or number.
- **"Settled" is not "frozen".** A line the viewer must read keeps its ≥ 0.3 s/word hold, but during the hold the scene can drift, float or shift its background. Readability needs the letters still relative to each other, not a frozen frame.
- **Decorative words** (a single slammed word, a swap list, a kinetic accent) can hold for 0.5s; they're not lines to read.
- **No empty frames.** The incoming scene's first text effect starts before or at the transition's midpoint, so the cut never lands on a blank background.
- **One hero effect per scene.** Stack a hero (slam, scramble, flip) with quiet support (rise, fade). Three heroes at once is noise.

## Setup

```html
<script src="gsap.js"></script>      <!-- copied from <skill-dir>/runtime/ -->
<script src="timeline.js"></script>
<script src="ui-motion.js"></script>  <!-- product videos: the app's own motion, from tools/ui-motion.mjs -->
<script src="motion.js"></script>
<script>
BRAG.build((tl, fx) => {
  fx.scenes([
    { el: '#hook', start: 0,   end: 2.4, out: 'whip-left' },
    { el: '#list', start: 2.4, end: 5.2, out: 'zoom' },
    { el: '#cta',  start: 5.2, end: 8 },
  ]);
  const settled = fx.text('#hook h1', 'rise', 0.15);    // returns when it's fully in
  fx.highlight('#hook h1', settled + 0.2, { words: [4, 5] });
  fx.drift('#hook .inner', 0, 2.6);
  tl.from('#list .badge', { y: 80, autoAlpha: 0, stagger: 0.09, ease: 'back.out(1.7)', immediateRender: true }, 2.9);  // film-layer badges
  fx.ui('#list .app .sheet', 3.6, { yPercent: 0 });   // the product's own sheet transition, from ui-motion.js
});
</script>
```

- `BRAG.build` runs once after fonts and images load (SplitText must measure real glyphs). Everything goes on `tl`; times are absolute seconds of the video.
- With `fx.scenes`, drop the CSS `.scene` visibility animation from the skeleton.
- Raw GSAP is fine for anything not in the menu: `tl.from/to/fromTo(targets, vars, atSeconds)`. Use `immediateRender: true` on `from` tweens that start after 0, so the element is hidden before its entrance.
- Animate an inner wrapper (`.scene > .inner`) for drift/float, not the scene element itself: transitions move the scene element.
- Deterministic: Math.random is seeded by timeline.js, so `stagger: { from: 'random' }` is safe. Don't use ScrambleTextPlugin or a CustomWiggle of type `random` (they randomise per render); `fx.scramble` and `fx.shake` are deterministic versions.

## The menu

### Text in: `fx.text(el, name, at, { by, dur, stagger, ease })`
| name | looks like | use for |
|---|---|---|
| `rise` | words slide up out of a line mask | the default headline entrance |
| `lines` | whole lines slide up from masks | paragraphs, two-line hooks |
| `chars` | letters roll up with a little overshoot | titles, short punchy lines |
| `drop` | words drop in from above | contrast with a previous rise |
| `blur` | letters sharpen from a blur while rising | captions, cinematic reveals |
| `pop` | letters pop from zero with a bounce | playful, app-store, numbers |
| `flip` | letters flip up in 3D | product names, CTA |
| `tracking` | spacing collapses from wide while it sharpens | luxury, polished titles |
| `slam` | the whole line slams down from 3× with a shake | one word or number on an impact/beat |
| `type` | typewriter with caret (`cps`, default 16) | prompts, search boxes, code |
| `scramble` | glyphs decode left to right | tech, AI, reveals of a name |
| `fade` | plain fade | calm only |

`by` overrides the split unit (`'chars' | 'words' | 'lines' | 'el'`).

### Text out: `fx.out(el, name, at)`
`rise` · `drop` · `chars` · `blur` · `shrink` · `fade`. Use an out when the next scene arrives with a `cut` or when a line is replaced inside the same scene. With a transition, the transition is the exit.

### Emphasis
- `fx.highlight(el, at, { words: [i…], color })`: marker sweeps behind those words.
- `fx.underline(el, at)`: a line draws under.
- `fx.swap(el, ['word2', 'word3'], at, { every })`: rotating word ("Built for designers / devs / teams").
- `fx.count(el, to, at, { from, dur, decimals, prefix, suffix })`: number counts up. Only real numbers.
- `fx.pulse(el, at)`, `fx.shake(el, at, { strength })`: hits on a beat or impact.

### Ambient (the "during")
- `fx.drift(el, start, end, { scale, x, y })`: slow push-in. Default for any held scene.
- `fx.float(els, start, end, { y, period, phase })`: gentle bob for cards, devices, stickers.
- `fx.parallax([{ el, x, y }, …], start, end)`: layers move at different rates.
- `fx.bgShift('#stage', start, end)`: background gradient drifts (needs `background-size: 300% 300%`).

### Transitions: `out` in `fx.scenes`, optional `outDur`
| name | feel | default |
|---|---|---|
| `cut` | hard cut (choose it, on a beat) | 0 |
| `fade` | soft crossfade, incoming on top | 0.5 |
| `blur` | out-of-focus crossfade with a slight scale | 0.6 |
| `push-left/right/up/down` | both scenes slide, expo ease | 0.6 |
| `whip-left/right/up/down` | fast push with motion blur | 0.35 |
| `zoom` | fly through the old scene into the new | 0.55 |
| `iris` | circle opens (`at: 'x% y%'` to open from the clicked button) | 0.6 |
| `wipe`, `wipe-diag` | hard-edged reveal | 0.5 / 0.6 |
| `bars` | accent bars sweep up and away (`bars`, `color`) | 0.8 |
| `flash` | white flash, new scene settles from 1.12× | 0.3 |
| `flip` | 3D card flip | 0.7 |
| `glitch` | RGB tear for a few frames | 0.3 |

Busy-to-busy layouts: prefer push, whip, bars or zoom over fade/blur (two busy layouts crossfading turn to mud).

## Product UI: the app's motion, not this menu
Everything above is for the **film layer**: titles, captions, overlays, the camera and scene transitions. Elements inside the product (its screens, buttons, lists, sheets, headings) move only with the app's own animations, through `fx.ui` / `fx.uiAnim` and `ui-motion.js`. See [product-native.md → The UI moves like the UI](product-native.md#the-ui-moves-like-the-ui). Energy never adds motion inside the product. At punchy and hype, it adds motion around the product.

Film-layer moves that work with a product:
- A cursor that moves on an eased path, presses (scale 0.9) on the click, and the UI responds on the same frame with the app's own transition.
- Push-ins on the region that matters (scale 1.15–1.4, dim or blur the rest), `power2.inOut`/`expo.inOut`, on a wrapper around the window.
- Callouts over the UI (a ring, an arrow, a label) instead of emphasis effects on the UI's own text.
- MotionPath (`motionPath: { path: '#curve' }`) for a cursor or object along a curve; DrawSVG for strokes drawing on; MorphSVG for icon-to-icon morphs. All are in `gsap.js`.

## Check before showing
Render a motion strip (`panels.mjs --strip`) and look at it: no empty frames at cuts, nothing frozen longer than the energy allows, text never clipped by its line mask after it's in, and the hero effect lands on the beat if there's music.
