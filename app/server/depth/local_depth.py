"""Local server-side Depth-Anything-V2-Small inference via ONNX Runtime."""
import asyncio
import io
import os
from pathlib import Path
import time
import urllib.request

import numpy as np
from PIL import Image

from ..utils import config, trace

MODEL_URL = "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4.onnx"
MODEL_PATH = config.APP_DIR / ".models" / "depth_anything_v2_small_q4.onnx"
INPUT_SIZE = 168  # 12 * 14 ViT patch grid

_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 3, 1, 1)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 3, 1, 1)

_session = None
_provider_label = "unloaded"
_load_lock: asyncio.Lock | None = None
_infer_lock: asyncio.Lock | None = None


def _ensure_model_file(path: Path = MODEL_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 1_000_000:
        return path
    tmp = path.with_suffix(".onnx.part")
    urllib.request.urlretrieve(MODEL_URL, tmp)
    tmp.replace(path)
    return path


def _create_session():
    import onnxruntime as ort

    model_file = _ensure_model_file()
    opts = ort.SessionOptions()
    phys_threads = max(1, min(4, (os.cpu_count() or 4) // 2))
    opts.intra_op_num_threads = phys_threads
    opts.inter_op_num_threads = 1
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

    avail = ort.get_available_providers()
    providers = (
        ["CUDAExecutionProvider", "CPUExecutionProvider"]
        if "CUDAExecutionProvider" in avail
        else ["CPUExecutionProvider"]
    )
    sess = ort.InferenceSession(str(model_file), sess_options=opts, providers=providers)
    active_prov = sess.get_providers()[0]
    label = "Laptop CUDA" if "CUDA" in active_prov else f"Laptop CPU ({phys_threads}t)"

    dummy = np.zeros((1, 3, INPUT_SIZE, INPUT_SIZE), dtype=np.float32)
    sess.run(None, {"pixel_values": dummy})
    return sess, label


async def warm() -> str:
    """Download (if missing) and warm up the local ONNX Depth-Anything-V2-Small session once."""
    global _session, _provider_label, _load_lock
    if _session is not None:
        return _provider_label
    if _load_lock is None:
        _load_lock = asyncio.Lock()
    async with _load_lock:
        if _session is not None:
            return _provider_label
        t0 = time.time()
        try:
            _session, _provider_label = await asyncio.to_thread(_create_session)
            trace.log("local_depth_ready", provider=_provider_label, ms=round((time.time() - t0) * 1000))
        except Exception as exc:
            _provider_label = f"unavailable ({type(exc).__name__})"
            trace.log("local_depth_error", error=f"{type(exc).__name__}: {exc}"[:200])
        return _provider_label


def extract_center_disparity_np(depth_2d: np.ndarray) -> dict | None:
    """Extract 75th-percentile inverse-depth disparity in the central 20%x20% crosshair."""
    if depth_2d is None or depth_2d.ndim != 2:
        return None
    h, w = depth_2d.shape
    if h < 4 or w < 4:
        return None
    x0, x1 = max(0, int(w * 0.40)), min(w, int(np.ceil(w * 0.60)))
    y0, y1 = max(0, int(h * 0.40)), min(h, int(np.ceil(h * 0.60)))
    patch = depth_2d[y0:y1, x0:x1]
    valid = patch[np.isfinite(patch) & (patch > 0)]
    if valid.size == 0:
        return None
    center_disp = float(np.percentile(valid, 75))
    all_valid = depth_2d[np.isfinite(depth_2d) & (depth_2d > 0)]
    p10 = float(np.percentile(all_valid, 10)) if all_valid.size else center_disp
    p90 = float(np.percentile(all_valid, 90)) if all_valid.size else center_disp
    return {
        "center_disp": round(center_disp, 4),
        "p10": round(p10, 4),
        "p90": round(p90, 4),
        "sector_disp": sector_disparities_np(depth_2d),
    }


def sector_disparities_np(depth_2d: np.ndarray) -> list[float | None]:
    """LEFT / CENTER / RIGHT thirds of a horizontal band (floor/ceiling skipped): 75th-percentile disparity each."""
    h, w = depth_2d.shape
    band = depth_2d[int(h * 0.18): int(np.ceil(h * 0.68))]
    out: list[float | None] = []
    for s in range(3):
        part = band[:, int(w * s / 3): int(w * (s + 1) / 3)]
        valid = part[np.isfinite(part) & (part > 0)]
        out.append(round(float(np.percentile(valid, 75)), 4) if valid.size >= 8 else None)
    return out


def _infer_sync(jpeg_bytes: bytes) -> dict | None:
    if _session is None:
        return None
    with Image.open(io.BytesIO(jpeg_bytes)) as im:
        rgb = im.convert("RGB").resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
        arr = np.asarray(rgb, dtype=np.float32) * (1.0 / 255.0)
    chw = np.transpose(arr, (2, 0, 1))[None, ...]
    pixel_values = (chw - _MEAN) / _STD
    pred = _session.run(None, {"pixel_values": pixel_values})[0]
    depth_2d = pred[0] if pred.ndim == 3 else pred
    return extract_center_disparity_np(depth_2d)


async def predict_center_disparity(jpeg_bytes: bytes) -> tuple[dict | None, str, int]:
    """Run local Depth-Anything-V2-Small on `jpeg_bytes`, returning (stats_dict, provider_label, ms)."""
    global _infer_lock
    if _session is None:
        await warm()
    if _session is None:
        return None, _provider_label, 0
    if _infer_lock is None:
        _infer_lock = asyncio.Lock()
    if _infer_lock.locked():
        return None, _provider_label, 0
    async with _infer_lock:
        t0 = time.perf_counter()
        stats = await asyncio.to_thread(_infer_sync, jpeg_bytes)
        ms = round((time.perf_counter() - t0) * 1000)
        return stats, _provider_label, ms
