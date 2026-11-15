// Blueprint kit: drawn construction lines, dimension lines, balloons, exploded views, revision cloud, stamp.
// Every move takes `at` (seconds on BRAG.tl) and returns the time it finishes. Deterministic: no timers, no Date.
// Needs gsap.js (DrawSVG), timeline.js, motion.js loaded before this file.
(function () {
  'use strict';
  const G = window.gsap, B = window.BRAG;
  if (!G || !B || !B.tl || !B.fx) { console.error('blueprint kit: load gsap.js, timeline.js, motion.js first'); return; }
  const tl = B.tl, fx = B.fx;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
  const $$ = (x) => (typeof x === 'string' ? [...document.querySelectorAll(x)] : Array.isArray(x) ? x : x && x.length !== undefined && !x.tagName ? [...x] : [x]);
  const hash = (i, k) => { let x = Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(k + 7, 0x85EBCA77); x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
  let uid = 0;

  // ---- tiny SVG builder: S('path', { d, class }, parent)
  function S(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (parent) $(parent).appendChild(e);
    return e;
  }
  function svgLayer(parent, w, h) {
    const s = S('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'bp-svg' });
    $(parent).appendChild(s);
    return s;
  }
  const len = (e) => { try { return e.getTotalLength(); } catch (_) { return 100; } };

  // ---- draw: construction lines drawn on in drafting order, with a glowing nib at the head.
  // els: selector / elements (path, line, rect, circle, ellipse, polyline). o: speed px/s, minDur, parallel, stagger, nib, ease
  function draw(els, at, o = {}) {
    const list = $$(els), speed = o.speed || 1500, minDur = o.minDur ?? 0.22, nibOn = o.nib !== false;
    let t = at, end = at, nib = null;
    if (nibOn && list.length) {
      nib = S('circle', { r: o.nibR || 7, class: 'bp-nib' });
      list[0].parentNode.appendChild(nib);
      tl.set(nib, { autoAlpha: 0 }, 0);
    }
    list.forEach((el, i) => {
      const L = len(el), dur = o.dur ?? Math.max(minDur, L / speed), ease = o.ease || 'power1.inOut';
      const st = o.parallel ? at + i * (o.span != null ? o.span / Math.max(1, list.length) : (o.stagger ?? 0.04)) : t;
      tl.fromTo(el, { drawSVG: '0%' }, { drawSVG: '100%', duration: dur, ease, immediateRender: true }, st);
      if (nib) {
        const s = { p: 0 };
        tl.set(nib, { autoAlpha: 1 }, st);
        tl.fromTo(s, { p: 0 }, { p: 1, duration: dur, ease, immediateRender: false, onUpdate() {
          const pt = el.getPointAtLength(Math.max(0, Math.min(L, s.p * L)));
          nib.setAttribute('cx', pt.x); nib.setAttribute('cy', pt.y);
        } }, st);
        tl.set(nib, { autoAlpha: 0 }, st + dur + 0.001);
      }
      if (!o.parallel) t = st + dur - (o.overlap ?? 0.05);
      end = Math.max(end, st + dur);
    });
    return end;
  }

  // dash-dot / dashed straight line revealed by a growing clip (DrawSVG would erase the dash pattern)
  function dashed(line, at, dur = 0.5) {
    line = $(line);
    const x1 = +line.getAttribute('x1'), y1 = +line.getAttribute('y1'), x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
    const id = 'bpcp' + (uid++), cp = S('clipPath', { id }, line.ownerSVGElement.querySelector('defs') || line.ownerSVGElement.insertBefore(S('defs'), line.ownerSVGElement.firstChild));
    const horiz = Math.abs(x2 - x1) >= Math.abs(y2 - y1), pad = 8;
    const r = S('rect', horiz ? { x: Math.min(x1, x2) - pad, y: y1 - 10, width: 0, height: 20 } : { x: x1 - 10, y: Math.min(y1, y2) - pad, width: 20, height: 0 }, cp);
    line.setAttribute('clip-path', `url(#${id})`);
    tl.to(r, { attr: horiz ? { width: Math.abs(x2 - x1) + pad * 2 } : { height: Math.abs(y2 - y1) + pad * 2 }, duration: dur, ease: 'power2.inOut' }, at);
    return at + dur;
  }

  // hatching (45 degree fine lines) inside a rectangle; returns the line elements (draw them with draw(..., {parallel:true}))
  function hatch(parent, x, y, w, h, gap = 12) {
    const id = 'bpcp' + (uid++), svg = $(parent).ownerSVGElement || $(parent);
    const cp = S('clipPath', { id }, svg.querySelector('defs') || svg.insertBefore(S('defs'), svg.firstChild));
    S('rect', { x, y, width: w, height: h }, cp);
    const g = S('g', { 'clip-path': `url(#${id})`, class: 'bp-hair' }, parent);
    const out = [];
    for (let k = -h; k < w; k += gap) out.push(S('line', { x1: x + k, y1: y + h, x2: x + k + h, y2: y }, g));
    return out;
  }

  // ---- dimension line: extension lines, line with arrowheads, a value that counts up (spec.count) or fades in (spec.label)
  // spec: { x1, y1, x2, y2, off (px, sign = side), label, count, suffix, size }
  function dimension(svg, spec, at, o = {}) {
    svg = $(svg);
    const { x1, y1, x2, y2 } = spec, off = spec.off ?? 40;
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const sg = off < 0 ? -1 : 1, nx = -uy * sg, ny = ux * sg;
    const p1 = { x: x1 + nx * Math.abs(off), y: y1 + ny * Math.abs(off) }, p2 = { x: x2 + nx * Math.abs(off), y: y2 + ny * Math.abs(off) };
    const g = S('g', { class: 'bp-dim' }, spec.parent || svg);
    const e1 = S('line', { x1: x1 + nx * 8, y1: y1 + ny * 8, x2: p1.x + nx * 14, y2: p1.y + ny * 14, class: 'bp-hair-line' }, g);
    const e2 = S('line', { x1: x2 + nx * 8, y1: y2 + ny * 8, x2: p2.x + nx * 14, y2: p2.y + ny * 14, class: 'bp-hair-line' }, g);
    const dl = S('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'bp-dimline' }, g);
    const ar = (p, dir) => S('polygon', { points: `${p.x},${p.y} ${p.x + dir * ux * 20 + nx * 5},${p.y + dir * uy * 20 + ny * 5} ${p.x + dir * ux * 20 - nx * 5},${p.y + dir * uy * 20 - ny * 5}`, class: 'bp-arrow' }, g);
    const a1 = ar(p1, 1), a2 = ar(p2, -1);
    const ang0 = Math.atan2(uy, ux) * 180 / Math.PI, ang = ang0 > 90 || ang0 <= -90 ? ang0 + 180 : ang0;
    const tx = S('text', { class: 'bp-dimtext', 'text-anchor': 'middle', y: -(spec.lift ?? 14), style: `font-size:${spec.size || 30}px` }, S('g', { transform: `translate(${(p1.x + p2.x) / 2} ${(p1.y + p2.y) / 2}) rotate(${ang})` }, g));
    const fmt = (v) => (spec.prefix || '') + Math.round(v).toLocaleString('en-US') + (spec.suffix || '');
    tx.textContent = spec.count != null ? fmt(0) : spec.label || '';
    // choreography
    const d = o.dur ?? 0.7;
    tl.set([e1, e2, dl, a1, a2, tx], { autoAlpha: 0 }, 0);
    tl.set([e1, e2, dl], { autoAlpha: 1 }, at);
    tl.fromTo([e1, e2], { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.22, ease: 'power2.out', immediateRender: true }, at);
    tl.fromTo(dl, { drawSVG: '50% 50%' }, { drawSVG: '0% 100%', duration: d, ease: 'expo.out', immediateRender: true }, at + 0.14);
    tl.fromTo([a1, a2], { autoAlpha: 0, scale: 0 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(3)', immediateRender: false }, at + 0.14 + d * 0.55);
    tl.set(a1, { svgOrigin: `${p1.x} ${p1.y}` }, 0); tl.set(a2, { svgOrigin: `${p2.x} ${p2.y}` }, 0);
    tl.fromTo(tx, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: 'power1.out', immediateRender: false }, at + 0.14 + d * 0.3);
    if (spec.count != null) {
      const s = { v: 0 };
      tl.fromTo(s, { v: 0 }, { v: spec.count, duration: d + 0.2, ease: 'power3.out', immediateRender: false, onUpdate() { tx.textContent = fmt(s.v); } }, at + 0.14 + d * 0.3);
    }
    return at + 0.14 + d + 0.05;
  }

  // ---- balloon: leader line from a feature to a numbered circle. spec: { x, y (balloon centre), tx, ty (target), n, r }
  function balloon(svg, spec, at) {
    svg = $(svg);
    const r = spec.r || 28, g = S('g', { class: 'bp-balloon' }, spec.parent || svg);
    const dx = spec.tx - spec.x, dy = spec.ty - spec.y, L = Math.hypot(dx, dy);
    const sx = spec.x + (dx / L) * r, sy = spec.y + (dy / L) * r;
    const lead = S('line', { x1: spec.tx, y1: spec.ty, x2: sx, y2: sy, class: 'bp-leader' }, g);
    const dot = S('circle', { cx: spec.tx, cy: spec.ty, r: 5, class: 'bp-dot' }, g);
    const c = S('circle', { cx: spec.x, cy: spec.y, r, class: 'bp-ring' }, g);
    const t = S('text', { x: spec.x, y: spec.y + r * 0.34, 'text-anchor': 'middle', class: 'bp-dimtext', style: `font-size:${r * 1.05}px` }, g);
    t.textContent = spec.n;
    tl.set([lead, dot, c, t], { autoAlpha: 0 }, 0);
    tl.set([lead, dot, c], { autoAlpha: 1 }, at);
    tl.fromTo(dot, { scale: 0 }, { scale: 1, svgOrigin: `${spec.tx} ${spec.ty}`, duration: 0.25, ease: 'back.out(3)', immediateRender: false }, at);
    tl.fromTo(lead, { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.35, ease: 'power2.out', immediateRender: true }, at + 0.05);
    tl.fromTo(c, { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.4, ease: 'power2.inOut', immediateRender: true }, at + 0.3);
    tl.fromTo(t, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, svgOrigin: `${spec.x} ${spec.y}`, duration: 0.3, ease: 'back.out(2.5)', immediateRender: false }, at + 0.5);
    return at + 0.8;
  }

  // ---- exploded view: parts (<g> elements) leave along vectors with dashed assembly lines, hold, optionally return.
  // parts: [{ el, dx, dy }]; o: out (s), hold (s), back (s, 0 = stay exploded), ease
  function explode(parts, at, o = {}) {
    const out = o.out ?? 0.7, hold = o.hold ?? 0.3, back = o.back ?? 0, ease = o.ease || 'expo.inOut';
    parts.forEach((p, i) => {
      const el = $(p.el), t0 = at + i * (o.stagger ?? 0.1);
      tl.fromTo(el, { x: 0, y: 0 }, { x: p.dx || 0, y: p.dy || 0, duration: out, ease, immediateRender: false }, t0);
      if (p.guide !== false) {
        const bb = p.cx != null ? { x: p.cx, y: p.cy } : { x: 0, y: 0 };
        const ln = S('line', { x1: bb.x, y1: bb.y, x2: bb.x, y2: bb.y, class: 'bp-guide' }, el.parentNode);
        el.parentNode.insertBefore(ln, el);
        tl.set(ln, { autoAlpha: 0 }, 0);
        tl.set(ln, { autoAlpha: 1 }, t0 + 0.05);
        tl.to(ln, { attr: { x2: bb.x + (p.dx || 0), y2: bb.y + (p.dy || 0) }, duration: out, ease }, t0);
      }
      if (back > 0) tl.to(el, { x: 0, y: 0, duration: back, ease: 'power3.inOut' }, t0 + out + hold);
    });
    return at + (parts.length - 1) * (o.stagger ?? 0.1) + out + (back > 0 ? hold + back : 0);
  }

  // ---- revision cloud: scalloped outline around a rectangle that draws on, with a delta tag. rect: { x, y, w, h }
  function cloud(svg, rect, at, o = {}) {
    svg = $(svg);
    const r = o.r || 18, step = r * 1.9, { x, y, w, h } = rect, pts = [];
    const side = (ax, ay, bx, by) => { const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / step)); for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]); };
    side(x, y, x + w, y); side(x + w, y, x + w, y + h); side(x + w, y + h, x, y + h); side(x, y + h, x, y);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; const rr = Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.62; d += ` A${rr.toFixed(1)},${rr.toFixed(1)} 0 0 1 ${q[0].toFixed(1)},${q[1].toFixed(1)}`; });
    const g = S('g', { class: 'bp-cloud' }, svg);
    const path = S('path', { d: d + 'Z', class: 'bp-line bp-heavy' }, g);
    const dur = o.dur ?? 0.8;
    const end = draw(path, at, { dur, ease: 'power1.inOut', nibR: 9 });
    // delta tag: triangle with a letter
    const tx = x + w - 6, ty = y - 30;
    const tri = S('path', { d: `M${tx},${ty - 34} L${tx + 34},${ty + 20} L${tx - 34},${ty + 20} Z`, class: 'bp-line' }, g);
    const lt = S('text', { x: tx, y: ty + 14, 'text-anchor': 'middle', class: 'bp-dimtext', style: 'font-size:30px' }, g);
    lt.textContent = o.tag || 'B';
    tl.set([tri, lt], { autoAlpha: 0 }, 0);
    tl.set([tri, lt], { autoAlpha: 1 }, end - 0.1);
    tl.fromTo([tri, lt], { scale: 0 }, { scale: 1, svgOrigin: `${tx} ${ty}`, duration: 0.35, ease: 'back.out(3)', immediateRender: false }, end - 0.1);
    return end + 0.25;
  }

  // ---- rubber stamp: the one non-blue colour; slams down from 1.7x with a small rotation and a ripple
  function stamp(el, at, o = {}) {
    el = $(el);
    const rot = o.rotate ?? -9;
    tl.set(el, { autoAlpha: 0 }, 0);
    tl.set(el, { autoAlpha: 1 }, at);
    tl.fromTo(el, { scale: 1.9, rotation: rot - 8, filter: 'blur(5px)' }, { scale: 1, rotation: rot, filter: 'blur(0px)', duration: 0.22, ease: 'power4.in', immediateRender: false }, at);
    tl.fromTo(el, { scale: 1 }, { scale: 1.06, duration: 0.09, yoyo: true, repeat: 1, ease: 'power2.out', immediateRender: false }, at + 0.22);
    fx.shake(el.closest('.scene') || el.parentElement, at + 0.22, { strength: 7, dur: 0.3 });
    return at + 0.5;
  }

  // ---- hand lettering: text is written on left to right, line by line, with a glowing nib at the pen point
  function letter(el, at, o = {}) {
    el = $(el);
    const sp = fx.split(el), lines = sp.lines, cps = o.cps || 28;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const er = el.getBoundingClientRect(), k = er.width / (el.offsetWidth || er.width) || 1;
    const nib = document.createElement('i');
    nib.className = 'bp-pen'; el.appendChild(nib);
    tl.set(nib, { autoAlpha: 0 }, 0);
    let t = at;
    lines.forEach((ln, li) => {
      const chars = sp.chars.filter((c) => ln.contains(c));
      const a = chars[0].getBoundingClientRect(), b = chars[chars.length - 1].getBoundingClientRect(), lr = ln.getBoundingClientRect();
      const x0 = (a.left - er.left) / k, x1 = (b.right - er.left) / k, ly = (lr.top - er.top) / k, lh = lr.height / k;
      const lw = lr.width / k, lx = (lr.left - er.left) / k, dur = Math.max(0.25, chars.length / cps);
      const s = { u: 0 };
      const apply = () => { ln.style.clipPath = `inset(0 ${Math.max(0, lw - (x0 - lx) - s.u * (x1 - x0)).toFixed(1)}px 0 0)`; };
      ln.style.clipPath = `inset(0 ${lw}px 0 0)`;
      tl.set(nib, { autoAlpha: 1, y: ly + lh * 0.62 }, t);
      tl.fromTo(s, { u: 0 }, { u: 1, duration: dur, ease: 'none', immediateRender: true, onUpdate: apply }, t);
      tl.fromTo(nib, { x: x0 }, { x: x1, duration: dur, ease: 'none', immediateRender: false }, t);
      t += dur + 0.04;
    });
    tl.set(nib, { autoAlpha: 0 }, t);
    return t;
  }

  // sheet-frame field that changes value over time: children are alternatives, shown from times[i]
  function cycle(el, times) {
    const kids = [...$(el).children];
    kids.forEach((c, i) => {
      c.style.gridArea = '1 / 1';
      if (i > 0) tl.set(c, { autoAlpha: 0 }, 0);
      if (i > 0) tl.set(c, { autoAlpha: 1 }, times[i]);
      if (i < kids.length - 1) tl.set(c, { autoAlpha: 0 }, times[i + 1]);
    });
    return times[times.length - 1];
  }

  // a cutting-plane line (A-A) that sweeps across the sheet together with a wipe transition (same ease, same time)
  function sectionSweep(at, d = 0.5, stage) {
    stage = $(stage || '#stage');
    const ln = document.createElement('div');
    ln.className = 'bp-section';
    ln.innerHTML = '<b>A</b><span></span><b>A</b>';
    stage.appendChild(ln);
    tl.set(ln, { autoAlpha: 0 }, 0);
    tl.set(ln, { autoAlpha: 1 }, at);
    tl.fromTo(ln, { x: 0 }, { x: 1080, duration: d, ease: 'expo.inOut', immediateRender: false }, at);
    tl.set(ln, { autoAlpha: 0 }, at + d + 0.001);
    return at + d;
  }

  const scenes = (list) => fx.scenes(list);

  B.styles = B.styles || {};
  B.styles.blueprint = { S, svgLayer, draw, dashed, hatch, dimension, balloon, explode, cloud, stamp, letter, cycle, sectionSweep, scenes };
})();
