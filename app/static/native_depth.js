// Native ARCore Depth API source, available only inside the VoxEye Android app (window.VoxNative bridge).
//
// Same interface as XrDepthSource (xr_depth.js), so app.js treats it the same way:
// - depth: the app runs an ARCore session (Depth API, AUTOMATIC) and pushes the nearest surface in the
//   LEFT / CENTER / RIGHT third (metres, ~12 Hz) plus a 48x48 thumbnail (~5 Hz)
// - camera frames for questions: ARCore owns the camera, so JPEGs come from the app (ARCore CPU image)
// Anywhere else (browser, or a phone without ARCore depth) supported() is false and the WebXR / depth-model
// paths are used.
(function (root) {
  // No depth for this long (ARCore not tracking: too dark, blank wall, no motion yet) -> release ARCore and let
  // app.js fall back to the camera + depth model, so the sonar never stays silent.
  const STALE_MS = 6000;
  function bridge() { return root.VoxNative && typeof root.VoxNative.arStart === "function" ? root.VoxNative : null; }

  function b64ToBytes(b64) {
    const s = atob(b64), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  class NativeDepthSource {
    // "ok" when the app can run ARCore depth, otherwise the reason (null outside the app).
    static availability() {
      const b = bridge();
      if (!b) return null;
      try { return String(b.arAvailable()); } catch (e) { return "bridge error: " + e; }
    }
    static supported() { return NativeDepthSource.availability() === "ok"; }

    constructor({ onSectors, onThumb, onStatus }) {
      this.onSectors = onSectors;
      this.onThumb = onThumb || (() => {});
      this.onStatus = onStatus || (() => {});
      this.onEnded = null;
      this.label = "ARCore depth (native)";
      this.hasCamera = true;
      this.frames = 0;
      this.running = false;
      this.lastDepthAt = 0;
      this.watchdog = null;
    }

    async start() {
      const b = bridge();
      if (!b) throw new Error("not in the VoxEye app");
      root.__voxNative = {
        onDepth: (m) => {
          if (!this.running) return;
          this.frames = m.n || this.frames + 1;
          this.lastDepthAt = performance.now();
          if (this.onSectors) this.onSectors({ left: m.l, center: m.c, right: m.r }, { w: m.w, h: m.h, frames: this.frames });
          if (m.t) this.onThumb(b64ToBytes(m.t), 48, 48);
        },
        onEnded: (why) => this._end(why),
      };
      const res = String(b.arStart());
      if (res !== "ok") throw new Error(res);
      this.running = true;
      this.lastDepthAt = performance.now(); // grace period while ARCore starts tracking
      this.onStatus("running");
      this.watchdog = setInterval(() => {
        if (this.running && performance.now() - this.lastDepthAt > STALE_MS) {
          const why = "no depth for " + STALE_MS / 1000 + " s (" + this.status() + ")";
          this.stop();
          this._end(why);
        }
      }, 1000);
    }

    _end(why) {
      if (this.endedWhy) return;
      this.endedWhy = String(why);
      this.running = false;
      if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
      this.onStatus("ended: " + why);
      if (this.onEnded) this.onEnded(this.endedWhy);
    }

    async stop() {
      this.running = false;
      if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
      const b = bridge();
      if (b) try { b.arStop(); } catch (_) {}
    }

    status() {
      const b = bridge();
      try { return b ? String(b.arStatus()) : "-"; } catch (_) { return "-"; }
    }

    // Camera JPEG (base64, no data: prefix) from the ARCore camera image, portrait.
    captureJpeg(width = 512, quality = 0.58) {
      const b = bridge();
      if (!b || !this.running) return Promise.reject(new Error("native AR not running"));
      return new Promise((resolve, reject) => {
        // the bridge call blocks until the AR thread encodes the frame: run it off the current task
        setTimeout(() => {
          let d = "";
          try { d = String(b.captureJpeg(Math.round(width), Math.round(quality * 100))); } catch (e) { reject(e); return; }
          if (d) resolve(d); else reject(new Error("no AR camera frame"));
        }, 0);
      });
    }
  }

  const api = { NativeDepthSource };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== "undefined" ? window : globalThis);
