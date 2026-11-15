"""Tools the agent can call. Plain functions with type hints and docstrings: the SDK turns them
into tool declarations. Every call is traced so judges can see the agent acting.

Remembered places belong to ONE connection (kept in a context variable that each connection sets at its start),
so two users never see each other's places."""
from contextvars import ContextVar

from . import trace

_memory: ContextVar[dict[str, str]] = ContextVar("eyes_memory")


def use_new_memory() -> dict[str, str]:
    """Give the current connection its own empty memory. Call once at the start of a connection handler."""
    memory: dict[str, str] = {}
    _memory.set(memory)
    return memory


def _places() -> dict[str, str]:
    try:
        return _memory.get()
    except LookupError:  # a caller that never set one still gets a private memory, never a shared one
        return use_new_memory()


def remember_place(name: str, note: str) -> dict:
    """Remember a place or object the user mentions, e.g. name='front door', note='3 steps ahead, handle on the right'."""
    _places()[name.lower()] = note
    trace.log("tool", tool="remember_place", name=name, note=note)
    return {"status": "saved", "name": name}


def recall_places() -> dict:
    """List every place or object the user asked us to remember."""
    places = _places()
    trace.log("tool", tool="recall_places", count=len(places))
    return {"places": dict(places)}


def peek_places() -> dict[str, str]:
    """Read-only snapshot of remembered places for agent context without emitting a tool trace."""
    return dict(_places())


def call_contact(name: str, message: str) -> dict:
    """Call a contact (for example a pharmacy) and say the given message. DEMO ONLY: no real call is placed."""
    trace.log("tool", tool="call_contact", name=name, message=message, simulated=True)
    return {
        "status": "simulated",
        "note": "No real call was placed. This is a demo. Tell the user what would have been said.",
        "name": name,
        "message": message,
    }


ALL = [remember_place, recall_places, call_contact]
