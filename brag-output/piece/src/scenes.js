// =====================================================================
//  SCENES — VoxEye 16:9 (1920x1080) Pure Hand-Drawn Sketchbook Story
//  Minimal text · Zero UI screenshots · Blindfolded Mascot (`blindHero`)
// =====================================================================

// ---------------------------------------------------------------------
//  BLINDFOLDED HERO (`blindHero`):
//  Wraps `doodleHero` and ties a hand-drawn cloth blindfold across the eyes
//  (with a side knot & fluttering ribbon tails on 2s), plus optional
//  white cane (`o.cane`) and stereo earphones (`o.earphones`).
// ---------------------------------------------------------------------
function blindHero(x, y, r, o = {}) {
  const key = o.key ?? 'hero', mood = o.mood ?? 'calm', lw = Math.max(3, r * 0.065);
  SPARK_AT = toScreen(x, y);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rot ?? 0);

  // Legs
  if (o.legs) {
    const st = o.step ?? 0;
    for (const s of [-1, 1]) {
      const hip = [s * r * 0.32, r * 0.85];
      const kick = s * st * r * 0.24;
      const foot = [s * r * 0.36 + kick, r * 1.42 - Math.max(0, s * st) * r * 0.12];
      gline([hip, foot], { w: lw, key: key + 'leg' + s, amp: 0.8, second: false, step: 8 });
      gline([foot, [foot[0] + s * r * 0.22, foot[1] + 2]], { w: lw * 1.25, key: key + 'ft' + s, amp: 0.5, second: false, step: 6 });
    }
  }

  // Arms + optional white cane in right hand
  let rightHand = [r * 1.35, r * 0.15];
  if (o.arms) {
    [-1, 1].forEach((s, i) => {
      const ang = o.arms[i];
      if (ang == null) return;
      const sh = [s * r * 0.9, r * 0.15], L = r * 0.85;
      const el = [sh[0] + s * L * 0.5 * Math.cos(ang * 0.6), sh[1] - L * 0.5 * Math.sin(ang * 0.6)];
      const hd = [sh[0] + s * L * Math.cos(ang), sh[1] - L * Math.sin(ang)];
      if (s === 1) rightHand = hd;
      gline([sh, el, hd], { w: lw, key: key + 'arm' + s, amp: 0.8, second: false, step: 8 });
      gline(loopPts(hd[0], hd[1], r * 0.09, r * 0.09, 0.1), { w: lw * 0.8, key: key + 'hd' + s, amp: 0.4, second: false, step: 5 });
    });
  }

  if (o.cane) {
    const cx0 = rightHand[0], cy0 = rightHand[1];
    const cx1 = cx0 + r * 1.25, cy1 = r * 1.42;
    const cxm = lerp(cx0, cx1, 0.78), cym = lerp(cy0, cy1, 0.78);
    gline([[cx0, cy0], [cx1, cy1]], { w: lw * 0.95, col: SK.ink, key: key + 'cane' });
    gline([[cxm, cym], [cx1, cy1]], { w: lw * 1.35, col: SK.red, key: key + 'canetip', second: false });
  }

  ctx.scale(o.sx ?? 1, o.sy ?? 1);

  // Terracotta body + hatched shading + ink outline + crown asterisk
  const body = loopPts(0, 0, r, r, 0, 0, 40);
  gfill(body, SK.terra, { off: [r * 0.06, r * 0.05], key: key + 'f' });
  litHatch(body, { ang: -0.85, gap: Math.max(5, r * 0.08), col: SK.terraD, w: Math.max(1.6, r * 0.03), a: 0.85, key: key + 'h' });
  gline(loopPts(0, 0, r, r, 0.08), { w: lw, key: key + 'o' });

  for (let i = 0; i < 8; i++) {
    const an = i / 8 * TAU + 0.2, r0 = r * 0.04, r1 = r * 0.18, cy = -r * 0.54;
    gline([[Math.cos(an) * r0, cy + Math.sin(an) * r0], [Math.cos(an) * r1, cy + Math.sin(an) * r1]], {
      w: r * 0.06, col: SK.cream, key: key + 'a' + i, amp: 0.4, second: false, step: 6
    });
  }

  // ---- BLINDFOLD BAND ACROSS THE EYES ----
  const flutter = ((B % 2) ? 1 : -1) * r * 0.04;
  // Knot and two fluttering cloth tails on the left side of the head
  const tail1 = [[-r * 0.96, -r * 0.04], [-r * 1.28, -r * 0.24 + flutter], [-r * 1.48, -r * 0.12 - flutter]];
  const tail2 = [[-r * 0.96, r * 0.06], [-r * 1.32, r * 0.18 - flutter], [-r * 1.52, r * 0.30 + flutter]];
  gline(tail1, { w: lw * 1.1, col: SK.ink, key: key + 'bf_t1' });
  gline(tail2, { w: lw * 1.1, col: SK.ink, key: key + 'bf_t2' });
  const knot = loopPts(-r * 0.98, r * 0.01, r * 0.13, r * 0.13, 0.08);
  gfill(knot, SK.sheet, { off: [2, 2], key: key + 'bf_kf' });
  gline(knot, { w: lw * 0.9, key: key + 'bf_ko' });

  // Main cloth blindfold strap wrapping across the face
  const band = [
    [-r * 0.98, -r * 0.16],
    [0, -r * 0.12],
    [r * 0.98, -r * 0.16],
    [r * 1.00, r * 0.15],
    [0, r * 0.20],
    [-r * 1.00, r * 0.15]
  ];
  gfill(band, SK.sheet, { off: [3, 2], key: key + 'bf_f' });
  ctx.save();
  gclip(band);
  ghatch(-r, -r * 0.2, r, r * 0.22, { ang: -0.45, gap: Math.max(6, r * 0.11), col: SK.graph, w: 1.8, a: 0.45, key: key + 'bf_h' });
  ctx.restore();
  gline(closeP(band), { w: lw * 0.95, key: key + 'bf_o' });
  // Subtle cloth fold crease along the blindfold
  gpencil([[-r * 0.65, r * 0.02], [r * 0.62, r * 0.04]], { w: 2, col: SK.graph, key: key + 'bf_cr', passes: 1 });

  // Optional Stereo Earphones on left & right sides of head
  if (o.earphones) {
    for (const s of [-1, 1]) {
      const ep = loopPts(s * r * 1.03, r * 0.02, r * 0.14, r * 0.22, 0.06);
      gfill(ep, SK.hilite, { off: [2, 2], key: key + 'epf' + s });
      gline(ep, { w: lw * 0.95, key: key + 'epo' + s });
    }
  }

  // Expressive mouth below the blindfold
  const my = r * 0.44;
  if (mood === 'wow') {
    ctx.fillStyle = SK.ink;
    ctx.beginPath();
    ctx.ellipse(0, my + r * 0.02, r * 0.09, r * 0.11, 0, 0, TAU);
    ctx.fill();
  } else if (mood === 'happy') {
    ctx.fillStyle = SK.ink;
    ctx.beginPath();
    ctx.moveTo(-r * 0.22, my - r * 0.05);
    ctx.quadraticCurveTo(0, my + r * 0.32, r * 0.22, my - r * 0.05);
    ctx.closePath();
    ctx.fill();
  } else if (mood === 'puzzled') {
    gline([[-r * 0.18, my], [-r * 0.05, my - r * 0.05], [r * 0.06, my + r * 0.04], [r * 0.18, my - r * 0.02]], {
      w: lw * 0.85, key: key + 'm', amp: 0.4, second: false, step: 5
    });
  } else {
    gline(arcPts(0, my - r * 0.12, r * 0.18, Math.PI * 0.2, Math.PI * 0.8, 8), {
      w: lw * 0.85, key: key + 'm', amp: 0.4, second: false, step: 5
    });
  }

  ctx.restore();
  return body;
}

