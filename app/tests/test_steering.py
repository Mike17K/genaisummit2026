"""Turn side/degrees and compass-facing logic (pure, no network). Run: uv run --with pytest pytest tests -q"""
import types

import pytest

from server.core import router
from server.safety import steering

H = steering.LANDSCAPE_HFOV_DEG


def turn(p, compass=None, target=None, hfov=H):
    return steering.decide_turn(p, hfov=hfov, compass_deg=compass, target_deg=target)


@pytest.mark.parametrize(
    "target,current,expected",
    [(180, 90, 90), (90, 180, -90), (10, 350, 20), (350, 10, -20), (0, 180, 180), (180, 203, -23), (180, 147, 33)],
)
def test_signed_delta(target, current, expected):
    assert steering.signed_delta(target, current) == pytest.approx(expected)


def test_gap_geometry():
    # gap at 0.85 in a 68 deg frame = 23.8 deg + 10 clearance -> 33.8 -> "30"
    t = turn({"left": None, "right": 0.85})
    assert (t.side, t.code) == ("right", "TURN_RIGHT_30")
    assert turn({"left": 0.2, "right": None}).code == "TURN_LEFT_30"
    # open floor past the edge
    assert turn({"left": 0.0, "right": None}).code == "TURN_LEFT_45"
    # portrait frame is narrower -> smaller turn for the same x
    assert turn({"right": 0.85}, hfov=steering.PORTRAIT_HFOV_DEG).code == "TURN_RIGHT_30"


def test_no_target_picks_nearest_opening():
    assert turn({"left": 0.1, "right": 0.7}).side == "right"
    assert turn({"left": 0.35, "right": 0.95}).side == "left"


def test_target_side_wins_when_open():
    # facing 203 (SW), target south 180 -> target is 23 deg LEFT; both sides open, right one nearer
    t = turn({"left": 0.2, "right": 0.6}, compass=203, target=180)
    assert t.side == "left", t.reason
    # facing 147, target 180 -> 33 deg RIGHT
    t = turn({"left": 0.45, "right": 0.9}, compass=147, target=180)
    assert t.side == "right", t.reason


def test_target_side_blocked_detours_other_side():
    t = turn({"left": None, "right": 0.8}, compass=203, target=180)  # target left, left blocked
    assert t.side == "right" and "detour" in t.reason


def test_target_outside_frame_turns_fully_when_edge_open():
    # target 80 deg right, floor open past the right edge -> turn 75/90 toward it, not just the 50 deg edge
    t = turn({"right": 1.0}, compass=100, target=180)
    assert t.side == "right" and t.deg >= 75


def test_target_behind_turn_around():
    assert turn({"left": 0.1}, compass=0, target=180).code == "GUIDE_AROUND"


def test_wait_and_stay():
    assert turn({"a": "wait"}).code == "GUIDE_WAIT"
    assert turn({"a": "stay"}).code == "GUIDE_STAY"


def test_nothing_visible_uses_more_open_or_target():
    assert turn({"more_open": "left"}).code == "TURN_LEFT_90"
    assert turn({"more_open": "left"}, compass=90, target=180).side == "right"


@pytest.mark.parametrize(
    "heard",
    [
        "Πόσες μοίρες κοιτάω;",
        "Πόσες μέρες κοιτάχτηκε η Θέμη;",  # real STT slip from the trace
        "Προς τα πού κοιτάω;",
        "Σε ποια κατεύθυνση κοιτάω;",
        "Τι δείχνει η πυξίδα;",
        "Which way am I facing?",
        "How many degrees am I facing?",
        "What's my heading?",
    ],
)
def test_facing_queries(heard):
    d = router.decide_user_command(heard)
    assert d.action == "compass:facing" and d.should_answer


@pytest.mark.parametrize("heard", ["Θέλω να πάω νότια", "Guide me north"])
def test_nav_requests_still_set_target(heard):
    assert router.decide_user_command(heard).action.startswith("compass:") and not router.decide_user_command(
        heard
    ).action.endswith("facing")


@pytest.mark.parametrize(
    "goal,deg",
    [("να πάω νότια", 180), ("go north east", 45), ("πάω ανατολικά", 90), ("find the pharmacy", None),
     ("find the exit on the north side of the big building", None)],
)
def test_goal_to_target(goal, deg):
    assert router.compass_target_from_goal(goal) == deg


def _state(compass, target=None):
    return types.SimpleNamespace(
        imu={"compassDeg": compass} if compass is not None else None,
        imu_at=__import__("time").time(),
        target_bearing_deg=target,
    )


def test_facing_reply_numbers():
    assert router.facing_reply(_state(203), "Greek") == "Κοιτάς 203 μοίρες, νοτιοδυτικά."
    en = router.facing_reply(_state(203, 180), "English")
    assert en == "You are facing 203 degrees, southwest. Your target, south (180 degrees), is 23 degrees to your left."
    gr = router.facing_reply(_state(147, 180), "Greek")
    assert gr.endswith("είναι δεξιά σου, 33 μοίρες.")
    assert "δεν στέλνει" in router.facing_reply(_state(None), "Greek")
