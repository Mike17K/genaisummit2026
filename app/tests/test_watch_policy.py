"""Run: uv run python tests/test_watch_policy.py   (no test framework needed)"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.watch import AlertPolicy, WatchDecision, same_hazard  # noqa: E402


def d(notify=True, urgency="low", conf=0.8, key="car-right", msg="Car from the right."):
    return WatchDecision(notify=notify, urgency=urgency, confidence=conf, hazard_key=key, message=msg)


def run():
    results = []

    def check(name, got, want):
        ok = got == want
        results.append(ok)
        print(("PASS" if ok else "FAIL"), name, "" if ok else f"got {got!r} want {want!r}")

    # silence is the default
    p = AlertPolicy()
    check("model says silent", p.decide(d(notify=False), 0, 99), (False, "silent"))
    check("empty message never speaks", p.decide(d(msg=""), 0, 99), (False, "silent"))

    # low urgency must be seen twice before it is announced
    p = AlertPolicy()
    check("low urgency, first sighting waits", p.decide(d(), 0, 99), (False, "needs_confirmation"))
    check("low urgency, second sighting speaks", p.decide(d(), 2, 99), (True, "ok"))

    # high urgency speaks at once
    p = AlertPolicy()
    check("high urgency speaks immediately", p.decide(d(urgency="high", conf=0.7), 0, 99), (True, "ok"))

    # confidence thresholds
    p = AlertPolicy()
    check("low confidence rejected", p.decide(d(conf=0.5), 0, 99), (False, "low_confidence"))
    check("high urgency below its threshold rejected", p.decide(d(urgency="high", conf=0.4), 0, 99), (False, "low_confidence"))

    # the same hazard is not repeated
    p = AlertPolicy()
    p.decide(d(), 0, 99)
    ok, _ = p.decide(d(), 2, 99)
    p.record(d(), 2)
    check("same hazard right after is a duplicate", p.decide(d(), 10, 99), (False, "duplicate"))
    check("slightly different key still a duplicate", p.decide(d(key="car-right-approaching"), 12, 99), (False, "duplicate"))
    check("old hazard must be re-confirmed after a long gap", p.decide(d(), 38, 99), (False, "needs_confirmation"))
    check("same hazard allowed again after the dedupe window", p.decide(d(), 40, 99), (True, "ok"))

    # escalation is allowed through the duplicate rule
    p = AlertPolicy()
    p.decide(d(), 0, 99)
    p.decide(d(), 2, 99)
    p.record(d(), 2)
    check("low then high for same hazard escalates", p.decide(d(urgency="high"), 4, 99), (True, "ok"))

    # cooldowns
    p = AlertPolicy()
    p.decide(d(key="pole-ahead"), 0, 99)
    p.decide(d(key="pole-ahead"), 2, 99)
    p.record(d(key="pole-ahead"), 2)
    p.decide(d(key="step-down"), 3, 99)
    check("a different low alert inside the cooldown waits", p.decide(d(key="step-down"), 4, 99), (False, "cooldown"))
    check("a different low alert after the cooldown speaks", p.decide(d(key="step-down"), 9, 99), (True, "ok"))

    # never talk over the user (low urgency), but danger still gets through
    p = AlertPolicy()
    p.decide(d(), 0, 99)
    check("low urgency does not talk over the user", p.decide(d(), 2, 0.5), (False, "user_speaking"))
    check("high urgency does talk over the user", p.decide(d(urgency="high", key="bike-left"), 2, 0.5), (True, "ok"))

    # rate limit
    p = AlertPolicy()
    for i in range(6):
        p.record(d(key=f"thing-{i}"), 100 + i)
    p.decide(d(key="new-thing"), 110, 99)
    check("rate limit stops a chatty watcher", p.decide(d(key="new-thing"), 112, 99), (False, "rate_limit"))

    # modes
    p = AlertPolicy()
    p.mode = "off"
    check("mode off", p.decide(d(urgency="high"), 0, 99), (False, "mode_off"))
    p.mode = "urgent_only"
    check("urgent_only blocks low", p.decide(d(), 0, 99), (False, "urgent_only_mode"))
    check("urgent_only allows high", p.decide(d(urgency="high"), 0, 99), (True, "ok"))

    # key matching
    check("same_hazard exact", same_hazard("car-right", "car-right"), True)
    check("same_hazard overlap", same_hazard("car-right", "car-right-approaching"), True)
    check("same_hazard different", same_hazard("car-right", "step-down"), False)
    check("same_hazard synonyms (car vs vehicle)", same_hazard("car-ahead", "vehicle-ahead"), True)
    check("same_hazard synonyms (stairs vs curb)", same_hazard("stairs-down", "curb-ahead"), True)
    check("same_hazard different objects, same direction", same_hazard("car-ahead", "pole-ahead"), False)

    print(f"\n{sum(results)}/{len(results)} passed")
    return all(results)


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
