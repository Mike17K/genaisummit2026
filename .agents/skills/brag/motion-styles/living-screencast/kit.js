// living-screencast kit: a pixel mascot that stands on measured UI edges, a spring cursor, a screen-recorder camera,
// and the information layers (chapter pill, key HUD, caption). Every move takes `at` (seconds), returns its end time.
(function () {
  'use strict';
  const B = window.BRAG, G = window.gsap;
  B.styles = B.styles || {};
  const stage = () => document.getElementById('stage');
  const cam = () => document.getElementById('cam');
  const $ = (x) => (typeof x === 'string' ? document.querySelector(x) : x);
  const W = () => (window.TIMELINE && window.TIMELINE.width) || 1080;
  const H = () => (window.TIMELINE && window.TIMELINE.height) || 1920;
  const mk = (cls, html, parent) => { const e = document.createElement('div'); e.className = cls; if (html) e.innerHTML = html; (parent || stage()).appendChild(e); return e; };
  const PX = 9, HALF = PX / 2;

  // mascot sprite on a 12 x 11 grid; groups are shown/hidden per frame (eyes, legs, arms), never tweened
  const SPRITE = () => {
    const r = (x, y, w, h, f) => `<rect x="${x * PX}" y="${y * PX}" width="${w * PX}" height="${h * PX}" fill="${f}"/>`;
    const M = '#FF3D8B', D = '#C41D63', K = '#1b1b2b', Wt = '#fff';
    const eye = (cls, parts) => `<g class="e ${cls}" style="visibility:hidden">${parts}</g>`;
    return `<svg width="108" height="99" viewBox="0 0 108 99">
      ${r(3, 0, 6, 1, M)}${r(1, 1, 10, 8, M)}${r(1, 8, 10, 1, D)}
      ${r(3, 3, 2, 3, Wt)}${r(7, 3, 2, 3, Wt)}
      ${eye('n', r(4, 4, 1, 1, K) + r(8, 4, 1, 1, K))}
      ${eye('l', r(3, 4, 1, 1, K) + r(7, 4, 1, 1, K))}
      ${eye('r', r(4, 4, 1, 1, K) + r(8, 4, 1, 1, K) + r(4, 5, 1, 1, K) + r(8, 5, 1, 1, K))}
      ${eye('d', r(3, 5, 2, 1, K) + r(7, 5, 2, 1, K))}
      ${eye('u', r(3, 3, 2, 1, K) + r(7, 3, 2, 1, K))}
      ${eye('h', r(3, 4, 2, 1, K) + r(7, 4, 2, 1, K) + r(3, 5, 1, 1, K) + r(5, 5, 0, 0, K))}
      ${eye('s', r(3, 5, 2, 1, K) + r(7, 5, 2, 1, K))}
      <g class="a dn">${r(0, 5, 1, 2, D)}${r(11, 5, 1, 2, D)}</g>
      <g class="a up" style="visibility:hidden">${r(0, 2, 1, 3, D)}${r(11, 2, 1, 3, D)}</g>
      <g class="lg A">${r(2, 9, 2, 2, D)}${r(8, 9, 2, 1, D)}</g>
      <g class="lg B" style="visibility:hidden">${r(2, 9, 2, 1, D)}${r(8, 9, 2, 2, D)}</g>
      <g class="heart" style="visibility:hidden">${r(2, -3, 2, 1, M)}${r(5, -3, 2, 1, M)}${r(1, -2, 7, 1, M)}${r(2, -1, 5, 1, M)}${r(3, 0, 3, 1, M)}</g>
    </svg>`;
  };

  const S = B.styles['living-screencast'] = {
    // stage-space rectangle of an element: call BEFORE tweens displace it (the mascot stands on measured DOM)
    rectOf(el) {
      const s = stage().getBoundingClientRect(), k = s.width / W(), r = $(el).getBoundingClientRect(), c = cam()._k || 1;
      return { x: (r.left - s.left) / k / c, y: (r.top - s.top) / k / c, w: r.width / k / c, h: r.height / k / c };
    },
    // create the mascot inside the camera; feet sit at (x, y). returns the element
    mascot(x, y, o = {}) {
      const el = mk('ls-mascot', SPRITE(), cam()); S.el = el; S.pos = { x, y };
      B.tl.set(el, { x: x - 54, y: y - 99, transformOrigin: '50% 100%', autoAlpha: o.hidden ? 0 : 1 }, 0);
      G.set(el.querySelector('.e.n'), { autoAlpha: 1 });
      return el;
    },
    eyes(at, state) { const e = S.el; B.tl.set(e.querySelectorAll('.e'), { autoAlpha: 0 }, at); B.tl.set(e.querySelector('.e.' + state), { autoAlpha: 1 }, at); return at; },
    arms(at, up) { const e = S.el; B.tl.set(e.querySelector('.a.dn'), { autoAlpha: up ? 0 : 1 }, at); B.tl.set(e.querySelector('.a.up'), { autoAlpha: up ? 1 : 0 }, at); return at; },
    // walk along a top edge: position steps on the half-pixel grid, legs alternate every 0.1 s. returns end
    walk(at, x, o = {}) {
      const e = S.el, d = o.dur ?? Math.max(0.3, Math.abs(x - S.pos.x) / (o.speed ?? 700)), tl = B.tl;
      tl.to(e, { x: x - 54, duration: d, ease: o.ease || 'none', snap: { x: HALF } }, at);
      for (let t = 0, i = 0; t < d; t += 0.1, i++) {
        tl.set(e.querySelector('.lg.A'), { autoAlpha: i % 2 ? 0 : 1 }, at + t);
        tl.set(e.querySelector('.lg.B'), { autoAlpha: i % 2 ? 1 : 0 }, at + t);
      }
      tl.set(e.querySelector('.lg.A'), { autoAlpha: 1 }, at + d); tl.set(e.querySelector('.lg.B'), { autoAlpha: 0 }, at + d);
      if (x !== S.pos.x) tl.set(e.querySelector('svg'), { scaleX: x < S.pos.x ? -1 : 1, transformOrigin: '50% 50%' }, at);
      S.pos.x = x; return at + d;
    },
    // jump with crouch, stretch on take-off, squash on landing and a dust puff. lands feet at (x, y). returns end
    hop(at, x, y, o = {}) {
      const e = S.el, tl = B.tl, h = o.h ?? 130, up = o.up ?? 0.26, dn = o.down ?? 0.22, dust = mk('ls-dust', '', cam());
      const y0 = S.pos.y, x0 = S.pos.x, top = Math.min(y0, y) - h;
      tl.to(e, { scaleY: 0.72, scaleX: 1.14, duration: 0.1, ease: 'power2.out' }, at);                  // anticipation
      tl.to(e, { scaleY: 1.2, scaleX: 0.88, duration: 0.06 }, at + 0.1);                                  // stretch
      tl.to(e, { x: x - 54, duration: up + dn, ease: 'none', snap: { x: HALF } }, at + 0.1);
      tl.to(e, { y: top - 99, duration: up, ease: 'power2.out', snap: { y: HALF } }, at + 0.1);
      tl.to(e, { scaleY: 1, scaleX: 1, duration: 0.2 }, at + 0.16);
      tl.to(e, { y: y - 99, duration: dn, ease: 'power2.in', snap: { y: HALF } }, at + 0.1 + up);
      const land = at + 0.1 + up + dn;
      tl.to(e, { scaleY: 0.7, scaleX: 1.18, duration: 0.07, ease: 'power2.out' }, land);                  // landing squash
      tl.to(e, { scaleY: 1, scaleX: 1, duration: 0.3, ease: 'elastic.out(1,0.45)' }, land + 0.07);
      tl.set(dust, { x: x - 60, y: y - 14 }, 0);
      tl.fromTo(dust, { autoAlpha: 0.9, scale: 1 }, { autoAlpha: 0, scale: 2.6, x: x - 90, y: y - 22, duration: 0.35, ease: 'power2.out', immediateRender: false }, land);
      tl.set(dust, { autoAlpha: 0 }, 0);
      S.pos = { x, y }; return land + 0.3;
    },
    // stomp the spot under it (a button): quick down-and-up squash. returns end
    stomp(at) {
      const e = S.el, tl = B.tl;
      tl.to(e, { scaleY: 1.25, scaleX: 0.85, duration: 0.1, ease: 'power2.out' }, at);
      tl.to(e, { scaleY: 0.62, scaleX: 1.22, duration: 0.08, ease: 'power3.in' }, at + 0.1);
      tl.to(e, { scaleY: 1, scaleX: 1, duration: 0.35, ease: 'elastic.out(1,0.4)' }, at + 0.18);
      return at + 0.5;
    },
    heart(at) {
      const g = S.el.querySelector('.heart');
      B.tl.set(g, { autoAlpha: 1 }, at);
      B.tl.fromTo(g, { y: 10, scale: 0.4, transformOrigin: '50% 100%' }, { y: -22, scale: 1, duration: 0.5, ease: 'back.out(2)', immediateRender: false }, at);
      B.tl.set(g, { autoAlpha: 0 }, at + 1.1);
      return at + 1.1;
    },
    // the user: cursor path [{x,y,dur,click}] (spring-eased, never teleports); presses and rings on click. returns end
    cursor(at, path, o = {}) {
      const tl = B.tl, c = mk('ls-cursor', '<svg viewBox="0 0 24 24" width="56" height="56"><path d="M4 2 L4 19 L8.6 14.8 L11.8 21.6 L14.6 20.3 L11.4 13.6 L17.6 13.6 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>', cam()), ring = mk('ls-ring', '', cam());
      let t = at; tl.set(c, { x: path[0].x, y: path[0].y, autoAlpha: 0, transformOrigin: '4px 2px' }, 0); tl.set(ring, { autoAlpha: 0 }, 0);
      tl.to(c, { autoAlpha: 1, duration: 0.15 }, at);
      for (let i = 1; i < path.length; i++) {
        const p = path[i], d = p.dur ?? 0.5;
        tl.to(c, { x: p.x, y: p.y, duration: d, ease: p.ease || 'back.out(0.7)' }, t); t += d;
        if (p.click) {
          tl.to(c, { scale: 0.82, duration: 0.07 }, t); tl.to(c, { scale: 1, duration: 0.2, ease: 'back.out(3)' }, t + 0.07);
          tl.fromTo(ring, { x: p.x + 4, y: p.y + 2, scale: 0.3, autoAlpha: 0.9 }, { scale: 2.6, autoAlpha: 0, duration: 0.45, ease: 'power2.out', immediateRender: false }, t);
          t += 0.1;
        }
        if (p.hold) t += p.hold;
      }
      if (o.out) tl.to(c, { autoAlpha: 0, duration: 0.2 }, t + 0.1);
      return t;
    },
    // screen-recorder camera: zoom >= 1 toward a focus point in stage coords, never showing beyond the frame
    camera(at, o = {}) {
      const z = o.zoom ?? 1, f = o.focus || { x: W() / 2, y: H() / 2 }, d = o.dur ?? 0.7;
      const x = Math.min(0, Math.max(W() - W() * z, W() / 2 - f.x * z)), y = Math.min(0, Math.max(H() - H() * z, H() / 2 - f.y * z));
      B.tl.to(cam(), { x, y, scale: z, duration: d, ease: o.ease || 'power3.inOut', onUpdate() { cam()._k = G.getProperty(cam(), 'scale'); } }, at);
      return at + d;
    },
    // chapter pill: "01  Ask". swaps text per chapter with a small rise
    chapter(at, num, label) {
      let p = stage().querySelector('.ls-pill');
      if (!p) { p = mk('ls-hud ls-pill', '<b></b><span></span>'); B.tl.set(p, { autoAlpha: 0 }, 0); }
      B.tl.set(p.querySelector('b'), { textContent: num }, at); B.tl.set(p.querySelector('span'), { textContent: label }, at);
      B.tl.fromTo(p, { y: -24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, ease: 'power3.out', immediateRender: false }, at);
      return at + 0.3;
    },
    // keystroke HUD: caps that press in, hold, and leave. keys = ['Enter'] or ['⌘','K']
    keys(at, keys, o = {}) {
      const box = mk('ls-hud ls-keys', keys.map((k) => `<span class="ls-key">${k}</span>`).join('')), caps = box.querySelectorAll('.ls-key');
      B.tl.fromTo(caps, { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.14, ease: 'power2.out', stagger: 0.04, immediateRender: true }, at);
      B.tl.to(caps, { y: 5, duration: 0.06, yoyo: true, repeat: 1 }, at + 0.2);
      B.tl.to(caps, { autoAlpha: 0, duration: 0.2 }, at + (o.hold ?? 0.7));
      return at + (o.hold ?? 0.7) + 0.2;
    },
    // frosted caption pill at the bottom (never over the element being discussed)
    caption(at, text, o = {}) {
      const c = mk('ls-hud ls-cap', text), hold = o.hold ?? 1.8;
      B.tl.fromTo(c, { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.22, ease: 'power3.out', immediateRender: true }, at);
      if (hold < 90) B.tl.to(c, { autoAlpha: 0, duration: 0.2 }, at + hold);
      return at + hold + 0.2;
    },
  };
})();
