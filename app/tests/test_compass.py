"""Compass facing answers and goal -> bearing logic (pure, no network). Run: uv run --with pytest python -m pytest tests -q"""
import types

import pytest

from server.core import router
from server.geo import geo_math


@pytest.mark.parametrize(
    "target,current,expected",
    [(180, 90, 90), (90, 180, -90), (10, 350, 20), (350, 10, -20), (0, 180, 180), (180, 203, -23), (180, 147, 33)],
)
def test_signed_delta(target, current, expected):
    assert geo_math.signed_delta(target, current) == pytest.approx(expected)
    assert router.compass_delta_deg(target, current) == pytest.approx(expected)


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
