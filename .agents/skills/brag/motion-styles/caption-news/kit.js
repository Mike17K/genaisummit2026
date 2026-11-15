// Caption News kit: captions slam in chunk by chunk, one keyword gets a yellow block, evidence is highlighted,
// numbers roll, source tags slide in. Hard cuts live on a 0.5 s grid. Every move: (el, at, opts) -> end time.
(function () {
  const tl = BRAG.tl;
  const $$ = (s, r) => (typeof s === 'string' ? [...(r || document).querySelectorAll(s)] : s.length != null && !s.nodeType ? [...s] : [s]);
  const K = {
    GRID: 0.5,
    // Build the yellow block behind every .w.key (once, safe to call twice). Call inside BRAG.build before animating.
    prep(root) {
      $$('.cap .w.key', root).forEach((w) => {
        if (w.querySelector('i')) return;
        w.innerHTML = `<i></i><span>${w.innerHTML}</span>`;
      });
      $$('.mark', root).forEach((m) => { if (!m.querySelector('i')) m.insertAdjacentHTML('afterbegin', '<i></i>'); });
    },
    // Caption: .ck chunks slam in `gap` apart, words pop one by one; a .key word gets its block swept on. Returns settle time.
    caption(cap, at, o = {}) {
      const el = $$(cap)[0], gap = o.gap ?? 0.28, wd = o.word ?? 0.07;
      K.prep(el);
      let t = at;
      $$('.ck', el).forEach((ck) => {
        const ws = $$('.w', ck);
        tl.from(ck, { autoAlpha: 0, duration: 0.01, immediateRender: true }, t);
        tl.from(ws, { y: 70, scale: 1.35, autoAlpha: 0, transformOrigin: '0 100%', duration: 0.22, ease: 'back.out(2.2)', stagger: wd, immediateRender: true }, t);
        $$('i', ck).forEach((b) => tl.fromTo(b, { scaleX: 0 }, { scaleX: 1, duration: 0.22, ease: 'power3.out', immediateRender: true }, t + wd * ws.length + 0.02));
        t += gap + wd * (ws.length - 1);
      });
      return t + 0.2;
    },
    // Channel bug slides in from the left edge (clip), optional second line
    bug(el, at, o = {}) {
      tl.from($$(el), { clipPath: 'inset(0 100% 0 0)', x: -30, duration: 0.3, ease: 'power3.out', immediateRender: true }, at);
      return at + 0.3;
    },
    // Source tag: white SOURCE chip, then the dark label slides out of it in 0.2 s
    source(el, at) {
      const e = $$(el)[0];
      tl.from(e, { clipPath: 'inset(0 100% 0 0)', duration: 0.22, ease: 'power3.out', immediateRender: true }, at);
      return at + 0.22;
    },
    // Lower third: yellow edge, white label, ink tag; slides from the left, holds, optionally leaves
    strap(el, at, o = {}) {
      const e = $$(el)[0];
      tl.from(e, { xPercent: -105, duration: 0.35, ease: 'expo.out', immediateRender: true }, at);
      if (o.out != null) tl.to(e, { xPercent: -105, duration: 0.25, ease: 'power3.in', immediateRender: false }, o.out);
      return at + 0.35;
    },
    // Evidence highlight: marker block sweeps behind the figure in the "document", text flips to ink
    mark(el, at, o = {}) {
      K.prep();
      $$(el).forEach((m, k) => {
        const i = m.querySelector('i');
        tl.fromTo(i, { scaleX: 0 }, { scaleX: 1, duration: o.dur ?? 0.3, ease: 'power2.out', immediateRender: true }, at + k * (o.stagger ?? 0.15));
        tl.to(m, { color: '#0B0D12', duration: 0.12, ease: 'none', immediateRender: false }, at + k * (o.stagger ?? 0.15) + 0.1);
      });
      return at + (o.dur ?? 0.3);
    },
    // Number that rolls up in whole numbers with a punch on arrival (ease-out count)
    roll(el, to, at, o = {}) {
      const n = $$(el)[0], from = o.from ?? 0, dur = o.dur ?? 0.6, st = { p: 0 }, suf = o.suffix || '';
      n.textContent = from + suf;
      tl.to(st, { p: 1, duration: dur, ease: 'power3.out', immediateRender: false, onUpdate() { n.textContent = Math.round(from + (to - from) * st.p) + suf; } }, at);
      tl.set(n, { textContent: to + suf }, at + dur + 0.001);
      tl.fromTo(n, { scale: 1 }, { scale: 1.12, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out', immediateRender: false }, at + dur);
      return at + dur + 0.2;
    },
    // Hard-cut punch: new shot lands 4 % oversize and settles, with a 2-frame brightness hit (use on the first frames after a cut)
    punch(el, at, o = {}) {
      tl.fromTo($$(el), { scale: 1.08 }, { scale: 1, duration: o.dur ?? 0.35, ease: 'expo.out', immediateRender: false }, at);
      return at + (o.dur ?? 0.35);
    },
    // Badge / number callout pops with a hard offset shadow
    callout(el, at, o = {}) {
      tl.from($$(el), { scale: 0, rotation: o.rot ?? -8, autoAlpha: 0, transformOrigin: '50% 50%', duration: 0.32, ease: 'back.out(2.4)', stagger: o.stagger ?? 0, immediateRender: true }, at);
      return at + 0.32;
    },
    scenes(fx, list) {
      const end = fx.scenes(list);
      return end;
    },
  };
  BRAG.styles = BRAG.styles || {};
  BRAG.styles['caption-news'] = K;
})();
