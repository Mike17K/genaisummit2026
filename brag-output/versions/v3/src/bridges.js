// =====================================================================
//  ERAS, CAMERAS, BRIDGES — VoxEye 16:9 Pure Hand-Drawn Sketchbook Story
// =====================================================================
const ERA_BG = ['#f2ead8', '#efe3c4', '#f2ead8', '#efe3c4', '#f2ead8', '#efe3c4', '#f2ead8'];

function pieceCam(era, t) {
  if (era === 0) return push(t, 4.5, 6.4, { z: 1.04, p: [960, 540], to: [960, 540] });
  if (era === 1) return push(t, 11.2, 13.2, { z: 1.04, p: [960, 480], to: [960, 540] });
  if (era === 2) return push(t, 19.5, 21.4, { z: 1.04, p: [960, 540], to: [960, 540] });
  if (era === 3) return push(t, 28.0, 30.1, { z: 1.04, p: [960, 540], to: [960, 540] });
  if (era === 4) return push(t, 35.8, 37.8, { z: 1.04, p: [960, 480], to: [960, 540] });
  if (era === 5) return CAM0;
  return camMix(camOf({ z: 1.05, p: [960, 480], to: [960, 540] }), CAM0, EZ.io(seg(t, 54.0, 58.5)));
}

const BRIDGES = [
  {
    tc: 6.8,
    A: () => ({ P: sketchBox(830, 470, 210, 95, 10), c: SK.hilite }),
    B: () => ({ P: bulbPts(P2_BULB.x, P2_BULB.y, P2_BULB.r), c: SK.hilite })
  },
  {
    tc: 13.6,
    A: () => ({ P: bulbPts(P2_BULB.x, P2_BULB.y, P2_BULB.r), c: SK.hilite }),
    B: () => ({ P: [[555, 575], [1280, 385], [1280, 575], [555, 605]], c: SK.hilite })
  },
  {
    tc: 21.8,
    A: () => ({ P: sketchBox(1360, 420, 180, 320, 16), c: SK.hilite }),
    B: () => ({ P: sketchBox(260, 235, 540, 155, 22), c: SK.hilite })
  },
  {
    tc: 30.5,
    A: () => ({ P: sketchBox(910, 420, 220, 150, 12), c: SK.hilite }),
    B: () => ({ P: ellipsePts(P5_COMP.x, P5_COMP.y, P5_COMP.r, P5_COMP.r, 0, 64), c: SK.hilite })
  },
  {
    tc: 38.2,
    A: () => ({ P: ellipsePts(P5_COMP.x, P5_COMP.y, P5_COMP.r, P5_COMP.r, 0, 64), c: SK.hilite }),
    B: () => ({ P: sketchBox(P6_WIN.x, P6_WIN.y, P6_WIN.w, P6_WIN.h, 22), c: SK.hilite })
  },
  {
    tc: 53.5,
    A: () => ({ P: sketchBox(P6_WIN.x, P6_WIN.y, P6_WIN.w, P6_WIN.h, 22), c: SK.hilite }),
    B: () => ({ P: ellipsePts(P7_SUN.x, P7_SUN.y, P7_SUN.r, P7_SUN.r, 0, 64), c: SK.hilite })
  }
];