// Ensure morph bridges also use our blindfolded hero
STYLE.hero = (x, y, r, o) => blindHero(x, y, r * 0.6, { ...o, key: o.key });

// ---------------------------------------------------------------------
//  BACKGROUND LIFE & MINIMAL LETTERING HELPERS (16:9 Page)
// ---------------------------------------------------------------------
function ant(x, y, s, key) {
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = SK.ink;
    ctx.beginPath();
    ctx.ellipse(x + (i - 1) * 11 * s, y - 6 * s, (i === 1 ? 5 : 6.5) * s, 5 * s, 0, 0, TAU);
    ctx.fill();
  }
  const k = B % 2 ? 1 : -1;
  for (let i = 0; i < 3; i++) {
    gline([[x + (i - 1) * 8 * s, y - 4 * s], [x + (i - 1) * 8 * s + k * (i % 2 ? 5 : -5) * s, y + 3 * s]], {
      w: 1.8 * s, key: key + i, amp: 0.3, second: false, step: 4
    });
  }
  gline([[x + 16 * s, y - 8 * s], [x + 24 * s, y - 16 * s]], { w: 1.6 * s, key: key + 'ant', amp: 0.3, second: false, step: 4 });
}

function marginPlane(key, x0 = 1580, y0 = 230) {
  const at = (p) => [x0 + 130 * Math.sin(TAU * p), y0 + 55 * Math.sin(2 * TAU * p)];
  const p = TT / 3.5, trail = [];
  for (let i = 0; i <= 24; i++) trail.push(at(p - 0.35 + 0.35 * i / 24));
  ctx.save();
  ctx.setLineDash([10, 12]);
  gpencil(trail, { key: key + 'tr', w: 2.2, a: 0.6, passes: 1, amp: 1 });
  ctx.restore();
  const [x, y] = at(p), [x2, y2] = at(p + 0.01);
  paperPlane(x, y, Math.atan2(y2 - y, x2 - x), 1.2, key);
}

