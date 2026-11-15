"""VoxEye server package organized by functional domain:

- `core`: session state, explicit user memory, centralized command/risk router, WebSocket lifecycle
- `assistant`: multimodal command/answer streaming, turn-taking, tools, legacy session helpers
- `safety`: depth-triggered emergency stop (image + compass -> model guidance) and compass guidance cues
- `depth`: local server ONNX Depth-Anything-V2-Small engine and Gemini center-crop metric anchor
- `audio`: ElevenLabs / fal.ai TTS synthesis, PCM streaming, English/Greek standard navigation phrases
- `utils`: environment config and JSONL tracing
"""
from . import assistant, audio, core, depth, safety, utils
from .assistant import agent, info_pipeline, live_bridge, tools, turns
from .audio import fal, phrases, speak
from .core import live, memory, router, state
from .depth import center_probe, local_depth
from .safety import alerts
from .utils import config, trace

__all__ = [
    "assistant",
    "audio",
    "core",
    "depth",
    "safety",
    "utils",
    "agent",
    "alerts",
    "center_probe",
    "config",
    "fal",
    "info_pipeline",
    "live",
    "live_bridge",
    "local_depth",
    "memory",
    "phrases",
    "router",
    "speak",
    "state",
    "tools",
    "trace",
    "turns",
]
