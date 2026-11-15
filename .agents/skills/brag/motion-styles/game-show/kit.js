// Game Show kit: one tempo, everything on the beat. Hops, pops, stamps, judgement bursts, stepped scoreboards.
// Every move takes absolute seconds `at` (use K.t(beat) to place on the grid) and returns its end time.
(function () {
  const tl = BRAG.tl;
  const $$ = (s, r) => (typeof s === 'string' ? [...(r || document).querySelectorAll(s)] : s.length != null && !s.nodeType ? [...s] : [s]);
  const BPM = 150, BEAT = 60 / BPM; // 0.4 s
  const NS = 'http://www.w3.org/2000/svg';
  const K = {
    BPM, BEAT,
    t: (beat) => beat * BEAT,                         // beat number -> seconds
    // hand-built mascot: a toy fridge body with face, mitten arms (.armL / .armR) and a mouth that swaps (.mouthO)
    mascot(el, o = {}) {
      const c = o.color || '#E9F4FF', belly = o.belly || '#FFFFFF', ink = '#1B1030';
      $$(el)[0].innerHTML = `<svg viewBox="0 0 520 760">
        <ellipse cx="260" cy="735" rx="190" ry="22" fill="rgba(27,16,48,.3)"/>
        <g class="armL" style="transform-origin:70px 360px"><rect x="-10" y="330" width="100" height="56" rx="28" fill="${c}" stroke="${ink}" stroke-width="8"/><circle cx="-6" cy="358" r="38" fill="${c}" stroke="${ink}" stroke-width="8"/></g>
        <g class="armR" style="transform-origin:450px 360px"><rect x="430" y="330" width="100" height="56" rx="28" fill="${c}" stroke="${ink}" stroke-width="8"/><circle cx="526" cy="358" r="38" fill="${c}" stroke="${ink}" stroke-width="8"/></g>
        <rect x="52" y="40" width="416" height="660" rx="90" fill="${ink}" transform="translate(12 14)"/>
        <rect x="52" y="40" width="416" height="660" rx="90" fill="${c}" stroke="${ink}" stroke-width="8"/>
        <path d="M60 300 H460" stroke="${ink}" stroke-width="8"/>
        <rect x="92" y="96" width="14" height="150" rx="7" fill="${ink}"/><rect x="92" y="360" width="14" height="230" rx="7" fill="${ink}"/>
        <ellipse cx="260" cy="520" rx="130" ry="120" fill="${belly}" opacity=".9"/>
        <ellipse cx="200" cy="170" rx="34" ry="46" fill="${ink}"/><ellipse cx="330" cy="170" rx="34" ry="46" fill="${ink}"/>
        <circle cx="190" cy="152" r="12" fill="#fff"/><circle cx="320" cy="152" r="12" fill="#fff"/>
        <path class="mouthS" d="M205 232 Q265 280 325 232" fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>
        <ellipse class="mouthO" cx="265" cy="250" rx="42" ry="30" fill="${ink}" opacity="0"/>
        <circle cx="140" cy="230" r="20" fill="#FF8FC7" opacity=".8"/><circle cx="390" cy="230" r="20" fill="#FF8FC7" opacity=".8"/>
      </svg>`;
    },
    // squash and hop on the beat: n hops starting at `at`
    hop(el, at, o = {}) {
      const n = o.n ?? 1, h = o.h ?? 70, e = $$(el);
      for (let k = 0; k < n; k++) {
        const t0 = at + k * BEAT;
        tl.to(e, { scaleY: 0.86, scaleX: 1.08, duration: 0.07, ease: 'power2.out', transformOrigin: '50% 100%', immediateRender: false }, t0);
        tl.to(e, { y: -h, scaleY: 1.08, scaleX: 0.95, duration: BEAT * 0.38, ease: 'power2.out', immediateRender: false }, t0 + 0.07);
        tl.to(e, { y: 0, scaleY: 1, scaleX: 1, duration: BEAT * 0.38, ease: 'power2.in', immediateRender: false }, t0 + 0.07 + BEAT * 0.38);
      }
      return at + n * BEAT;
    },
    // arms up on a shout, mouth opens, back down after `hold` beats
    shout(mascot, at, o = {}) {
      const m = $$(mascot)[0], hold = (o.hold ?? 1) * BEAT;
      tl.to(m.querySelector('.armL'), { rotation: 150, duration: 0.12, ease: 'back.out(3)', immediateRender: false }, at);
      tl.to(m.querySelector('.armR'), { rotation: -150, duration: 0.12, ease: 'back.out(3)', immediateRender: false }, at);
      tl.set(m.querySelector('.mouthO'), { opacity: 1 }, at); tl.set(m.querySelector('.mouthS'), { opacity: 0 }, at);
      tl.to([m.querySelector('.armL'), m.querySelector('.armR')], { rotation: 0, duration: 0.15, ease: 'power2.out', immediateRender: false }, at + hold);
      tl.set(m.querySelector('.mouthO'), { opacity: 0 }, at + hold); tl.set(m.querySelector('.mouthS'), { opacity: 1 }, at + hold);
      return at + hold;
    },
    // on-beat pop: elements enter one per beat (or `every` beats), springy, rotating in
    pop(el, at, o = {}) {
      const e = $$(el), every = (o.every ?? 1) * BEAT;
      tl.from(e, { scale: 0, rotation: o.rot ?? -10, autoAlpha: 0, transformOrigin: o.origin || '50% 50%', duration: 0.3, ease: 'back.out(2.6)', stagger: every, immediateRender: true }, at);
      return at + every * (e.length - 1) + 0.3;
    },
    // card dealt in from below / the side, with a hard landing
    deal(el, at, o = {}) {
      const e = $$(el), every = (o.every ?? 1) * BEAT;
      tl.from(e, { x: o.x ?? 0, y: o.y ?? 400, rotation: o.rot ?? 6, autoAlpha: 0, duration: 0.38, ease: 'back.out(1.6)', stagger: every, immediateRender: true }, at);
      return at + every * (e.length - 1) + 0.38;
    },
    // telop line slams on a beat: scales from 1.6, lands with a tiny bounce
    telop(el, at, o = {}) {
      const e = $$(el), every = (o.every ?? 1) * BEAT;
      tl.from(e, { scale: 1.7, autoAlpha: 0, y: -40, duration: 0.22, ease: 'back.out(2.2)', stagger: every, immediateRender: true }, at);
      return at + every * (e.length - 1) + 0.22;
    },
    // judgement burst: starburst spins in, word slams, speed ticks; el = .burst holding a .tele word
    judge(el, at, o = {}) {
      const b = $$(el)[0];
      if (!b.querySelector('svg')) {
        const pts = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 230 : 320; pts.push((320 + Math.cos(a) * r).toFixed(1) + ',' + (320 + Math.sin(a) * r).toFixed(1)); }
        b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 640 640"><polygon points="${pts.join(' ')}" fill="${o.fill || '#FFD23F'}" stroke="#1B1030" stroke-width="12" stroke-linejoin="round" transform="translate(14 14)" opacity=".0"/><polygon class="star" points="${pts.join(' ')}" fill="${o.fill || '#FFD23F'}" stroke="#1B1030" stroke-width="12" stroke-linejoin="round"/></svg>`);
      }
      const star = b.querySelector('.star'), word = b.querySelector('.tele');
      tl.from(b, { scale: 0, rotation: -30, autoAlpha: 0, transformOrigin: '50% 50%', duration: 0.3, ease: 'back.out(2.4)', immediateRender: true }, at);
      tl.fromTo(star, { rotation: 0, transformOrigin: '320px 320px' }, { rotation: 40, duration: o.spin ?? 1.6, ease: 'none', immediateRender: false }, at);
      tl.from(word, { scale: 2.2, autoAlpha: 0, duration: 0.2, ease: 'power4.in', immediateRender: true }, at + 0.1);
      return at + 0.4;
    },
    // set background: stripes scroll, sunbursts spin, dots drift. Linear, so the set never stops.
    set(el, start, end) {
      const s = $$(el)[0], p = s.querySelector('.pat'), d = end - start;
      if (s.classList.contains('pink')) tl.fromTo(p, { x: 0, y: 0 }, { x: -198, y: 198, duration: d, ease: 'none', immediateRender: false }, start);
      else if (s.classList.contains('yellow')) tl.fromTo(p, { x: 0, y: 0 }, { x: 90, y: 90, duration: d, ease: 'none', immediateRender: false }, start);
      else tl.fromTo(p, { rotation: 0 }, { rotation: 24, duration: d, ease: 'none', transformOrigin: '50% 50%', immediateRender: false }, start);
      return end;
    },
    // scoreboard number: counts one step per half beat
    score(el, to, at, o = {}) {
      const n = $$(el)[0], from = o.from ?? 0, steps = o.steps ?? Math.min(to - from, 8), st = { p: 0 }, dur = o.dur ?? steps * BEAT / 2;
      n.textContent = String(from);
      tl.to(st, { p: 1, duration: dur, ease: `steps(${steps})`, immediateRender: false, onUpdate() { n.textContent = String(Math.round(from + (to - from) * st.p)); } }, at);
      tl.set(n, { textContent: String(to) }, at + dur + 0.001);
      tl.fromTo(n, { scale: 1 }, { scale: 1.15, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.out', transformOrigin: '50% 60%', immediateRender: false }, at + dur);
      return at + dur + 0.2;
    },
    // confetti squares fall from fixed hashed positions (no randomness at render time)
    confetti(parent, at, n, o = {}) {
      const P = $$(parent)[0], cols = ['#FF4D6D', '#3DDC84', '#4CC9F0', '#FFD23F', '#8B5CF6', '#FF8A3D'], out = [];
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div'); d.className = 'conf';
        const h = (i * 2654435761) >>> 0, x = (h % 1000) / 1000 * 1000 + 20, rot = ((h >> 8) % 360);
        d.style.cssText = `left:${x}px;top:-60px;background:${cols[i % cols.length]};`;
        P.appendChild(d);
        tl.fromTo(d, { y: 0, rotation: rot }, { y: 2000, rotation: rot + 360 * ((i % 2) ? 1 : -1), duration: (o.dur ?? 0.6) + (i % 5) * 0.04, ease: 'none', immediateRender: true }, at + (i % 6) * 0.04);
        out.push(d);
      }
      return at + 0.9;
    },
    scenes(fx, list) {
      const end = fx.scenes(list);
      return end;
    },
  };
  BRAG.styles = BRAG.styles || {};
  BRAG.styles['game-show'] = K;
})();
