// brag product-native runtime: makes an HTML/CSS composition seekable frame by frame.
// Include it last in <body>:  <script src="timeline.js"></script>  (copy this file next to index.html)
//
// The composition defines, before this script:
//   window.TIMELINE = { width: 1920, height: 1080, fps: 30, duration: 20 }
// and animates with CSS @keyframes (animation-delay = when it happens on the timeline), the Web Animations API,
// and/or JS per-frame callbacks:  BRAG.onFrame((t) => { ... })   (t in seconds; pure function of t, no state)
// <video data-start="4.0"> elements are seeked to (t - start). Never use CSS transitions, setTimeout,
// Math.random(), or Date for anything visible: they can't be seeked.
//
// What it exposes:
//   window.seek(t)            -> Promise: the frame at time t is painted (tools/panels.mjs, tools/export-dom.mjs)
//   window.BRAG_READY         -> Promise: fonts, images and videos are loaded
//   BRAG.onFrame(fn)          register a per-frame callback
//   BRAG.p(t, t0, d, ease)    0..1 progress of a move that starts at t0 and lasts d (clamped, eased)
//   BRAG.ease                 { linear, inOut, out, in, back, spring }
//   BRAG.mix(a, b, u)         lerp
// Preview (open index.html in a browser): plays in real time, loops. Space = play/pause, ←/→ = ±1s,
// ?t=12.5 freezes a frame, ?export=1 hides the preview controls (the tools set it).
(function () {
  'use strict';
  const T = window.TIMELINE;
  if (!T) throw new Error('timeline.js: define window.TIMELINE = { width, height, fps, duration } first');
  T.fps = T.fps || 30;
  const params = new URLSearchParams(location.search);
  const EXPORT = params.has('export');
  const callbacks = [];
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = {
    linear: (u) => u,
    in: (u) => u * u * u,
    out: (u) => 1 - Math.pow(1 - u, 3),
    inOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    back: (u) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); },
    spring: (u) => (u >= 1 ? 1 : 1 - Math.exp(-6 * u) * Math.cos(10 * u)),
  };
  window.BRAG = {
    onFrame: (fn) => callbacks.push(fn),
    p: (t, t0, d, e = ease.inOut) => e(clamp((t - t0) / d)),
    ease, clamp,
    mix: (a, b, u) => a + (b - a) * u,
  };

  // the stage: fixed size, scaled to fit the window in preview, 1:1 in export
  const stage = document.getElementById('stage') || document.body;
  Object.assign(stage.style, { width: T.width + 'px', height: T.height + 'px', position: 'relative', overflow: 'hidden' });
  document.documentElement.style.background = '#111';
  document.body.style.margin = '0';
  function fit() {
    if (EXPORT) return;
    const k = Math.min(innerWidth / T.width, (innerHeight - 40) / T.height, 1);
    stage.style.transformOrigin = '0 0';
    stage.style.transform = `scale(${k})`;
  }

  async function ready() {
    await document.fonts.ready;
    const imgs = [...document.images].map((i) => (i.complete ? (i.decode ? i.decode().catch(() => {}) : null) : new Promise((r) => { i.onload = i.onerror = r; })));
    const vids = [...document.querySelectorAll('video')].map((v) => {
      v.muted = true; v.pause();
      return v.readyState >= 2 ? null : new Promise((r) => { v.addEventListener('loadeddata', r, { once: true }); v.addEventListener('error', r, { once: true }); v.load(); });
    });
    await Promise.all([...imgs, ...vids]);
  }
  window.BRAG_READY = (document.readyState === 'complete' ? Promise.resolve() : new Promise((r) => addEventListener('load', r, { once: true }))).then(ready);

  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let current = 0;
  async function seek(t, { wait = true } = {}) {
    current = t;
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
    for (const fn of callbacks) fn(t);
    const seeks = [];
    for (const v of document.querySelectorAll('video')) {
      const local = Math.max(0, t - Number(v.dataset.start || 0));
      const target = Math.min(local, (v.duration || Infinity) - 0.001);
      if (Math.abs(v.currentTime - target) > 0.5 / T.fps) {
        if (wait) seeks.push(new Promise((r) => v.addEventListener('seeked', r, { once: true })));
        v.currentTime = target;
      }
    }
    if (wait) { await Promise.all(seeks); await raf(); }
  }
  window.seek = async (t) => { await window.BRAG_READY; await seek(t); return t; };

  if (EXPORT) return;

  // ---- preview: play in real time with a small control bar
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:40px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#000c;color:#eee;font:13px system-ui;z-index:99999';
  bar.innerHTML = '<button id="bragPlay" style="font:inherit;padding:2px 10px">❚❚</button><input id="bragScrub" type="range" min="0" step="0.001" style="flex:1"><span id="bragTime" style="font-variant-numeric:tabular-nums;min-width:90px;text-align:right"></span>';
  document.body.appendChild(bar);
  const play = bar.querySelector('#bragPlay'), scrub = bar.querySelector('#bragScrub'), label = bar.querySelector('#bragTime');
  scrub.max = T.duration;
  let playing = !params.has('t'), t0 = performance.now() - Number(params.get('t') || 0) * 1000;
  const show = (t) => { scrub.value = t; label.textContent = `${t.toFixed(2)} / ${T.duration}s`; };
  function tick() {
    if (playing) { const t = ((performance.now() - t0) / 1000) % T.duration; seek(t, { wait: false }); show(t); }
    requestAnimationFrame(tick);
  }
  const setPlaying = (p) => { playing = p; play.textContent = p ? '❚❚' : '▶'; if (p) t0 = performance.now() - current * 1000; };
  play.onclick = () => setPlaying(!playing);
  scrub.oninput = () => { setPlaying(false); seek(Number(scrub.value), { wait: false }); show(Number(scrub.value)); };
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') { setPlaying(false); const t = clamp(current + (e.code === 'ArrowRight' ? 1 : -1), 0, T.duration); seek(t, { wait: false }); show(t); }
  });
  addEventListener('resize', fit);
  window.BRAG_READY.then(() => { fit(); seek(Number(params.get('t') || 0), { wait: false }); show(current); requestAnimationFrame(tick); });
})();
