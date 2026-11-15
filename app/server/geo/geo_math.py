"""Pure geodesy helpers: distance, bearing, steps and user-relative direction words."""
import math

EARTH_R_M = 6_371_000.0
STEP_M = 0.7


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle (haversine) distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_M * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial compass bearing from point 1 to point 2 (0 = North, 90 = East)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def signed_delta(target_deg: float, current_deg: float) -> float:
    """Shortest signed turn in (-180, 180]: + right, - left."""
    d = ((float(target_deg) - float(current_deg) + 540.0) % 360.0) - 180.0
    return 180.0 if d == -180.0 else d


def clock_position(delta: float) -> int:
    """Delta (+ right) -> clock hour where 12 is straight ahead."""
    h = round(((delta % 360.0) + 360.0) % 360.0 / 30.0) % 12
    return 12 if h == 0 else h


def steps(dist_m: float) -> int:
    return max(1, round(dist_m / STEP_M))


def direction_words(delta: float | None, lang: str) -> str:
    """Spoken direction relative to where the user faces; falls back when there is no compass."""
    gr = lang == "Greek"
    if delta is None:
        return "κατεύθυνση άγνωστη (η πυξίδα δεν απαντά)" if gr else "direction unknown (no compass reading)"
    ad = abs(round(delta))
    clock = clock_position(delta)
    if ad <= 12:
        return "ακριβώς μπροστά σου (στις 12)" if gr else "straight ahead (12 o'clock)"
    if ad >= 160:
        return f"πίσω σου (στις {clock})" if gr else f"behind you ({clock} o'clock)"
    if gr:
        return f"{'δεξιά' if delta > 0 else 'αριστερά'} σου {ad} μοίρες (στις {clock})"
    return f"{ad} degrees to your {'right' if delta > 0 else 'left'} ({clock} o'clock)"
