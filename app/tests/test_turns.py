"""Turn-taking logic. Run: uv run python tests/test_turns.py   (no network, no test framework)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.turns import BARGE_IN_S, END_WAIT_FLOOR_S, TurnTracker, parse_chunk  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append(bool(cond))
    print(("PASS" if cond else "FAIL"), name, "" if cond else detail)


MS = 85                                     # one chunk, like the phone page (about 85 ms)
N = MS * 32                                 # bytes of PCM16 mono 16 kHz in 85 ms


def voice(flag=True):
    return (b"\x01" if flag else b"\x00") + b"\x05\x00" * (N // 2)    # flagged chunk: voice


def quiet_tail():
    return b"\x00" + b"\x03\x00" * (N // 2)                           # flagged quiet, but real (non-zero) audio


def silence():
    return b"\x00" + b"\x00\x00" * (N // 2)                           # flagged quiet zeros


def kinds(actions):
    return [a[0] for a in actions]


def run_script(t, script, speaking=False, t0=100.0):
    """script: list of (chunk_bytes). Returns list of (time, actions)."""
    log, now = [], t0
    for chunk in script:
        log.append((round(now, 3), t.feed(chunk, now, speaking)))
        now += MS / 1000
    return log


def all_kinds(log):
    return [k for _, acts in log for k in kinds(acts)]


def run():
    # ---- floor and parsing
    check("the wait never goes below the floor", TurnTracker(end_wait=0.3).end_wait == END_WAIT_FLOOR_S)
    check("a longer wait is kept", TurnTracker(end_wait=1.5).end_wait == 1.5)
    check("odd length means a flag byte", parse_chunk(voice())[1] == 1 and len(parse_chunk(voice())[0]) == N)
    check("flag 0 with real audio is quiet", parse_chunk(quiet_tail())[1] == 0)
    check("older pages: raw non-zero audio counts as voice", parse_chunk(b"\x05\x00" * 100)[1] == 1)
    check("older pages: raw zeros are quiet", parse_chunk(b"\x00\x00" * 100)[1] == 0)

    # ---- start and end
    t = TurnTracker(end_wait=0.9)
    first = t.feed(voice(), 100.0, False)
    check("voice starts a turn at once when the assistant is quiet", kinds(first) == ["start", "audio"])
    check("tracker is active", t.active)

    # long utterance (1.7 s of voice), then the page's tail (real audio flagged quiet), then silence
    t = TurnTracker(end_wait=0.9)
    log = run_script(t, [voice()] * 20 + [quiet_tail()] * 6 + [silence()] * 20)
    end_t = next(ts for ts, acts in log if "end" in kinds(acts))
    last_voice_t = 100.0 + 19 * MS / 1000
    check("a long utterance ends 0.9 s after the last VOICE chunk, not after the tail", abs((end_t - last_voice_t) - 0.9) < MS / 1000 + 0.01, (end_t, last_voice_t))
    audio_count = sum(1 for _, acts in log for a in acts if a[0] == "audio")
    check("the quiet tail is still forwarded to the model", audio_count >= 20 + 6)
    check("exactly one turn", all_kinds(log).count("start") == 1 and all_kinds(log).count("end") == 1)

    # short utterance gets extra patience
    t = TurnTracker(end_wait=0.9)
    log = run_script(t, [voice()] * 3 + [silence()] * 25)         # 0.25 s of voice
    end_t = next(ts for ts, acts in log if "end" in kinds(acts))
    gap = end_t - (100.0 + 2 * MS / 1000)
    check("a short utterance waits longer (about 1.3 s)", 1.25 <= gap <= 1.45, gap)

    # a mid-sentence pause shorter than the wait does not split the turn
    t = TurnTracker(end_wait=0.9)
    log = run_script(t, [voice()] * 12 + [silence()] * 7 + [voice()] * 12 + [silence()] * 20)   # 0.6 s pause
    check("a 0.6 s pause inside a sentence stays one turn", all_kinds(log).count("start") == 1 and all_kinds(log).count("end") == 1, all_kinds(log).count("start"))

    # the old failure: a 300 ms setting used to split speech; now it is floored
    t = TurnTracker(end_wait=0.3)
    log = run_script(t, [voice()] * 15 + [silence()] * 6 + [voice()] * 15 + [silence()] * 20)   # 0.5 s pause
    check("a 300 ms setting no longer splits a sentence at a 0.5 s pause", all_kinds(log).count("start") == 1, all_kinds(log).count("start"))

    # ---- barge-in while the assistant is speaking
    t = TurnTracker(end_wait=0.9)
    log = run_script(t, [voice()] * 2 + [silence()] * 5, speaking=True)       # 0.17 s burst
    check("a short burst does not interrupt the assistant", "start" not in all_kinds(log) and not t.active)
    t = TurnTracker(end_wait=0.9)
    log = run_script(t, [voice()] * 8, speaking=True)                         # 0.68 s sustained
    acts = [a for _, x in log for a in x]
    first_start = next(i for i, a in enumerate(acts) if a[0] == "start")
    check("sustained voice does interrupt it", "start" in all_kinds(log) and t.active)
    check("the start comes before the buffered audio, and the buffered audio is kept", acts[first_start + 1][0] == "audio" and sum(1 for a in acts if a[0] == "audio") >= 6)
    start_time = next(ts for ts, x in log if "start" in kinds(x))
    check(f"it takes about {BARGE_IN_S} s of voice", 100.0 + BARGE_IN_S - MS / 1000 <= start_time <= 100.0 + BARGE_IN_S + MS / 1000, start_time)
    t = TurnTracker(end_wait=0.9)
    log = run_script(t, [voice()] * 3 + [silence()] + [voice()] * 3 + [silence()] * 3, speaking=True)   # two short bursts, a gap between
    check("two short bursts do not add up", "start" not in all_kinds(log))

    # ---- hold-open after an alert
    t = TurnTracker(end_wait=0.9)
    t.hold_for_alert()
    log = run_script(t, [silence()] * 60)                                      # 5 s of silence
    check("a held turn is not ended or fed by silence", all_kinds(log) == [] and t.active and t.hold_open)
    log = run_script(t, [voice()] * 15 + [silence()] * 20, t0=200.0)
    check("real speech joins the held turn without a second start", all_kinds(log).count("start") == 0 and all_kinds(log).count("end") == 1)
    check("and releases the hold", not t.hold_open and not t.active)

    # ---- older pages (no flag byte)
    t = TurnTracker(end_wait=0.9)
    raw_voice, raw_zero = b"\x05\x00" * (N // 2), b"\x00\x00" * (N // 2)
    log = run_script(t, [raw_voice] * 15 + [raw_zero] * 25)
    check("raw audio from an older page still works", all_kinds(log).count("start") == 1 and all_kinds(log).count("end") == 1)

    print(f"\n{sum(results)}/{len(results)} passed")
    return all(results)


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
