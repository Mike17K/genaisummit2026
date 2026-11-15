"""Agent core: sees the latest camera frame, hears the user, decides to speak, act or stay silent."""
import re
import time
from dataclasses import dataclass, field

from . import config, tools, trace
from .memory import UserMemory

SYSTEM = """You are Eyes, a voice assistant for a blind or low-vision person. They cannot see your reply, they only hear it.
Rules:
- Reply in at most two short spoken sentences. No markdown, lists, or emojis.
- Give directions with clock positions and rough distances ("door at 2 o'clock, about 3 steps").
- Put warnings first (steps, obstacles, traffic, hot or sharp objects), then the answer.
- Read text exactly as written when asked to read. Explain bills and letters in plain language.
- If the image is blurry, dark, cut off, or you are not sure, say so and say what to do: move closer, add light, hold still. Never guess.
- Never say a road or crossing is safe. You support a cane or guide dog, you do not replace them.
- You have tools: remember_place, recall_places, call_contact. Use call_contact only if the user asks to call someone. If a tool result says simulated, say it is a demo call.
- If there is nothing useful to say, reply with exactly SILENT.
- STRICT LANGUAGE RULE: Speak ONLY in English or Greek (Ελληνικά). Never use any other language."""

MAX_HISTORY = 6
FRAME_MAX_AGE_S = 5.0

_client = None


def _get_client():
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(api_key=config.API_KEY)
    return _client


@dataclass
class Session:
    frame: bytes | None = None
    frame_time: float = 0.0
    history: list[tuple[str, str]] = field(default_factory=list)  # (role, text)
    memory: UserMemory = field(default_factory=UserMemory)

    def set_frame(self, jpeg: bytes) -> None:
        self.frame, self.frame_time = jpeg, time.time()

    def frame_age(self) -> float | None:
        return None if self.frame is None else time.time() - self.frame_time


def _clean(text: str) -> str | None:
    text = re.sub(r"[*_`#>]+", "", text or "").strip()
    if not text or text.upper().startswith("SILENT"):
        return None
    return text


async def _call_model(model: str, contents: list) -> tuple[str, dict]:
    from google.genai import types

    response = await _get_client().aio.models.generate_content(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM,
            tools=tools.ALL,  # the SDK runs tool calls automatically, including async ones
            temperature=0.3,
        ),
    )
    usage = getattr(response, "usage_metadata", None)
    info = {
        "prompt_tokens": getattr(usage, "prompt_token_count", None),
        "output_tokens": getattr(usage, "candidates_token_count", None),
    }
    return response.text or "", info


async def decide(session: Session, user_text: str | None) -> str | None:
    """Return one short sentence to speak, or None to stay silent."""
    if not user_text:
        return None  # silence by default: a blind user does not want constant chatter

    started = time.time()
    age = session.frame_age()
    trace.log("heard", text=user_text, frame_age_s=None if age is None else round(age, 1))

    if not config.API_KEY:
        return "The model is not connected yet. Add the Gemini key and restart."

    from google.genai import types

    parts: list = []
    for role, text in session.history[-MAX_HISTORY:]:
        parts.append(types.Content(role=role, parts=[types.Part.from_text(text=text)]))

    note = ""
    if session.frame is None or (age is not None and age > FRAME_MAX_AGE_S):
        note = "\n(No fresh camera image is available. If the question needs sight, say you cannot see right now.)"
    mem_ctx = session.memory.context_text(tools.peek_places())
    if mem_ctx:
        note += f"\n(User context: {mem_ctx})"
    user_parts = [types.Part.from_text(text=user_text + note)]
    if session.frame is not None and not note:
        user_parts.insert(0, types.Part.from_bytes(data=session.frame, mime_type="image/jpeg"))
    parts.append(types.Content(role="user", parts=user_parts))

    try:
        text, info = await _call_model(config.MODEL, parts)
    except Exception as exc:  # network, quota, wrong model id, bad key
        trace.log("error", error=f"{type(exc).__name__}: {exc}"[:300])
        return "Sorry, I could not reach the model. Please try again."

    reply = _clean(text)
    trace.log(
        "reply",
        text=reply,
        silent=reply is None,
        model=config.MODEL,
        latency_ms=round((time.time() - started) * 1000),
        **info,
    )
    session.history.append(("user", user_text))
    if reply:
        session.history.append(("model", reply))
    return reply
