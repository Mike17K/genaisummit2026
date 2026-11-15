// Whiteboard kit: marker strokes that draw on with a floating marker (no hand) following the tip, handwriting,
// hand-drawn circles / underlines / arrows / checks / bursts and a small set of doodle icons.
// Every move takes `at` (seconds on BRAG.tl) and returns the time it finishes. Deterministic.
(function () {
  'use strict';
  const G = window.gsap, B = window.BRAG;
  if (!G || !B || !B.tl || !B.fx) { console.error('whiteboard kit: load gsap.js, timeline.js, motion.js first'); return; }
  const tl = B.tl, fx = B.fx, NS = 'http://www.w3.org/2000/svg';
  const $ = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
  const hash = (i, k) => { let x = Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(k + 7, 0x85EBCA77); x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const f1 = (n) => Math.round(n * 10) / 10;
  function S(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (parent) $(parent).appendChild(e); return e; }

  const COLORS = { ink: '#23262c', blue: '#2a5cb3', orange: '#d97757' };

  // ---- a layer: svg in stage coordinates, with a strokes group (under) and the pens (over)
  function layer(parent, w = 1080, h = 1920) {
    const svg = S('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'wb-svg' }, parent);
    S('g', { class: 'wb-ghosts' }, svg);
    const strokes = S('g', { class: 'wb-strokes' }, svg);
    const pens = S('g', { class: 'wb-pens' }, svg);
    return { svg, strokes, pens, seed: 0, n: 0 };
  }

  // ---- ghost marks: faint leftovers of old lessons (5-9 %), placed by hash so the board never looks new
  function ghosts(L, seed = 1, count = 9) {
    const g = $(L.svg).querySelector('.wb-ghosts');
    const kinds = [
      (x, y, s) => `M${x},${y} m${-30 * s},0 a${30 * s},${22 * s} 0 1 0 ${60 * s},0 a${30 * s},${22 * s} 0 1 0 ${-60 * s},0`,
      (x, y, s) => `M${x},${y} l${90 * s},${-14 * s} m${-18 * s},${-14 * s} l${18 * s},${14 * s} l${-16 * s},${16 * s}`,
      (x, y, s) => `M${x - 24 * s},${y} h${48 * s} M${x},${y - 24 * s} v${48 * s}`,
      (x, y, s) => `M${x},${y} q${20 * s},${-30 * s} ${40 * s},0 t${40 * s},0 t${40 * s},0`,
      (x, y, s) => `M${x},${y} l${60 * s},${10 * s} M${x + 4 * s},${y + 22 * s} l${70 * s},${8 * s}`,
    ];
    for (let i = 0; i < count; i++) {
      const x = 90 + hash(i, seed) * 900, y = 120 + hash(i, seed + 11) * 1560, s = 0.8 + hash(i, seed + 5) * 1.0;
      S('path', { d: kinds[Math.floor(hash(i, seed + 3) * kinds.length)](f1(x), f1(y), s), class: 'wb-ghost', transform: `rotate(${f1((hash(i, seed + 8) - 0.5) * 30)} ${f1(x)} ${f1(y)})` }, g);
    }
  }

  // ---- the marker: a floating pen with a cast shadow that grows when it lifts. Parks off the right edge.
  function pen(L, color = 'ink', o = {}) {
    const g = S('g', { class: 'wb-pen' }, L.pens);
    const sh = S('g', { class: 'wb-pen-sh' }, g), body = S('g', { class: 'wb-pen-body' }, g);
    const silhouette = 'M-9,-44 L9,-44 L16,-60 L16,-250 Q16,-262 4,-262 L-4,-262 Q-16,-262 -16,-250 L-16,-60 Z';
    S('path', { d: silhouette, class: 'wb-pen-shadow', transform: 'rotate(30) scale(.8)' }, sh);
    const r = S('g', { transform: 'rotate(30) scale(.8)' }, body);
    S('path', { d: 'M-5,0 L5,0 L9,-44 L-9,-44 Z', fill: COLORS[color] || color, class: 'wb-pen-nib' }, r);
    S('path', { d: 'M-9,-44 L9,-44 L16,-60 L-16,-60 Z', fill: '#d8d6cc', class: 'wb-pen-nib' }, r);
    S('rect', { x: -16, y: -250, width: 32, height: 190, rx: 8, fill: '#f7f6f1', stroke: '#c5c3b8', 'stroke-width': 2 }, r);
    S('rect', { x: -16, y: -168, width: 32, height: 70, fill: COLORS[color] || color, opacity: .92 }, r);
    S('rect', { x: -16, y: -250, width: 32, height: 26, rx: 8, fill: COLORS[color] || color }, r);
    S('path', { d: 'M-9,-236 L-9,-100', stroke: '#fff', 'stroke-width': 3, opacity: .8, fill: 'none' }, r);
    const p = { g, sh, body, color, x: o.x ?? 1320, y: o.y ?? 980, L };
    tl.set(g, { x: p.x, y: p.y }, 0);
    return p;
  }
  function liftTween(p, at, dur) {
    tl.to(p.sh, { x: 44, y: 60, duration: dur / 2, ease: 'power2.out' }, at);
    tl.to(p.sh, { x: 0, y: 0, duration: dur / 2, ease: 'power2.in' }, at + dur / 2);
    tl.to(p.body, { x: -6, y: -16, duration: dur / 2, ease: 'power2.out' }, at);
    tl.to(p.body, { x: 0, y: 0, duration: dur / 2, ease: 'power2.in' }, at + dur / 2);
  }
  // move the marker (lifted) to a point
  function hop(p, x, y, at, o = {}) {
    const dist = Math.hypot(x - p.x, y - p.y);
    if (dist < 24) { p.x = x; p.y = y; return at; }
    const d = o.dur ?? clamp(0.06 + dist / 6000, 0.06, 0.28);
    tl.fromTo(p.g, { x: p.x, y: p.y }, { x, y, duration: d, ease: 'power2.inOut', immediateRender: false }, at);
    liftTween(p, at, d);
    p.x = x; p.y = y;
    return at + d;
  }
  function park(p, at, o = {}) {
    return hop(p, o.x ?? 1320, o.y ?? p.y - 200, at, { dur: o.dur ?? 0.35 });
  }

  // ---- one stroke: path data `d` (stage coords) drawn slow-fast-slow with the marker tip on the leading edge
  function stroke(p, d, at, o = {}) {
    const path = S('path', { d, class: 'wb-stroke wb-' + (o.color || p.color) + (o.cls ? ' ' + o.cls : '') }, p.L.strokes);
    if (o.width) path.style.strokeWidth = o.width;
    if (o.opacity != null) path.style.opacity = o.opacity;
    const Ln = path.getTotalLength(), p0 = path.getPointAtLength(0);
    const t0 = hop(p, p0.x, p0.y, at);
    const dur = o.dur ?? clamp(Ln / (o.speed || 1500), 0.14, 1.6), ease = o.ease || 'sine.inOut';
    tl.set(path, { autoAlpha: 0 }, 0);
    tl.set(path, { autoAlpha: 1 }, t0);
    tl.fromTo(path, { drawSVG: '0%' }, { drawSVG: '100%', duration: dur, ease, immediateRender: true }, t0);
    const s = { u: 0 };
    tl.fromTo(s, { u: 0 }, { u: 1, duration: dur, ease, immediateRender: false, onUpdate() {
      const pt = path.getPointAtLength(s.u * Ln);
      G.set(p.g, { x: pt.x, y: pt.y });
    } }, t0);
    const pe = path.getPointAtLength(Ln);
    p.x = pe.x; p.y = pe.y;
    return t0 + dur;
  }
  // several strokes in a row (array of d strings)
  function strokes(p, ds, at, o = {}) { let t = at; ds.forEach((d) => { t = stroke(p, d, t + (o.gap ?? 0), o); }); return t; }

  // ---- hand-drawn shapes, built from points with deterministic wobble
  const pts = (arr) => 'M' + arr.map((q) => f1(q[0]) + ',' + f1(q[1])).join(' L');
  // loop around a rectangle { x, y, w, h }: starts at the top, overshoots past the start, a little spiral
  function loop(rect, seed = 1, o = {}) {
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, rx = rect.w / 2 + (o.pad ?? 18), ry = rect.h / 2 + (o.pad ?? 14);
    const n = 44, a0 = -Math.PI * 0.62, sweep = Math.PI * 2.18, out = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, a = a0 + sweep * u, k = 1 + 0.07 * Math.sin(u * 9 + seed) + (hash(i, seed) - 0.5) * 0.03 + u * 0.1;
      out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts(out);
  }
  function underline(x1, x2, y, seed = 1, o = {}) {
    const n = Math.max(4, Math.round((x2 - x1) / 36)), out = [];
    for (let i = 0; i <= n; i++) out.push([x1 + ((x2 - x1) * i) / n, y - (i / n) * (o.rise ?? 6) + (hash(i, seed) - 0.5) * 5]);
    let d = pts(out);
    if (o.double) { const out2 = out.slice().reverse().map((q, i) => [q[0] + (hash(i, seed + 4) - 0.5) * 6, q[1] + 11 + (hash(i, seed + 2) - 0.5) * 4]); d += ' ' + pts(out2).replace('M', 'M'); }
    return d;
  }
  function arrow(x1, y1, x2, y2, seed = 1, bend = 0.18, head = 30) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / L) * L * bend, cy = my + (dx / L) * L * bend;
    const tx = x2 - cx, ty = y2 - cy, tl_ = Math.hypot(tx, ty) || 1, ux = tx / tl_, uy = ty / tl_, a = 0.5;
    const h1 = [x2 - head * (ux * Math.cos(a) - uy * Math.sin(a)), y2 - head * (uy * Math.cos(a) + ux * Math.sin(a))];
    const h2 = [x2 - head * (ux * Math.cos(-a) - uy * Math.sin(-a)), y2 - head * (uy * Math.cos(-a) + ux * Math.sin(-a))];
    return `M${f1(x1)},${f1(y1)} Q${f1(cx)},${f1(cy)} ${f1(x2)},${f1(y2)} M${f1(h1[0])},${f1(h1[1])} L${f1(x2)},${f1(y2)} L${f1(h2[0])},${f1(h2[1])}`;
  }
  const check = (x, y, s = 1) => `M${f1(x)},${f1(y + 18 * s)} L${f1(x + 22 * s)},${f1(y + 44 * s)} L${f1(x + 68 * s)},${f1(y - 14 * s)}`;
  function burst(cx, cy, r, n = 9, seed = 1) {
    let d = '';
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + hash(i, seed) * 0.2, r1 = r * (0.62 + hash(i, seed + 1) * 0.1), r2 = r * (1 + hash(i, seed + 2) * 0.25); d += `M${f1(cx + Math.cos(a) * r1)},${f1(cy + Math.sin(a) * r1)} L${f1(cx + Math.cos(a) * r2)},${f1(cy + Math.sin(a) * r2)} `; }
    return d.trim();
  }

  // ---- doodle icons (authored in a 0..100 box, absolute M/L/C only); each entry is a list of strokes
  const DOODLES = {
    fridge: ['M10,5 C40,2 70,4 90,6 L92,150 C60,154 35,152 8,150 Z', 'M9,58 C35,56 65,60 91,57', 'M79,22 L79,44', 'M79,72 L79,112'],
    face: ['M30,24 L31,34', 'M58,24 L59,34', 'M33,44 C41,51 52,51 60,43'],
    cup: ['M8,16 C35,12 65,13 92,15', 'M12,20 L88,20 L74,92 C55,95 40,95 26,92 Z', 'M17,50 C40,54 60,52 83,49'],
    leaf: ['M14,86 C-2,42 40,4 92,12 C97,60 62,96 14,86 Z', 'M14,86 C40,62 62,42 84,22'],
    feta: ['M6,42 L72,42 L72,88 L6,88 Z', 'M6,42 L28,18 L94,18 L72,42', 'M94,18 L94,64 L72,88', 'M22,60 L22.5,60.5', 'M44,72 L44.5,72.5', 'M56,56 L56.5,56.5'],
    pot: ['M16,40 L84,40 L79,90 C60,95 40,95 21,90 Z', 'M8,36 C35,32 65,32 92,36', 'M16,52 C0,52 0,70 18,70', 'M84,52 C100,52 100,70 82,70'],
    steam: ['M34,26 C22,14 46,6 34,-8', 'M52,26 C40,14 64,6 52,-8', 'M70,26 C58,14 82,6 70,-8'],
    clock: ['M50,8 C78,6 94,28 92,54 C90,80 68,94 46,92 C22,90 8,68 10,44 C12,22 30,8 50,8 Z', 'M50,26 L50,52 L68,62'],
  };
  function tx(d, s, ox, oy) {
    let i = 0;
    return d.replace(/-?\d*\.?\d+/g, (m) => { const v = parseFloat(m); const o = (i++ % 2 === 0) ? ox : oy; return f1(v * s + o); });
  }
  // draws a doodle as ONE stroke (sub-paths joined: the marker jumps between them like a quick lift) unless o.split
  function doodle(p, name, x, y, s, at, o = {}) {
    const ds = DOODLES[name].map((d) => tx(d, s, x, y));
    if (o.split) { let t = at; ds.forEach((d) => { t = stroke(p, d, t, { speed: o.speed || 1700, color: o.color, dur: o.dur }); }); return t; }
    return stroke(p, ds.join(' '), at, { speed: o.speed || 2600, color: o.color, dur: o.dur });
  }

  // ---- handwriting: text is written left to right line by line, the marker tip riding the writing edge.
  // Chars get a little deterministic rotation / baseline jitter so it looks like a hand.
  function write(p, el, at, o = {}) {
    el = $(el);
    const sp = fx.split(el), stage = document.getElementById('stage'), sr = stage.getBoundingClientRect(), k = sr.width / (stage.offsetWidth || sr.width) || 1;
    sp.chars.forEach((c, i) => { G.set(c, { rotation: (hash(i, 3) - 0.5) * 3.2, y: (hash(i, 9) - 0.5) * 5 }); });
    const cps = o.cps || 24;
    let t = at;
    sp.lines.forEach((ln, li) => {
      const chars = sp.chars.filter((c) => ln.contains(c));
      const a = chars[0].getBoundingClientRect(), b = chars[chars.length - 1].getBoundingClientRect(), lr = ln.getBoundingClientRect();
      const x0 = (a.left - sr.left) / k, x1 = (b.right - sr.left) / k, lw = lr.width / k, lx = (lr.left - sr.left) / k, ly = (lr.top - sr.top) / k, lh = lr.height / k;
      const tipY = ly + lh * (o.baseline ?? 0.66), dur = Math.max(0.25, chars.length / cps);
      const s = { u: 0 };
      ln.style.clipPath = `inset(0 ${lw}px 0 0)`;
      const t0 = hop(p, x0, tipY, t);
      const apply = () => { ln.style.clipPath = `inset(-10% ${Math.max(0, lw - (x0 - lx) - s.u * (x1 - x0) - 6).toFixed(1)}px -10% 0)`; };
      tl.fromTo(s, { u: 0 }, { u: 1, duration: dur, ease: 'sine.inOut', immediateRender: true, onUpdate() { apply(); G.set(p.g, { x: x0 + s.u * (x1 - x0), y: tipY + Math.sin(s.u * chars.length * 1.7) * 6 }); } }, t0);
      p.x = x1; p.y = tipY;
      t = t0 + dur + 0.02;
    });
    return t;
  }

  // ---- a stroke around / under an element's words (rect measured in stage coords)
  function rectOf(el) {
    el = $(el);
    const stage = document.getElementById('stage'), sr = stage.getBoundingClientRect(), k = sr.width / (stage.offsetWidth || sr.width) || 1, r = el.getBoundingClientRect();
    return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k };
  }
  function wordRect(el, i) { const w = fx.split(el).words[i]; return rectOf(w); }
  function circleWord(p, el, i, at, o = {}) { const r = typeof i === 'number' ? wordRect(el, i) : i; return stroke(p, loop(r, o.seed || 3, { pad: o.pad }), at, { dur: o.dur ?? 0.55, color: o.color, width: o.width }); }
  function underlineWord(p, el, i, at, o = {}) { const r = typeof i === 'number' ? wordRect(el, i) : rectOf(el); return stroke(p, underline(r.x - 4, r.x + r.w + 6, r.y + r.h * (o.y ?? 0.86), o.seed || 5, o), at, { dur: o.dur ?? 0.35, color: o.color, width: o.width }); }

  // a marker highlight swipe (translucent band) behind a word, drawn by the marker
  function swipe(p, el, i, at, o = {}) {
    const r = typeof i === 'number' ? wordRect(el, i) : rectOf(el);
    const y = r.y + r.h * 0.58;
    return stroke(p, `M${f1(r.x - 8)},${f1(y)} L${f1(r.x + r.w + 10)},${f1(y - 4)}`, at, { dur: o.dur ?? 0.3, color: o.color, width: r.h * 0.62, opacity: o.opacity ?? 0.34, cls: 'wb-swipe' });
  }

  B.styles = B.styles || {};
  B.styles.whiteboard = { S, layer, ghosts, pen, hop, park, stroke, strokes, write, doodle, DOODLES, tx, loop, underline, arrow, check, burst, circleWord, underlineWord, swipe, rectOf, wordRect, COLORS };
})();
