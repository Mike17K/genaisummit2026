// brag motion library: named text effects, scene transitions and ambient motion on the GSAP master timeline.
// Load order in index.html:  gsap.js → timeline.js → motion.js → your <script> with BRAG.build((tl, fx) => { … })
// Every function places tweens at an absolute time (seconds) on BRAG.tl and returns the time it finishes,
// so holds can be computed:  const settled = fx.text('#hook h1', 'rise', 0.3);   // readable from `settled`
// The menu with when-to-use notes is references/motion.md. Everything here is deterministic (no Math.random
// at render time), so panels, preview and the 4 export workers all draw the same frame for the same t.
(function () {
  'use strict';
  const G = window.gsap, B = window.BRAG;
  if (!G || !B || !B.tl) { console.error('motion.js: load gsap.js, then timeline.js, then motion.js'); return; }
  const tl = B.tl;
  const $ = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
  const $$ = (x) => (typeof x === 'string' ? [...document.querySelectorAll(x)] : Array.isArray(x) ? x : [x]);
  const stage = document.getElementById('stage') || document.body;
  const hash = (i, k) => { let x = Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(k + 7, 0x85EBCA77); x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const accent = () => getComputedStyle(stage).getPropertyValue('--accent').trim() || '#fff';

  // ---- splitting: one SplitText per element (lines masked), reused by in/out/emphasis effects
  const splits = new Map();
  function split(el) {
    el = $(el);
    if (!splits.has(el)) {
      if (!window.SplitText) throw new Error('motion.js: SplitText missing (gsap.js bundle)');
      splits.set(el, SplitText.create(el, { type: 'lines,words,chars', mask: 'lines', linesClass: 'fx-line', wordsClass: 'fx-word', charsClass: 'fx-char' }));
    }
    return splits.get(el);
  }
  // effects that scale or blur past the glyph box open the line masks while they run
  const unmask = (s, at) => tl.set(s.masks || [], { overflow: 'visible' }, at);

  // ---- text in: fx.text(el, name, at, { stagger, dur, ease, by: 'chars'|'words'|'lines' }) → end time
  const TEXT = {
    rise:     { by: 'words', dur: 0.7, stagger: 0.06, from: { yPercent: 110 }, ease: 'expo.out' },
    lines:    { by: 'lines', dur: 0.8, stagger: 0.1, from: { yPercent: 110 }, ease: 'expo.out' },
    chars:    { by: 'chars', dur: 0.6, stagger: 0.025, from: { yPercent: 110 }, ease: 'back.out(1.6)' },
    drop:     { by: 'words', dur: 0.6, stagger: 0.05, from: { yPercent: -110 }, ease: 'expo.out' },
    blur:     { by: 'chars', dur: 0.7, stagger: 0.025, from: { autoAlpha: 0, filter: 'blur(14px)', y: 24 }, ease: 'power3.out', open: true },
    pop:      { by: 'chars', dur: 0.5, stagger: 0.03, from: { scale: 0, autoAlpha: 0, transformOrigin: '50% 80%' }, ease: 'back.out(3)', open: true },
    flip:     { by: 'chars', dur: 0.8, stagger: 0.03, from: { rotationX: -95, autoAlpha: 0, transformOrigin: '50% 50% -20px', transformPerspective: 700 }, ease: 'power4.out', open: true },
    tracking: { by: 'el', dur: 1.0, from: { letterSpacing: '0.6em', autoAlpha: 0, filter: 'blur(10px)' }, ease: 'expo.out', open: true },
    slam:     { by: 'el', dur: 0.32, from: { scale: 2.8, autoAlpha: 0, filter: 'blur(8px)' }, ease: 'power4.in', open: true, after: (el, end) => shake(el.closest('.scene, section') || el.parentElement, end, { strength: 14, dur: 0.35 }) },
    fade:     { by: 'el', dur: 0.5, from: { autoAlpha: 0 }, ease: 'power1.out' },
  };
  function text(el, name, at, o = {}) {
    if (name === 'type') return type(el, at, o);
    if (name === 'scramble') return scramble(el, at, o);
    const e = TEXT[name];
    if (!e) throw new Error(`motion.js: no text effect "${name}" (have: ${Object.keys(TEXT).concat('type', 'scramble').join(', ')})`);
    const by = o.by || e.by, dur = o.dur ?? e.dur, stagger = o.stagger ?? e.stagger ?? 0;
    el = $(el);
    tl.set(el, { autoAlpha: 1 }, at);
    let targets = [el];
    if (by !== 'el') { const s = split(el); targets = s[by]; if (e.open) unmask(s, at); }
    tl.from(targets, { ...e.from, duration: dur, ease: o.ease || e.ease, stagger, immediateRender: true }, at);
    const end = at + dur + stagger * Math.max(0, targets.length - 1);
    if (e.after) e.after(el, at + dur);
    return end;
  }

  // ---- text out: fx.out(el, name, at) → end time.  rise | drop | blur | chars | fade | shrink
  const OUT = {
    rise:   { by: 'words', dur: 0.45, stagger: 0.03, to: { yPercent: -110 }, ease: 'power3.in' },
    drop:   { by: 'words', dur: 0.45, stagger: 0.03, to: { yPercent: 110 }, ease: 'power3.in' },
    chars:  { by: 'chars', dur: 0.35, stagger: 0.012, to: { yPercent: -110 }, ease: 'power2.in' },
    blur:   { by: 'chars', dur: 0.4, stagger: 0.012, to: { autoAlpha: 0, filter: 'blur(12px)', y: -16 }, ease: 'power2.in', open: true },
    shrink: { by: 'el', dur: 0.35, to: { scale: 0.6, autoAlpha: 0 }, ease: 'power3.in', open: true },
    fade:   { by: 'el', dur: 0.3, to: { autoAlpha: 0 }, ease: 'power1.in' },
  };
  function out(el, name, at, o = {}) {
    const e = OUT[name];
    if (!e) throw new Error(`motion.js: no out effect "${name}" (have: ${Object.keys(OUT).join(', ')})`);
    el = $(el);
    const by = o.by || e.by, dur = o.dur ?? e.dur, stagger = o.stagger ?? e.stagger ?? 0;
    let targets = [el];
    if (by !== 'el') { const s = split(el); targets = s[by]; if (e.open) unmask(s, at); }
    tl.to(targets, { ...e.to, duration: dur, ease: o.ease || e.ease, stagger }, at);
    return at + dur + stagger * Math.max(0, targets.length - 1);
  }

  // typewriter with a caret: o.cps (chars/s, default 16), o.caret (true), o.blinks after typing (3)
  function type(el, at, o = {}) {
    el = $(el);
    const s = split(el), cps = o.cps || 16, chars = s.chars;
    tl.set(el, { autoAlpha: 1 }, at);
    tl.set(chars, { autoAlpha: 0 }, 0);
    chars.forEach((c, i) => tl.set(c, { autoAlpha: 1 }, at + i / cps));
    const end = at + chars.length / cps;
    if (o.caret !== false) {
      const caret = document.createElement('span');
      caret.className = 'fx-caret';
      caret.style.cssText = 'display:inline-block;width:0.08em;height:0.95em;margin-left:0.06em;vertical-align:-0.1em;background:currentColor';
      el.appendChild(caret);
      tl.set(caret, { autoAlpha: 0 }, 0);
      tl.set(caret, { autoAlpha: 1 }, at);
      const blinks = o.blinks ?? 3;
      for (let k = 0; k < blinks; k++) { tl.set(caret, { autoAlpha: 0 }, end + 0.35 + k * 0.7); tl.set(caret, { autoAlpha: 1 }, end + 0.7 + k * 0.7); }
      tl.set(caret, { autoAlpha: 0 }, end + 0.35 + blinks * 0.7);
    }
    return end;
  }

  // decoding effect: characters cycle through glyphs and lock in left to right (deterministic per frame)
  function scramble(el, at, o = {}) {
    el = $(el);
    const s = split(el), chars = s.chars, finals = chars.map((c) => c.textContent);
    const glyphs = o.glyphs || 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=<>/';
    const dur = o.dur ?? Math.max(0.6, chars.length * 0.04), lock = o.lock ?? 0.55;
    const state = { p: 0 };
    tl.set(el, { autoAlpha: 0 }, 0);
    tl.set(el, { autoAlpha: 1 }, at);
    tl.fromTo(state, { p: 0 }, {
      p: 1, duration: dur, ease: 'none', immediateRender: true,
      onUpdate() {
        const p = state.p, frame = Math.floor(p * dur * 30);
        chars.forEach((c, i) => {
          const lockAt = lock + (1 - lock) * (i / Math.max(1, chars.length - 1));
          if (p >= lockAt || finals[i] === ' ') c.textContent = finals[i];
          else if (p < (i / chars.length) * lock) c.textContent = ' ';
          else c.textContent = glyphs[Math.floor(hash(i, frame) * glyphs.length)];
        });
      },
    }, at);
    return at + dur;
  }

  // ---- emphasis on text that's already in
  // marker highlight behind words (o.words: indexes or 'all'; o.color)
  function highlight(el, at, o = {}) {
    const s = split(el), words = o.words === undefined || o.words === 'all' ? s.words : o.words.map((i) => s.words[i]);
    const marks = words.map((w) => {
      const m = document.createElement('span');
      m.style.cssText = `position:absolute;left:-0.08em;right:-0.08em;top:0.12em;bottom:0.02em;z-index:-1;background:${o.color || accent()};transform-origin:0 50%`;
      if (getComputedStyle(w).position === 'static') w.style.position = 'relative';
      w.style.zIndex = 0; w.appendChild(m); return m;
    });
    unmask(s, at);
    tl.fromTo(marks, { scaleX: 0 }, { scaleX: 1, duration: o.dur ?? 0.45, ease: 'power3.inOut', stagger: 0.12, immediateRender: true }, at);
    return at + (o.dur ?? 0.45) + 0.12 * (marks.length - 1);
  }
  // underline that draws under the element
  function underline(el, at, o = {}) {
    el = $(el);
    const u = document.createElement('span');
    u.style.cssText = `position:absolute;left:0;right:0;bottom:-0.08em;height:${o.thickness || '0.08em'};background:${o.color || accent()};transform-origin:0 50%`;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(u);
    tl.fromTo(u, { scaleX: 0 }, { scaleX: 1, duration: o.dur ?? 0.5, ease: 'expo.inOut', immediateRender: true }, at);
    return at + (o.dur ?? 0.5);
  }
  // rotating word: el holds the first word; words[] cycle in with a masked roll, one every `every` seconds
  function swap(el, words, at, o = {}) {
    el = $(el);
    const every = o.every ?? 0.9, dur = o.dur ?? 0.45;
    el.style.display = 'inline-grid'; el.style.overflow = 'clip'; el.style.verticalAlign = 'bottom';
    const first = el.textContent; el.textContent = '';
    const items = [first, ...words].map((w) => { const sp = document.createElement('span'); sp.textContent = w; sp.style.gridArea = '1/1'; el.appendChild(sp); return sp; });
    tl.set(items.slice(1), { yPercent: 110 }, 0);
    items.slice(1).forEach((sp, i) => {
      const t = at + i * every;
      tl.to(items[i], { yPercent: -110, duration: dur, ease: 'expo.inOut' }, t);
      tl.fromTo(sp, { yPercent: 110 }, { yPercent: 0, duration: dur, ease: 'expo.inOut', immediateRender: false }, t);
    });
    return at + (items.length - 2) * every + dur;
  }
  // number counter: el's text becomes `to` (formatted with o.decimals, o.prefix, o.suffix, thousands separators)
  function count(el, to, at, o = {}) {
    el = $(el);
    const st = { v: o.from ?? 0 }, dur = o.dur ?? 1.2;
    const fmt = (v) => (o.prefix || '') + v.toLocaleString(o.locale || 'en-US', { minimumFractionDigits: o.decimals || 0, maximumFractionDigits: o.decimals || 0 }) + (o.suffix || '');
    el.textContent = fmt(st.v);
    tl.fromTo(st, { v: o.from ?? 0 }, { v: to, duration: dur, ease: o.ease || 'expo.out', immediateRender: true, onUpdate: () => { el.textContent = fmt(st.v); } }, at);
    return at + dur;
  }
  function pulse(el, at, o = {}) { tl.fromTo($$(el), { scale: 1 }, { scale: o.scale ?? 1.12, duration: (o.dur ?? 0.4) / 2, ease: 'power2.out', yoyo: true, repeat: 1, immediateRender: false }, at); return at + (o.dur ?? 0.4); }
  function shake(el, at, o = {}) {
    if (window.CustomWiggle && !G.parseEase('fxShake')) CustomWiggle.create('fxShake', { wiggles: 7, type: 'easeOut' });
    tl.fromTo($$(el), { x: 0 }, { x: o.strength ?? 10, duration: o.dur ?? 0.35, ease: G.parseEase('fxShake') || 'none', immediateRender: false, clearProps: 'x' }, at);
    return at + (o.dur ?? 0.35);
  }

  // ---- ambient: keep a scene alive while it holds
  // slow push-in (Ken Burns); o.scale (1.06), o.x / o.y in px
  function drift(el, start, end, o = {}) { tl.fromTo($$(el), { scale: 1, x: 0, y: 0 }, { scale: o.scale ?? 1.06, x: o.x ?? 0, y: o.y ?? 0, duration: end - start, ease: 'none', immediateRender: false }, start); return end; }
  // gentle bob; o.y (px, 10), o.period (s, 3), o.phase (0..1) so several elements don't move in sync
  function float(el, start, end, o = {}) {
    const period = o.period ?? 3, amp = o.y ?? 10, ph = (o.phase ?? 0) * Math.PI * 2;
    const st = { t: 0 }, targets = $$(el);
    tl.fromTo(st, { t: 0 }, { t: end - start, duration: end - start, ease: 'none', immediateRender: false, onUpdate: () => G.set(targets, { y: amp * Math.sin((st.t / period) * Math.PI * 2 + ph) }) }, start);
    return end;
  }
  // parallax: layers [{el, x, y}] move by their own amount across the span (foreground more than background)
  function parallax(layers, start, end) { layers.forEach((l) => tl.fromTo($$(l.el), { x: 0, y: 0 }, { x: l.x ?? 0, y: l.y ?? 0, duration: end - start, ease: 'none', immediateRender: false }, start)); return end; }
  // animated gradient background: el needs a background-image larger than itself (background-size: 300% 300%)
  function bgShift(el, start, end) { tl.fromTo($$(el), { backgroundPosition: '0% 50%' }, { backgroundPosition: '100% 50%', duration: end - start, ease: 'sine.inOut', immediateRender: false }, start); return end; }

  // ---- scenes and transitions
  // fx.scenes([{ el: '#hook', start: 0, end: 2.5, out: 'whip-left', outDur: 0.4 }, …])
  // Each scene is visible over [start, end); `out` is the transition into the NEXT scene, centred on `end`.
  // Use this instead of the CSS .scene visibility animation (remove that rule when using fx.scenes).
  const TRANS = {
    cut:          { d: 0 },
    fade:         { d: 0.5, run: (a, b, t, d) => { tl.fromTo(b, { autoAlpha: 0 }, { autoAlpha: 1, duration: d, ease: 'power1.inOut', immediateRender: false }, t); } },
    blur:         { d: 0.6, run: (a, b, t, d) => {
      tl.to(a, { filter: 'blur(24px)', scale: 1.08, autoAlpha: 0, duration: d, ease: 'power2.in' }, t);
      tl.fromTo(b, { filter: 'blur(24px)', scale: 0.94, autoAlpha: 0 }, { filter: 'blur(0px)', scale: 1, autoAlpha: 1, duration: d, ease: 'power2.out', immediateRender: false }, t + d * 0.25);
    } },
    zoom:         { d: 0.55, run: (a, b, t, d) => {
      tl.to(a, { scale: 3, autoAlpha: 0, filter: 'blur(10px)', duration: d, ease: 'power3.in' }, t);
      tl.fromTo(b, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: d * 0.8, ease: 'expo.out', immediateRender: false }, t + d * 0.4);
    } },
    flash:        { d: 0.3, run: (a, b, t, d) => {
      const f = overlay('#fff');
      tl.fromTo(f, { autoAlpha: 0 }, { autoAlpha: 1, duration: d / 2, ease: 'power2.in', immediateRender: true }, t);
      tl.to(f, { autoAlpha: 0, duration: d, ease: 'power2.out' }, t + d / 2);
      tl.set(a, { autoAlpha: 0 }, t + d / 2);
      tl.fromTo(b, { scale: 1.12 }, { scale: 1, duration: d * 1.5, ease: 'expo.out', immediateRender: false }, t + d / 2);
    } },
    iris:         { d: 0.6, run: (a, b, t, d, o) => { tl.fromTo(b, { clipPath: `circle(0% at ${o.at || '50% 50%'})` }, { clipPath: `circle(150% at ${o.at || '50% 50%'})`, duration: d, ease: 'power3.in', immediateRender: false, clearProps: 'clipPath' }, t); } },
    wipe:         { d: 0.5, run: (a, b, t, d) => { tl.fromTo(b, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: d, ease: 'expo.inOut', immediateRender: false, clearProps: 'clipPath' }, t); } },
    'wipe-diag':  { d: 0.6, run: (a, b, t, d) => { tl.fromTo(b, { clipPath: 'polygon(0 0, 0 0, 0 100%, 0 100%)' }, { clipPath: 'polygon(0 0, 140% 0, 100% 100%, -40% 100%)', duration: d, ease: 'expo.inOut', immediateRender: false, clearProps: 'clipPath' }, t); } },
    bars:         { d: 0.8, run: (a, b, t, d, o) => {
      const n = o.bars || 5, color = o.color || accent();
      const bars = Array.from({ length: n }, (_, i) => { const e = overlay(color); Object.assign(e.style, { left: (i * 100) / n + '%', width: 100 / n + 0.2 + '%', right: 'auto' }); return e; });
      tl.set(bars, { autoAlpha: 1 }, t);
      tl.fromTo(bars, { yPercent: 100 }, { yPercent: 0, duration: d / 2, ease: 'power3.in', stagger: 0.04, immediateRender: false }, t);
      tl.set(a, { autoAlpha: 0 }, t + d / 2 + 0.04 * n);
      tl.to(bars, { yPercent: -100, duration: d / 2, ease: 'power3.out', stagger: 0.04 }, t + d / 2 + 0.04 * n);
      tl.set(bars, { autoAlpha: 0 }, t + d + 0.08 * n);
    } },
    flip:         { d: 0.7, run: (a, b, t, d) => {
      G.set(stage, { perspective: 1600 });
      tl.to(a, { rotationY: -90, duration: d / 2, ease: 'power2.in', transformOrigin: '50% 50%' }, t);
      tl.set(a, { autoAlpha: 0 }, t + d / 2);
      tl.fromTo(b, { rotationY: 90, autoAlpha: 1 }, { rotationY: 0, duration: d / 2, ease: 'power2.out', immediateRender: false }, t + d / 2);
    } },
    glitch:       { d: 0.3, run: (a, b, t, d) => {
      const steps = 6;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps, tgt = u < 0.5 ? a : b;
        tl.set(tgt, { x: (hash(k, 3) - 0.5) * 60, filter: `hue-rotate(${Math.round(hash(k, 5) * 180)}deg) saturate(2.5) contrast(1.4)`, clipPath: `inset(${Math.round(hash(k, 9) * 40)}% 0 ${Math.round(hash(k, 11) * 40)}% 0)` }, t + u * d);
      }
      tl.set(a, { autoAlpha: 0 }, t + d / 2);
      tl.set(b, { x: 0, filter: 'none', clipPath: 'none' }, t + d);
    } },
  };
  for (const dir of ['left', 'right', 'up', 'down']) {
    const axis = dir === 'left' || dir === 'right' ? 'xPercent' : 'yPercent', sgn = dir === 'left' || dir === 'up' ? -1 : 1;
    TRANS['push-' + dir] = { d: 0.6, run: (a, b, t, d) => {
      tl.to(a, { [axis]: 100 * sgn, duration: d, ease: 'expo.inOut' }, t);
      tl.fromTo(b, { [axis]: -100 * sgn }, { [axis]: 0, duration: d, ease: 'expo.inOut', immediateRender: false }, t);
    } };
    TRANS['whip-' + dir] = { d: 0.35, run: (a, b, t, d) => {
      tl.to(a, { [axis]: 100 * sgn, duration: d, ease: 'power4.in' }, t);
      tl.fromTo(a, { filter: 'blur(0px)' }, { filter: 'blur(30px)', duration: d, ease: 'power4.in', immediateRender: false }, t);
      tl.fromTo(b, { [axis]: -100 * sgn, filter: 'blur(30px)' }, { [axis]: 0, filter: 'blur(0px)', duration: d * 1.3, ease: 'power4.out', immediateRender: false }, t + d * 0.7);
    } };
  }
  function overlay(color) {
    const e = document.createElement('div');
    e.className = 'fx-overlay';
    e.style.cssText = `position:absolute;inset:0;background:${color};z-index:9000;pointer-events:none;visibility:hidden`;
    stage.appendChild(e);
    return e;
  }
  function scenes(list) {
    const els = list.map((s) => $(s.el));
    // visibility is decided per frame from each scene's window (not by GSAP sets, whose revert on a backwards
    // seek isn't reliable); the transitions only animate opacity, transforms, filters and clip paths
    const win = list.map((s) => [s.start, s.end]);
    els.forEach((el, i) => { G.set(el, { zIndex: i + 1 }); });
    list.forEach((s, i) => {
      const a = els[i], b = els[i + 1];
      if (!b) return;
      const name = s.out || 'cut', tr = TRANS[name];
      if (!tr) throw new Error(`motion.js: no transition "${name}" (have: ${Object.keys(TRANS).join(', ')})`);
      const d = s.outDur ?? tr.d, t = s.end - d / 2;
      if (d) { win[i][1] = Math.max(win[i][1], s.end + d / 2); win[i + 1][0] = Math.min(win[i + 1][0], t); }
      if (tr.run) tr.run(a, b, t, d, s);
    });
    const last = list.length - 1;
    B.onFrame((t) => els.forEach((el, i) => { el.style.visibility = t >= win[i][0] && (t < win[i][1] || (i === last && t <= win[i][1] + 1e-6)) ? 'visible' : 'hidden'; }));
    return list[last].end;
  }

  // ---- the product's own motion (product-native.md → "The UI moves like the UI")
  // Inside the product's UI, state changes replay the app's real transitions: fx.ui looks up the duration and easing
  // in window.UI_MOTION (tools/ui-motion.mjs) for the element and the properties it changes. If the app has no
  // transition for them, the change is instant, because that's what the app does.
  const NAMED_EASE = { ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };
  const easeCache = new Map();
  // a CSS timing function → a GSAP ease (cubic-bezier via CustomEase, linear() as a piecewise function, steps)
  function cssEase(s) {
    s = (s || 'ease').trim();
    if (easeCache.has(s)) return easeCache.get(s);
    let e;
    const steps = /^steps\(\s*(\d+)/.exec(s);
    if (s === 'linear') e = 'none';
    else if (steps) e = `steps(${steps[1]})`;
    else if (s === 'step-end' || s === 'step-start') e = 'steps(1)';
    else if (s.startsWith('linear(')) {
      const pts = splitArgs(s.slice(7, -1)).map((p, i, all) => { const [v, at] = p.split(/\s+/); return { v: +v, x: at ? parseFloat(at) / 100 : NaN, i, n: all.length }; });
      pts.forEach((p, i) => { if (isNaN(p.x)) p.x = i === 0 ? 0 : i === pts.length - 1 ? 1 : NaN; });
      for (let i = 1; i < pts.length; i++) if (isNaN(pts[i].x)) { let j = i; while (isNaN(pts[j].x)) j++; for (let k = i; k < j; k++) pts[k].x = pts[i - 1].x + ((pts[j].x - pts[i - 1].x) * (k - i + 1)) / (j - i + 1); }
      e = (t) => { let i = 1; while (i < pts.length - 1 && pts[i].x < t) i++; const a = pts[i - 1], b = pts[i]; return b.x === a.x ? b.v : a.v + ((b.v - a.v) * (t - a.x)) / (b.x - a.x); };
    } else {
      const p = NAMED_EASE[s] || (/cubic-bezier\(([^)]+)\)/.exec(s) || [])[1]?.split(',').map(Number);
      e = p && window.CustomEase ? CustomEase.create('css' + easeCache.size, `M0,0 C${p[0]},${p[1]} ${p[2]},${p[3]} 1,1`) : 'power1.out';
    }
    easeCache.set(s, e);
    return e;
  }
  const splitArgs = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const UI_PROP = { x: 'transform', y: 'transform', xPercent: 'transform', yPercent: 'transform', scale: 'transform', scaleX: 'transform', scaleY: 'transform',
    rotation: 'transform', rotate: 'transform', autoAlpha: 'opacity', backgroundColor: 'background' };
  const cssProp = (k) => UI_PROP[k] || k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  const STATE = /:(hover|active|focus|focus-visible|focus-within|checked|disabled|enabled|open)\b/g;
  // the app's transition for el and these properties: the last matching rule wins, as in the cascade
  function uiTransition(el, props) {
    let hit = null;
    for (const t of (window.UI_MOTION && UI_MOTION.transitions) || []) {
      if (/::?(before|after|placeholder)/.test(t.selector) || (t.media && !matchMedia(t.media.replace(/^@media\s*/, '')).matches)) continue;
      let ok = false;
      try { ok = el.matches(t.selector.replace(STATE, '') || '*'); } catch (e) { /* selector the browser can't parse */ }
      const p = t.property;
      if (ok && (p === 'all' || props.some((q) => q === p || q.startsWith(p + '-') || (p === 'background-color' && q === 'background')))) hit = t;
    }
    return hit;
  }
  // fx.ui(el, at, toVars, { dur, ease, delay }) → end time. toVars as in GSAP (x, scale, autoAlpha, backgroundColor…).
  // o.dur / o.ease override the inventory (CSS or GSAP ease names); use them for motion that lives in the app's JS.
  function ui(el, at, to, o = {}) {
    const els = $$(el), props = [...new Set(Object.keys(to).map(cssProp))];
    const t = o.dur === undefined ? uiTransition(els[0], props) : null;
    const dur = o.dur ?? (t ? t.duration : 0), delay = o.delay ?? (t ? t.delay : 0);
    const isCss = (s) => /^(cubic-bezier|linear|steps)\(|^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/.test(s);
    const ease = o.ease ? (typeof o.ease === 'string' && isCss(o.ease) ? cssEase(o.ease) : o.ease) : cssEase(t && t.easing);
    // an instant change is a 1 ms tween: unlike a zero-length set, it reverts reliably on a backwards seek
    tl.to(els, { ...to, duration: Math.max(dur, 0.001), ease: dur ? ease : 'none' }, at + delay);
    return at + delay + dur;
  }
  // fx.uiAnim(el, name, at, { dur, ease, iterations }) → end time: play one of the app's own @keyframes (copied in
  // with its CSS) starting at `at`, with the duration, easing and count the app uses for it
  function uiAnim(el, name, at, o = {}) {
    const k = ((window.UI_MOTION && UI_MOTION.animations) || []).find((a) => a.name === name) || {};
    const dur = o.dur ?? k.duration ?? 0.24, n = o.iterations ?? k.iterations ?? '1';
    $$(el).forEach((e) => { e.style.animation = `${name} ${dur}s ${o.ease || k.easing || 'ease'} ${at}s ${n} ${o.direction || k.direction || 'normal'} both`; });
    return at + dur * (n === 'infinite' ? 1 : Number(n));
  }

  B.fx = { text, out, type, scramble, highlight, underline, swap, count, pulse, shake, drift, float, parallax, bgShift, scenes, split, ui, uiAnim, cssEase,
    transitions: Object.keys(TRANS), texts: Object.keys(TEXT).concat('type', 'scramble'), outs: Object.keys(OUT) };
})();
