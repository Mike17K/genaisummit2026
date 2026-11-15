"""Tiny trace log so judges and developers can inspect every step per connection.

Every event is tagged with the id of the connection that caused it via a ContextVar, so several
phones can use the server at once while keeping their event timelines separable.
"""
from contextvars import ContextVar
import json
import time

_events: list[dict] = []
_conn: ContextVar[str] = ContextVar("eyes_conn", default="-")


def set_conn(conn_id: str) -> None:
    """Call once at the start of a connection handler; spawned tasks inherit the id."""
    _conn.set(conn_id)


def current_conn() -> str:
    return _conn.get()


def log(kind: str, **fields) -> dict:
    event = {"t": round(time.time(), 3), "conn": _conn.get(), "kind": kind, **fields}
    _events.append(event)
    del _events[:-1000]  # keep the last 1000 only
    print(json.dumps(event), flush=True)
    return event


def recent(n: int = 50, conn: str | None = None) -> list[dict]:
    events = _events if conn is None else [e for e in _events if e["conn"] == conn]
    return events[-n:]
