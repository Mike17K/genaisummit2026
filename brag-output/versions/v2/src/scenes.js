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
    const epPart = typeof o.earphones === 'number' ? clamp(o.earphones) : 1;
    if (epPart > 0) {
      // Headband arc over top of crown
      gline(arcPts(0, -r * 0.05, r * 1.04, Math.PI * 1.05, Math.PI * 1.95, 18), { w: lw * 0.95, col: SK.ink, key: key + 'ep_hb', part: epPart, second: false });
      for (const s of [-1, 1]) {
        const ep = loopPts(s * r * 1.03, r * 0.02, r * 0.14, r * 0.22, 0.06);
        gfill(ep, SK.hilite, { off: [2, 2], key: key + 'epf' + s, a: epPart });
        gline(ep, { w: lw * 0.95, key: key + 'epo' + s, part: epPart });
      }
    }
  }

  // Optional Embodied Smartphone on Chest Lanyard (Open Track Hardware Bonus)
  if (o.phone) {
    const phPart = typeof o.phone === 'number' ? clamp(o.phone) : 1;
    if (phPart > 0) {
      // Lanyard strap from neck/shoulders down to chest phone
      gpencil([[-r * 0.34, r * 0.35], [-r * 0.12, r * 0.62]], { w: 2.4, col: SK.ink, key: key + 'ph_ln1', part: phPart });
      gpencil([[r * 0.34, r * 0.35], [r * 0.12, r * 0.62]], { w: 2.4, col: SK.ink, key: key + 'ph_ln2', part: phPart });
      const phBox = sketchBox(-r * 0.20, r * 0.58, r * 0.40, r * 0.56, 6);
      gfill(phBox, SK.sheet, { off: [2, 2], key: key + 'ph_bg', a: phPart });
      gline(phBox, { closed: true, w: lw * 0.85, key: key + 'ph_bd', part: phPart });
      // Camera lens ring in center of chest phone
      gline(loopPts(0, r * 0.82, r * 0.09, r * 0.09, 0.1), { w: lw * 0.75, col: SK.red, key: key + 'ph_lns', part: phPart });
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
  gpencil([[200, 745], [680, 740], [1180, 748], [1720, 742]], { key: 'p1_gnd', w: 3.2, a: 0.8 });
  ant(1160 + 55 * TT, 744, 1.4, 'p1_ant');

  // True forward walking kinematics: blindfolded hero walks from x=390 to x=625
  // so the cane sweeps UNDER the overhanging sign while the head approaches the hazard!
  const walkU = EZ.io(seg(TT, 0.15, 3.8));
  const isWalking = TT > 0.15 && TT < 3.8;
  const hx = lerp(390, 625, walkU), hy = 585;
  blindHero(hx, hy, 108, {
    key: 'p1_hero', legs: true, cane: true,
    mood: 'puzzled', step: isWalking ? Math.sin(TT * 5.5) : 0,
    arms: [-0.8, -0.22 + 0.08 * Math.sin(TT * 5.5)]
  });
  // Dashed graphite arc showing the cane tip only feels ground level (y=742), missing head level!
  ctx.save();
  ctx.setLineDash([8, 10]);
  gpencil(arcPts(hx + 180, 738, 65, Math.PI * 1.1, Math.PI * 1.9, 10), { key: 'p1_csweep', w: 2.4, col: SK.red, a: 0.75 });
  ctx.restore();

  handLetter('?', hx - 125, hy - 115 + 6 * Math.sin(B * 0.9), 86, { face: 'marker', col: SK.graph, key: 'p1_q' });
  sweat(hx - 110, hy - 40, (TT * 1.2) % 1, 'p1_sw1');
  sweat(hx - 128, hy - 20, ((TT * 1.2 + 0.5) % 1), 'p1_sw2');

  // Sketched street tree with hatched trunk, leafy canopy, and low overhanging branch at head height!
  const pBranch = ev(cu.p1_cards, 0.65);
  const trk = [[1390, 744], [1375, 420], [1395, 290], [1455, 290], [1465, 744]];
  if (pBranch > 0) {
    gfill(trk, SK.paper, { off: [0, 0], key: 'p1_trkf' });
    ctx.save();
    gclip(trk);
    ghatch(1360, 280, 1480, 750, { ang: -0.7, gap: 9, col: SK.graph, w: 2, a: 0.45, key: 'p1_trkh' });
    ctx.restore();
    gline([[1390, 744], [1375, 420], [1395, 290]], { w: 5.5, key: 'p1_trkL', part: seg(pBranch, 0, 0.5) });
    gline([[1465, 744], [1455, 290]], { w: 5.5, key: 'p1_trkR', part: seg(pBranch, 0, 0.5) });

    // Leafy tree crown at top-right
    const canopy = [
      ...arcPts(1330, 260, 65, Math.PI * 0.6, Math.PI * 1.5, 8),
      ...arcPts(1420, 220, 78, Math.PI * 1.0, Math.PI * 2.0, 9),
      ...arcPts(1510, 265, 62, Math.PI * 1.4, Math.PI * 2.4, 8),
      [1460, 310], [1350, 305]
    ];
    gfill(canopy, SK.paper, { off: [0, 0], key: 'p1_cnpf', a: seg(pBranch, 0.2, 0.7) });
    litHatch(canopy, { ang: -0.6, gap: 9, col: SK.graph, w: 2, a: 0.45 * seg(pBranch, 0.3, 0.8), key: 'p1_cnph' });
    gline(canopy, { closed: true, w: 5, key: 'p1_cnpo', part: seg(pBranch, 0.2, 0.8) });
  }

  // Low gnarled branch reaching left right at the blindfolded hero's forehead height
  const branch = [[1380, 405], [1160, 415], [960, 435], [775, 452]];
  gpencil(branch, { w: 3, key: 'p1_brp', part: seg(pBranch, 0.1, 0.6) });
  gline(branch, { w: 6, key: 'p1_br', part: seg(pBranch, 0.25, 0.85) });
  // Small twigs on the branch
  gline([[1120, 418], [1085, 385]], { w: 3.5, key: 'p1_tw1', part: seg(pBranch, 0.6, 1), second: false });
  gline([[830, 446], [790, 420]], { w: 3.5, key: 'p1_tw2', part: seg(pBranch, 0.7, 1), second: false });

  // Hanging sign dangling from the branch right in front of the hero's face
  const signBox = sketchBox(805, 472, 205, 92, 10);
  const pSign = ev(cu.p1_cards + 0.35, 0.45);
  if (pSign > 0) {
    gfill(signBox, SK.sheet, { off: [4, 4], key: 'p1_sgf', a: pSign });
    scribbleFill(signBox, SK.hilite, { key: 'p1_sgh', part: pSign, gap: 11, w: 4, a: 0.85, base: 0.3 });
    gline([[855, 444], [855, 472]], { w: 3.5, key: 'p1_chn1', second: false, part: pSign });
    gline([[960, 435], [960, 472]], { w: 3.5, key: 'p1_chn2', second: false, part: pSign });
    gline(signBox, { closed: true, w: 4.8, key: 'p1_sgo', part: pSign });
    if (pSign > 0.5) {
      handLetter('!', 908, 540, 68, { face: 'marker', col: SK.red, key: 'p1_haz' });
    }
  }

  // Pencil drawing the branch & sign, then rubber stamp
  if (TT >= cu.p1_cards && TT < cu.p1_stamp) {
    const tip = TT < cu.p1_cards + 0.55
      ? writeEnd(branch, seg(pBranch, 0.1, 0.85))
      : writeEnd(closeP(signBox), pSign);
    pencilTool(tip[0], tip[1], -0.7 + 0.06 * Math.sin(B * 1.5), 0.9);
  }
  if (TT >= cu.p1_stamp) {
    inkStamp('€5,000 / 3s LAG', 1230, 605, 0.52, -0.09, ev(cu.p1_stamp, 0.2), 'p1_stmp');
  }

  skTag('the unseen world');
  skCaption(
    ['a cane feels the ground', 'not what hangs above'],
    [[1, 'above']]
  );
}

// =====================================================================
//  ERA 1 (6.8 - 13.6s): MEET VOXEYE (The Idea Bulb + Phone & Earphones)
// =====================================================================
const P2_BULB = { x: 960, y: 350, r: 102 };
function sceneReveal() {
  const cu = TIMELINE.cues;
  sketchPage({ grid: 'dots' });

  marginPlane('p2_mp', 1560, 250);
  [[240, 360, 0], [310, 540, 1], [1580, 520, 2]].forEach(([x, y, i]) =>
    doodleStar(x, y, 24 + 7 * ((B + i) % 3 === 0), 'p2_st' + i, { w: 3.2 })
  );

  gpencil([[320, 755], [760, 748], [1200, 756], [1600, 750]], { key: 'p2_gnd', w: 3, a: 0.75 });

  // Glowing Idea Bulb above our blindfolded hero (with inner filament like sketchbook demo)
  const P = bulbPts(P2_BULB.x, P2_BULB.y, P2_BULB.r);
  const lit = ev(7.35, 0.3);
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
  // Bulb screw threads + inner filament
  for (let i = 0; i < 3; i++) {
    gline([[P2_BULB.x - 0.38 * P2_BULB.r, P2_BULB.y + (1.2 + i * 0.1) * P2_BULB.r], [P2_BULB.x + 0.38 * P2_BULB.r, P2_BULB.y + (1.17 + i * 0.1) * P2_BULB.r]], {
      w: 4, key: 'p2_sc' + i, second: false, part: ev(7.15 + i * 0.05, 0.15)
    });
  }
  gline([
    [P2_BULB.x - 0.12 * P2_BULB.r, P2_BULB.y + 1.12 * P2_BULB.r],
    [P2_BULB.x - 0.2 * P2_BULB.r, P2_BULB.y + 0.3 * P2_BULB.r],
    [P2_BULB.x, P2_BULB.y + 0.12 * P2_BULB.r],
    [P2_BULB.x + 0.2 * P2_BULB.r, P2_BULB.y + 0.3 * P2_BULB.r],
    [P2_BULB.x + 0.12 * P2_BULB.r, P2_BULB.y + 1.12 * P2_BULB.r]
  ], { w: 3, key: 'p2_fil', second: false, part: ev(7.1, 0.25), col: SK.graph });

  // Blindfolded hero gets stereo earphones (7.4s) AND chest-lanyard smartphone (cu.p2_phone = 8.0s)
  const hop = Math.sin(Math.PI * ev(7.5, 0.3));
  const hx = 620, hy = 605 - 45 * hop;
  const epPart = ev(7.35, 0.4);
  const phPart = ev(cu.p2_phone, 0.5);
  blindHero(hx, hy, 108, {
    key: 'p2_hero', legs: true,
    earphones: epPart, phone: phPart,
    mood: TT >= 7.35 ? 'happy' : 'calm',
    arms: TT >= 7.35 ? [1.15, 1.25] : [-0.6, 0.6],
    sx: 1 - 0.04 * hop, sy: 1 + 0.06 * hop
  });
  if (TT >= 7.35) {
    handLetter('!', hx + 135, hy - 110 - 20 * hop, 96, { face: 'marker', col: SK.red, key: 'p2_bang', reveal: ev(7.35, 0.12) });
  }

  // Hand-drawn callout label for the embodied smartphone + green checkmark at cu.p2_chk (9.2s)
  if (phPart > 0.3) {
    arrowPencil([[1140, 615], [880, 675], [hx + 45, hy + 88]], phPart, { key: 'p2_pharw', w: 3.5 });
    handLetter('your phone camera', 1310, 595, 36, { face: 'hand', col: SK.ink, key: 'p2_phl1', reveal: ev(cu.p2_phone + 0.2, 0.35) });
    handLetter('= 3D depth eyes', 1310, 642, 34, { face: 'marker', col: SK.graph, key: 'p2_phl2', reveal: ev(cu.p2_phone + 0.45, 0.35) });
    checkMark(1535, 610, 0.8, ev(cu.p2_chk, 0.28), SK.green, 'p2_chk');
  }

  // Pencil tool: first draws the bulb (6.9-7.8s), then sketches the chest phone (7.8-8.7s)
  if (TT >= 6.9 && TT < 8.7) {
    const tip = TT < 7.8
      ? writeEnd(closeP(P), ev(6.9, 0.85))
      : [hx + 30 * Math.cos(TT * 8), hy + 85 + 20 * Math.sin(TT * 8)];
    pencilTool(tip[0], tip[1], -0.75 + 0.08 * Math.sin(B * 1.7), 0.95);
  }

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
    key: 'p3_hero', legs: true, cane: true, earphones: true, phone: true,
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

  // Sketched Obstacle (a street bollard / café chair) at x = 1420 — shaded with ghatch per STYLE.md!
  const ox = 1360, oy = 420;
  const obs = sketchBox(ox, oy, 180, 320, 16);
  gfill(obs, SK.sheet, { off: [5, 5], key: 'p3_obf' });
  ctx.save();
  gclip(obs);
  ghatch(ox, oy, ox + 180, oy + 320, { ang: -0.65, gap: 10, col: SK.graph, w: 2, a: 0.45, key: 'p3_obh' });
  ctx.restore();
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
    key: 'p4_hero', legs: true, earphones: true, phone: true,
    mood: 'happy', arms: [-0.5, 0.95]
  });

  // Hand-drawn speech bubble above hero
  const sb = sketchBox(260, 235, 540, 155, 22);
  gfill(sb, SK.sheet, { off: [4, 4], key: 'p4_sbf', a: ev(cu.p4_ask, 0.3) });
  gline(sb, { closed: true, w: 5, key: 'p4_sbo', part: ev(cu.p4_ask, 0.35) });
  handLetter('"Πού είναι το φαρμακείο;"', 530, 305, 38, { face: 'marker', col: SK.ink, key: 'p4_q1', reveal: ev(cu.p4_ask + 0.1, 0.35) });
  handLetter('"Where is the pharmacy?"', 530, 358, 32, { face: 'hand', col: SK.graph, key: 'p4_q2', reveal: ev(cu.p4_ask + 0.3, 0.35) });

  // Pinned Memory Index Card (`noteCard`) in the center + green checkmark (SK.graph stripe so SK.terra stays exclusive to hero)
  const np = ev(cu.p4_router, 0.4);
  if (np > 0) {
    noteCard(1010, 490, -0.05, 1.95, 0, 'p4_nc', SK.graph);
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
const P7_SUN = { x: 1260, y: 265, r: 105 };
function hillPts16x9() {
  return [[120, 820], [380, 725], [680, 640], [900, 608], [1080, 612], [1340, 665], [1620, 750], [1820, 825]];
}
function sceneWhatsNext() {
  const cu = TIMELINE.cues;
  sketchPage({ grid: 'dots' });

  // Drifting cloud + flying birds on 2s (routed across left/center sky, completely clear of P7_SUN!)
  const cx = 280 + 25 * (TT - 53.5), cy0 = 235;
  gpencil(xform([[cx - 70, 0], ...arcPts(cx - 40, -10, 32, Math.PI, TAU * 0.86, 8), ...arcPts(cx + 10, -28, 40, Math.PI * 1.1, TAU * 0.98, 9), ...arcPts(cx + 60, -8, 28, Math.PI * 1.3, TAU * 1.1, 7), [cx + 90, 4], [cx - 70, 4]], 0, cy0), {
    key: 'p7_cld', w: 3, a: 0.75
  });
  for (let i = 0; i < 3; i++) {
    doodleBird(790 - 55 * (TT - 53.5) + i * 64, 215 + i * 28 - (i % 2) * 14, 1.25 - i * 0.18, (B + i) % 2, 'p7_bd' + i);
  }

  // Glowing yellow Sun with sequential ray write-ons
  const SP0 = ellipsePts(P7_SUN.x, P7_SUN.y, P7_SUN.r, P7_SUN.r, 0, 64);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * TAU + TT * 0.25, r0 = P7_SUN.r * 1.18, r1 = P7_SUN.r * (1.42 + 0.1 * ((B + i) % 2));
    gline([[P7_SUN.x + Math.cos(a) * r0, P7_SUN.y + Math.sin(a) * r0], [P7_SUN.x + Math.cos(a) * r1, P7_SUN.y + Math.sin(a) * r1]], {
      w: 5, key: 'p7_sr' + i, part: ev(53.7 + i * 0.025, 0.25), second: false, amp: 0.8
    });
  }
  scribbleFill(SP0, SK.hilite, { key: 'p7_sf', gap: 12, w: 4.5, a: 0.95, base: 0.35 });
  gpencil(SP0, { closed: true, key: 'p7_sc', w: 2.6, a: 0.6 });
  gline(loopPts(P7_SUN.x, P7_SUN.y, P7_SUN.r, P7_SUN.r, 0.06), { key: 'p7_so', w: 6 });

  // Sketched Hill with hatched shady slope
  const HP = hillPts16x9();
  const ridge = HP.filter(([x]) => x >= 900);
  const band = [...ridge, ...ridge.slice().reverse().map(([x, y]) => [x - 30, y + 110])];
  ctx.save();
  gclip(band);
  ghatch(860, 590, 1820, 880, { ang: -0.9, gap: 9, col: SK.graph, w: 2, a: 0.45, key: 'p7_hh' });
  ctx.restore();

  // Little house on the left slope (drawn with closed base seated cleanly on the hill!)
  const hp = ev(53.8, 0.55), hx = 460, hy = 700;
  if (hp > 0) {
    const hPoly = [[hx - 58, hy + 12], [hx - 58, hy - 80], [hx, hy - 138], [hx + 58, hy - 80], [hx + 58, hy - 10]];
    gfill(hPoly, SK.paper, { off: [0, 0], key: 'p7_hf', a: clamp(hp * 2) });
    gline([[hx - 58, hy + 8], [hx - 58, hy - 82], [hx + 58, hy - 82], [hx + 58, hy - 12]], { key: 'p7_hw', w: 4.5, part: seg(hp, 0, 0.6) });
    gline([[hx - 74, hy - 76], [hx, hy - 140], [hx + 74, hy - 76]], { key: 'p7_hr', w: 4.8, part: seg(hp, 0.3, 0.85) });
    gline([[hx - 12, hy], [hx - 12, hy - 44], [hx + 14, hy - 44], [hx + 14, hy - 4]], { key: 'p7_hd', w: 3.5, part: seg(hp, 0.65, 1), second: false });
    if (hp >= 0.85) {
      gline([[hx + 34, hy - 108], [hx + 34, hy - 138], [hx + 48, hy - 138], [hx + 48, hy - 98]], { key: 'p7_chm', w: 3.5, second: false });
      const sm = [];
      for (let k = 0; k <= 10; k++) sm.push([hx + 41 + Math.sin(k * 0.9 - TT * 5) * 10, hy - 148 - k * 11]);
      gpencil(sm, { key: 'p7_smk', w: 2.6, a: 0.6 });
    }
  }
  // Draw hill line over bottom of house walls so the house sits firmly planted on the hill!
  gline(HP, { key: 'p7_hl', w: 6 });

  // Blindfolded hero on the hilltop waving happily with celebratory sound waves!
  const hop = Math.sin(Math.PI * ev(54.8, 0.3));
  const wave = 1.05 + 0.45 * ((B % 4) < 2 ? 1 : -1);
  const hrx = 885, hry = 472 - 40 * hop;
  blindHero(hrx, hry, 92, {
    key: 'p7_hero', legs: true, earphones: true, phone: true,
    mood: 'happy', arms: [-0.6, wave],
    sx: 1 - 0.04 * hop, sy: 1 + 0.06 * hop
  });
  for (let k = 1; k <= 2; k++) {
    const r = 122 + k * 24 + 5 * ((B + k) % 2);
    gline(arcPts(hrx, hry, r, Math.PI * 0.84, Math.PI * 1.16, 10), { w: 3.6, col: SK.ink, key: 'p7_wl' + k, second: false, part: ev(54.2 + k * 0.1, 0.25) });
  }

  inkStamp('FREE & OPEN', 1480, 560, 0.56, -0.08, ev(54.4, 0.25), 'p7_st');

  skTag('open for all');
  skCaption(
    ['VoxEye — eyes in your ears', 'free on every phone'],
    [[0, 'ears'], [1, 'free']]
  );
}
