// Main-thread controller for on-phone WebGPU Depth-Anything-V2-Small (`depth_worker.js`).
//
// Runs while the user holds the depth-sonar scan. One self-scheduling loop with exactly ONE pending step at a time
// (in-flight frame, timer or animation frame); `setIntervalMs(ms)` throttles it (0 = full speed).
// `start()` / `setIntervalMs()` are idempotent, so callers may sync state as often as they like without
// ever doubling the loop. A watchdog recovers a frame the worker never answered, and transient frame errors
// back off instead of killing the loop. Disparity -> metres via Looming.DepthCalibrator.
(function (root) {
  const CAPTURE_SIZE = 224;       // Matches the ViT 16*14 patch grid in depth_worker.js
  const STALL_MS = 1500;          // a frame unanswered this long is considered lost
  const ERROR_BACKOFF_MS = 300;
  const MAX_FRAME_ERRORS = 3;     // consecutive frame errors before reporting the engine as failed

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
      this.hasError = false;
      this.backend = "-";
      this.status = "idle";
      this.benchMs = null;
      this.emaMs = null;
      this.frames = 0;
      this.lastMs = 0;
      this.lastDisp = null;
      this.lastDepthAt = 0;
      this.seq = 0;
      this.intervalMs = 0;
      this.frameErrors = 0;

      this.inFlight = false;
      this.inFlightAt = 0;
      this.lastPostAt = 0;
      this.timerId = 0;
      this.rafId = 0;
      this.watchdogId = 0;

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
        this.worker = new Worker("/static/depth_worker.js?v=13");
      } catch (err) {
        this.loading = false;
        this.hasError = true;
        this._setStatus("worker unsupported: " + String((err && err.message) || err).slice(0, 60));
        if (this.onPerfChange) this.onPerfChange();
        return;
      }
      this.worker.onmessage = (e) => this._onMessage(e.data || {});
      this.worker.onerror = (err) => {
        this._frameDone();
        this.loading = false;
        this.hasError = true;
        this._setStatus("worker error: " + String(err.message || err).slice(0, 60));
        if (this.onPerfChange) this.onPerfChange();
      };
      this.worker.postMessage({ type: "init" });
    }

    _onMessage(m) {
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
        this._schedule();
      } else if (m.type === "depth") {
        if (m.seq !== this.seq) return; // a stale answer for a frame the watchdog already gave up on
        this._frameDone();
        this.frameErrors = 0;
        this.hasError = false; // recovered from transient frame errors
        this.lastMs = m.ms;
        this.frames++;
        this.emaMs = this.emaMs === null ? m.ms : 0.65 * this.emaMs + 0.35 * m.ms;
        this.lastDisp = m.centerDisp;
        this.lastDepthAt = performance.now();
        // Schedule the next frame BEFORE callbacks, so nothing they do can start a second loop
        this._schedule();
        this._setStatus(`${m.backend}, ${m.ms} ms/frame (avg ${Math.round(this.emaMs)} ms)`);
        if (this.onPerfChange) this.onPerfChange();
        const distM = this.calibrator.toMeters(m.centerDisp);
        const sectors = Array.isArray(m.sectorDisp)
          ? {
              left: m.sectorDisp[0] != null ? this.calibrator.toMeters(m.sectorDisp[0]) : null,
              center: m.sectorDisp[1] != null ? this.calibrator.toMeters(m.sectorDisp[1]) : null,
              right: m.sectorDisp[2] != null ? this.calibrator.toMeters(m.sectorDisp[2]) : null,
            }
          : null;
        if (this.active && distM !== null && this.onDepth) this.onDepth(distM, m.backend, m.ms, m.centerDisp, sectors);
      } else if (m.type === "skipped") {
        if (m.seq !== this.seq) return;
        this._frameDone();
        this._schedule();
      } else if (m.type === "frame_error") {
        if (m.seq !== this.seq) return;
        this._frameDone();
        this.frameErrors++;
        this._setStatus("frame error: " + String(m.error || "").slice(0, 60));
        if (this.frameErrors >= MAX_FRAME_ERRORS) {
          this.hasError = true;
          if (this.onPerfChange) this.onPerfChange();
        }
        this._schedule(ERROR_BACKOFF_MS);
      } else if (m.type === "error") {
        // init failure
        this._frameDone();
        this.loading = false;
        this.hasError = true;
        this._setStatus("error: " + String(m.error || "").slice(0, 80));
        if (this.onPerfChange) this.onPerfChange();
      }
    }

    // Idempotent: safe to call on every state sync.
    start() {
      this.active = true;
      if (!this.worker) this.init();
      this._schedule();
    }

    stop() {
      this.active = false;
      this._clearPending();
    }

    // Idempotent; shortening the interval (guard -> hold scan) reschedules a waiting timer immediately.
    setIntervalMs(ms) {
      const next = Math.max(0, +ms || 0);
      if (next === this.intervalMs) return;
      const shorter = next < this.intervalMs;
      this.intervalMs = next;
      if (shorter && this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = 0;
        this._schedule();
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
      this._frameDone();
      this.calibrator.reset();
    }

    anchorMetric(metricMeters, dispOverride = null) {
      const disp = dispOverride != null ? dispOverride : this.lastDisp;
      return disp != null ? this.calibrator.anchor(disp, metricMeters) : false;
    }

    _clearPending() {
      if (this.timerId) { clearTimeout(this.timerId); this.timerId = 0; }
      if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    }

    _frameDone() {
      this.inFlight = false;
      if (this.watchdogId) { clearTimeout(this.watchdogId); this.watchdogId = 0; }
    }

    // Arrange the next capture, unless one is already pending or in flight.
    _schedule(minDelayMs = 0) {
      if (!this.active || !this.ready || !this.worker) return;
      if (this.inFlight || this.timerId || this.rafId) return;
      const sinceLast = performance.now() - this.lastPostAt;
      const wait = Math.max(minDelayMs, this.intervalMs - sinceLast);
      if (wait > 4) {
        this.timerId = setTimeout(() => {
          this.timerId = 0;
          this._requestFrame();
        }, wait);
      } else {
        this._requestFrame();
      }
    }

    _requestFrame() {
      if (!this.active || this.rafId) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        this._capture();
      });
    }

    _capture() {
      if (!this.active || !this.ready || this.inFlight || !this.worker) return;
      const v = this.video;
      if (!v || !v.videoWidth || v.readyState < 2) {
        this._schedule(60);
        return;
      }
      const vw = v.videoWidth, vh = v.videoHeight;
      // Square center field-of-view (middle 70% of shorter axis) so the 224x224 input concentrates on the aim point
      const side = Math.round(Math.min(vw, vh) * 0.70);
      const sx = Math.round((vw - side) / 2);
      const sy = Math.round((vh - side) / 2);
      let buf;
      try {
        this.ctx.drawImage(v, sx, sy, side, side, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);
        buf = this.ctx.getImageData(0, 0, CAPTURE_SIZE, CAPTURE_SIZE).data.buffer;
      } catch (_) {
        this._schedule(ERROR_BACKOFF_MS);
        return;
      }
      const seq = ++this.seq;
      this.inFlight = true;
      this.lastPostAt = this.inFlightAt = performance.now();
      this.watchdogId = setTimeout(() => {
        // The worker never answered this frame (GPU hiccup, lost message): drop it and keep going
        this.watchdogId = 0;
        if (this.inFlight && this.seq === seq) {
          this.inFlight = false;
          this._setStatus(`frame ${seq} timed out, retrying`);
          this._schedule();
        }
      }, STALL_MS);
      this.worker.postMessage({ type: "frame", seq, width: CAPTURE_SIZE, height: CAPTURE_SIZE, buffer: buf }, [buf]);
    }
  }

  root.DepthEngine = DepthEngine;
})(typeof window !== "undefined" ? window : globalThis);
