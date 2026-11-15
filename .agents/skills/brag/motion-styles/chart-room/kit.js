// Chart Room kit: builders that turn real data into SVG / div charts, and moves that reveal them.
// Moves take absolute seconds `at` and return the time they finish. All on BRAG.tl; no timers, no CSS transitions.
(function () {
  const tl = BRAG.tl;
  const NS = 'http://www.w3.org/2000/svg';
  const $$ = (s) => (typeof s === 'string' ? [...document.querySelectorAll(s)] : s.length != null && !s.nodeType ? [...s] : [s]);
  const $ = (s) => $$(s)[0];
  const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const div = (cls, css, parent, html) => { const e = document.createElement('div'); e.className = cls; if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  const nice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  let uid = 0;

  const K = {
    fmt,
    // Build an empty chart frame in `host` (an absolutely positioned box). Returns the geometry other builders use.
    frame(host, o) {
      host = $(host);
      const w = o.w, h = o.h, max = o.max || nice(Math.max(...o.data)), rows = o.rows ?? 4;
      host.classList.add('cr-chart'); host.style.width = w + 'px'; host.style.height = h + 'px';
      const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}` }, host);
      const grid = [];
      for (let i = 0; i <= rows; i++) {
        const y = h - (i / rows) * h;
        grid.push(svgEl('line', { x1: 0, x2: w, y1: y, y2: y, class: 'cr-grid' + (i === 0 ? ' base' : '') }, svg));
        if (o.ticks !== false) div('cr-tick', `left:-${o.tickPad ?? 90}px;top:${y - 10}px;width:${(o.tickPad ?? 90) - 20}px;text-align:right`, host, (o.yFmt || fmt)((max * i) / rows));
      }
      return { host, svg, w, h, max, grid };
    },
    // line + area + leading dot from data points; labels under chosen points
    lineChart(host, o) {
      const f = K.frame(host, o), n = o.data.length, id = 'crc' + uid++;
      const pts = o.data.map((v, i) => [(i / (n - 1)) * f.w, f.h - (v / f.max) * f.h]);
      const defs = svgEl('defs', {}, f.svg);
      const lg = svgEl('linearGradient', { id: 'crfill' + id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      svgEl('stop', { offset: 0, 'stop-color': '#5CF2A8', 'stop-opacity': 0.28 }, lg); svgEl('stop', { offset: 1, 'stop-color': '#5CF2A8', 'stop-opacity': 0 }, lg);
      const cp = svgEl('clipPath', { id: 'cp' + id }, defs); const cr = svgEl('rect', { x: -20, y: -40, width: 0, height: f.h + 80 }, cp);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const area = svgEl('path', { d: d + ` L${f.w} ${f.h} L0 ${f.h} Z`, class: 'cr-area', fill: `url(#crfill${id})`, 'clip-path': `url(#cp${id})` }, f.svg);
      const line = svgEl('path', { d, class: 'cr-line' }, f.svg);
      const dot = svgEl('circle', { r: 11, class: 'cr-dot', cx: pts[0][0], cy: pts[0][1] }, f.svg);
      (o.labels || []).forEach((t, i) => { if (t != null) div('cr-tick', `left:${pts[i][0] - 40}px;top:${f.h + 22}px;width:80px;text-align:center`, f.host, t); });
      return { ...f, pts, line, area, dot, clip: cr, len: line.getTotalLength() };
    },
    // vertical bars with value labels. o.hi = index of the highlighted bar
    barChart(host, o) {
      const f = K.frame(host, o), n = o.data.length, slot = f.w / n, bw = slot * (o.barW ?? 0.56);
      const bars = [], vals = [];
      o.data.forEach((v, i) => {
        const bh = (v / f.max) * f.h, x = i * slot + (slot - bw) / 2;
        bars.push(div('cr-bar' + (i === o.hi ? ' hi' : ''), `left:${x}px;width:${bw}px;height:${bh}px`, f.host));
        vals.push(div('cr-val', `left:${x - 20}px;width:${bw + 40}px;top:${f.h - bh - 40}px`, f.host, '0'));
        if (o.labels) div('cr-tick', `left:${x - 20}px;top:${f.h + 22}px;width:${bw + 40}px;text-align:center`, f.host, o.labels[i]);
      });
      return { ...f, bars, vals, slot, bw };
    },
    // ring with an arc for a share (0..1)
    donut(host, o) {
      host = $(host); const r = o.r ?? 150, c = 2 * Math.PI * r, s = (r + 40) * 2;
      host.style.cssText += `;position:absolute;width:${s}px;height:${s}px`;
      const svg = svgEl('svg', { width: s, height: s, viewBox: `0 0 ${s} ${s}` }, host);
      svgEl('circle', { cx: s / 2, cy: s / 2, r, class: 'cr-ring' }, svg);
      const arc = svgEl('circle', { cx: s / 2, cy: s / 2, r, class: 'cr-arc', transform: `rotate(-90 ${s / 2} ${s / 2})`, 'stroke-dasharray': c, 'stroke-dashoffset': c }, svg);
      return { host, arc, c, share: o.share };
    },

    // ---- moves
    // panel / block rises 24px and fades in
    rise(el, at, o = {}) {
      tl.from($$(el), { y: o.y ?? 24, autoAlpha: 0, duration: o.dur ?? 0.5, ease: 'expo.out', stagger: o.stagger ?? 0.08, immediateRender: true }, at);
      return at + (o.dur ?? 0.5) + (o.stagger ?? 0.08) * ($$(el).length - 1);
    },
    // gridlines draw from the left, ticks fade in
    axes(chart, at, o = {}) {
      tl.from(chart.grid, { attr: { x2: 0 }, duration: o.dur ?? 0.6, ease: 'power3.out', stagger: 0.06, immediateRender: true }, at);
      tl.from(chart.host.querySelectorAll('.cr-tick'), { autoAlpha: 0, duration: 0.4, stagger: 0.03, immediateRender: true }, at + 0.15);
      return at + (o.dur ?? 0.6) + 0.3;
    },
    // the line is drawn left to right; area and leading dot follow (the dot rides the real path length)
    drawLine(c, at, o = {}) {
      const dur = o.dur ?? 1.4, st = { p: 0 };
      tl.fromTo(c.line, { strokeDasharray: c.len, strokeDashoffset: c.len }, { strokeDashoffset: 0, duration: dur, ease: 'power2.inOut', immediateRender: true }, at);
      tl.fromTo(c.clip, { attr: { width: 0 } }, { attr: { width: c.w + 40 }, duration: dur, ease: 'power2.inOut', immediateRender: true }, at);
      tl.fromTo(st, { p: 0 }, { p: 1, duration: dur, ease: 'power2.inOut', immediateRender: false, onUpdate() { const q = c.line.getPointAtLength(st.p * c.len); c.dot.setAttribute('cx', q.x); c.dot.setAttribute('cy', q.y); } }, at);
      tl.from(c.dot, { autoAlpha: 0, duration: 0.15, immediateRender: true }, at);
      return at + dur;
    },
    // bars grow from the baseline and their labels count to the real value
    grow(c, data, at, o = {}) {
      const stag = o.stagger ?? 0.07, dur = o.dur ?? 0.7;
      tl.from(c.bars, { scaleY: 0, duration: dur, ease: 'expo.out', stagger: stag, immediateRender: true }, at);
      c.vals.forEach((v, i) => {
        const st = { v: 0 }; v.textContent = '0';
        tl.fromTo(v, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, immediateRender: true }, at + i * stag);
        tl.fromTo(st, { v: 0 }, { v: data[i], duration: dur, ease: 'expo.out', immediateRender: false, onUpdate() { v.textContent = (o.vFmt || fmt)(st.v); } }, at + i * stag);
        tl.fromTo(v, { y: 40 }, { y: 0, duration: dur, ease: 'expo.out', immediateRender: false }, at + i * stag);
      });
      return at + dur + stag * (c.bars.length - 1);
    },
    // horizontal bar rows: fill scales to its share, value counts
    fill(rows, data, at, o = {}) {
      const r = $$(rows), stag = o.stagger ?? 0.1, dur = o.dur ?? 0.9;
      r.forEach((row, i) => {
        const fl = row.querySelector('.fl'), vl = row.querySelector('.vl'), st = { v: 0 };
        fl.style.width = (data[i] / (o.max || 100)) * 100 + '%';
        tl.fromTo(fl, { scaleX: 0 }, { scaleX: 1, duration: dur, ease: 'expo.out', immediateRender: true }, at + i * stag);
        tl.fromTo(st, { v: 0 }, { v: data[i], duration: dur, ease: 'expo.out', immediateRender: false, onUpdate() { vl.textContent = (o.vFmt || fmt)(st.v); } }, at + i * stag);
      });
      tl.from(r.map((x) => x.querySelector('.nm')), { x: -24, autoAlpha: 0, duration: 0.5, ease: 'expo.out', stagger: stag, immediateRender: true }, at);
      return at + dur + stag * (r.length - 1);
    },
    // the donut sweeps to its share; its label (el) counts in step
    sweepArc(d, at, o = {}) {
      const dur = o.dur ?? 1.2;
      tl.fromTo(d.arc, { strokeDashoffset: d.c }, { strokeDashoffset: d.c * (1 - d.share), duration: dur, ease: 'power3.inOut', immediateRender: true }, at);
      if (o.label) { const el = $(o.label), st = { v: 0 }; tl.fromTo(st, { v: 0 }, { v: d.share * 100, duration: dur, ease: 'power3.inOut', immediateRender: false, onUpdate() { el.textContent = Math.round(st.v) + '%'; } }, at); }
      return at + dur;
    },
    // callout: a leader line draws to a point, then the label appears. x1,y1 is the data point; label sits at its CSS position
    callout(el, at, o = {}) {
      tl.from($$(el), { autoAlpha: 0, scale: 0.92, y: 10, duration: 0.35, ease: 'expo.out', immediateRender: true }, at + (o.delay ?? 0.15));
      if (o.leader) tl.fromTo($$(o.leader), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.3, ease: 'power2.out', immediateRender: true }, at);
      return at + 0.5;
    },
    // hero number counts up (thousands separators); use for the one figure the scene is about
    count(el, to, at, o = {}) {
      const node = $(el), st = { v: o.from ?? 0 }, dur = o.dur ?? 1.0;
      tl.fromTo(st, { v: o.from ?? 0 }, { v: to, duration: dur, ease: 'expo.out', immediateRender: true, onUpdate() { node.textContent = (o.prefix || '') + (o.fmt || fmt)(st.v) + (o.suffix || ''); } }, at);
      return at + dur;
    },
    // slow camera drift on the whole scene while it holds (1.0 to 1.03 max)
    drift(el, start, end, o = {}) {
      tl.fromTo($$(el), { scale: 1 }, { scale: o.scale ?? 1.025, duration: end - start, ease: 'none', immediateRender: false }, start);
      return end;
    },
  };
  BRAG.styles = BRAG.styles || {};
  BRAG.styles['chart-room'] = K;
})();
