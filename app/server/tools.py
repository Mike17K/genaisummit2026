"""Tools the agent can call. Plain functions with type hints and docstrings: the SDK turns them
into tool declarations. Every call is traced so judges can see the agent acting."""
from . import trace

_places: dict[str, str] = {}


def remember_place(name: str, note: str) -> dict:
    """Remember a place or object the user mentions, e.g. name='front door', note='3 steps ahead, handle on the right'."""
    _places[name.lower()] = note
    trace.log("tool", tool="remember_place", name=name, note=note)
    return {"status": "saved", "name": name}


def recall_places() -> dict:
    """List every place or object the user asked us to remember."""
    trace.log("tool", tool="recall_places", count=len(_places))
    return {"places": _places}


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
