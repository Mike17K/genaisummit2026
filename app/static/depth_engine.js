// Main-thread controller for on-phone WebGPU Depth-Anything-V2-Small (`depth_worker.js`).
// Runs off-thread at 10-20 FPS (~45-90 ms/frame) while Hold > 1s Depth Mode is active, and calibrates
// disparity -> metric metres via Looming.DepthCalibrator.
(function (root) {
  const CAPTURE_SIZE = 224; // Matches ViT 16*14 patch grid in depth_worker.js

  class DepthEngine {
    constructor({ video, onDepth, onStatus, onPerfChange }) {
      this.video = video;
      this.onDepth = onDepth;
      this.onStatus = onStatus;
      this.onPerfChange = onPerfChange;
      this.calibrator = new root.Looming.DepthCalibrator(4.5);
      this.worker = null;
      this.ready = false;
      this.loading = false;
      this.active = false;
      this.inFlight = false;
      this.hasError = false;
      this.backend = "-";
      this.status = "idle";
      this.benchMs = null;
      this.emaMs = null;
      this.frames = 0;
      this.lastMs = 0;
      this.lastDisp = null;
      this.seq = 0;
      this.dispBySeq = new Map();
      this.rafId = 0;

      this.canvas = document.createElement("canvas");
      this.canvas.width = this.canvas.height = CAPTURE_SIZE;
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }

    _setStatus(s) {
      this.status = s;
      if (this.onStatus) this.onStatus(s);
    }

    init() {
      if (this.worker || this.loading) return;
      this.loading = true;
      this._setStatus("starting worker...");
      try {
        this.worker = new Worker("/static/depth_worker.js?v=11");
      } catch (err) {
        this.loading = false;
        this.hasError = true;
        this._setStatus("worker unsupported: " + String((err && err.message) || err).slice(0, 60));
        if (this.onPerfChange) this.onPerfChange();
        return;
      }

      this.worker.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === "progress") {
          this._setStatus(`downloading Depth-Anything-V2 (${m.pct}%)`);
        } else if (m.type === "status") {
          this._setStatus(m.status);
        } else if (m.type === "ready") {
          this.ready = true;
          this.loading = false;
          this.hasError = false;
          this.backend = m.backend;
          this.benchMs = typeof m.benchMs === "number" ? m.benchMs : null;
          this._setStatus(`ready (${m.backend}, bench ${m.benchMs ?? m.warmMs} ms)`);
          if (this.onPerfChange) this.onPerfChange();
          if (this.active) this._pump();
        } else if (m.type === "depth") {
          this.inFlight = false;
          this.lastMs = m.ms;
          this.frames++;
          this.emaMs = this.emaMs === null ? m.ms : 0.65 * this.emaMs + 0.35 * m.ms;
          this.lastDisp = m.centerDisp;
          this.dispBySeq.set(m.seq, m.centerDisp);
          if (this.dispBySeq.size > 24) {
            const oldest = this.dispBySeq.keys().next().value;
            this.dispBySeq.delete(oldest);
          }
          const distM = this.calibrator.toMeters(m.centerDisp);
          this._setStatus(`${m.backend}, ${m.ms} ms/frame (avg ${Math.round(this.emaMs)} ms)`);
          if (this.onPerfChange) this.onPerfChange();
          if (this.active && distM !== null && this.onDepth) {
            this.onDepth(distM, m.backend, m.ms, m.centerDisp);
          }
          if (this.active) this._scheduleNext();
        } else if (m.type === "skipped") {
          this.inFlight = false;
          if (this.active) this._scheduleNext();
        } else if (m.type === "error") {
          this.inFlight = false;
          this.loading = false;
          this.hasError = true;
          this._setStatus("error: " + String(m.error || "").slice(0, 80));
          if (this.onPerfChange) this.onPerfChange();
        }
      };

      this.worker.onerror = (err) => {
        this.inFlight = false;
        this.loading = false;
        this.hasError = true;
        this._setStatus("worker error: " + String(err.message || err).slice(0, 60));
        if (this.onPerfChange) this.onPerfChange();
      };

      this.worker.postMessage({ type: "init" });
    }

    start() {
      this.active = true;
      if (!this.worker) this.init();
      if (this.ready) this._pump();
    }

    stop() {
      this.active = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    }

    destroy() {
      this.stop();
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      this.ready = false;
      this.loading = false;
      this.inFlight = false;
      this.calibrator.reset();
    }

    anchorMetric(metricMeters, dispOverride = null) {
      const disp = dispOverride != null ? dispOverride : this.lastDisp;
      if (disp != null) {
        return this.calibrator.anchor(disp, metricMeters);
      }
      return false;
    }

    _scheduleNext() {
      if (!this.active) return;
      this.rafId = requestAnimationFrame(() => this._pump());
    }

    _pump() {
      this.rafId = 0;
      if (!this.active || !this.ready || this.inFlight || !this.worker) return;
      const v = this.video;
      if (!v || !v.videoWidth || v.readyState < 2) {
        setTimeout(() => this._scheduleNext(), 40);
        return;
      }
      this.inFlight = true;
      const vw = v.videoWidth, vh = v.videoHeight;
      // Crop square center field-of-view (middle 70% of shorter axis) so 224x224 resolution concentrates on center aim
      const side = Math.round(Math.min(vw, vh) * 0.70);
      const sx = Math.round((vw - side) / 2);
      const sy = Math.round((vh - side) / 2);
      this.ctx.drawImage(v, sx, sy, side, side, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
      const imgData = this.ctx.getImageData(0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
      const seq = ++this.seq;
      const buf = imgData.data.buffer;
      this.worker.postMessage({ type: "frame", seq, width: CAPTURE_SIZE, height: CAPTURE_SIZE, buffer: buf }, [buf]);
    }
  }

  root.DepthEngine = DepthEngine;
})(typeof window !== "undefined" ? window : globalThis);
