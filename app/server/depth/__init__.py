"""Depth inference services: local ONNX Depth-Anything-V2-Small and the Gemini center-crop metric anchor."""
from . import center_probe, local_depth

__all__ = ["center_probe", "local_depth"]
