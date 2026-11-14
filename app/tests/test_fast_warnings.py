"""Fast-warning logic: confident single sightings, phone-sensor rules, phrase bank, watcher thinking fallback.
Run: uv run python tests/test_fast_warnings.py   (no network, no test framework)"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import agent, config, phrases, speak, watch  # noqa: E402
from server.watch import AlertPolicy, WatchDecision, sensors_text  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append(bool(cond))
    print(("PASS" if cond else "FAIL"), name, "" if cond else detail)


def d(notify=True, urgency="low", conf=0.8, key="pole-ahead", msg="Pole ahead.", htype="static"):
    return WatchDecision(notify=notify, urgency=urgency, confidence=conf, hazard_key=key, message=msg, hazard_type=htype)


def run():
    # ---- single sighting when very sure
    p = AlertPolicy()
    check("low urgency, 0.80 sure: still waits for a second look", p.decide(d(conf=0.80), 0, 99) == (False, "needs_confirmation"))
    p = AlertPolicy()
    check("low urgency, 0.90 sure: announced on the first sighting", p.decide(d(conf=0.90), 0, 99) == (True, "ok"))
    p = AlertPolicy()
    check("exactly at the fast threshold counts", p.decide(d(conf=config.ALERT_FAST_CONF), 0, 99) == (True, "ok"))
    p = AlertPolicy()
    check("while walking, 0.82 is sure enough", p.decide(d(conf=0.82), 0, 99, user_moving=True) == (True, "ok"))
    p = AlertPolicy()
    check("with unknown movement, 0.82 still waits", p.decide(d(conf=0.82), 0, 99, user_moving=None) == (False, "needs_confirmation"))
    p = AlertPolicy()
    check("an alert from the phone's own detector skips confirmation", p.decide(d(conf=0.80), 0, 99, fast_confirm=True) == (True, "ok"))
    p = AlertPolicy()
    check("fast confirm still respects the confidence floor", p.decide(d(conf=0.5), 0, 99, fast_confirm=True) == (False, "low_confidence"))
    p = AlertPolicy()
    p.decide(d(conf=0.95), 0, 99); p.record(d(conf=0.95), 0)
    check("a single-sighting alert is not repeated within the dedupe window", p.decide(d(conf=0.95), 3, 99) == (False, "duplicate"))
    p = AlertPolicy()
    check("fast confirm still honours the cooldown", (p.record(d(key="a-b"), 0), p.decide(d(conf=0.95, key="c-d"), 2, 99, fast_confirm=True))[1] == (False, "cooldown"))

    # ---- stationary user
    p = AlertPolicy()
    check("a fixed obstacle is held back while the user stands still", p.decide(d(conf=0.95, htype="static"), 0, 99, user_moving=False) == (False, "user_stationary"))
    p = AlertPolicy()
    check("a moving hazard is NOT held back for a stationary user", p.decide(d(conf=0.95, htype="moving", key="car-right"), 0, 99, user_moving=False) == (True, "ok"))
    p = AlertPolicy()
    check("urgent static hazards are never held back", p.decide(d(urgency="high", conf=0.9, htype="static"), 0, 99, user_moving=False) == (True, "ok"))
    p = AlertPolicy()
    check("a walking user gets the static alert", p.decide(d(conf=0.95, htype="static"), 0, 99, user_moving=True) == (True, "ok"))
    p = AlertPolicy()
    check("unknown movement does not suppress anything", p.decide(d(conf=0.95, htype="static"), 0, 99, user_moving=None) == (True, "ok"))

    # ---- sensor text for the watcher
    check("no sensors, no text", sensors_text(None) == "" and sensors_text({}) == "")
    check("stationary", sensors_text({"walking": False, "angularSpeed": 3, "pitchDeg": 80}) == "user stationary, gyro 3 deg/s, phone pitch 80 deg")
    check("walking", sensors_text({"walking": True, "angularSpeed": 12}).startswith("user walking"))
    check("an unknown walking state is never reported as stationary", "stationary" not in sensors_text({"angularSpeed": 3}) and "unknown" in sensors_text({"angularSpeed": 3}))
    check("user_moving: True / False / unknown", (watch.user_moving({"walking": True}), watch.user_moving({"walking": False}), watch.user_moving({"walking": None}), watch.user_moving({}), watch.user_moving(None)) == (True, False, None, None, None))
    check("panning wins over walking", sensors_text({"panning": True, "walking": True, "angularSpeed": 120}).startswith("user panning fast"))

    # ---- phrase bank
    check("a car maps to the vehicle phrase", phrases.local_alert("car") == ("vehicle-ahead", "Vehicle ahead, stop!"))
    check("a bicycle maps to the bike phrase", phrases.local_alert("bicycle")[0] == "bike-ahead")
    check("a person gets a careful phrase", phrases.local_alert("person") == ("person-ahead", "Person ahead, careful."))
    check("an unknown object becomes an obstacle", phrases.local_alert("potted plant")[0] == "obstacle-ahead")
    check("Greek phrases are used for Greek", phrases.local_alert("car", "Greek")[1].startswith("Όχημα"))
    check("every phrase is at most 8 words", all(len(t.split()) <= 8 for t in phrases.all_phrases()), [t for t in phrases.all_phrases() if len(t.split()) > 8])
    check("no duplicate phrases", len(phrases.all_phrases()) == len(set(phrases.all_phrases())))
    check("every on-device phrase is in the pre-spoken set", all(t in phrases.all_phrases() for pair in phrases.LOCAL.values() for t in pair))
    check("the watcher is told its preferred phrases", "Step down ahead." in phrases.prefer_list("English") and "Σκάλες μπροστά." in phrases.prefer_list("Greek"))

    # ---- the plan's thinking_budget=0 is rejected by this model; ours must survive any rejection
    class FakeModels:
        def __init__(self): self.calls = []
        async def generate_content(self, *, model, contents, config):
            self.calls.append(getattr(config, "thinking_config", None))
            if config.thinking_config is not None:
                raise RuntimeError("400 INVALID_ARGUMENT. Request contains an invalid argument.")
            class R:
                parsed = None
                text = '{"notify": false}'
                usage_metadata = None
            return R()

    class FakeClient:
        def __init__(self): self.aio = type("A", (), {"models": FakeModels()})()

    fake = FakeClient()
    original = agent._get_client
    agent._get_client = lambda: fake
    watch._thinking_ok = True
    try:
        decision, _ = asyncio.run(watch.judge([(1.0, b"x"), (2.0, b"y")], [], "English"))
        check("a refused thinking setting falls back to a plain call", decision.notify is False and fake.aio.models.calls[0] is not None and fake.aio.models.calls[1] is None)
        n = len(fake.aio.models.calls)
        asyncio.run(watch.judge([(1.0, b"x"), (2.0, b"y")], [], "English"))
        check("and is not retried on later looks", len(fake.aio.models.calls) == n + 1 and fake.aio.models.calls[-1] is None)
        class Boom(FakeModels):
            async def generate_content(self, **kw): raise RuntimeError("503 UNAVAILABLE")
        fake.aio.models = Boom(); watch._thinking_ok = True
        try:
            asyncio.run(watch.judge([(1.0, b"x"), (2.0, b"y")], [], "English")); raised = False
        except RuntimeError:
            raised = True
        check("other errors are still raised", raised)
    finally:
        agent._get_client = original
        watch._thinking_ok = True

    # ---- warming the voice bank
    made = []
    async def fake_synth(text):
        made.append(text); return b"\x01\x00" * 10
    original_synth = speak._synthesize
    speak._synthesize = fake_synth
    speak._cache.clear(); speak._warmed = False
    try:
        asyncio.run(speak.warm_common())
        check("warming makes every common phrase", set(made) == set(phrases.all_phrases()) and len(made) == len(phrases.all_phrases()), len(made))
        n = len(made)
        asyncio.run(speak.warm_common())
        check("warming runs only once", len(made) == n)
        check("warmed phrases are cached", speak.is_cached("Vehicle ahead, stop!") and speak.is_cached("Όχημα μπροστά, σταμάτα!"))
    finally:
        speak._synthesize = original_synth
        speak._cache.clear(); speak._warmed = False

    print(f"\n{sum(results)}/{len(results)} passed")
    return all(results)


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
