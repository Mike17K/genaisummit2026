// Web Worker running Depth-Anything-V2-Small on the phone's GPU via WebGPU (with WASM fallback).
// Uses a 224x224 (16x14 ViT patch grid) input and pre-compiles GPU shaders on load so Hold-to-Scan responds in ~40-90 ms.
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1";
const MODEL_ID = "onnx-community/depth-anything-v2-small";
const INPUT_SIZE = 224; // 16 * 14 patch grid -> ~10x faster ViT attention than 518x518

let RawImageCls = null;
let model = null;
let processor = null;
let backendLabel = "-";
let busy = false;

function extractCenterStats(data, width, height) {
  const x0 = Math.max(0, Math.floor(width * 0.40));
  const x1 = Math.min(width, Math.ceil(width * 0.60));
  const y0 = Math.max(0, Math.floor(height * 0.40));
  const y1 = Math.min(height, Math.ceil(height * 0.60));
  const center = [];
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      const v = Number(data[row + x]);
      if (Number.isFinite(v) && v > 0) center.push(v);
    }
  }
  if (!center.length) return null;
  center.sort((a, b) => a - b);
  const centerDisp = center[Math.min(center.length - 1, Math.floor(center.length * 0.75))];

  const sample = [];
  const step = Math.max(1, Math.floor(data.length / 512));
  for (let i = 0; i < data.length; i += step) {
    const v = Number(data[i]);
    if (Number.isFinite(v) && v > 0) sample.push(v);
  }
  sample.sort((a, b) => a - b);
  const p10 = sample.length ? sample[Math.floor(sample.length * 0.10)] : centerDisp;
  const p90 = sample.length ? sample[Math.floor(sample.length * 0.90)] : centerDisp;
  return { centerDisp, p10, p90 };
}

async function detectGpu() {
  if (typeof navigator === "undefined" || !navigator.gpu) return { webgpu: false, fp16: false };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { webgpu: false, fp16: false };
    const fp16 = !!(adapter.features && adapter.features.has("shader-f16"));
    return { webgpu: true, fp16 };
  } catch (_) {
    return { webgpu: false, fp16: false };
  }
}

async function initModel(allowWasm = false) {
  const gpu = await detectGpu();
  if (!gpu.webgpu && !allowWasm) {
    throw new Error("WebGPU unavailable on mobile browser/HTTP; using laptop ONNX");
  }

  self.postMessage({ type: "status", status: "loading transformers.js..." });
  const tf = await import(TRANSFORMERS_CDN);
  tf.env.allowLocalModels = false;
  RawImageCls = tf.RawImage;

  const candidates = [];
  if (gpu.webgpu) {
    if (gpu.fp16) candidates.push({ device: "webgpu", dtype: "q4f16", label: "WebGPU q4f16" });
    candidates.push({ device: "webgpu", dtype: "q4", label: "WebGPU q4" });
    if (gpu.fp16) candidates.push({ device: "webgpu", dtype: "fp16", label: "WebGPU fp16" });
    candidates.push({ device: "webgpu", dtype: "fp32", label: "WebGPU fp32" });
  }
  if (allowWasm) {
    candidates.push({ device: "wasm", dtype: "q8", label: "WASM q8" });
  }

  let lastPct = -1;
  const progress_callback = (p) => {
    if (p && typeof p.progress === "number") {
      const pct = Math.round(p.progress);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        self.postMessage({ type: "progress", pct, file: p.file || "" });
      }
    }
  };

  processor = await tf.AutoImageProcessor.from_pretrained(MODEL_ID, { progress_callback });
  processor.size = { width: INPUT_SIZE, height: INPUT_SIZE };

  let lastErr = null;
  for (const cand of candidates) {
    try {
      self.postMessage({ type: "status", status: `loading ${cand.label}...` });
      model = await tf.AutoModel.from_pretrained(MODEL_ID, {
        device: cand.device,
        dtype: cand.dtype,
        progress_callback,
      });
      backendLabel = cand.label;

      // Pass 1: compile WebGPU shaders. Skip Pass 2 if Pass 1 is already >1000ms so slow devices never stall audio.
      const tWarm = performance.now();
      const dummy = new RawImageCls(new Uint8ClampedArray(INPUT_SIZE * INPUT_SIZE * 4), INPUT_SIZE, INPUT_SIZE, 4);
      const warmIn = await processor(dummy);
      const warmOut = await model(warmIn);
      warmOut?.predicted_depth?.dispose?.();
      const warmMs = Math.round(performance.now() - tWarm);

      let benchMs = warmMs;
      if (warmMs <= 1000) {
        const tBench = performance.now();
        const benchIn = await processor(dummy);
        const benchOut = await model(benchIn);
        benchOut?.predicted_depth?.dispose?.();
        benchMs = Math.round(performance.now() - tBench);
      }

      self.postMessage({ type: "ready", backend: backendLabel, warmMs, benchMs, inputSize: INPUT_SIZE });
      return;
    } catch (err) {
      lastErr = err;
      model = null;
    }
  }
  throw lastErr || new Error("No depth backend available");
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === "init") {
    try {
      await initModel(!!msg.allowWasm);
    } catch (err) {
      self.postMessage({ type: "error", error: String((err && err.message) || err) });
    }
    return;
  }

  if (msg.type === "frame") {
    if (!model || !processor || busy) {
      self.postMessage({ type: "skipped", seq: msg.seq });
      return;
    }
    busy = true;
    const t0 = performance.now();
    try {
      const rgba = new Uint8ClampedArray(msg.buffer);
      const img = new RawImageCls(rgba, msg.width, msg.height, 4);
      const inputs = await processor(img);
      const { predicted_depth } = await model(inputs);
      const dims = predicted_depth.dims;
      const oh = dims[dims.length - 2];
      const ow = dims[dims.length - 1];
      const stats = extractCenterStats(predicted_depth.data, ow, oh);
      predicted_depth.dispose?.();
      const ms = Math.round(performance.now() - t0);
      if (stats) {
        self.postMessage({
          type: "depth",
          seq: msg.seq,
          ms,
          backend: backendLabel,
          ...stats,
        });
      } else {
        self.postMessage({ type: "skipped", seq: msg.seq });
      }
    } catch (err) {
      self.postMessage({ type: "error", error: String((err && err.message) || err) });
    } finally {
      busy = false;
    }
  }
};
