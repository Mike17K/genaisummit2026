"""Several connections at once must not see each other's data.
Run: uv run python tests/test_isolation.py   (no network, no test framework needed)"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import live, speak, tools, trace  # noqa: E402
from server.watch import AlertPolicy  # noqa: E402

results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "" if ok else detail)


async def connection(conn_id, place, note, delay_before_recall, out):
    """Behaves like a connection handler: sets its identity and memory first, then uses the tools."""
    trace.set_conn(conn_id)
    tools.use_new_memory()
    tools.remember_place(place, note)
    await asyncio.sleep(delay_before_recall)          # let the other connections run in between
    out[conn_id] = tools.recall_places()["places"]


async def memory_isolation():
    out = {}
    await asyncio.gather(*[
        connection(f"c{i}", f"place-{i}", f"note-{i}", 0.05 * (5 - i), out) for i in range(5)
    ])
    for i in range(5):
        check(f"connection {i} sees only its own place", out[f"c{i}"] == {f"place-{i}": f"note-{i}"}, out[f"c{i}"])


async def no_memory_set_is_still_private():
    """A caller that never set a memory must not fall into a shared one."""
    seen = {}

    async def lazy(name):
        tools.remember_place(name, "x")                # no use_new_memory() call first
        await asyncio.sleep(0.02)
        seen[name] = set(tools.recall_places()["places"])

    await asyncio.gather(lazy("alpha"), lazy("beta"), lazy("gamma"))
    check("without an explicit memory, tasks are still isolated", all(v == {k} for k, v in seen.items()), seen)


async def trace_tagging():
    async def conn(cid):
        trace.set_conn(cid)
        trace.log("marker", who=cid)
        await asyncio.sleep(0.01)
        trace.log("marker2", who=cid)
        # a task created inside the connection inherits its id
        await asyncio.create_task(asyncio.sleep(0, result=trace.log("child", who=cid)))

    await asyncio.gather(conn("aaa111"), conn("bbb222"), conn("ccc333"))
    for cid in ("aaa111", "bbb222", "ccc333"):
        mine = trace.recent(100, cid)
        check(f"trace for {cid} has only its own events", mine and all(e["who"] == cid for e in mine if "who" in e), mine)
        check(f"trace for {cid} has marker, marker2 and child", {e["kind"] for e in mine} >= {"marker", "marker2", "child"})


def state_has_no_shared_defaults():
    a, b = live.State(socket=None), live.State(socket=None)
    check("frames buffers are separate", a.frames is not b.frames)
    check("alert policies are separate", a.policy is not b.policy)
    check("recent alert lists are separate", a.recent_alerts is not b.recent_alerts)
    check("extra tool maps are separate", a.extra_funcs is not b.extra_funcs)
    a.policy.mode = "off"
    a.frames.append((1.0, b"x"))
    check("changing one state does not change another", b.policy.mode == "normal" and len(b.frames) == 0)
    p1, p2 = AlertPolicy(), AlertPolicy()
    p1.record(__import__("server.watch", fromlist=["WatchDecision"]).WatchDecision(notify=True, hazard_key="car-right", message="x"), 100.0)
    check("alert histories are separate", not p2.alerted and p2.last_alert_at == float("-inf"))


async def speak_cache_is_safe_to_share():
    """The TTS cache maps text to audio only; two connections asking for the same text share one call."""
    calls = []

    async def fake(text):
        calls.append(text)
        await asyncio.sleep(0.05)
        return b"\x01\x00" * 100

    original = speak._synthesize
    speak._synthesize = fake
    speak._cache.clear()
    try:
        r = await asyncio.gather(*[speak.synthesize("Car ahead, stop!") for _ in range(6)])
        check("six simultaneous identical alerts make one TTS call", len(calls) == 1, calls)
        check("all six get the same audio", all(x == r[0] for x in r))
        await asyncio.gather(speak.synthesize("Step down."), speak.synthesize("Pole ahead."))
        check("different texts each get their own call", len(calls) == 3, calls)
    finally:
        speak._synthesize = original
        speak._cache.clear()


async def speak_failure_does_not_poison_cache():
    async def boom(text):
        raise RuntimeError("tts down")

    original = speak._synthesize
    speak._synthesize = boom
    speak._cache.clear()
    try:
        errors = 0
        for _ in range(2):
            try:
                await speak.synthesize("Car ahead, stop!")
            except RuntimeError:
                errors += 1
        check("a failed TTS call is retried, not cached", errors == 2 and not speak._cache)
    finally:
        speak._synthesize = original


async def main():
    await memory_isolation()
    await no_memory_set_is_still_private()
    await trace_tagging()
    state_has_no_shared_defaults()
    await speak_cache_is_safe_to_share()
    await speak_failure_does_not_poison_cache()
    print(f"\n{sum(results)}/{len(results)} passed")
    return all(results)


if __name__ == "__main__":
    sys.exit(0 if asyncio.run(main()) else 1)
