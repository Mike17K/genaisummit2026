// Telestrator kit: sports-analysis moves over "footage" (here: the real product UI as HTML): freeze frame with flash and punch,
// spotlight, marker rings / lines / arrows drawn on the picture, red space patches, label cards, stopwatch, the yellow packaging
// band transition, split screen, a stamp card. Every move takes `at` (seconds on BRAG.tl) and returns its end time. Deterministic.
(function () {
  'use strict';
  const G = window.gsap, B = window.BRAG;
  if (!G || !B || !B.tl || !B.fx) { console.error('telestrator kit: load gsap.js, timeline.js, motion.js first'); return; }
  const tl = B.tl, fx = B.fx, NS = 'http://www.w3.org/2000/svg';
  const $ = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
  const hash = (i, k) => { let x = Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(k + 7, 0x85EBCA77); x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  const f1 = (n) => Math.round(n * 10) / 10;
  function S(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (parent) $(parent).appendChild(e); return e; }
  function H(html, parent) { const t = document.createElement('div'); t.innerHTML = html.trim(); const e = t.firstChild; if (parent) $(parent).appendChild(e); return e; }

  const C = { yellow: '#FFD400', cyan: '#3FD8FF', red: '#FF3B30', chalk: '#F4F1E8', board: '#0C1411', card: 'rgba(8,12,14,.92)' };

  // ---- the "footage": the Pantry fridge screen, built from HTML so it looks like a real app recording
  const ITEMS = [
    { n: 'Greek yoghurt', m: 'OPENED MON', chip: '2 DAYS', c: '#F5A524', i: 'G' },
    { n: 'Spinach', m: 'BAG, OPENED', chip: 'TOMORROW', c: '#FF5A4D', i: 'S' },
    { n: 'Feta', m: 'BLOCK, SEALED', chip: '9 DAYS', c: '#5FD08A', i: 'F' },
    { n: 'Eggs', m: 'TRAY OF 12', chip: '12 DAYS', c: '#5FD08A', i: 'E' },
    { n: 'Butter', m: 'SEALED', chip: '21 DAYS', c: '#5FD08A', i: 'B' },
    { n: 'Tomatoes', m: '4 LEFT', chip: '5 DAYS', c: '#E8C547', i: 'T' },
  ];
  const GEO = { top: 540, pitch: 214, h: 190, x: 56, w: 968, chipX: 782, chipW: 220, chipH: 78 };
  // geometry of card i in the footage (before its scroll offset), for placing rings and patches
  function card(i, scroll = 0) {
    const y = GEO.top + i * GEO.pitch + scroll;
    return { x: GEO.x, y, w: GEO.w, h: GEO.h, cx: GEO.x + GEO.w / 2, cy: y + GEO.h / 2, chip: { x: GEO.chipX, y: y + (GEO.h - GEO.chipH) / 2, w: GEO.chipW, h: GEO.chipH, cx: GEO.chipX + GEO.chipW / 2, cy: y + GEO.h / 2 } };
  }
  function footage(parent, o = {}) {
    const items = (o.items || ITEMS), root = H(`<div class="ts-footage"><div class="ts-ui"></div><div class="ts-grade"></div><svg class="ts-ann" viewBox="0 0 1080 1920" width="1080" height="1920"></svg></div>`, parent);
    const ui = root.querySelector('.ts-ui');
    ui.innerHTML = `<div class="ts-status"><span>9:41</span><span>PANTRY</span><span>100%</span></div>
      <div class="ts-title">My fridge</div>
      <div class="ts-pills"><b>6 ITEMS</b><b class="warn">2 EXPIRING</b><b class="ok">12 RECIPES</b></div>
      <div class="ts-sub">SORTED BY EXPIRY</div>
      <div class="ts-list">${items.map((it, k) => `<div class="ts-card" style="top:${GEO.top + k * GEO.pitch - 540 + 0}px"><i style="background:${it.c}">${it.i}</i><div><strong>${it.n}</strong><small>${it.m}</small></div><em style="--c:${it.c}">${it.chip}</em></div>`).join('')}</div>`;
    return { root, ui, ann: root.querySelector('.ts-ann'), grade: root.querySelector('.ts-grade'), list: ui.querySelector('.ts-list') };
  }
  // live play: the list scrolls slowly until the freeze
  function play(f, from, to, dy) { tl.fromTo(f.list, { y: 0 }, { y: dy, duration: to - from, ease: 'sine.inOut', immediateRender: false }, from); return to; }

  // ---- freeze: white flash, punch 1.035 -> 1, desaturate, vignette, then a slow 1.2 % creep. Overlays live inside the footage so they share its transform.
  function freeze(f, at, o = {}) {
    const flash = H('<div class="ts-flash"></div>', f.root), vig = H('<div class="ts-vig"></div>', f.root);
    tl.set(flash, { autoAlpha: 0 }, 0); tl.set(vig, { autoAlpha: 0 }, 0);
    tl.fromTo(flash, { autoAlpha: 0.6 }, { autoAlpha: 0, duration: 0.2, ease: 'power2.out', immediateRender: false }, at);
    tl.set(flash, { autoAlpha: 0.6 }, at - 0.001);
    tl.fromTo(f.root, { scale: 1.035 }, { scale: 1, duration: 0.35, ease: 'power2.out', immediateRender: false }, at);
    tl.to(f.ui, { filter: 'saturate(.55) brightness(.9) contrast(1.05)', duration: 0.2, ease: 'power1.out' }, at);
    tl.to(vig, { autoAlpha: 1, duration: 0.4 }, at);
    tl.to(f.root, { scale: 1 + (o.creep ?? 0.014), duration: o.hold ?? 2, ease: 'none' }, at + 0.35);
    return at + 0.35;
  }

  // ---- spotlight: everything outside a focus shape darkens (even-odd hole). o.shape 'ellipse' | 'rect'
  function spotlight(f, focus, at, o = {}) {
    const p = S('path', { fill: 'rgba(0,0,0,.6)', 'fill-rule': 'evenodd', class: 'ts-spot' }, f.ann);
    const shape = o.shape || 'rect', r = focus.r ?? 36;
    const build = (k) => {
      const w = focus.w * k, h = focus.h * k, x = focus.cx - w / 2, y = focus.cy - h / 2;
      const hole = shape === 'ellipse'
        ? `M${f1(focus.cx - w / 2)},${f1(focus.cy)} a${f1(w / 2)},${f1(h / 2)} 0 1 0 ${f1(w)},0 a${f1(w / 2)},${f1(h / 2)} 0 1 0 ${f1(-w)},0 Z`
        : `M${f1(x + r)},${f1(y)} h${f1(w - 2 * r)} a${r},${r} 0 0 1 ${r},${r} v${f1(h - 2 * r)} a${r},${r} 0 0 1 ${-r},${r} h${f1(2 * r - w)} a${r},${r} 0 0 1 ${-r},${-r} v${f1(2 * r - h)} a${r},${r} 0 0 1 ${r},${-r} Z`;
      return `M-200,-200 H1280 V2120 H-200 Z ${hole}`;
    };
    const st = { k: 2.2 };
    p.setAttribute('d', build(st.k));
    tl.set(p, { autoAlpha: 0 }, 0);
    tl.set(p, { autoAlpha: 1 }, at);
    tl.fromTo(st, { k: 2.2 }, { k: 1, duration: o.dur ?? 0.4, ease: 'power3.out', immediateRender: false, onUpdate() { p.setAttribute('d', build(st.k)); } }, at);
    tl.fromTo(p, { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, at);
    return at + (o.dur ?? 0.4);
  }

  // ---- marker line: dark outline + coloured core with glow + thin white highlight, drawn along its length
  function markerLine(f, d, at, o = {}) {
    const col = C[o.color] || o.color || C.yellow, w = o.w ?? 9;
    const g = S('g', { class: 'ts-mk' }, f.ann);
    const mk = (cls, sw, stroke, op) => S('path', { d, class: cls, style: `stroke-width:${sw}px;stroke:${stroke};opacity:${op}` }, g);
    const a = mk('ts-mk-o', w + 6, '#000', 0.55), b = mk('ts-mk-c', w, col, 1), c = mk('ts-mk-h', w * 0.28, '#fff', 0.85);
    b.style.filter = `drop-shadow(0 0 10px ${col})`;
    const dur = o.dur ?? 0.5;
    tl.set(g, { autoAlpha: 0 }, 0);
    tl.set(g, { autoAlpha: 1 }, at);
    tl.fromTo([a, b, c], { drawSVG: '0%' }, { drawSVG: '100%', duration: dur, ease: o.ease || 'power2.inOut', immediateRender: true }, at);
    let end = at + dur;
    if (o.head) {
      const L = b.getTotalLength(), p1 = b.getPointAtLength(L), p0 = b.getPointAtLength(Math.max(0, L - 8)), ang = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI, hs = o.head;
      const head = S('path', { d: `M0,0 L${-hs},${-hs * 0.62} L${-hs * 0.72},0 L${-hs},${hs * 0.62} Z`, class: 'ts-mk-head', style: `fill:${col};stroke:#000;stroke-opacity:.55;stroke-width:5px;filter:drop-shadow(0 0 8px ${col})` }, f.ann);
      tl.set(head, { autoAlpha: 0 }, 0);
      tl.set(head, { x: p1.x, y: p1.y, rotation: ang }, 0);
      tl.set(head, { autoAlpha: 1 }, at + dur * 0.9);
      tl.fromTo(head, { scale: 0 }, { scale: 1, duration: 0.18, ease: 'back.out(3)', immediateRender: false }, at + dur * 0.9);
      end += 0.12;
    }
    return end;
  }
  // wobbly closed outline of an ellipse (hand-drawn), starts at the left, clockwise
  function ellipsePath(cx, cy, rx, ry, seed = 1) {
    const n = 36, out = [];
    for (let i = 0; i <= n; i++) { const a = Math.PI + (i / n) * Math.PI * 2.04, k = 1 + (hash(i, seed) - 0.5) * 0.035; out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
    return 'M' + out.map((q) => f1(q[0]) + ',' + f1(q[1])).join(' L');
  }
  // ring around a thing: ellipse in the role colour, drawn clockwise, then an outer dashed ring that rotates
  function ring(f, c, at, o = {}) {
    const col = C[o.color] || o.color || C.yellow;
    const end = markerLine(f, ellipsePath(c.cx, c.cy, c.rx, c.ry, o.seed || 1), at, { color: o.color || 'yellow', w: o.w ?? 8, dur: o.dur ?? 0.45 });
    const outer = S('ellipse', { cx: c.cx, cy: c.cy, rx: c.rx * 1.2, ry: c.ry * 1.22, class: 'ts-dash', style: `stroke:${col};filter:drop-shadow(0 0 6px ${col})` }, f.ann);
    tl.set(outer, { autoAlpha: 0 }, 0);
    tl.fromTo(outer, { autoAlpha: 0 }, { autoAlpha: 0.9, duration: 0.2, immediateRender: false }, end - 0.1);
    const st = { v: 0 };
    tl.fromTo(st, { v: 0 }, { v: 1, duration: Math.max(0.5, Math.min(3, 5.95 - at)), ease: 'none', immediateRender: false, onUpdate() { outer.style.strokeDashoffset = (-st.v * 180).toFixed(1); } }, at);
    return end;
  }
  // rounded rectangle marker around a card or block
  function rrectPath(x, y, w, h, r = 28, seed = 1) {
    const j = (i) => (hash(i, seed) - 0.5) * 3;
    return `M${f1(x + r)},${f1(y + j(0))} H${f1(x + w - r)} Q${f1(x + w + j(1))},${f1(y)} ${f1(x + w)},${f1(y + r)} V${f1(y + h - r)} Q${f1(x + w)},${f1(y + h + j(2))} ${f1(x + w - r)},${f1(y + h)} H${f1(x + r)} Q${f1(x)},${f1(y + h)} ${f1(x)},${f1(y + h - r)} V${f1(y + r)} Q${f1(x + j(3))},${f1(y)} ${f1(x + r)},${f1(y + j(0))}`;
  }
  function box(f, r, at, o = {}) { return markerLine(f, rrectPath(r.x, r.y, r.w, r.h, o.r ?? 30, o.seed || 2), at, { color: o.color || 'yellow', w: o.w ?? 8, dur: o.dur ?? 0.55 }); }

  // ---- space patch: the area nobody covers. Red fill (0.35) with a dashed edge
  function patch(f, r, at, o = {}) {
    const col = C[o.color] || o.color || C.red;
    const rr = S('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: o.r ?? 26, class: 'ts-patch', style: `fill:${col};fill-opacity:.34;stroke:${col}` }, f.ann);
    tl.set(rr, { autoAlpha: 0 }, 0);
    tl.set(rr, { autoAlpha: 1 }, at);
    tl.fromTo(rr, { opacity: 0, scaleY: 0.86, svgOrigin: `${r.x + r.w / 2} ${r.y + r.h / 2}` }, { opacity: 1, scaleY: 1, duration: 0.4, ease: 'power3.out', immediateRender: false }, at);
    return at + 0.4;
  }

  // ---- label card: black card, role-coloured left bar, big italic line, small spaced second line. Reveals left to right.
  function label(parent, o, at) {
    const col = C[o.color] || o.color || C.yellow;
    const el = H(`<div class="ts-label" style="--c:${col};left:${o.x}px;top:${o.y}px;${o.w ? 'width:' + o.w + 'px;' : ''}${o.size ? '--fs:' + o.size + 'px;' : ''}"><i></i><b>${o.text}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</div>`, parent);
    tl.set(el, { autoAlpha: 0 }, 0);
    tl.set(el, { autoAlpha: 1 }, at);
    tl.fromTo(el, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: o.dur ?? 0.4, ease: 'power3.out', immediateRender: true }, at);
    tl.fromTo(el.querySelector('i'), { scaleY: 0 }, { scaleY: 1, duration: 0.25, ease: 'power2.out', transformOrigin: '50% 100%', immediateRender: false }, at);
    tl.fromTo(el, { x: -26 }, { x: 0, duration: 0.45, ease: 'expo.out', immediateRender: false }, at);
    return { el, end: at + (o.dur ?? 0.4) };
  }

  // stopwatch-style number in a tag: counts up (decimals ok)
  function stopwatch(el, to, at, o = {}) { return fx.count(el, to, at, { from: 0, dur: o.dur ?? 0.5, decimals: o.decimals ?? 0, suffix: o.suffix || '', prefix: o.prefix || '', ease: 'power2.out' }); }

  // ---- packaging wipe: a yellow slanted band with dark edges crosses the frame in 0.34 s; the next scene is revealed behind its centre line
  function band(a, b, at, dur = 0.38, stage) {
    a = $(a); b = $(b); stage = $(stage || '#stage');
    const slope = 0.36, wband = 300, mk = (cls) => { const e = H(`<div class="ts-band ${cls}"></div>`, stage); tl.set(e, { autoAlpha: 0 }, 0); return e; };
    const dark = mk('d'), yel = mk('y');
    const poly = (X, half, up = 1) => `polygon(${f1(X - half - 960 * slope)}px 0, ${f1(X + half - 960 * slope)}px 0, ${f1(X + half + 960 * slope)}px 1920px, ${f1(X - half + 960 * slope)}px 1920px)`;
    const reveal = (X) => `polygon(0 0, ${f1(X - 960 * slope)}px 0, ${f1(X + 960 * slope)}px 1920px, 0 1920px)`;
    const st = { x: -wband - 1100 };
    const apply = () => { dark.style.clipPath = poly(st.x, wband / 2 + 16); yel.style.clipPath = poly(st.x, wband / 2); b.style.clipPath = reveal(st.x); };
    tl.set([dark, yel], { autoAlpha: 1 }, at);
    tl.set(b, { autoAlpha: 1 }, at);
    tl.fromTo(st, { x: -wband - 1100 }, { x: 1080 + wband + 1100, duration: dur, ease: 'power2.inOut', immediateRender: false, onUpdate: apply }, at);
    tl.set([dark, yel], { autoAlpha: 0 }, at + dur + 0.001);
    tl.set(a, { autoAlpha: 0 }, at + dur + 0.001);
    tl.set(b, { clipPath: 'none' }, at + dur + 0.001);
    tl.set(b, { clipPath: reveal(-wband - 1100) }, 0);
    return at + dur;
  }

  // ---- split screen: two windows (top / bottom in 9:16) wipe in from their edges, a yellow divider draws from the centre
  function split(wa, wb, at, o = {}) {
    wa = $(wa); wb = $(wb);
    const div = H('<div class="ts-divider"></div>', wa.parentNode);
    tl.set(div, { autoAlpha: 0 }, 0); tl.set(div, { autoAlpha: 1 }, at);
    tl.fromTo(wa, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 0.5, ease: 'expo.out', immediateRender: true }, at);
    tl.fromTo(wb, { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 0.5, ease: 'expo.out', immediateRender: true }, at + 0.08);
    tl.fromTo(div, { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: 'expo.out', immediateRender: true }, at + 0.1);
    return at + 0.6;
  }

  // ---- stamp card: drops from 1.7x to 1x with overshoot, slightly rotated, a small flash (once per film)
  function stamp(el, at, o = {}) {
    el = $(el);
    tl.set(el, { autoAlpha: 0 }, 0); tl.set(el, { autoAlpha: 1 }, at);
    tl.fromTo(el, { scale: 1.7, rotation: (o.rotate ?? -4) - 5 }, { scale: 1, rotation: o.rotate ?? -4, duration: 0.34, ease: 'back.out(2.4)', immediateRender: false }, at);
    const fl = H('<div class="ts-flash"></div>', el.parentNode);
    tl.set(fl, { autoAlpha: 0 }, 0);
    tl.fromTo(fl, { autoAlpha: 0.5 }, { autoAlpha: 0, duration: 0.2, immediateRender: false }, at + 0.14);
    tl.set(fl, { autoAlpha: 0.5 }, at + 0.139);
    fx.shake(el.parentNode, at + 0.14, { strength: 8, dur: 0.3 });
    return at + 0.4;
  }

  // a text slot that changes over time (mode line LIVE / ANALYSIS / REPLAY, source clock): children are alternatives
  function cycle(el, times) {
    const kids = [...$(el).children];
    kids.forEach((c, i) => {
      c.style.gridArea = '1 / 1';
      if (i > 0) { tl.set(c, { autoAlpha: 0 }, 0); tl.set(c, { autoAlpha: 1 }, times[i]); }
      if (i < kids.length - 1) tl.set(c, { autoAlpha: 0 }, times[i + 1]);
    });
    return times[times.length - 1];
  }
  // fix: fx.scenes' own reset is lost when the master timeline rewinds, so scenes 2..n are reset on the timeline too
  function resetScenes(list) { list.slice(1).forEach((s) => tl.set($(s), { autoAlpha: 0 }, 0)); }

  B.styles = B.styles || {};
  B.styles.telestrator = { S, H, C, ITEMS, GEO, card, footage, play, freeze, spotlight, markerLine, ring, box, patch, label, stopwatch, band, split, stamp, cycle, resetScenes, ellipsePath, rrectPath };
})();