function skTag(str) {
  const f = () => {
    const size = 50, w = letterW(str, size, 'marker'), x = 110, y = 148;
    tapeStrip(x + w / 2, y - size * 0.28, w + 64, -0.025, 'tagt_' + str, size * 1.15);
    const [x0, x1] = handLetter(str, x, y, size, { face: 'marker', align: 'left', reveal: ev(E0 + 0.08, 0.25), key: 'tag_' + str, jit: 0.6 });
    underline(x0, x1, y + 15, { col: SK.red, w: 4.5, key: 'tagu_' + str, part: ev(E0 + 0.3, 0.2) });
  };
  if (DEFER) DEFER.push(f); else f();
}

function skCaption(lines, hi = [], o = {}) {
  pageCaption(lines, hi, { y: o.y ?? 915, size: o.size ?? 54, at: o.at ?? 0.25 });
}

function bulbPts(x, y, r) {
  const P = [], a0 = Math.PI / 2 - 0.6, a1 = Math.PI / 2 + 0.6 - TAU;
  for (let i = 0; i <= 36; i++) {
    const a = lerp(a0, a1, i / 36);
    P.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  P.push([x - 0.36 * r, y + 1.12 * r], [x - 0.34 * r, y + 1.42 * r], [x + 0.34 * r, y + 1.42 * r], [x + 0.36 * r, y + 1.12 * r]);
  return P;
}

// =====================================================================
//  ERA 0 (0.0 - 6.8s): THE UNSEEN WORLD (Blindfolded Hero + Overhangs)
// =====================================================================
function scenePerson() {
  const cu = TIMELINE.cues;
  sketchPage({ grid: 'dots' });

  // Margin stars
  [[160, 320, 0], [220, 480, 1], [140, 620, 2]].forEach(([x, y, i]) =>
    doodleStar(x, y, 22 + 6 * ((B + i) % 3 === 0), 'p1_st' + i, { w: 3 })
  );

  // Ground line & tiny ant walking it
  gpencil([[220, 745], [680, 740], [1180, 748], [1680, 742]], { key: 'p1_gnd', w: 3.2, a: 0.8 });
  ant(1120 + 60 * TT, 744, 1.4, 'p1_ant');

  // Blindfolded hero walking with white cane toward a low overhanging branch & sign
  const hx = 560, hy = 585;
  blindHero(hx, hy, 108, {
    key: 'p1_hero', legs: true, cane: true,
    mood: 'puzzled', step: Math.sin(TT * 4),
    arms: [-0.8, -0.25]
  });
  handLetter('?', hx - 125, hy - 115 + 6 * Math.sin(B * 0.9), 86, { face: 'marker', col: SK.graph, key: 'p1_q' });
  sweat(hx - 110, hy - 40, (TT * 1.2) % 1, 'p1_sw1');
  sweat(hx - 128, hy - 20, ((TT * 1.2 + 0.5) % 1), 'p1_sw2');

  // Sketched overhanging tree branch & hanging street sign right at head height!
  const pBranch = ev(cu.p1_cards, 0.5);
  // Tree trunk on the right + low branch reaching left toward the hero's head
  gline([[1380, 744], [1370, 260]], { w: 6, key: 'p1_trk', part: pBranch });
  const branch = [[1372, 390], [1160, 405], [960, 435], [810, 455]];
  gline(branch, { w: 5.5, key: 'p1_br', part: pBranch });
  // Hanging sign dangling from the branch right at head level
  const signBox = sketchBox(830, 470, 210, 95, 10);
  if (pBranch > 0.4) {
    gfill(signBox, SK.sheet, { off: [4, 4], key: 'p1_sgf' });
    scribbleFill(signBox, SK.hilite, { key: 'p1_sgh', gap: 11, w: 4, a: 0.75, base: 0.25 });
    gline([[880, 448], [880, 470]], { w: 3.5, key: 'p1_chn1', second: false });
    gline([[990, 432], [990, 470]], { w: 3.5, key: 'p1_chn2', second: false });
    gline(signBox, { closed: true, w: 4.5, key: 'p1_sgo' });
    handLetter('!', 935, 540, 68, { face: 'marker', col: SK.red, key: 'p1_haz' });
  }

  // Pencil drawing the hazard, then rubber stamp
  if (TT >= cu.p1_cards && TT < cu.p1_stamp) {
    const tip = writeEnd(branch, pBranch);
    pencilTool(tip[0], tip[1], -0.7, 0.9);
  }
  if (TT >= cu.p1_stamp) {
    inkStamp('€5,000 / 3s LAG', 1420, 610, 0.56, -0.1, ev(cu.p1_stamp, 0.2), 'p1_stmp');
  }

  skTag('the unseen world');
  skCaption(
    ['a cane feels the ground', 'not what hangs above'],
    [[1, 'above']]
  );
}

// =====================================================================
//  ERA 1 (6.8 - 13.6s): MEET VOXEYE (The Idea Bulb + Earphones)
// =====================================================================
const P2_BULB = { x: 960, y: 360, r: 105 };
function sceneReveal() {
  const cu = TIMELINE.cues;
  sketchPage({ grid: 'dots' });

  marginPlane('p2_mp', 1560, 250);
  [[240, 360, 0], [310, 540, 1], [1580, 520, 2]].forEach(([x, y, i]) =>
    doodleStar(x, y, 24 + 7 * ((B + i) % 3 === 0), 'p2_st' + i, { w: 3.2 })
  );

  gpencil([[320, 755], [760, 748], [1200, 756], [1600, 750]], { key: 'p2_gnd', w: 3, a: 0.75 });

  // Glowing Idea Bulb above our blindfolded hero
  const P = bulbPts(P2_BULB.x, P2_BULB.y, P2_BULB.r);
  const lit = ev(7.3, 0.3);
  if (lit > 0) {
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU - Math.PI / 2, r0 = P2_BULB.r * 1.22, r1 = P2_BULB.r * (1.48 + 0.1 * ((B + i) % 2));
      if (Math.sin(a) > 0.7) continue;
      gline([[P2_BULB.x + Math.cos(a) * r0, P2_BULB.y + Math.sin(a) * r0], [P2_BULB.x + Math.cos(a) * r1, P2_BULB.y + Math.sin(a) * r1]], {
        w: 5, key: 'p2_ray' + i, part: lit, second: false, amp: 0.8
      });
    }
  }
  scribbleFill(P, SK.hilite, { key: 'p2_bf', part: ev(7.1, 0.45), gap: 12, w: 4.5, a: 0.95, base: 0.35 });
  gpencil(P, { closed: true, key: 'p2_bc', w: 2.6, a: 0.7, part: ev(6.9, 0.3) });
  gline(P, { closed: true, key: 'p2_bo', w: 6, part: ev(7.0, 0.35) });
  for (let i = 0; i < 3; i++) {
    gline([[P2_BULB.x - 0.38 * P2_BULB.r, P2_BULB.y + (1.2 + i * 0.1) * P2_BULB.r], [P2_BULB.x + 0.38 * P2_BULB.r, P2_BULB.y + (1.17 + i * 0.1) * P2_BULB.r]], {
      w: 4, key: 'p2_sc' + i, second: false, part: ev(7.15 + i * 0.05, 0.15)
    });
  }

  // Pencil drawing the bulb and earphones
  if (TT >= 6.9 && TT < 8.4) {
    const tip = writeEnd(closeP(P), ev(6.9, 0.9));
    pencilTool(tip[0], tip[1], -0.75 + 0.08 * Math.sin(B * 1.7), 0.95);
  }

  // Blindfolded hero puts on earphones and hops with joy!
  const hop = Math.sin(Math.PI * ev(7.5, 0.3));
  const hx = 620, hy = 605 - 45 * hop;
  blindHero(hx, hy, 108, {
    key: 'p2_hero', legs: true, earphones: true,
    mood: 'happy', arms: [1.15, 1.25],
    sx: 1 - 0.04 * hop, sy: 1 + 0.06 * hop
  });
  handLetter('!', hx + 135, hy - 110 - 20 * hop, 96, { face: 'marker', col: SK.red, key: 'p2_bang' });

  // Sound waves radiating from the earphones
  for (let k = 1; k <= 3; k++) {
    const r = 135 + k * 28 + 6 * ((B + k) % 2);
    gline(arcPts(hx, hy, r, Math.PI * 0.84, Math.PI * 1.16, 12), { w: 4, col: SK.ink, key: 'p2_wl' + k, second: false, part: ev(7.6 + k * 0.1, 0.25) });
    gline(arcPts(hx, hy, r, -Math.PI * 0.16, Math.PI * 0.16, 12), { w: 4, col: SK.ink, key: 'p2_wr' + k, second: false, part: ev(7.6 + k * 0.1, 0.25) });
  }

  skTag('meet VoxEye');
  skCaption(
    ['just your phone & earphones', 'now your ears can see'],
    [[1, 'see']]
  );
}

