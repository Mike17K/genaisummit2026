// dark-keynote kit: light reveals, snap-grid spawns, UI expand transitions, a precise cursor, the lone giant number.
// Every move takes `at` (seconds) and returns the time it ends; everything is on BRAG.tl (deterministic).
(function () {
  'use strict';
  const B = window.BRAG, G = window.gsap;
  B.styles = B.styles || {};
  const stage = () => document.getElementById('stage');
  const $ = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
  const $$ = (x) => (typeof x === 'string' ? [...document.querySelectorAll(x)] : Array.isArray(x) ? x : [x]);
  const W = () => (window.TIMELINE && window.TIMELINE.width) || 1080;
  const H = () => (window.TIMELINE && window.TIMELINE.height) || 1920;
  const mk = (cls, html) => { const e = document.createElement('div'); e.className = cls; if (html) e.innerHTML = html; stage().appendChild(e); return e; };
  // rect of an element in stage coordinates (use before animating it, or pass a literal {x,y,w,h})
  const rectOf = (r) => {
    if (r && r.w != null) return r;
    const s = stage().getBoundingClientRect(), k = s.width / W(), b = $(r).getBoundingClientRect();
    return { x: (b.left - s.left) / k, y: (b.top - s.top) / k, w: b.width / k, h: b.height / k };
  };

  const S = B.styles['dark-keynote'] = {
    // light sweep across the whole stage (a soft cool band), 0.9 s default
    sweep(at, o = {}) {
      const dur = o.dur ?? 0.9, el = stage().querySelector('.dk-light') || mk('dk-light');
      B.tl.fromTo(el, { x: o.from ?? -200 }, { x: o.to ?? W() + 700, duration: dur, ease: 'power2.inOut', immediateRender: false }, at);
      return at + dur;
    },
    // light is the reveal tool: only the pixels the light has passed turn on (a mask edge travels over `el`)
    lightReveal(el, at, o = {}) {
      const dur = o.dur ?? 1.0;
      B.tl.fromTo($(el), { '--p': -30 }, { '--p': 135, duration: dur, ease: 'power2.inOut', immediateRender: true }, at);
      if (o.rise !== false) B.tl.fromTo($(el), { y: 26 }, { y: 0, duration: dur * 0.8, ease: 'expo.out', immediateRender: true }, at);
      return at + dur;
    },
    // short, typed spawn: drop + one small bounce on the 48 px grid (0.28 s each). returns end of the last one
    snapIn(els, at, o = {}) {
      const list = $$(els), gap = o.gap ?? 0.12, dy = o.dy ?? -48;
      B.tl.fromTo(list, { y: dy, autoAlpha: 0, scale: 0.97 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.28, ease: 'back.out(1.7)', stagger: gap, immediateRender: true }, at);
      return at + 0.28 + gap * (list.length - 1);
    },
    // a grid ring spreading from a point, lime hairlines lit only where the ring is
    ping(at, o = {}) {
      const el = mk('dk-ping'); el.style.setProperty('--cx', (o.x ?? W() / 2) + 'px'); el.style.setProperty('--cy', (o.y ?? H() / 2) + 'px');
      const dur = o.dur ?? 0.8;
      B.tl.fromTo(el, { '--r': 0, autoAlpha: 1 }, { '--r': o.r ?? 1400, duration: dur, ease: 'power2.out', immediateRender: false }, at);
      B.tl.set(el, { autoAlpha: 0 }, at + dur);
      B.tl.set(el, { autoAlpha: 0 }, 0);
      return at + dur;
    },
    // UI expand transition: a pill/tile grows from `src` (element or {x,y,w,h}) to fill the frame, the scene cuts under
    // it at the returned time, then it releases (lit edge fades). Use fx.scenes `out:'cut'` with end = returned time.
    expand(at, src, o = {}) {
      const r = rectOf(src), dur = o.dur ?? 0.42, rel = o.release ?? 0.32, el = mk('dk-expand');
      B.tl.set(el, { left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: o.radius ?? 99, autoAlpha: 0 }, 0);
      B.tl.set(el, { autoAlpha: 1 }, at);
      B.tl.to(el, { left: 0, top: 0, width: W(), height: H(), borderRadius: 0, duration: dur, ease: 'expo.in' }, at);
      B.tl.to(el, { autoAlpha: 0, scale: 1.03, duration: rel, ease: 'power2.out' }, at + dur);
      return at + dur;
    },
    // cursor: path = [{ x, y, dur, click, hold }], spring-eased, presses (0.86) on click and a ring spreads. returns end
    cursor(at, path, o = {}) {
      const c = mk('dk-cursor', '<svg viewBox="0 0 24 24" width="54" height="54"><path d="M4 2 L4 19 L8.6 14.8 L11.8 21.6 L14.6 20.3 L11.4 13.6 L17.6 13.6 Z" fill="#fff" stroke="#05060a" stroke-width="1.4" stroke-linejoin="round"/></svg>');
      const ring = mk('dk-ring'), tl = B.tl;
      let t = at, p0 = path[0];
      tl.set(c, { x: p0.x, y: p0.y, autoAlpha: 0, transformOrigin: '4px 2px' }, 0);
      tl.to(c, { autoAlpha: 1, duration: 0.12 }, at);
      for (let i = 1; i < path.length; i++) {
        const p = path[i], d = p.dur ?? 0.5;
        tl.to(c, { x: p.x, y: p.y, duration: d, ease: p.ease || 'power3.inOut' }, t);
        t += d;
        if (p.click) {
          tl.to(c, { scale: 0.84, duration: 0.07, ease: 'power2.out' }, t);
          tl.to(c, { scale: 1, duration: 0.18, ease: 'back.out(3)' }, t + 0.07);
          tl.fromTo(ring, { x: p.x + 4, y: p.y + 2, scale: 0.4, autoAlpha: 0.9 }, { scale: 3.2, autoAlpha: 0, duration: 0.45, ease: 'power2.out', immediateRender: false }, t);
          t += 0.08;
        }
        if (p.hold) t += p.hold;
      }
      tl.set(ring, { autoAlpha: 0 }, 0);
      if (o.out) tl.to(c, { autoAlpha: 0, duration: 0.15 }, t + 0.05);
      return t;
    },
    // the lone giant number: slams in from 1.14x with a glow flare, counts up, then settles. returns when it reads 'to'
    bigNumber(el, to, at, o = {}) {
      const e = $(el), dur = o.dur ?? 0.9, tl = B.tl;
      tl.fromTo(e, { scale: 1.14, autoAlpha: 0, filter: 'blur(14px)' }, { scale: 1, autoAlpha: 1, filter: 'blur(0px)', duration: 0.35, ease: 'expo.out', immediateRender: true }, at);
      const o2 = { v: 0 }, from = o.from ?? 0;
      tl.fromTo(o2, { v: from }, { v: to, duration: dur, ease: 'power3.out', onUpdate() { e.textContent = String(Math.round(o2.v)); }, immediateRender: false }, at);
      tl.fromTo(e, { textShadow: '0 0 260px rgba(183,243,74,.9), 0 0 40px rgba(183,243,74,.5)' }, { textShadow: '0 0 120px rgba(183,243,74,.38), 0 0 28px rgba(183,243,74,.25)', duration: 0.9, ease: 'power2.out', immediateRender: false }, at + 0.1);
      return at + dur;
    },
    // designed disappearance: collapse into a point (scale to a thin line, then gone)
    collapse(el, at, o = {}) {
      const e = $$(el);
      B.tl.to(e, { scaleY: 0.02, duration: 0.2, ease: 'power3.in', transformOrigin: '50% 50%' }, at);
      B.tl.to(e, { scaleX: 0, autoAlpha: 0, duration: 0.14, ease: 'power3.in' }, at + 0.2);
      return at + 0.34;
    },
  };
})();
