// =====================================================================
//  ERAS, CAMERAS, BRIDGES — VoxEye 16:9 Pure Hand-Drawn Sketchbook Story
//  Iteration 3 (v4): Story-driven camera pushes with pre-bridge pull-backs
//  and exact polygon alignment across all 6 transitions.
// =====================================================================
const ERA_BG = ['#f2ead8', '#efe3c4', '#f2ead8', '#efe3c4', '#f2ead8', '#efe3c4', '#f2ead8'];

function pieceCam(era, t) {
  // Every camera push leans in on the scene's focal moment, then pulls cleanly back to CAM0 before tc!
  if (era === 0) return push(t, 1.8, 3.6, { z: 1.14, p: [780, 520], to: [960, 540] }, 5.1, 6.1);
  if (era === 1) return push(t, 7.8, 9.6, { z: 1.13, p: [840, 500], to: [960, 540] }, 11.4, 12.8);
  if (era === 2) return push(t, 15.0, 17.5, { z: 1.14, p: [1040, 500], to: [960, 540] }, 19.6, 21.0);
  if (era === 3) return push(t, 23.6, 26.2, { z: 1.15, p: [1012, 495], to: [960, 540] }, 28.4, 29.8);
  if (era === 4) return push(t, 31.8, 34.4, { z: 1.16, p: [940, 445], to: [960, 540] }, 36.2, 37.4);
  if (era === 5) return push(t, 39.8, 44.0, { z: 1.10, p: [960, 520], to: [960, 540] }, 50.8, 52.6);
  return camMix(camOf({ z: 1.14, p: [885, 472], to: [960, 540] }), CAM0, EZ.io(seg(t, 54.0, 58.2)));
}

const BRIDGES = [
  {
    tc: 6.8,
    A: () => ({ P: sketchBox(805, 472, 205, 92, 10), c: SK.hilite }),
    B: () => ({ P: bulbPts(P2_BULB.x, P2_BULB.y, P2_BULB.r), c: SK.hilite })
  },
  {
    tc: 13.6,
    A: () => ({ P: bulbPts(P2_BULB.x, P2_BULB.y, P2_BULB.r), c: SK.hilite }),
    B: () => ({ P: [[588, 577], [1270, 380], [1270, 565], [588, 603]], c: SK.hilite })
  },
  {
    tc: 21.8,
    A: () => ({ P: sketchBox(1360, 420, 185, 320, 16), c: SK.sheet }),
    B: () => ({ P: sketchBox(230, 220, 570, 160, 22), c: SK.sheet })
  },
  {
    tc: 30.5,
    A: () => ({ P: sketchBox(835, 398, 355, 192, 14), c: SK.sheet }),
    B: () => ({ P: ellipsePts(P5_COMP.x, P5_COMP.y, P5_COMP.r, P5_COMP.r, 0, 64), c: SK.sheet })
  },
  {
    tc: 38.2,
    A: () => ({ P: ellipsePts(P5_COMP.x, P5_COMP.y, P5_COMP.r, P5_COMP.r, 0, 64), c: SK.sheet }),
    B: () => ({ P: sketchBox(P6_WIN.x, P6_WIN.y, P6_WIN.w, P6_WIN.h, 22), c: SK.sheet })
  },
  {
    tc: 53.5,
    A: () => ({ P: sketchBox(P6_WIN.x, P6_WIN.y, P6_WIN.w, P6_WIN.h, 22), c: SK.hilite }),
    B: () => ({ P: ellipsePts(P7_SUN.x, P7_SUN.y, P7_SUN.r, P7_SUN.r, 0, 64), c: SK.hilite })
  }
];
