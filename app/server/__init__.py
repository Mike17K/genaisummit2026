"""VoxEye server package organized by functional domain:

- `core`: session state, explicit user memory, centralized command/risk router, WebSocket lifecycle
- `assistant`: multimodal command/answer streaming, turn-taking, tools, legacy session helpers
- `safety`: 3-frame trajectory risk watcher, alert policy, attention state machine, interrupt/resume alerts
- `depth`: local server ONNX Depth-Anything-V2-Small engine
- `audio`: ElevenLabs / fal.ai TTS synthesis, PCM streaming, English/Greek standard navigation phrases
- `utils`: environment config, image contact-sheet composer, visual movement scoring, JSONL tracing, debug reports
"""
from . import assistant, audio, core, depth, safety, utils
from .assistant import agent, info_pipeline, live_bridge, tools, turns
from .audio import fal, phrases, speak
from .core import live, memory, router, state
from .depth import local_depth
from .safety import alerts, attention, policy, watch
from .utils import compose, config, debug_report, similarity, trace

__all__ = [
    "assistant",
    "audio",
    "core",
    "depth",
    "safety",
    "utils",
    "agent",
    "alerts",
    "attention",
    "compose",
    "config",
    "debug_report",
    "fal",
    "info_pipeline",
    "live",
    "live_bridge",
    "local_depth",
    "memory",
    "phrases",
    "policy",
    "router",
    "similarity",
    "speak",
    "state",
    "tools",
    "trace",
    "turns",
    "watch",
]