// =====================================================================
//  ERA 2 (13.6 - 21.8s): STEREO SONAR (Left · Center · Right Beeps)
// =====================================================================
function sceneSonar() {
  const cu = TIMELINE.cues;
  sketchPage({ grid: 'dots' });

  // Blindfolded hero on the left sending 3 hand-drawn sonar beams across the page
  gpencil([[200, 745], [700, 750], [1250, 742], [1720, 748]], { key: 'p3_gnd', w: 3, a: 0.75 });

  const hx = 420, hy = 585;
  blindHero(hx, hy, 104, {
    key: 'p3_hero', legs: true, cane: true, earphones: true,
    mood: 'happy', step: Math.sin(TT * 5),
    arms: [-0.6, -0.2]
  });

  // Pulsing stereo sound arcs at hero's left & right ears
  for (let k = 1; k <= 3; k++) {
    const r = 128 + k * 26 + 5 * ((B + k) % 2);
    gline(arcPts(hx, hy, r, Math.PI * 0.82, Math.PI * 1.18, 12), { w: 4.2, col: SK.ink, key: 'p3_el' + k, second: false });
    gline(arcPts(hx, hy, r, -Math.PI * 0.18, Math.PI * 0.18, 12), { w: 4.2, col: SK.ink, key: 'p3_er' + k, second: false });
  }

  // 3 Hand-Drawn Sonar Cones fanning right toward a sketched obstacle
  const coneTop = [[hx + 125, hy - 35], [1280, 220], [1280, 385], [hx + 135, hy - 10]];
  const coneMid = [[hx + 135, hy - 10], [1280, 385], [1280, 575], [hx + 135, hy + 20]];
  const coneBot = [[hx + 135, hy + 20], [1280, 575], [1280, 735], [hx + 125, hy + 45]];

  scribbleFill(coneMid, SK.hilite, { key: 'p3_cmf', part: ev(cu.p3_cone, 0.45), gap: 12, w: 4.5, a: 0.85, base: 0.3 });
  gpencil(coneTop, { closed: true, key: 'p3_ct', w: 2.8, part: ev(13.9, 0.35) });
  gline(coneMid, { closed: true, key: 'p3_cm', w: 5, part: ev(14.1, 0.35) });
  gpencil(coneBot, { closed: true, key: 'p3_cb', w: 2.8, part: ev(14.3, 0.35) });

  handLetter('LEFT EAR', 1050, 320, 36, { face: 'marker', col: SK.graph, key: 'p3_lt' });
  handLetter('BEEP · BEEP · BEEP!', 980, 492, 44, { face: 'marker', col: SK.ink, key: 'p3_md' });
  handLetter('RIGHT EAR', 1050, 665, 36, { face: 'marker', col: SK.graph, key: 'p3_rt' });

  // Sketched Obstacle (a street bollard / café chair) at x = 1420
  const ox = 1360, oy = 420;
  const obs = sketchBox(ox, oy, 180, 320, 16);
  gfill(obs, SK.sheet, { off: [5, 5], key: 'p3_obf' });
  scribbleFill(obs, SK.hilite, { key: 'p3_obh', gap: 11, w: 4, a: 0.7, base: 0.25 });
  gline(obs, { closed: true, w: 5.5, key: 'p3_obo' });
  handLetter('0.8m', ox + 90, oy + 175, 52, { face: 'marker', col: SK.red, key: 'p3_obm' });

  skTag('stereo sonar');
  skCaption(
    ['closer means faster beeps', 'left ear · center · right ear'],
    [[0, 'beeps']]
  );
}

