// Manim Explainer kit: the Create / Write / FadeIn / Transform / Indicate vocabulary on BRAG.tl.
// Moves take absolute seconds `at` and return the time they finish. Strokes smooth in/out (power1.inOut), like the original.
(function () {
  const tl = BRAG.tl;
  const NS = 'http://www.w3.org/2000/svg';
  const $$ = (s) => (typeof s === 'string' ? [...document.querySelectorAll(s)] : s.length != null && !s.nodeType ? [...s] : [s]);
  const SMOOTH = 'power1.inOut';
  const K = {
    SMOOTH,
    // faint coordinate plane filling a scene; lines draw out from the axes. Call in BRAG.build.
    plane(host, o = {}) {
      host = $$(host)[0]; const W = o.w ?? 1920, H = o.h ?? 1080, step = o.step ?? 120, cx = o.cx ?? W / 2, cy = o.cy ?? H / 2;
      const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'mx-plane'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const lines = [];
      const add = (x1, y1, x2, y2, axis) => { const l = document.createElementNS(NS, 'line'); [['x1', x1], ['y1', y1], ['x2', x2], ['y2', y2]].forEach(([k, v]) => l.setAttribute(k, v)); if (axis) l.setAttribute('class', 'axis'); svg.appendChild(l); lines.push(l); };
      for (let x = cx % step; x <= W; x += step) if (x !== cx) add(x, 0, x, H);
      for (let y = cy % step; y <= H; y += step) if (y !== cy) add(0, y, W, y);
      if (o.axes) { add(0, cy, W, cy, true); add(cx, 0, cx, H, true); }
      host.insertBefore(svg, host.firstChild);
      return lines;
    },
    // grid lines grow from the centre outward
    planeIn(lines, at, o = {}) {
      tl.fromTo(lines, { drawSVG: '50% 50%' }, { drawSVG: '0% 100%', duration: o.dur ?? 1.2, ease: SMOOTH, stagger: { amount: 0.5, from: 'center' }, immediateRender: true }, at);
      return at + (o.dur ?? 1.2) + 0.5;
    },
    // split a text element into per-character spans (once). Returns the spans.
    chars(el) {
      el = $$(el)[0];
      if (el._mx) return el._mx;
      const out = [];
      const walk = (node) => [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) { const f = document.createDocumentFragment(); [...n.textContent].forEach((c) => { if (c === ' ') f.appendChild(document.createTextNode(' ')); else { const s = document.createElement('span'); s.className = 'mx-ch'; s.textContent = c; f.appendChild(s); out.push(s); } }); n.replaceWith(f); }
        else if (n.nodeType === 1) walk(n);
      });
      walk(el); el._mx = out; return out;
    },
    // Write: each glyph appears as an outline and fills, left to right
    write(el, at, o = {}) {
      const cs = K.chars(el), stag = o.stagger ?? Math.min(0.06, (o.dur ?? 1.0) / Math.max(1, cs.length));
      const cols = cs.map((c) => getComputedStyle(c).color);
      tl.fromTo(cs, { autoAlpha: 0, webkitTextStrokeWidth: '2px', webkitTextStrokeColor: (i) => cols[i], color: 'rgba(0,0,0,0)' },
        { autoAlpha: 1, duration: 0.25, ease: 'none', stagger: stag, immediateRender: true }, at);
      tl.to(cs, { color: (i) => cols[i], duration: 0.3, ease: 'power1.in', stagger: stag, immediateRender: false }, at + 0.1);
      tl.to(cs, { webkitTextStrokeWidth: '0px', duration: 0.2, stagger: stag, immediateRender: false }, at + 0.35);
      return at + 0.55 + stag * cs.length;
    },
    // Create: a stroke draws itself (works on path, line, circle, rect)
    create(el, at, o = {}) {
      tl.fromTo($$(el), { drawSVG: '0%' }, { drawSVG: '100%', duration: o.dur ?? 1.0, ease: SMOOTH, stagger: o.stagger ?? 0, immediateRender: true }, at);
      return at + (o.dur ?? 1.0) + (o.stagger ?? 0) * ($$(el).length - 1);
    },
    // FadeIn with a small shift (default up 28px)
    fadeIn(el, at, o = {}) {
      tl.from($$(el), { autoAlpha: 0, x: o.x ?? 0, y: o.y ?? 28, scale: o.scale ?? 1, duration: o.dur ?? 0.7, ease: 'power2.out', stagger: o.stagger ?? 0, immediateRender: true }, at);
      return at + (o.dur ?? 0.7) + (o.stagger ?? 0) * ($$(el).length - 1);
    },
    fadeOut(el, at, o = {}) {
      tl.to($$(el), { autoAlpha: 0, y: o.y ?? -16, duration: o.dur ?? 0.5, ease: 'power1.in', stagger: o.stagger ?? 0, immediateRender: false }, at);
      return at + (o.dur ?? 0.5);
    },
    // fill colour (or opacity) comes in after the outline was Created
    fillIn(el, at, o = {}) {
      tl.from($$(el), { fillOpacity: 0, duration: o.dur ?? 0.5, ease: 'none', immediateRender: true }, at);
      return at + (o.dur ?? 0.5);
    },
    // Transform: one shape outline becomes another (MorphSVG). The element must be a <path> (circles and rects do not morph).
    morph(el, toPath, at, o = {}) {
      tl.to($$(el), { morphSVG: { shape: toPath, shapeIndex: o.shapeIndex ?? 'auto' }, duration: o.dur ?? 1.0, ease: SMOOTH, immediateRender: false }, at);
      return at + (o.dur ?? 1.0);
    },
    // Indicate: the thing grows 20%, flashes yellow and relaxes
    indicate(el, at, o = {}) {
      const t = $$(el), s = o.scale ?? 1.18, d = o.dur ?? 0.8;
      tl.to(t, { scale: s, duration: d * 0.4, ease: 'power2.out', immediateRender: false }, at);
      tl.to(t, { scale: 1, duration: d * 0.6, ease: 'power2.inOut', immediateRender: false }, at + d * 0.4);
      if (o.flash !== false) {
        tl.to(t, { color: '#FFE45C', stroke: '#FFE45C', duration: d * 0.4, ease: 'power2.out', immediateRender: false }, at);
        tl.to(t, { color: o.back ?? '#ECECEC', stroke: o.backStroke ?? o.back ?? '#ECECEC', duration: d * 0.6, ease: 'power2.inOut', immediateRender: false }, at + d * 0.4);
      }
      return at + d;
    },
    // slide a point along a line (number line dot); x from -> to in px
    slide(el, from, to, at, o = {}) {
      tl.fromTo($$(el), { x: from }, { x: to, duration: o.dur ?? 1.2, ease: SMOOTH, immediateRender: true }, at);
      return at + (o.dur ?? 1.2);
    },
    // camera: scale / shift the scene's world wrapper (smooth), for a push toward the part being explained
    camera(world, at, o = {}) {
      tl.to($$(world), { scale: o.scale ?? 1.12, x: o.x ?? 0, y: o.y ?? 0, duration: o.dur ?? 1.4, ease: SMOOTH, transformOrigin: o.origin ?? '50% 50%', immediateRender: false }, at);
      return at + (o.dur ?? 1.4);
    },
  };
  BRAG.styles = BRAG.styles || {};
  BRAG.styles['manim-explainer'] = K;
})();
