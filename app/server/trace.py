"""Tiny trace log so judges can see every step (the 'show the work' rule)."""
import json
import time

_events: list[dict] = []


def log(kind: str, **fields) -> dict:
    event = {"t": round(time.time(), 3), "kind": kind, **fields}
    _events.append(event)
    del _events[:-200]  # keep the last 200 only
    print(json.dumps(event), flush=True)
    return event


def recent(n: int = 50) -> list[dict]:
    return _events[-n:]
