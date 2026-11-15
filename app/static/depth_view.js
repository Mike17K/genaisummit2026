// On-screen depth view behind the main button: the depth image the sonar inspects (heat-map, near = bright/warm),
// the two lines that split it into LEFT EAR / BOTH / RIGHT EAR, the inspected horizontal band (floor and ceiling
// dimmed because the sonar ignores them), each part's distance, and a highlight on the parts beeping right now.
// `colormap`, `fitRect`, `sectorGeometry` are pure (testable in Node); `DepthView` draws on a canvas.
(function (root) {
  const BAND = { y0: 0.18, y1: 0.68 };   // must match the sector band in depth_worker.js / local_depth.py
  const STALE_MS = 2000;
  const LABELS = { left: "LEFT EAR", center: "BOTH EARS", right: "RIGHT EAR" };

  // 0 (far) .. 255 (near) -> [r, g, b]: dark blue/purple far, orange, bright yellow-white near (inferno-like)
  const STOPS = [[0, [8, 6, 30]], [70, [60, 18, 110]], [130, [170, 45, 90]], [190, [240, 120, 30]], [255, [252, 240, 170]]];
  function colormap(v) {
    const x = Math.max(0, Math.min(255, v));
    for (let i = 1; i < STOPS.length; i++) {
      const [x1, c1] = STOPS[i];
      if (x <= x1) {
        const [x0, c0] = STOPS[i - 1];
        const t = (x - x0) / (x1 - x0 || 1);
        return c0.map((c, k) => Math.round(c + (c1[k] - c) * t));
      }
    }
    return STOPS[STOPS.length - 1][1].slice();
  }
  const LUT = Array.from({ length: 256 }, (_, i) => colormap(i));

  // Where the depth image lands inside a W x H area: the WHOLE image, centered ("contain"), so the inspected
  // band and all three ear parts are always visible
  function fitRect(W, H, imgW = 1, imgH = 1) {
    const s = Math.min(W / imgW, H / imgH);
    const w = imgW * s, h = imgH * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  // Sector boxes in canvas pixels for an image rect: thirds horizontally, inside the inspected band
  function sectorGeometry(r) {
    const top = r.y + r.h * BAND.y0, bottom = r.y + r.h * BAND.y1;
    return {
      band: { top, bottom },
      dividers: [r.x + r.w / 3, r.x + (2 * r.w) / 3],
      sectors: ["left", "center", "right"].map((k, i) => ({
        key: k, x: r.x + (i * r.w) / 3, y: top, w: r.w / 3, h: bottom - top,
      })),
    };
  }

  class DepthView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext("2d") : null;
      this.img = null;        // { data: Uint8Array, w, h, at, src }
      this.tile = null;       // small canvas holding the colored depth image
      this.dpr = 1;
    }

    setImage(data, w, h, src = "") {
      if (!data || !w || !h) return;
      if (!this.tile) this.tile = document.createElement("canvas");
      if (this.tile.width !== w || this.tile.height !== h) { this.tile.width = w; this.tile.height = h; }
      const tctx = this.tile.getContext("2d");
      const im = tctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const c = LUT[data[i]];
        im.data[i * 4] = c[0]; im.data[i * 4 + 1] = c[1]; im.data[i * 4 + 2] = c[2]; im.data[i * 4 + 3] = 255;
      }
      tctx.putImageData(im, 0, 0);
      this.img = { w, h, at: performance.now(), src };
    }

    clear() {
      this.img = null;
      this.draw(null, []);
    }

    _fit() {
      const c = this.canvas;
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      this.dpr = dpr;
      return { W, H };
    }

    // sectors: {left, center, right} metres or null; beeping: array of sector keys sounding now
    draw(sectors, beeping = [], { running = true } = {}) {
      if (!this.ctx) return;
      const { W, H } = this._fit();
      const g = this.ctx, d = this.dpr;
      g.clearRect(0, 0, W, H);
      if (!running) return;
      const r = fitRect(W, H, 1, 1);
      const stale = !this.img || performance.now() - this.img.at > STALE_MS;
      if (this.img && this.tile) {
        g.save();
        g.globalAlpha = stale ? 0.25 : 0.9;
        g.imageSmoothingEnabled = true;
        g.drawImage(this.tile, r.x, r.y, r.w, r.h);
        g.restore();
      }
      const geo = sectorGeometry(r);
      // frame of the inspected image; dim the parts of it the sonar ignores (above / below the band)
      g.strokeStyle = "rgba(255,255,255,0.25)";
      g.lineWidth = 1 * d;
      g.strokeRect(r.x, r.y, r.w, r.h);
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(r.x, r.y, r.w, Math.max(0, geo.band.top - r.y));
      g.fillRect(r.x, geo.band.bottom, r.w, Math.max(0, r.y + r.h - geo.band.bottom));
      // highlight sectors that are beeping
      for (const s of geo.sectors) {
        if (!beeping.includes(s.key)) continue;
        g.fillStyle = "rgba(255,255,255,0.14)";
        g.fillRect(s.x, s.y, s.w, s.h);
        g.strokeStyle = "rgba(255,230,120,0.95)";
        g.lineWidth = 3 * d;
        g.strokeRect(s.x + 1.5 * d, s.y + 1.5 * d, s.w - 3 * d, s.h - 3 * d);
      }
      // band edges
      g.strokeStyle = "rgba(255,255,255,0.45)";
      g.lineWidth = 1 * d;
      g.setLineDash([]);
      for (const y of [geo.band.top, geo.band.bottom]) { g.beginPath(); g.moveTo(r.x, y); g.lineTo(r.x + r.w, y); g.stroke(); }
      // ear dividing lines
      g.strokeStyle = "rgba(255,255,255,0.85)";
      g.lineWidth = 2 * d;
      g.setLineDash([8 * d, 6 * d]);
      for (const x of geo.dividers) { g.beginPath(); g.moveTo(x, r.y); g.lineTo(x, r.y + r.h); g.stroke(); }
      g.setLineDash([]);
      // labels + distances
      g.font = `${Math.round((r.w < 330 * d ? 9 : 11) * d)}px ui-monospace, monospace`;
      g.textAlign = "center";
      g.textBaseline = "top";
      for (const s of geo.sectors) {
        const v = sectors ? sectors[s.key] : null;
        const text = `${LABELS[s.key]} · ${typeof v === "number" ? v.toFixed(2) + " m" : "–"}`;
        const cx = Math.min(W - 4 * d, Math.max(4 * d, s.x + s.w / 2));
        const ty = Math.max(4 * d, s.y + 4 * d);
        g.fillStyle = "rgba(0,0,0,0.55)";
        const tw = g.measureText(text).width + 10 * d;
        g.fillRect(cx - tw / 2, ty - 2 * d, tw, 16 * d);
        g.fillStyle = beeping.includes(s.key) ? "#ffe680" : "#ffffff";
        g.fillText(text, cx, ty);
      }
      if (stale) {
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.textBaseline = "bottom";
        g.fillText(this.img ? "depth paused" : "waiting for depth...", W / 2, H - 6 * d);
      }
    }
  }

  const api = { DepthView, colormap, fitRect, sectorGeometry, BAND };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, { DepthViewLib: api, DepthView });
})(typeof window !== "undefined" ? window : globalThis);
