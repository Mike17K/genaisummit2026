// Morph UI kit: a single shape that reshapes into UI parts, a cursor that does the clicking, a camera that frames each state.
// Moves take absolute seconds `at` and return the time they finish. All on BRAG.tl; springs are GSAP back.out with small overshoot.
(function () {
  const tl = BRAG.tl;
  const $$ = (s) => (typeof s === 'string' ? [...document.querySelectorAll(s)] : s.length != null && !s.nodeType ? [...s] : [s]);
  const $ = (s) => $$(s)[0];
  const SPRING = 'back.out(1.25)';
  const K = {
    SPRING,
    // place the shape at its first state (call in BRAG.build before any morph); centre-anchored
    init(shape, face, st) {
      shape = $(shape); face = $(face);
      // on the master timeline at 0 (gsap.set is on the paused global timeline and would never run)
      tl.set(shape, { xPercent: -50, yPercent: -50, width: st.w, height: st.h, borderRadius: st.r, backgroundColor: st.bg || '#121212', immediateRender: true }, 0);
      tl.set(face, { visibility: 'visible', immediateRender: true }, 0);
      shape._face = face;
    },
    // The signature move: the shape becomes the next UI state (size, radius, colour), the old face leaves, the new one arrives.
    // st = { w, h, r, bg?, y?, x? }
    morph(shape, face, st, at, o = {}) {
      shape = $(shape); face = $(face);
      const dur = o.dur ?? 0.55, prev = shape._face;
      tl.to(shape, { width: st.w, height: st.h, borderRadius: st.r, backgroundColor: st.bg || '#121212', x: st.x ?? 0, y: st.y ?? 0, duration: dur, ease: o.ease ?? SPRING, immediateRender: false }, at);
      if (prev && prev !== face) {
        tl.to(prev, { autoAlpha: 0, scale: 0.94, duration: 0.14, ease: 'power2.in', immediateRender: false }, at);
        
      }
      tl.fromTo(face, { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: 0.28, ease: 'power2.out', immediateRender: true }, at + dur * 0.4);
      shape._face = face;
      return at + dur;
    },
    // a continuous spin for loaders: linear, locked to the timeline
    spin(el, start, end, o = {}) {
      tl.fromTo($$(el), { rotation: 0 }, { rotation: (o.turns ?? 2) * 360, duration: end - start, ease: 'none', transformOrigin: '50% 50%', immediateRender: false }, start);
      return end;
    },
    // cursor travels to (x, y) on an eased path
    cursorTo(el, x, y, at, o = {}) {
      tl.to($$(el), { x, y, duration: o.dur ?? 0.6, ease: 'power3.inOut', immediateRender: false }, at);
      return at + (o.dur ?? 0.6);
    },
    // press (0.82) and release, with a ripple ring at the cursor tip
    click(el, ripple, at, o = {}) {
      const c = $(el), r = $(ripple);
      tl.to(c, { scale: 0.82, duration: 0.07, ease: 'power2.out', immediateRender: false }, at);
      tl.to(c, { scale: 1, duration: 0.18, ease: 'back.out(2)', immediateRender: false }, at + 0.07);
      tl.fromTo(r, { x: o.x, y: o.y, scale: 0.2, autoAlpha: 0.9 }, { scale: 1.1, autoAlpha: 0, duration: 0.45, ease: 'power2.out', immediateRender: false }, at);
      
      return at + 0.25;
    },
    // camera: frame the state by scaling / shifting the world wrapper (smooth in-out)
    camera(world, at, o = {}) {
      tl.to($$(world), { scale: o.scale ?? 1, x: o.x ?? 0, y: o.y ?? 0, duration: o.dur ?? 0.7, ease: o.ease ?? 'power3.inOut', transformOrigin: '50% 50%', immediateRender: false }, at);
      return at + (o.dur ?? 0.7);
    },
    // children of a face pop in after the shape settles (small, quick; the shape is the star)
    items(els, at, o = {}) {
      tl.from($$(els), { y: o.y ?? 14, autoAlpha: 0, scale: o.scale ?? 0.9, duration: o.dur ?? 0.3, ease: 'power3.out', stagger: o.stagger ?? 0.06, immediateRender: true }, at);
      return at + (o.dur ?? 0.3) + (o.stagger ?? 0.06) * ($$(els).length - 1);
    },
  };
  BRAG.styles = BRAG.styles || {};
  BRAG.styles['morph-ui'] = K;
})();