// =====================================================================
//  ERA 3 (21.8 - 30.5s): JUST ASK (Bilingual Voice & Pinned Memory Note)
// =====================================================================
function sceneVoice() {
  const cu = TIMELINE.cues;
  sketchPage({ grid: 'dots' });

  gpencil([[200, 750], [720, 744], [1240, 752], [1720, 746]], { key: 'p4_gnd', w: 3, a: 0.75 });

  // Blindfolded hero speaking a question
  const hx = 450, hy = 590;
  blindHero(hx, hy, 106, {
    key: 'p4_hero', legs: true, earphones: true,
    mood: 'happy', arms: [-0.5, 0.95]
  });

  // Hand-drawn speech bubble above hero
  const sb = sketchBox(260, 235, 540, 155, 22);
  gfill(sb, SK.sheet, { off: [4, 4], key: 'p4_sbf', a: ev(cu.p4_ask, 0.3) });
  gline(sb, { closed: true, w: 5, key: 'p4_sbo', part: ev(cu.p4_ask, 0.35) });
  handLetter('"Πού είναι το φαρμακείο;"', 530, 305, 38, { face: 'marker', col: SK.ink, key: 'p4_q1', reveal: ev(cu.p4_ask + 0.1, 0.35) });
  handLetter('"Where is the pharmacy?"', 530, 358, 32, { face: 'hand', col: SK.graph, key: 'p4_q2', reveal: ev(cu.p4_ask + 0.3, 0.35) });

  // Pinned Memory Index Card (`noteCard`) in the center + green checkmark
  const np = ev(cu.p4_router, 0.4);
  if (np > 0) {
    noteCard(1010, 490, -0.05, 1.95, 0, 'p4_nc', SK.terra);
    handLetter('Goal:', 1020, 475, 28, { face: 'hand', col: SK.graph, key: 'p4_nct0' });
    handLetter('Pharmacy', 1020, 520, 34, { face: 'marker', col: SK.ink, key: 'p4_nct1' });
    checkMark(1155, 420, 0.75, ev(cu.p4_router + 0.3, 0.25), SK.green, 'p4_chk');
  }

  // Sketched Pharmacy Door on the right (`4 steps ahead`)
  const dx = 1380, dy = 340, dw = 240, dh = 405;
  const door = sketchBox(dx, dy, dw, dh, 12);
  const dp = ev(cu.p4_reply, 0.45);
  if (dp > 0) {
    gfill(door, SK.sheet, { off: [5, 5], key: 'p4_df', a: dp });
    scribbleFill(sketchBox(dx + 75, dy - 95, 90, 80, 10), SK.hilite, { key: 'p4_crf', gap: 10, w: 4, a: 0.9, base: 0.3 });
    gline(sketchBox(dx + 75, dy - 95, 90, 80, 10), { closed: true, w: 4.5, key: 'p4_cro', part: dp });
    handLetter('+', dx + 120, dy - 32, 68, { face: 'marker', col: SK.green, key: 'p4_pls' });
    gline(door, { closed: true, w: 5.5, key: 'p4_do', part: dp });
    gline(loopPts(dx + dw - 35, dy + dh * 0.52, 12, 12, 0.1), { w: 4.5, key: 'p4_knb' });
    arrowPencil([[hx + 150, hy + 20], [960, 650], [dx - 25, 620]], dp, { key: 'p4_arw', w: 4 });
  }

  skTag('just ask');
  skCaption(
    ['ask in Greek or English', 'it remembers what matters'],
    [[0, 'English'], [1, 'remembers']]
  );
}

