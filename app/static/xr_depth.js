// WebXR Depth Sensing (Chrome on ARCore Android phones) as the CONTINUOUS sonar source on phones that support it.
//
// While VoxEye runs, one `immersive-ar` session provides:
// - depth: each frame (~12 Hz) the CPU depth map is sampled inside the horizontal band of the view (floor and
//   ceiling skipped) -> nearest surface in the LEFT / CENTER / RIGHT third (metres), plus a small depth thumbnail
//   for the on-screen depth view
// - camera frames for questions: ARCore owns the camera during the session, so the normal getUserMedia camera
//   is not used; JPEGs come from WebXR "camera-access" (camera texture downscaled on the GPU, then read back)
// Phones without WebXR depth keep the depth-model path (see app.js).
(function (root) {
  const SAMPLE = { cols: 18, rows: 10, y0: 0.18, y1: 0.68, pct: 0.15, minM: 0.1, maxM: 8.0 };
  const FRAME_GAP_MS = 80;      // depth sampling ~12 Hz
  const THUMB = 48;             // depth-view thumbnail size
  const THUMB_GAP_MS = 200;     // ~5 Hz thumbnails
  const THUMB_NEAR_M = 0.3, THUMB_FAR_M = 4.0;

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

  // Pure: metric depth grid -> 0 (far / invalid) .. 255 (near) thumbnail, same convention as the model thumbnails.
  function depthThumb(sample, size = THUMB) {
    const out = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let d;
        try { d = sample((x + 0.5) / size, (y + 0.5) / size); } catch (_) { d = 0; }
        if (!(d > 0) || !Number.isFinite(d)) continue;
        const t = (THUMB_FAR_M - Math.min(THUMB_FAR_M, Math.max(THUMB_NEAR_M, d))) / (THUMB_FAR_M - THUMB_NEAR_M);
        out[y * size + x] = Math.round(t * 255);
      }
    }
    return out;
  }

  const BLIT_VS = "attribute vec2 p; varying vec2 uv; void main() { uv = vec2((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";
  const BLIT_FS = "precision mediump float; varying vec2 uv; uniform sampler2D t; void main() { gl_FragColor = texture2D(t, uv); }";

  class XrDepthSource {
    static async supported() {
      try {
        return !!(root.isSecureContext && navigator.xr && (await navigator.xr.isSessionSupported("immersive-ar")));
      } catch (_) {
        return false;
      }
    }

    constructor({ onSectors, onThumb, onStatus, overlayRoot }) {
      this.onSectors = onSectors;
      this.onThumb = onThumb || (() => {});
      this.onStatus = onStatus || (() => {});
      this.overlayRoot = overlayRoot;
      this.session = null;
      this.refSpace = null;
      this.gl = null;
      this.binding = null;
      this.hasCamera = false;
      this.lastAt = 0;
      this.lastThumbAt = 0;
      this.frames = 0;
      this.onEnded = null;
      this.pendingCapture = null;   // { width, quality, resolve, reject, at }
      this.blit = null;
    }

    async start() {
      if (this.session) return;
      const session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["depth-sensing"],
        optionalFeatures: ["dom-overlay", "camera-access"],
        depthSensing: { usagePreference: ["cpu-optimized"], dataFormatPreference: ["luminance-alpha", "float32"] },
        domOverlay: this.overlayRoot ? { root: this.overlayRoot } : undefined,
      });
      if (session.depthUsage && session.depthUsage !== "cpu-optimized") {
        await session.end().catch(() => {});
        throw new Error(`depth usage ${session.depthUsage} (need cpu-optimized)`);
      }
      this.session = session;
      const canvas = document.createElement("canvas");
      this.gl = canvas.getContext("webgl", { xrCompatible: true, alpha: true, preserveDrawingBuffer: false });
      if (this.gl && this.gl.makeXRCompatible) await this.gl.makeXRCompatible();
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, this.gl) });
      this.refSpace = await session.requestReferenceSpace("local").catch(() => session.requestReferenceSpace("viewer"));
      try {
        if (typeof XRWebGLBinding === "function") this.binding = new XRWebGLBinding(session, this.gl);
      } catch (_) {
        this.binding = null;
      }
      session.addEventListener("end", () => {
        this.session = null;
        if (this.pendingCapture) { this.pendingCapture.reject(new Error("xr session ended")); this.pendingCapture = null; }
        this.onStatus("ended");
        if (this.onEnded) this.onEnded();
      });
      this.onStatus(`running (${session.depthDataFormat || "depth"})`);
      session.requestAnimationFrame((t, f) => this._frame(t, f));
    }

    async stop() {
      const s = this.session;
      if (s) await s.end().catch(() => {});
    }

    // Camera JPEG (base64, no data: prefix) from the AR camera, resolved on the next XR frame.
    captureJpeg(width = 512, quality = 0.58) {
      if (!this.session) return Promise.reject(new Error("no xr session"));
      if (this.pendingCapture) return this.pendingCapture.promise;
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      this.pendingCapture = { width, quality, resolve, reject, promise, at: performance.now() };
      setTimeout(() => {
        if (this.pendingCapture && this.pendingCapture.promise === promise) {
          this.pendingCapture = null;
          reject(new Error("camera frame timeout (camera-access unavailable?)"));
        }
      }, 1500);
      return promise;
    }

    _initBlit() {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, BLIT_VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, BLIT_FS));
      gl.linkProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      this.blit = { prog, buf, loc: gl.getAttribLocation(prog, "p"), uTex: gl.getUniformLocation(prog, "t"), tex: null, fb: null, w: 0, h: 0 };
    }

    // Downscale the AR camera texture on the GPU into a small framebuffer and read it back (inside the XR frame).
    _captureFrom(view) {
      const req = this.pendingCapture;
      this.pendingCapture = null;
      try {
        if (!this.binding || !view.camera) throw new Error("camera-access not granted");
        const camTex = this.binding.getCameraImage(view.camera);
        if (!camTex) throw new Error("no camera image");
        const gl = this.gl;
        if (!this.blit) this._initBlit();
        const b = this.blit;
        const W = req.width, H = Math.max(1, Math.round((req.width * view.camera.height) / view.camera.width));
        if (b.w !== W || b.h !== H) {
          if (b.tex) gl.deleteTexture(b.tex);
          if (b.fb) gl.deleteFramebuffer(b.fb);
          b.tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, b.tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          b.fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.tex, 0);
          b.w = W; b.h = H;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
        gl.viewport(0, 0, W, H);
        gl.useProgram(b.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, camTex);
        gl.uniform1i(b.uTex, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
        gl.enableVertexAttribArray(b.loc);
        gl.vertexAttribPointer(b.loc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // readPixels rows start at the bottom: flip while copying into a 2D canvas, then encode JPEG off the XR frame
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        const c2 = c.getContext("2d");
        const img = c2.createImageData(W, H);
        const row = W * 4;
        for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
        c2.putImageData(img, 0, 0);
        setTimeout(() => req.resolve(c.toDataURL("image/jpeg", req.quality).split(",")[1]), 0);
        this.hasCamera = true;
      } catch (err) {
        req.reject(err);
      }
    }

    _frame(t, frame) {
      const session = this.session;
      if (!session) return;
      session.requestAnimationFrame((tt, ff) => this._frame(tt, ff));
      const layer = session.renderState.baseLayer;
      const gl = this.gl;
      const pose = frame.getViewerPose(this.refSpace);
      const view = pose && pose.views.length ? pose.views[0] : null;
      if (view && this.pendingCapture) this._captureFrom(view);
      if (layer && gl) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        const vp = layer.getViewport(view || { eye: "none" });
        if (vp) gl.viewport(vp.x, vp.y, vp.width, vp.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (!view || t - this.lastAt < FRAME_GAP_MS) return;
      let depth = null;
      try { depth = frame.getDepthInformation(view); } catch (_) { return; }
      if (!depth) return;
      this.lastAt = t;
      this.frames++;
      const sample = (x, y) => depth.getDepthInMeters(x, y);
      if (this.onSectors) this.onSectors(sampleSectors(sample), { w: depth.width, h: depth.height, frames: this.frames });
      if (t - this.lastThumbAt >= THUMB_GAP_MS) {
        this.lastThumbAt = t;
        this.onThumb(depthThumb(sample), THUMB, THUMB);
      }
    }
  }

  const api = { XrDepthSource, sampleSectors, depthThumb };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, { XrDepth: api, XrDepthSource });
})(typeof window !== "undefined" ? window : globalThis);
