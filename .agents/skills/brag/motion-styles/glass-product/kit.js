// glass-product kit: strip-light sweeps over frosted slabs, glint on thin titles, caustic floor rings, drifting camera,
// transitions that pass through black. Every move takes `at` (seconds) and returns its end time; all on BRAG.tl.
(function () {
  'use strict';
  const B = window.BRAG, G = window.gsap;
  B.styles = B.styles || {};
  const stage = () => document.getElementById('stage');
  const $ = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
  const $$ = (x) => (typeof x === 'string' ? [...document.querySelectorAll(x)] : Array.isArray(x) ? x : [x]);
  const W = () => (window.TIMELINE && window.TIMELINE.width) || 1080;
  const mk = (cls, parent) => { const e = document.createElement('div'); e.className = cls; (parent || stage()).appendChild(e); return e; };

  const S = B.styles['glass-product'] = {
    // turn an element into a glass slab: adds a sheen strip and an accent edge line. call once at build time
    glass(el) {
      const e = $(el); e.classList.add('gp-slab');
      if (!e.querySelector(':scope > .gp-sheen')) { mk('gp-sheen', e); mk('gp-edgeline', e); }
      return e;
    },
    // a strip light slides across a slab (the signature move). dir 1 = left to right
    sheen(el, at, o = {}) {
      const e = $(el), s = e.querySelector(':scope > .gp-sheen'), dur = o.dur ?? 1.1, dir = o.dir ?? 1;
      B.tl.fromTo(s, { left: dir > 0 ? '-60%' : '120%' }, { left: dir > 0 ? '130%' : '-70%', duration: dur, ease: 'power2.inOut', immediateRender: false }, at);
      return at + dur;
    },
    // the dispersion line on a slab's top edge draws on and stays lit
    edge(el, at, o = {}) {
      const l = $(el).querySelector(':scope > .gp-edgeline'), dur = o.dur ?? 0.7;
      B.tl.fromTo(l, { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: dur, ease: 'expo.out', immediateRender: true }, at);
      return at + dur;
    },
    // thin title entrance: tracking collapses from wide while it sharpens, then a diagonal glint crosses the letters
    title(el, at, o = {}) {
      const e = $(el), dur = o.dur ?? 1.0;
      B.tl.fromTo(e, { letterSpacing: o.from ?? '0.16em', autoAlpha: o.a0 ?? 0, filter: 'blur(10px)', y: 18 }, { letterSpacing: o.to ?? '0.02em', autoAlpha: 1, filter: 'blur(0px)', y: 0, duration: dur, ease: 'expo.out', immediateRender: true }, at);
      if (o.glint !== false) B.tl.fromTo(e, { '--g': -40 }, { '--g': 150, duration: o.glintDur ?? 1.0, ease: 'power2.inOut', immediateRender: true }, at + dur * 0.35);
      return at + dur;
    },
    glint(el, at, o = {}) {
      const dur = o.dur ?? 0.9;
      B.tl.fromTo($(el), { '--g': -40 }, { '--g': 150, duration: dur, ease: 'power2.inOut', immediateRender: false }, at);
      return at + dur;
    },
    // lift: an object rises out of the dark, tilted toward camera, and settles upright
    lift(els, at, o = {}) {
      const list = $$(els), dur = o.dur ?? 0.9, gap = o.gap ?? 0.1;
      B.tl.fromTo(list, { y: o.dy ?? 90, rotationX: o.tilt ?? 24, scale: 0.94, autoAlpha: o.a0 ?? 0, transformPerspective: 1800, transformOrigin: '50% 100%' },
        { y: 0, rotationX: 0, scale: 1, autoAlpha: 1, duration: dur, ease: 'expo.out', stagger: gap, immediateRender: true }, at);
      return at + dur + gap * (list.length - 1);
    },
    // the camera always drifts: a slow orbit (rotateY/rotateX) and push on a slab or group
    orbit(el, start, end, o = {}) {
      const e = $$(el);
      B.tl.fromTo(e, { rotationY: o.y0 ?? -7, rotationX: o.x0 ?? 3, scale: 1, transformPerspective: 1800 },
        { rotationY: o.y1 ?? 7, rotationX: o.x1 ?? -2, scale: o.scale ?? 1.04, duration: end - start, ease: 'none', immediateRender: true }, start);
      return end;
    },
    // caustic ripple on the floor: a ring spreading from an event, with the filament pool brightening under it
    caustic(at, o = {}) {
      const r = mk('gp-ring'), p = stage().querySelector('.gp-caustic') || mk('gp-caustic'), dur = o.dur ?? 1.3, x = o.x ?? W() / 2, y = o.y ?? 1560;
      B.tl.set(r, { left: x, top: y }, 0);
      B.tl.fromTo(r, { scale: 0.2, autoAlpha: 0.9 }, { scale: o.scale ?? 4.2, autoAlpha: 0, duration: dur, ease: 'power2.out', immediateRender: false }, at);
      B.tl.set(r, { autoAlpha: 0 }, 0);
      B.tl.to(p, { opacity: o.pool ?? 0.9, duration: 0.5, ease: 'power2.out' }, at);
      B.tl.to(p, { opacity: 0.35, duration: o.fade ?? 1.2, ease: 'sine.inOut' }, at + 0.5);
      return at + dur;
    },
    // transition: a strip of light sweeps through black; the scene cuts under it at the returned time
    sweepCut(at, o = {}) {
      const dur = o.dur ?? 0.55, ov = mk('gp-cut'), strip = mk('gp-cutstrip');
      Object.assign(ov.style, { position: 'absolute', inset: '0', background: '#000', zIndex: 7000, visibility: 'hidden', pointerEvents: 'none' });
      Object.assign(strip.style, { position: 'absolute', top: '-10%', bottom: '-10%', width: '300px', left: '-400px', zIndex: 7001, mixBlendMode: 'screen', pointerEvents: 'none',
        background: 'linear-gradient(90deg, transparent, rgba(150,180,255,.25) 30%, rgba(255,255,255,.95) 50%, rgba(190,160,255,.25) 70%, transparent)', filter: 'blur(14px)', transform: 'skewX(-18deg)', visibility: 'hidden' });
      const tl = B.tl;
      tl.set([ov, strip], { autoAlpha: 0 }, 0);
      tl.set([ov, strip], { autoAlpha: 1 }, at);
      tl.fromTo(ov, { opacity: 0 }, { opacity: 1, duration: dur * 0.4, ease: 'power2.in', immediateRender: false }, at);
      tl.to(ov, { opacity: 0, duration: dur * 0.6, ease: 'power2.out' }, at + dur * 0.5);
      tl.fromTo(strip, { x: -200 }, { x: W() + 900, duration: dur, ease: 'power2.inOut', immediateRender: false }, at);
      tl.set([ov, strip], { autoAlpha: 0 }, at + dur);
      return at + dur * 0.45;
    },
  };
})();