// =====================================================================
//  ERA 4 (30.5 - 38.2s): FIND YOUR WAY (Compass Rose & Footpath)
// =====================================================================
const P5_COMP = { x: 960, y: 460, r: 175 };
function scenePlaces() {
  const cu = TIMELINE.cues;
  sketchPage({ grid: 'dots' });

  // Dashed graphite footpath winding across the page
  ctx.save();
  ctx.setLineDash([16, 16]);
  gpencil([[220, 720], [560, 650], [960, 690], [1380, 610], [1680, 520]], { key: 'p5_path', w: 3.5, a: 0.75 });
  ctx.restore();

  // Big Hand-Drawn Compass Rose in the center of the page
  const CP = ellipsePts(P5_COMP.x, P5_COMP.y, P5_COMP.r, P5_COMP.r, 0, 64);
  gfill(CP, SK.sheet, { off: [5, 5], key: 'p5_cf' });
  scribbleFill(CP, SK.hilite, { key: 'p5_cs', part: ev(cu.p5_comp, 0.45), gap: 13, w: 4.5, a: 0.85, base: 0.3 });
  gpencil(CP, { closed: true, key: 'p5_cp', w: 2.6, a: 0.6 });
  gline(loopPts(P5_COMP.x, P5_COMP.y, P5_COMP.r, P5_COMP.r, 0.06), { key: 'p5_co', w: 6 });

  handLetter('N', P5_COMP.x, P5_COMP.y - P5_COMP.r + 48, 38, { face: 'marker', col: SK.red, key: 'p5_n' });
  handLetter('S', P5_COMP.x, P5_COMP.y + P5_COMP.r - 20, 34, { face: 'marker', col: SK.graph, key: 'p5_s' });
  handLetter('W', P5_COMP.x - P5_COMP.r + 36, P5_COMP.y + 12, 34, { face: 'marker', col: SK.graph, key: 'p5_w' });
  handLetter('E', P5_COMP.x + P5_COMP.r - 36, P5_COMP.y + 12, 34, { face: 'marker', col: SK.graph, key: 'p5_e' });

  // Rotating Compass Needle pointing toward the destination
  const ang = -0.45 + 0.08 * Math.sin(TT * 3);
  const nx = P5_COMP.x + Math.cos(ang) * (P5_COMP.r * 0.65);
  const ny = P5_COMP.y + Math.sin(ang) * (P5_COMP.r * 0.65);
  gline([[P5_COMP.x, P5_COMP.y], [nx, ny]], { w: 7, col: SK.red, key: 'p5_ndl' });
  gline(loopPts(P5_COMP.x, P5_COMP.y, 14, 14, 0.1), { w: 5, key: 'p5_hub' });

  // Blindfolded hero walking confidently on the left
  blindHero(420, 560, 102, {
    key: 'p5_hero', legs: true, cane: true, earphones: true,
    mood: 'happy', step: Math.sin(TT * 6),
    arms: [-0.4, -0.2]
  });

  // Minimal margin stars for the stack (Gemini · Maps · fal.ai)
  if (TT >= cu.p5_stack) {
    doodleStar(1460, 310, 26, 'p5_s1', { w: 3 });
    handLetter('Gemini · Maps · fal.ai', 1520, 395, 34, { face: 'hand', col: SK.graph, key: 'p5_stk' });
  }

  skTag('find your way');
  skCaption(
    ['a compass in your ears', 'guiding every step'],
    [[0, 'ears']]
  );
}

