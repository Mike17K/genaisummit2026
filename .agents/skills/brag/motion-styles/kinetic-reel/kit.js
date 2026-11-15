// Kinetic Reel kit: words that land with weight, colour fields that cut on the beat, rows that never stop.
// Moves take absolute seconds `at` and return the time they finish. All on BRAG.tl.
(function () {
  const tl = BRAG.tl;
  const $$ = (s) => (typeof s === 'string' ? [...document.querySelectorAll(s)] : s.length != null && !s.nodeType ? [...s] : [s]);
  const BEAT = 0.5; // 120 BPM: cuts and slams land here
  const K = {
    BEAT,
    // set the font-size so each element's text is `w` px wide (call inside BRAG.build, after fonts have loaded)
    fit(sel, w, o = {}) {
      $$(sel).forEach((el) => {
        const prev = el.style.fontSize; el.style.fontSize = '100px';
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit;letter-spacing:inherit;text-transform:inherit';
        probe.textContent = el.dataset.fit || el.textContent; el.appendChild(probe);
        const m = probe.getBoundingClientRect().width / (el.closest('#stage')?.getBoundingClientRect().width / 1920 || 1);
        probe.remove();
        el.style.fontSize = (m ? (100 * w) / m : parseFloat(prev) || 100) + 'px';
        if (o.maxH) el.style.fontSize = Math.min(parseFloat(el.style.fontSize), o.maxH) + 'px';
      });
    },
    // the signature: a word falls (stretch), lands (squash) and settles. from: 'top' | 'bottom' | 'left' | 'right'
    slam(el, at, o = {}) {
      const t = $$(el), d = o.dist ?? 900, from = o.from || 'top';
      const v = { top: { y: -d }, bottom: { y: d }, left: { x: -d * 1.6 }, right: { x: d * 1.6 } }[from];
      const ax = from === 'left' || from === 'right';
      tl.fromTo(t, { ...v, autoAlpha: 0, scaleY: ax ? 1 : 1.18, scaleX: ax ? 1.18 : 0.94, transformOrigin: '50% 100%' },
        { x: 0, y: 0, autoAlpha: 1, scaleX: 1, scaleY: 1, duration: 0.16, ease: 'power3.in', immediateRender: true, stagger: o.stagger ?? 0 }, at);
      const hit = at + 0.16 + (o.stagger ?? 0) * (t.length - 1);
      tl.to(t, { scaleY: 0.86, scaleX: 1.05, duration: 0.07, ease: 'power2.out', immediateRender: false }, hit);
      tl.to(t, { scaleY: 1, scaleX: 1, duration: 0.3, ease: 'elastic.out(1, 0.55)', immediateRender: false }, hit + 0.07);
      return hit + 0.37;
    },
    // lines of a multi-line word rise out of their own masks, one after another
    stack(sel, at, o = {}) {
      const s = $$(sel);
      tl.from(s, { yPercent: 115, duration: o.dur ?? 0.45, ease: 'expo.out', stagger: o.stagger ?? 0.1, immediateRender: true }, at);
      return at + (o.dur ?? 0.45) + (o.stagger ?? 0.1) * (s.length - 1);
    },
    // a row of repeated words that scrolls for the whole scene. dir: 1 = right, -1 = left. Needs track content at least 2x the width.
    marquee(row, at, end, o = {}) {
      const tr = $$(row)[0].querySelector('.track') || $$(row)[0];
      const half = tr.scrollWidth / 2, dir = o.dir ?? -1, off = o.offset ?? 0;
      tl.fromTo(tr, { x: dir < 0 ? -off : -half + off }, { x: dir < 0 ? -half - off : -off, duration: end - at, ease: 'none', immediateRender: true }, at);
      return end;
    },
    // a hand-scribbled stroke draws under a word
    scribble(path, at, o = {}) {
      tl.fromTo($$(path), { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: o.dur ?? 0.35, ease: 'power2.inOut', immediateRender: true }, at);
      return at + (o.dur ?? 0.35);
    },
    // a flat colour block wipes across, then the content on it is already there: a stepped, hard-edged reveal
    block(el, at, o = {}) {
      const from = { left: 'inset(0 100% 0 0)', right: 'inset(0 0 0 100%)', up: 'inset(100% 0 0 0)', down: 'inset(0 0 100% 0)' }[o.from || 'left'];
      tl.fromTo($$(el), { clipPath: from }, { clipPath: 'inset(0 0 0 0)', duration: o.dur ?? 0.3, ease: 'expo.out', immediateRender: true }, at);
      return at + (o.dur ?? 0.3);
    },
    // hold: the word keeps pushing in slowly so it never freezes (1.0 to ~1.05 only)
    hold(el, start, end, o = {}) {
      tl.fromTo($$(el), { scale: 1 }, { scale: o.scale ?? 1.04, duration: end - start, ease: 'none', immediateRender: false }, start);
      return end;
    },
    // hard flash of the hot colour for 2 frames on an impact
    hit(el, at) {
      tl.set($$(el), { backgroundColor: '#FF4A1C' }, at); tl.set($$(el), { clearProps: 'backgroundColor' }, at + 0.07);
      return at + 0.07;
    },
  };
  BRAG.styles = BRAG.styles || {};
  BRAG.styles['kinetic-reel'] = K;
})();
