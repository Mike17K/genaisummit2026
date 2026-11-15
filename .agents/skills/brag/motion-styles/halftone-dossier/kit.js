// Halftone Dossier kit: stamps that slam, exhibits slapped onto the file, red string between pins, halftone that blooms.
// Every move: (el, at, opts) -> end time, on BRAG.tl. Deterministic.
(function () {
  const tl = BRAG.tl;
  const $$ = (s, r) => (typeof s === 'string' ? [...(r || document).querySelectorAll(s)] : s.length != null && !s.nodeType ? [...s] : [s]);
  const NS = 'http://www.w3.org/2000/svg';
  const K = {
    // call once in BRAG.build: injects the paper layer into every scene, the rough-edge filter, and the halftone structure
    init(root) {
      const st = document.getElementById('stage');
      if (!document.getElementById('rough')) st.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute"><filter id="rough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5" result="d"/><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="8" result="g"/><feColorMatrix in="g" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.4 1.6" result="m"/><feComposite in="d" in2="m" operator="in"/></filter></svg>`);
      $$('.scene', root).forEach((s) => { if (!s.querySelector(':scope > .paper')) s.insertAdjacentHTML('beforeend', '<div class="paper"></div>'); });
      $$('.ht', root).forEach((h) => { if (!h.querySelector('.pat')) h.innerHTML = '<div class="pat"></div><div class="tint"></div>'; });
    },
    // a stamp slams onto the page: 2.6x to 1x with a hard land, a tiny bounce back, the parent shudders
    stamp(el, at, o = {}) {
      const e = $$(el)[0], rot = o.rot ?? -8;
      tl.fromTo(e, { scale: 2.6, rotation: rot - 14, autoAlpha: 0 }, { scale: 1, rotation: rot, autoAlpha: 0.94, duration: 0.16, ease: 'power4.in', transformOrigin: '50% 50%', immediateRender: true }, at);
      tl.to(e, { scale: 1.06, duration: 0.07, ease: 'power2.out', immediateRender: false }, at + 0.16);
      tl.to(e, { scale: 1, duration: 0.12, ease: 'power2.in', immediateRender: false }, at + 0.23);
      const p = e.closest('.inner') || e.parentElement;
      tl.fromTo(p, { x: 0, y: 0 }, { x: 0, y: 0, keyframes: [{ x: -8, y: 10, duration: 0.04 }, { x: 7, y: -6, duration: 0.05 }, { x: -4, y: 3, duration: 0.05 }, { x: 0, y: 0, duration: 0.06 }], immediateRender: false }, at + 0.16);
      return at + 0.35;
    },
    // an exhibit slapped onto the file: flies in tilted from the side, lands with a small overshoot
    exhibit(el, at, o = {}) {
      const e = $$(el), every = o.every ?? 0.18;
      tl.from(e, { x: o.x ?? 700, y: o.y ?? 0, rotation: o.rot ?? 14, autoAlpha: 0, duration: 0.4, ease: 'back.out(1.5)', stagger: every, immediateRender: true }, at);
      return at + every * (e.length - 1) + 0.4;
    },
    // red string drawn between pins: path is an SVG <path> in an svg.string; pins pop as the string reaches them
    string(path, at, o = {}) {
      const p = $$(path)[0], dur = o.dur ?? 0.7;
      tl.fromTo(p, { drawSVG: '0%' }, { drawSVG: '100%', duration: dur, ease: 'power2.inOut', immediateRender: true }, at);
      (o.pins ? $$(o.pins) : []).forEach((pin, k, a) => tl.from(pin, { scale: 0, duration: 0.2, ease: 'back.out(3)', immediateRender: true }, at + (dur * k) / Math.max(1, a.length - 1) * 0.9));
      return at + dur;
    },
    // halftone blooms: dots grow from nothing to density `to` (--f low = dense) over `dur`
    bloom(el, at, o = {}) {
      const e = $$(el);
      tl.fromTo(e, { '--f': o.from ?? 255 }, { '--f': o.to ?? 60, duration: o.dur ?? 0.8, ease: 'power2.out', immediateRender: true }, at);
      return at + (o.dur ?? 0.8);
    },
    // slow breathing of the dot field so the print never sits dead (a few steps, like a reprint)
    breathe(el, start, end, o = {}) {
      const e = $$(el), a = o.a ?? 70, b = o.b ?? 40, n = Math.max(1, Math.round((end - start) / 0.5));
      tl.fromTo(e, { '--f': a }, { '--f': b, duration: end - start, ease: `steps(${n})`, immediateRender: false }, start);
      return end;
    },
    // headline misregistration: the red shadow plate slips 6 px (a print mis-register that settles)
    misregister(el, at, o = {}) {
      tl.fromTo($$(el), { textShadow: '18px 14px 0 #D8452B' }, { textShadow: '7px 7px 0 #D8452B', duration: 0.35, ease: 'power3.out', immediateRender: true }, at);
      return at + 0.35;
    },
    // typewriter caption bar: bar slides up, text types, keyword em gets its highlight sweep
    caption(el, at, o = {}) {
      const bar = $$(el)[0];
      tl.from(bar, { y: 80, autoAlpha: 0, duration: 0.3, ease: 'expo.out', immediateRender: true }, at);
      const end = BRAG.fx.text(bar, 'type', at + 0.15, { cps: o.cps ?? 34, caret: false });
      if (o.key) BRAG.fx.highlight(bar, end - 0.1, { words: o.key, color: '#F2B632', dur: 0.3 });
      return end;
    },
    scenes(fx, list) {
      const end = fx.scenes(list);
      return end;
    },
  };
  BRAG.styles = BRAG.styles || {};
  BRAG.styles['halftone-dossier'] = K;
})();