// =====================================================================
//  ERA 5 (38.2 - 53.5s): IN THE REAL WORLD (Live Demo Window on the Page)
// =====================================================================
const P6_WIN = { x: 340, y: 215, w: 1240, h: 610 };
function sceneLiveDemo() {
  const cu = TIMELINE.cues;
  sketchPage({ grid: 'dots' });

  // Margin birds & paper plane outside the taped window
  for (let i = 0; i < 2; i++) {
    doodleBird(220 + i * 70, 340 + i * 35, 1.2 - i * 0.2, (B + i) % 2, 'p6_bd' + i);
  }
  marginPlane('p6_mp', 1730, 310);

  // Hand-drawn sketchbook frame taped onto the center of the page (for real-demo.mp4 or live sketch)
  const WP = sketchBox(P6_WIN.x, P6_WIN.y, P6_WIN.w, P6_WIN.h, 22);
  smudge(P6_WIN.x + P6_WIN.w / 2, P6_WIN.y + P6_WIN.h / 2 + 14, P6_WIN.w * 0.5, P6_WIN.h * 0.5, 0.14, 0.01);
  gfill(WP, SK.sheet, { off: [5, 5], key: 'p6_wf' });
  gpencil(WP, { closed: true, w: 3, key: 'p6_wp' });
  gline(WP, { closed: true, w: 6, key: 'p6_wo' });

  tapeStrip(P6_WIN.x + 110, P6_WIN.y + 6, 150, -0.2, 'p6_t1', 40);
  tapeStrip(P6_WIN.x + P6_WIN.w - 110, P6_WIN.y + 6, 150, 0.2, 'p6_t2', 40);
  tapeStrip(P6_WIN.x + 110, P6_WIN.y + P6_WIN.h - 6, 150, 0.18, 'p6_t3', 40);
  tapeStrip(P6_WIN.x + P6_WIN.w - 110, P6_WIN.y + P6_WIN.h - 6, 150, -0.18, 'p6_t4', 40);

  // Inside the frame: our blindfolded hero walking happily past sketched obstacles in real time
  gpencil([[P6_WIN.x + 80, P6_WIN.y + 490], [P6_WIN.x + P6_WIN.w - 80, P6_WIN.y + 490]], { key: 'p6_flr', w: 3.2 });
  const wx = P6_WIN.x + 360 + 180 * Math.sin((TT - 38.2) * 0.45);
  blindHero(wx, P6_WIN.y + 345, 92, {
    key: 'p6_hero', legs: true, cane: true, earphones: true,
    mood: 'happy', step: Math.sin(TT * 6),
    arms: [-0.4, -0.2]
  });

  // Glowing sound wave arcs guiding the hero around a sketched chair
  for (let k = 1; k <= 3; k++) {
    const r = 120 + k * 28 + 6 * ((B + k) % 2);
    gline(arcPts(wx, P6_WIN.y + 345, r, -Math.PI * 0.22, Math.PI * 0.22, 12), { w: 4, col: SK.ink, key: 'p6_wv' + k, second: false });
  }

  // Sketched street tree inside the right side of the window
  const tx = P6_WIN.x + 960, ty = P6_WIN.y + 490;
  gline([[tx - 8, ty], [tx - 5, ty - 140]], { w: 5, key: 'p6_tk1', second: false });
  gline([[tx + 10, ty], [tx + 8, ty - 140]], { w: 5, key: 'p6_tk2', second: false });
  const crown = loopPts(tx + 2, ty - 200, 78, 68, 0.08);
  gfill(crown, SK.paper, { off: [0, 0], key: 'p6_crf' });
  scribbleFill(crown, SK.hilite, { key: 'p6_crs', gap: 12, w: 4, a: 0.75, base: 0.25 });
  gline(crown, { key: 'p6_cro', w: 5 });

  inkStamp('LIVE WALK', P6_WIN.x + 220, P6_WIN.y + 82, 0.46, -0.05, 0.9, 'p6_st');

  skTag('in the real world');
  skCaption(
    ['one person, walking free', 'real world · real time'],
    [[0, 'free']]
  );
}

