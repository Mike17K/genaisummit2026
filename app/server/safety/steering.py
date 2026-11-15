"""Deterministic turn decision for the depth emergency stop.

The vision model only reports PERCEPTION (where open walkable floor is in the image). All geometry and compass
math happens here, so the turn side/degrees are always consistent with the compass and the user's target:

- image x position -> degrees via the camera's horizontal field of view (portrait vs landscape)
- signed compass delta to the target (+ = target is to the RIGHT, - = LEFT)
- choose: toward the target when that side is open, otherwise detour through the open side
"""
from dataclasses import dataclass

from ..audio import phrases

LANDSCAPE_HFOV_DEG = 68.0  # typical phone main camera across the long side
PORTRAIT_HFOV_DEG = 52.0   # across the short side (phone held upright)
CLEARANCE_DEG = 10.0       # extra turn so the body clears the obstacle edge, not just the gap center
EDGE_X = 0.04              # gap reported at the image border = open floor continues beyond the frame
MAX_TURN_DEG = 90.0


@dataclass
class TurnDecision:
    code: str            # phrases.ACTION_CODES key, e.g. "TURN_RIGHT_30"
    side: str            # "left" | "right" | ""
    deg: float           # unsnapped turn
    reason: str


def hfov_for(width: int | None, height: int | None) -> float:
    if width and height and height > width:
        return PORTRAIT_HFOV_DEG
    return LANDSCAPE_HFOV_DEG


def signed_delta(target_deg: float, current_deg: float) -> float:
    """Shortest signed turn from `current_deg` to `target_deg` in (-180, 180]: + right, - left."""
    d = ((float(target_deg) - float(current_deg) + 540.0) % 360.0) - 180.0
    return 180.0 if d == -180.0 else d


def _as_x(v) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if 0.0 <= x <= 1.0 else None


def gap_turn_deg(x: float | None, side: str, hfov: float) -> tuple[float | None, bool]:
    """Turn (degrees, unsigned) needed to face an open gap at image position `x`; also whether it is at the edge."""
    if x is None:
        return None, False
    if side == "left":
        x = min(x, 0.5)
        at_edge = x <= EDGE_X
        offset = (0.5 - x) * hfov
    else:
        x = max(x, 0.5)
        at_edge = x >= 1.0 - EDGE_X
        offset = (x - 0.5) * hfov
    # Floor opens beyond the frame: turn past the edge by a fixed margin (already includes clearance)
    turn = hfov / 2.0 + 15.0 if at_edge else offset + CLEARANCE_DEG
    return min(MAX_TURN_DEG, max(15.0, turn)), at_edge


def decide_turn(
    perception: dict,
    *,
    hfov: float,
    compass_deg: float | None,
    target_deg: float | None,
) -> TurnDecision:
    """Pick the turn from model perception + compass. Pure function (unit-testable)."""
    action = str(perception.get("a", "turn") or "turn").strip().lower()
    if action == "wait":
        return TurnDecision("GUIDE_WAIT", "", 0.0, "moving obstacle")
    if action == "stay":
        return TurnDecision("GUIDE_STAY", "", 0.0, "no safe way visible")

    left, left_edge = gap_turn_deg(_as_x(perception.get("left")), "left", hfov)
    right, right_edge = gap_turn_deg(_as_x(perception.get("right")), "right", hfov)
    more_open = "left" if str(perception.get("more_open", "")).lower().startswith("l") else "right"

    def pick(side: str, deg: float, why: str) -> TurnDecision:
        return TurnDecision(phrases.turn_code("turn", side, deg), side, round(deg, 1), why)

    delta = None
    if target_deg is not None and compass_deg is not None:
        delta = signed_delta(target_deg, compass_deg)

    if delta is not None:
        ad = abs(delta)
        if ad >= 135.0:
            return TurnDecision("GUIDE_AROUND", "", round(ad, 1), f"target behind (delta {delta:+.0f})")
        if ad > 12.0:
            t_side = "right" if delta > 0 else "left"
            t_gap, t_edge = (right, right_edge) if t_side == "right" else (left, left_edge)
            o_side = "left" if t_side == "right" else "right"
            o_gap = left if t_side == "right" else right
            if t_gap is not None:
                # Target outside the frame and floor opens past the edge: turn all the way toward the target
                deg = max(t_gap, min(ad, MAX_TURN_DEG)) if t_edge else t_gap
                return pick(t_side, deg, f"toward target (delta {delta:+.0f}), {t_side} open")
            if o_gap is not None:
                return pick(o_side, o_gap, f"detour {o_side}: target side {t_side} blocked (delta {delta:+.0f})")
            return pick(t_side, max(MAX_TURN_DEG if ad > 45 else 45.0, min(ad, MAX_TURN_DEG)),
                        f"nothing open in view, toward target (delta {delta:+.0f})")
        # target straight ahead but blocked: take the nearest opening; prefer the target-ish side on ties
        tie_side = "right" if delta >= 0 else "left"
    else:
        tie_side = more_open

    if left is not None and right is not None:
        if abs(left - right) < 5.0:
            side = tie_side
        else:
            side = "left" if left < right else "right"
        return pick(side, left if side == "left" else right, "nearest opening")
    if left is not None:
        return pick("left", left, "only left open")
    if right is not None:
        return pick("right", right, "only right open")
    return pick(more_open, MAX_TURN_DEG, f"nothing open in view, {more_open} looks more open")
