// On-device object detector (MediaPipe, runs on the phone's GPU when it can) feeding the looming logic in looming.js.
// When something in the walking path is getting rapidly closer it calls onLocalAlert at once: no network, no cloud model.
// The cloud watcher keeps running too; this only adds a much faster path for approaching vehicles, bikes and people.
//
// Needs internet the first time to fetch the detector (a few MB) from jsdelivr and storage.googleapis.com. If that fails the
// app simply carries on without it (status "unavailable").
(function (root) {
  const MP_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18";
  const WASM_URL = MP_CDN + "/wasm";
  const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

  class SpatialSentry {
    constructor({ video, imu, onLocalAlert, tracker }) {
      this.video = video; this.imu = imu; this.onLocalAlert = onLocalAlert;
      this.tracker = tracker || new root.Looming.LoomingTracker();
      this.status = "off"; this.detector = null; this.running = false; this.timer = null;
      this.fps = 8; this.inferMs = 0; this.latest = { objects: [], ms: 0 }; this.frames = 0;
    }

    async init() {
      this.status = "loading";
      try {
        const mp = await import(MP_CDN);
        const vision = await mp.FilesetResolver.forVisionTasks(WASM_URL);
        const make = (delegate) => mp.ObjectDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate }, scoreThreshold: 0.45, maxResults: 6, runningMode: "VIDEO",
        });
        try { this.detector = await make("GPU"); this.status = "ready (GPU)"; }
        catch (_) { this.detector = await make("CPU"); this.status = "ready (CPU)"; }
      } catch (err) {
        this.status = "unavailable: " + String((err && err.message) || err).slice(0, 80);
        this.detector = null;
      }
      return this.status;
    }

    start() { if (this.running || !this.detector) return; this.running = true; this._schedule(); }
    stop() { this.running = false; clearTimeout(this.timer); this.tracker.reset(); }

    _schedule() { if (this.running) this.timer = setTimeout(() => this._tick(), 1000 / this.fps); }

    _tick() {
      if (!this.running) return;
      const v = this.video;
      if (document.hidden || !v.videoWidth || v.readyState < 2) return this._schedule();
      const t0 = performance.now();
      try {
        const result = this.detector.detectForVideo(v, t0);
        const vw = v.videoWidth, vh = v.videoHeight;
        const detections = (result.detections || []).map((d) => {
          const bb = d.boundingBox;
          return { label: d.categories[0].categoryName.toLowerCase(), cx: (bb.originX + bb.width / 2) / vw, cy: (bb.originY + bb.height / 2) / vh,
                   normW: bb.width / vw, normH: bb.height / vh };
        });
        const { objects, hazard } = this.tracker.update(detections, this.imu ? this.imu.snapshot() : null, t0);
        this.latest = { objects: objects.slice(0, 4), ms: Math.round(performance.now() - t0) };
        this.frames++;
        if (hazard && this.onLocalAlert) this.onLocalAlert(hazard);
      } catch (_) { /* a bad frame: skip it */ }
      this.inferMs = this.inferMs * 0.8 + (performance.now() - t0) * 0.2;
      // look faster while something is close or approaching, slower when idle or when inference is slow on this phone
      const near = this.latest.objects.some((o) => o.growth > 0.2 || (o.distM !== null && o.distM < 1.5));
      this.fps = this.inferMs > 90 ? 4 : near ? 15 : 8;
      this._schedule();
    }

    summary() {
      const o = this.latest.objects[0];
      return `${this.status}${this.running ? `, ${this.fps} fps, ${this.latest.ms} ms/frame` : ""}` +
        (o ? ` | ${o.label} ${o.clock}${o.distM != null ? " ~" + o.distM + "m" : ""} growth ${o.growth}/s` : "");
    }
  }
  root.SpatialSentry = SpatialSentry;
})(typeof window !== "undefined" ? window : globalThis);
