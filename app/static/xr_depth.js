// WebXR Depth Sensing (Chrome on ARCore Android phones) as the hold-to-scan depth source.
//
// Runs an `immersive-ar` session ONLY while the user holds the scan: ARCore takes exclusive use of the camera,
// so the app's normal camera stream pauses during the session and is restored afterwards (see app.js).
// Each frame (~12 Hz) samples the CPU depth map on a grid inside a horizontal band of the view (floor and
// ceiling skipped) and reports the nearest surface in the LEFT / CENTER / RIGHT third, in metres.
(function (root) {
  const SAMPLE = { cols: 18, rows: 10, y0: 0.18, y1: 0.68, pct: 0.15, minM: 0.1, maxM: 8.0 };
  const FRAME_GAP_MS = 80;

  // Pure: sample(x, y) -> metres (0 / NaN = invalid) over normalized view coords (0,0 top-left .. 1,1 bottom-right).
  function sampleSectors(sample, opts = {}) {
    const o = Object.assign({}, SAMPLE, opts);
    const bins = { left: [], center: [], right: [] };
    for (let c = 0; c < o.cols; c++) {
      const x = (c + 0.5) / o.cols;
      const key = x < 1 / 3 ? "left" : x < 2 / 3 ? "center" : "right";
      for (let r = 0; r < o.rows; r++) {
        const y = o.y0 + ((r + 0.5) / o.rows) * (o.y1 - o.y0);
        let d;
        try { d = sample(x, y); } catch (_) { continue; }
        if (typeof d === "number" && Number.isFinite(d) && d >= o.minM && d <= o.maxM) bins[key].push(d);
      }
    }
    const out = {};
    for (const k of Object.keys(bins)) {
      const v = bins[k].sort((a, b) => a - b);
      // need enough valid pixels, then a low percentile = "nearest surface" without single-pixel noise
      out[k] = v.length >= 4 ? Number(v[Math.min(v.length - 1, Math.floor(v.length * o.pct))].toFixed(2)) : null;
    }
    return out;
  }

  class XrDepthSource {
    static async supported() {
      try {
        return !!(root.isSecureContext && navigator.xr && (await navigator.xr.isSessionSupported("immersive-ar")));
      } catch (_) {
        return false;
      }
    }

    constructor({ onSectors, onStatus, overlayRoot }) {
      this.onSectors = onSectors;
      this.onStatus = onStatus || (() => {});
      this.overlayRoot = overlayRoot;
      this.session = null;
      this.refSpace = null;
      this.gl = null;
      this.lastAt = 0;
      this.frames = 0;
      this.active = false;
      this.onEnded = null;
    }

    async start() {
      if (this.session) return;
      const session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["depth-sensing"],
        optionalFeatures: ["dom-overlay"],
        depthSensing: { usagePreference: ["cpu-optimized"], dataFormatPreference: ["luminance-alpha", "float32"] },
        domOverlay: this.overlayRoot ? { root: this.overlayRoot } : undefined,
      });
      if (session.depthUsage && session.depthUsage !== "cpu-optimized") {
        await session.end().catch(() => {});
        throw new Error(`depth usage ${session.depthUsage} (need cpu-optimized)`);
      }
      this.session = session;
      this.active = true;
      this.frames = 0;
      const canvas = document.createElement("canvas");
      this.gl = canvas.getContext("webgl", { xrCompatible: true, alpha: true });
      if (this.gl && this.gl.makeXRCompatible) await this.gl.makeXRCompatible();
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, this.gl) });
      this.refSpace = await session.requestReferenceSpace("local").catch(() => session.requestReferenceSpace("viewer"));
      session.addEventListener("end", () => {
        this.session = null;
        this.active = false;
        this.onStatus("ended");
        if (this.onEnded) this.onEnded();
      });
      this.onStatus(`running (${session.depthDataFormat || "depth"})`);
      session.requestAnimationFrame((t, f) => this._frame(t, f));
    }

    async stop() {
      this.active = false;
      const s = this.session;
      if (s) await s.end().catch(() => {});
    }

    _frame(t, frame) {
      const session = this.session;
      if (!session) return;
      session.requestAnimationFrame((tt, ff) => this._frame(tt, ff));
      const layer = session.renderState.baseLayer;
      if (layer && this.gl) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, layer.framebuffer);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      }
      if (!this.active || t - this.lastAt < FRAME_GAP_MS) return;
      const pose = frame.getViewerPose(this.refSpace);
      if (!pose || !pose.views.length) return;
      let depth = null;
      try { depth = frame.getDepthInformation(pose.views[0]); } catch (_) { return; }
      if (!depth) return;
      this.lastAt = t;
      this.frames++;
      const sectors = sampleSectors((x, y) => depth.getDepthInMeters(x, y));
      if (this.onSectors) this.onSectors(sectors, { w: depth.width, h: depth.height, frames: this.frames });
    }
  }

  const api = { XrDepthSource, sampleSectors };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, { XrDepth: api, XrDepthSource });
})(typeof window !== "undefined" ? window : globalThis);
