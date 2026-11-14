"""Agent core (stub).

Step 3 of the build order replaces `decide` with a real multimodal model call.
The API key is read from the environment and is never stored in code.
"""
import os

from . import trace

MODEL_READY = bool(os.environ.get("GEMINI_API_KEY"))


async def decide(user_text: str | None, frame_bytes: int | None) -> str | None:
    """Return a short sentence to speak, or None to stay silent."""
    trace.log("decide", has_text=bool(user_text), frame_bytes=frame_bytes, model_ready=MODEL_READY)
    if user_text:
        if not MODEL_READY:
            return f"I heard: {user_text}. The model is not connected yet."
        # TODO: call the multimodal model with the latest frame and user_text.
        return f"I heard: {user_text}."
    return None  # silence by default: a blind user does not want constant chatter
