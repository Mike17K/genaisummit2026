// Swiss Motion kit: every move snaps to the grid, lands on a beat, never bounces.
// Moves take absolute seconds `at` and return the time they finish. All on BRAG.tl.
(function () {
  const tl = BRAG.tl;
  const $$ = (s) => (typeof s === 'string' ? [...document.querySelectorAll(s)] : s.length != null && !s.nodeType ? [...s] : [s]);
  const BEAT = 0.25; // 120 BPM half beat: the unit all starts snap to
  const snapT = (t) => Math.round(t / BEAT) * BEAT;
  const K = {
    // thin alias of fx.scenes so demos read S.scenes(fx, list)
    scenes(fx, list) {
      const end = fx.scenes(list);
      return end;
    },
    BEAT, snapT,
    // draw the column / baseline guides of a scene: lines drop from the top, staggered, hairline grey
    grid(scope, at, o = {}) {
      const lines = $$(scope + ' .sw-grid i');
      tl.fromTo(lines, { scaleY: 0, scaleX: 0 }, { scaleY: 1, scaleX: 1, duration: o.dur ?? 0.5, stagger: 0.04, ease: 'expo.out', immediateRender: true }, at);
      return at + (o.dur ?? 0.5) + 0.04 * lines.length;
    },
    // an element locks onto its grid position along one axis, expo.out, no overshoot
    snap(el, at, o = {}) {
      const d = o.dist ?? 120, from = o.from || 'left';
      const v = { left: { x: -d }, right: { x: d }, up: { y: -d }, down: { y: d } }[from];
      tl.from($$(el), { ...v, ...(o.fade === false ? {} : { autoAlpha: 0 }), duration: o.dur ?? 0.5, ease: 'expo.out', stagger: o.stagger ?? 0, immediateRender: true }, at);
      return at + (o.dur ?? 0.5) + (o.stagger ?? 0) * ($$(el).length - 1);
    },
    // a rule or bar grows in whole modules (stepped), from its left edge
    bar(el, at, o = {}) {
      const steps = o.steps ?? 8, dur = o.dur ?? 0.5;
      tl.fromTo($$(el), { scaleX: 0 }, { scaleX: 1, duration: dur, ease: `steps(${steps})`, stagger: o.stagger ?? 0, immediateRender: true }, at);
      return at + dur + (o.stagger ?? 0) * ($$(el).length - 1);
    },
    // a block's height grows in modules from its top edge
    column(el, at, o = {}) {
      tl.fromTo($$(el), { scaleY: 0, transformOrigin: '50% 0' }, { scaleY: 1, duration: o.dur ?? 0.5, ease: `steps(${o.steps ?? 8})`, immediateRender: true }, at);
      return at + (o.dur ?? 0.5);
    },
    // numeral counts in whole steps (not smooth), the way a mechanical counter turns
    ticker(el, to, at, o = {}) {
      const node = $$(el)[0], from = o.from ?? 0, n = Math.min(o.steps ?? to - from, to - from), dur = o.dur ?? 0.7;
      const st = { p: 0 };
      node.textContent = String(from);
      tl.to(st, { p: 1, duration: dur, ease: `steps(${n})`, immediateRender: false, onUpdate() { node.textContent = String(Math.round(from + (to - from) * st.p)); } }, at);
      tl.set(node, { textContent: String(to) }, at + dur + 0.001);
      return at + dur;
    },
    // THE exception: the one element that is allowed to be inexact. Locks onto the grid, then slips a few px and degrees off it.
    offGrid(el, at, o = {}) {
      tl.to($$(el), { x: o.dx ?? 14, y: o.dy ?? -10, rotation: o.rot ?? -1.6, duration: o.dur ?? 0.5, ease: 'power2.inOut', immediateRender: false }, at);
      return at + (o.dur ?? 0.5);
    },
    // a thin guide line that sweeps across the page once, like a ruler being laid down (full-bleed hairline)
    sweep(el, at, o = {}) {
      tl.fromTo($$(el), { xPercent: -100 }, { xPercent: 100, duration: o.dur ?? 0.9, ease: 'power2.inOut', immediateRender: true }, at);
      return at + (o.dur ?? 0.9);
    },
  };
  BRAG.styles = BRAG.styles || {};
  BRAG.styles['swiss-motion'] = K;
})();
