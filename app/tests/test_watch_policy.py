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

    # danger_level 1..5 normalization, deduplication, escalation, and similarity latch
    import io
    from PIL import Image
    from server.watch import apply_danger_level, is_similar_to_danger

    p = AlertPolicy()
    d2 = apply_danger_level(WatchDecision(danger_level=2, hazard_key="wall-ahead"))
    check("danger_level 2 maps to Slow down.", (d2.message, d2.urgency), ("Slow down.", "low"))
    check("danger_level 2 speaks immediately on first sighting", p.decide(d2, 0, 99), (True, "ok"))
    p.record(d2, 0)
    check("same danger_level 2 right after is deduplicated", p.decide(d2, 3, 99), (False, "duplicate"))
    d4 = apply_danger_level(WatchDecision(danger_level=4, hazard_key="wall-ahead"))
    check("danger_level 4 escalates to Stop! through duplicate gate", (d4.message, p.decide(d4, 3, 99)), ("Stop!", (True, "ok")))

    def make_jpeg(color: int) -> bytes:
        buf = io.BytesIO()
        Image.new("RGB", (64, 64), (color, color, color)).save(buf, "JPEG")
        return buf.getvalue()

    j_dark, j_almost_dark, j_bright = make_jpeg(20), make_jpeg(25), make_jpeg(220)
    check("nearly identical scene triggers similarity skip", is_similar_to_danger(j_dark, j_almost_dark)[0], True)
    check("changed scene clears similarity skip", is_similar_to_danger(j_dark, j_bright)[0], False)

    # clear_resolved resets dedupe after a confirmed clear path so a new wall ahead speaks immediately
    p = AlertPolicy()
    w1 = apply_danger_level(WatchDecision(danger_level=4, hazard_key="wall-ahead"))
    check("first wall speaks", p.decide(w1, 10.0, 99), (True, "ok"))
    p.record(w1, 10.0)
    check("same wall before clear is held as duplicate", p.decide(w1, 12.0, 99), (False, "duplicate"))
    p.clear_resolved()
    check("new wall after clear path speaks after 1s high cooldown", p.decide(w1, 12.0, 99), (True, "ok"))

    # Frame-inferred movement/rotation + side-front steering nudges
    p_steer = AlertPolicy()
    s_left = apply_danger_level(
        WatchDecision(danger_level=2, steer="left", user_direction="right", hazard_key="desk-front-right")
    )
    check("steer=left maps to Turn slightly left.", s_left.message, "Turn slightly left.")
    s_right_gr = apply_danger_level(
        WatchDecision(danger_level=2, steer="right", user_direction="forward", hazard_key="chair-front-left"),
        lang="Greek",
    )
    check("steer=right in Greek maps to Στρίψε λίγο δεξιά.", s_right_gr.message, "Στρίψε λίγο δεξιά.")
    check(
        "frame-detected rotation overrides stationary accelerometer for side-front steer",
        p_steer.decide(s_left, 10.0, 99, user_moving=False),
        (True, "ok"),
    )
    p_steer.record(s_left, 10.0)
    check(
        "different side-front obstacle speaks after responsive 1.5s steer cooldown",
        p_steer.decide(s_right_gr, 12.0, 99, user_moving=False),
        (True, "ok"),
    )
    s_lvl4 = apply_danger_level(
        WatchDecision(danger_level=4, steer="left", user_direction="forward", hazard_key="desk-front-right")
    )
    check("level >= 4 collision forces full Stop! instead of slight turn", (s_lvl4.message, s_lvl4.steer), ("Stop!", ""))

    # Standard ACTION_CODES -> exact standard words in English & Greek
    from server import phrases
    c_slide = apply_danger_level(WatchDecision(danger_level=2, action_code="SLIDE_RIGHT", user_direction="forward", hazard_key="chair-left"))
    check("SLIDE_RIGHT maps to Slide right.", (c_slide.message, c_slide.steer), ("Slide right.", "right"))
    c_slide_gr = apply_danger_level(
        WatchDecision(danger_level=2, action_code="SLIDE_LEFT", user_direction="forward", hazard_key="desk-right"),
        lang="Greek",
    )
    check("SLIDE_LEFT in Greek maps to Κάνε λίγο αριστερά.", c_slide_gr.message, "Κάνε λίγο αριστερά.")
    c_stop_next = apply_danger_level(WatchDecision(danger_level=4, action_code="SLIDE_LEFT", hazard_key="wall-ahead"))
    check(
        "lvl 4 promotes guidance code into next_code while commanding STOP",
        (c_stop_next.action_code, c_stop_next.next_code, c_stop_next.message),
        ("STOP", "SLIDE_LEFT", "Stop!"),
    )
    check(
        "all standard codes are pre-warmed in all_phrases()",
        all(en in phrases.all_phrases() and el in phrases.all_phrases() for en, el in phrases.ACTION_CODES.values()),
        True,
    )

    # Visible movement gating: small movement / hand sway blocks alerts; moderate movement downgrades STOP; big movement allows STOP
    from server.watch import frame_movement
    still_frames = [(1.0, make_jpeg(100)), (1.5, make_jpeg(106)), (2.0, make_jpeg(110))]
    mv_still = frame_movement(still_frames)
    check("tiny hand-sway frame change is below movement threshold", mv_still["enough_for_alert"], False)

    big_frames = [(1.0, make_jpeg(40)), (1.5, make_jpeg(110)), (2.0, make_jpeg(185))]
    mv_big = frame_movement(big_frames)
    check("clear sustained movement across all 3 frames passes threshold", mv_big["enough_for_alert"] and mv_big["score"] >= 0.12, True)

    twitch_frames = [(1.0, make_jpeg(40)), (1.5, make_jpeg(44)), (2.0, make_jpeg(180))]
    mv_twitch = frame_movement(twitch_frames)
    check("single-step twitch with frozen prior step is rejected as unsustained", mv_twitch["sustained"], False)

    p_mv = AlertPolicy()
    stop_low_mv = apply_danger_level(WatchDecision(danger_level=4, action_code="STOP", next_code="SLIDE_RIGHT", hazard_key="desk-ahead"))
    check(
        "small movement (<0.095) blocks even lvl 4 STOP alert",
        p_mv.decide(stop_low_mv, 10.0, 99, movement_score=0.052, movement_sustained=True),
        (False, "low_movement"),
    )
    stop_mod_mv = apply_danger_level(
        WatchDecision(danger_level=4, action_code="STOP", next_code="SLIDE_RIGHT", hazard_key="chair-ahead"),
        lang="Greek",
    )
    ok_mod, why_mod = p_mv.decide(stop_mod_mv, 12.0, 99, movement_score=0.105, movement_sustained=True, lang="Greek")
    check(
        "moderate movement (0.095..0.12) does NOT say Stop — downgrades to lvl 2 guidance",
        (ok_mod, why_mod, stop_mod_mv.danger_level, stop_mod_mv.message),
        (True, "ok", 2, "Κάνε λίγο δεξιά."),
    )
    stop_big_mv = apply_danger_level(WatchDecision(danger_level=4, action_code="STOP", hazard_key="wall-ahead"))
    check(
        "large sustained movement (>=0.12) speaks full Stop! immediately",
        (p_mv.decide(stop_big_mv, 15.0, 99, movement_score=0.24, movement_sustained=True), stop_big_mv.message),
        ((True, "ok"), "Stop!"),
    )

    print(f"\n{sum(results)}/{len(results)} passed")
    return all(results)


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
