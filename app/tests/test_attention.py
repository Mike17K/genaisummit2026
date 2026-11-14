"""Adaptive attention: how often images are sent and the watcher looks.
Run: uv run python tests/test_attention.py   (no network, no test framework needed)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import config  # noqa: E402
from server.watch import Attention, select_frames  # noqa: E402

results = []


def check(name, got, want=True):
    ok = got == want
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, "" if ok else f"got {got!r} want {want!r}")


def run():
    # ---- levels and rates
    a = Attention()
    check("starts at normal, 1 fps, look every 2 s", (a.level, a.fps, a.look_s), ("normal", config.FPS["normal"], config.LOOK_S["normal"]))
    check("rates increase with attention", config.FPS["normal"] < config.FPS["elevated"] < config.FPS["high"])
    check("looks get more frequent with attention", config.LOOK_S["normal"] > config.LOOK_S["elevated"] > config.LOOK_S["high"])

    # ---- rising is immediate
    a = Attention()
    check("model says elevated: changes at once", a.update("elevated", 100.0), True)
    check("now elevated, faster camera", (a.level, a.fps), ("elevated", config.FPS["elevated"]))
    check("model says high: changes at once", a.update("high", 101.0), True)
    check("now high, fastest camera", (a.level, a.fps, a.look_s), ("high", config.FPS["high"], config.LOOK_S["high"]))
    check("same level again is not a change", a.update("high", 102.0), False)

    # ---- falling is gradual (no flapping)
    a = Attention()
    a.update("high", 0.0)
    check("one calm look does not lower it", (a.update("normal", 1.0), a.level), (False, "high"))
    check("still high after 7 s of calm", (a.update("normal", 7.0), a.level), (False, "high"))
    check("after the 8 s hold it steps down to elevated", (a.update("normal", 8.1), a.level), (True, "elevated"))
    check("elevated is held 5 s", (a.update("normal", 12.0), a.level), (False, "elevated"))
    check("then steps down to normal", (a.update("normal", 13.2), a.level), (True, "normal"))

    # ---- being needed again restarts the hold
    a = Attention()
    a.update("elevated", 0.0)
    a.update("elevated", 4.0)            # still needed at 4 s
    check("hold restarts while still needed", (a.update("normal", 8.0), a.level), (False, "elevated"))
    check("and ends 5 s after the last need", (a.update("normal", 9.1), a.level), (True, "normal"))

    # ---- our own signals
    a = Attention()
    check("an alert forces high even if the model said normal", (a.update("normal", 0.0, alerted=True), a.level), (True, "high"))
    a = Attention()
    check("a held (suspected) hazard forces at least elevated", (a.update("normal", 0.0, held=True), a.level), (True, "elevated"))
    a = Attention()
    a.update("high", 0.0)
    a.update("normal", 0.5, held=True)
    check("held does not lower a high level", a.level, "high")

    # ---- junk in, safe out
    a = Attention()
    check("an unknown level is treated as normal", (a.update("panic", 0.0), a.level), (False, "normal"))

    # ---- cost guard: a long stretch above normal is cut off, then cools down
    a = Attention()
    t = 0.0
    a.update("elevated", t)
    while t < config.ATTENTION_MAX_S - 1:
        t += 2.0
        a.update("elevated", t)
    check("still elevated just under the cap", a.level, "elevated")
    t += 3.0
    check("forced back to normal after the cap", (a.update("elevated", t), a.level), (True, "normal"))
    check("during the cool-down the model cannot raise it", (a.update("elevated", t + 1.0), a.level), (False, "normal"))
    check("but a real alert still breaks through", (a.update("normal", t + 2.0, alerted=True), a.level), (True, "high"))
    a = Attention()
    a.update("elevated", 0.0)
    for k in range(1, 20):
        a.update("elevated", k * 2.0)
    after_cool = 40.0 + config.ATTENTION_COOLDOWN_S + 1
    a.update("normal", after_cool)       # let the cool-down pass
    check("after the cool-down the model can raise it again", (a.update("elevated", after_cool + 1.0), a.level), (True, "elevated"))

    # ---- frame selection
    def buf(fps, seconds, start=1000.0):
        return [(start + i / fps, b"x%d" % i) for i in range(int(fps * seconds) + 1)]

    now = 1010.0
    frames = select_frames(buf(4, 10), 0.5, now)
    gaps = [round(b[0] - a_[0], 2) for a_, b in zip(frames, frames[1:])]
    check("4 fps buffer, 0.5 s spacing: 3 frames, newest last", len(frames) == 3 and frames[-1][0] == buf(4, 10)[-1][0])
    check("those frames are about 0.5 s apart", all(0.45 <= g <= 0.6 for g in gaps))
    frames = select_frames(buf(1, 10), 1.0, now)
    gaps = [round(b[0] - a_[0], 2) for a_, b in zip(frames, frames[1:])]
    check("1 fps buffer, 1 s spacing: 3 frames 1 s apart", len(frames) == 3 and all(0.95 <= g <= 1.05 for g in gaps))
    check("a short buffer gives fewer frames, not an error", len(select_frames(buf(4, 0.6, start=1009.4), 0.5, now)) in (1, 2))
    check("stale frames are ignored", select_frames(buf(1, 3, start=900.0), 1.0, now) == [])
    check("an empty buffer gives no frames", select_frames([], 1.0, now) == [])
    ordered = select_frames(buf(4, 10), 0.5, now)
    check("frames are in time order", [f[0] for f in ordered] == sorted(f[0] for f in ordered))

    print(f"\n{sum(results)}/{len(results)} passed")
    return all(results)


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