// =====================================================================
//  ERA 6 (53.5 - 60.0s): OPEN FOR ALL (The Sun Over the Hilltop)
// =====================================================================
const P7_SUN = { x: 1220, y: 270, r: 105 };
function hillPts16x9() {
  return [[120, 820], [380, 730], [680, 645], [920, 610], [1080, 612], [1340, 665], [1620, 750], [1820, 825]];
}
function sceneWhatsNext() {
  const cu = TIMELINE.cues;
  sketchPage({ grid: 'dots' });

  // Drifting cloud + flying birds on 2s
  const cx = 340 + 25 * (TT - 53.5), cy0 = 240;
  gpencil(xform([[cx - 70, 0], ...arcPts(cx - 40, -10, 32, Math.PI, TAU * 0.86, 8), ...arcPts(cx + 10, -28, 40, Math.PI * 1.1, TAU * 0.98, 9), ...arcPts(cx + 60, -8, 28, Math.PI * 1.3, TAU * 1.1, 7), [cx + 90, 4], [cx - 70, 4]], 0, cy0), {
    key: 'p7_cld', w: 3, a: 0.75
  });
  for (let i = 0; i < 3; i++) {
    doodleBird(1580 - 90 * (TT - 53.5) + i * 68, 300 + i * 34 - (i % 2) * 16, 1.3 - i * 0.2, (B + i) % 2, 'p7_bd' + i);
  }

  // Glowing yellow Sun
  const SP0 = ellipsePts(P7_SUN.x, P7_SUN.y, P7_SUN.r, P7_SUN.r, 0, 64);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * TAU + TT * 0.25, r0 = P7_SUN.r * 1.18, r1 = P7_SUN.r * (1.42 + 0.1 * ((B + i) % 2));
    gline([[P7_SUN.x + Math.cos(a) * r0, P7_SUN.y + Math.sin(a) * r0], [P7_SUN.x + Math.cos(a) * r1, P7_SUN.y + Math.sin(a) * r1]], {
      w: 5, key: 'p7_sr' + i, second: false, amp: 0.8
    });
  }
  scribbleFill(SP0, SK.hilite, { key: 'p7_sf', gap: 12, w: 4.5, a: 0.95, base: 0.35 });
  gpencil(SP0, { closed: true, key: 'p7_sc', w: 2.6, a: 0.6 });
  gline(loopPts(P7_SUN.x, P7_SUN.y, P7_SUN.r, P7_SUN.r, 0.06), { key: 'p7_so', w: 6 });

  // Sketched Hill with hatched shady slope, little house with curling chimney smoke, and tree
  const HP = hillPts16x9();
  const ridge = HP.filter(([x]) => x >= 920);
  const band = [...ridge, ...ridge.slice().reverse().map(([x, y]) => [x - 30, y + 110])];
  ctx.save();
  gclip(band);
  ghatch(880, 590, 1820, 880, { ang: -0.9, gap: 9, col: SK.graph, w: 2, a: 0.45, key: 'p7_hh' });
  ctx.restore();
  gline(HP, { key: 'p7_hl', w: 6 });

  // Little house on the left slope with curling smoke
  const hx = 480, hy = 705;
  gfill([[hx - 55, hy], [hx - 55, hy - 80], [hx, hy - 135], [hx + 55, hy - 80], [hx + 55, hy]], SK.paper, { off: [0, 0], key: 'p7_hf' });
  gline([[hx - 55, hy], [hx - 55, hy - 82], [hx + 55, hy - 82], [hx + 55, hy]], { key: 'p7_hw', w: 4.5 });
  gline([[hx - 72, hy - 76], [hx, hy - 138], [hx + 72, hy - 76]], { key: 'p7_hr', w: 4.5 });
  gline([[hx + 34, hy - 108], [hx + 34, hy - 138], [hx + 48, hy - 138], [hx + 48, hy - 98]], { key: 'p7_chm', w: 3.5, second: false });
  const sm = [];
  for (let k = 0; k <= 10; k++) sm.push([hx + 41 + Math.sin(k * 0.9 - TT * 5) * 10, hy - 148 - k * 11]);
  gpencil(sm, { key: 'p7_smk', w: 2.6, a: 0.6 });

  // Blindfolded hero on the hilltop waving happily!
  const hop = Math.sin(Math.PI * ev(54.8, 0.3));
  const wave = 1.05 + 0.45 * ((B % 4) < 2 ? 1 : -1);
  blindHero(880, 480 - 40 * hop, 92, {
    key: 'p7_hero', legs: true, earphones: true,
    mood: 'happy', arms: [-0.6, wave],
    sx: 1 - 0.04 * hop, sy: 1 + 0.06 * hop
  });

  inkStamp('FREE & OPEN', 1460, 560, 0.56, -0.08, ev(54.4, 0.25), 'p7_st');

  skTag('open for all');
  skCaption(
    ['VoxEye — eyes in your ears', 'free on every phone'],
    [[0, 'ears'], [1, 'free']]
  );
}
