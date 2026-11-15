"""Location-aware place lookups for one connection: GPS + compass -> distances, steps and user-relative directions.

Every result is a small JSON-safe dict the voice model can turn into a tour-guide style answer. All geometry
(distance, bearing, "40 degrees to your right") is computed here, never by the model.
"""
import asyncio
import re
import time

from ..core import router
from ..core.state import State
from ..utils import config, trace
from . import geo_math
from .providers import provider

GPS_MAX_AGE_S = 60.0
_AREA_CACHE_M = 40.0  # reuse the reverse-geocode until the user has moved this far
CATEGORIES = ("any", "attractions", "food", "cafes", "transport", "shops", "pharmacy", "health", "services")


class NoLocation(Exception):
    pass


def gps_fix(state: State) -> dict:
    gps = state.gps
    if not gps or time.time() - state.gps_at > GPS_MAX_AGE_S:
        raise NoLocation()
    return gps


def _no_location(lang: str) -> dict:
    return {
        "error": "no_location",
        "say": ("Δεν έχω τη θέση σου. Επίτρεψε την τοποθεσία στο κινητό και ξαναρώτα."
                if lang == "Greek" else
                "I don't have your location. Allow location access on the phone and ask again."),
    }


def _relative(state: State, lat: float, lon: float, gps: dict) -> dict:
    dist = geo_math.distance_m(gps["lat"], gps["lon"], lat, lon)
    brg = geo_math.bearing_deg(gps["lat"], gps["lon"], lat, lon)
    comp = router.current_compass_deg(state, max_age_s=config.SENSOR_MAX_AGE_S)
    delta = geo_math.signed_delta(brg, comp) if comp is not None else None
    _, en_l, el_l = router.cardinal_labels(brg)
    return {
        "distance_m": round(dist),
        "steps": geo_math.steps(dist),
        "walk_minutes": max(1, round(dist / 80.0)),  # ~4.8 km/h careful pace
        "direction_from_you": geo_math.direction_words(delta, state.lang),
        "compass_bearing": f"{round(brg)}° {el_l if state.lang == 'Greek' else en_l}",
        "_bearing": brg,
    }


def _public(p: dict) -> dict:
    """Drop internal/empty fields so the model only sees useful facts."""
    return {k: v for k, v in p.items() if not k.startswith("_") and k not in ("lat", "lon", "id", "source")
            and v not in (None, "", [], {})}


async def where_am_i(state: State) -> dict:
    lang = state.lang
    try:
        gps = gps_fix(state)
    except NoLocation:
        return _no_location(lang)
    cache = state.geo_area
    if cache and geo_math.distance_m(gps["lat"], gps["lon"], cache["_lat"], cache["_lon"]) < _AREA_CACHE_M \
            and cache.get("_lang") == lang:
        area = cache
    else:
        area = await provider().reverse(gps["lat"], gps["lon"], lang)
        area.update({"_lat": gps["lat"], "_lon": gps["lon"], "_lang": lang})
        state.geo_area = area
    comp = router.current_compass_deg(state, max_age_s=config.SENSOR_MAX_AGE_S)
    out = {k: v for k, v in area.items() if not k.startswith("_") and v}
    out["gps_accuracy_m"] = round(gps.get("acc") or 0) or None
    if comp is not None:
        _, en_l, el_l = router.cardinal_labels(comp)
        out["facing"] = f"{round(comp)}° {el_l if lang == 'Greek' else en_l}"
    return out


def _rank(places: list[dict], gps: dict, state: State, limit: int) -> list[dict]:
    out = []
    seen = set()
    for p in places:
        if p.get("lat") is None or not p.get("name") or p["name"].lower() in seen:
            continue
        seen.add(p["name"].lower())
        p = {**p, **_relative(state, p["lat"], p["lon"], gps)}
        out.append(p)
    out.sort(key=lambda x: x["distance_m"])
    return out[:limit]


async def nearby_places(state: State, category: str = "any", query: str = "", radius_m: int = 400) -> dict:
    lang = state.lang
    try:
        gps = gps_fix(state)
    except NoLocation:
        return _no_location(lang)
    cat = (category or "any").strip().lower()
    cat = cat if cat in CATEGORIES else "any"
    radius = max(50, min(int(radius_m or 400), 3000))
    prov = provider()
    if query.strip():
        raw = await prov.search(gps["lat"], gps["lon"], query.strip(), max(radius, 1500), lang, 10)
    else:
        raw = await prov.nearby(gps["lat"], gps["lon"], cat, radius, lang, 12)
        if not raw and radius < 1200:
            raw = await prov.nearby(gps["lat"], gps["lon"], cat, radius * 3, lang, 12)
    places = _rank(raw, gps, state, 6)
    state.geo_places = places  # so "tell me more about the second one" / "take me there" can resolve names
    return {
        "provider": prov.name,
        "count": len(places),
        "places": [_public(p) for p in places],
        **({"note": "nothing found nearby; try a wider radius or another category"} if not places else {}),
    }


_GENERIC_WORDS = {
    "the", "a", "an", "of", "to", "at", "in", "and", "near", "nearest", "me", "my",
    "museum", "cafe", "café", "coffee", "restaurant", "church", "park", "square", "station", "stop", "bus", "metro",
    "pharmacy", "shop", "store", "market", "bar", "hotel", "street", "st", "avenue", "national",
    "το", "τη", "την", "τον", "του", "της", "των", "στο", "στη", "στην", "στον", "ο", "η", "οι", "κοντά",
    "μουσείο", "μουσειο", "καφετέρια", "καφετερια", "εκκλησία", "εκκλησια", "πάρκο", "παρκο", "πλατεία", "πλατεια",
    "σταθμός", "σταθμος", "στάση", "σταση", "φαρμακείο", "φαρμακειο", "εστιατόριο", "εστιατοριο", "οδός", "οδος",
}


def _distinctive(text: str) -> set[str]:
    return {w for w in re.findall(r"\w+", text.lower()) if w not in _GENERIC_WORDS and len(w) > 1}


def _match(state: State, name: str) -> dict | None:
    """Resolve a spoken name against the last results. Generic words ("museum", "cafe") never count as a match,
    so "Acropolis Museum" can not resolve to "Numismatic Museum"."""
    n = (name or "").strip().lower()
    words = _distinctive(n)
    if not words:
        return None  # only generic words ("the museum"): ambiguous, let the provider search decide
    for p in state.geo_places:
        pn = p["name"].lower()
        if n == pn or (len(n) > 3 and n in pn) or (len(pn) > 3 and pn in n):
            return p
    best = max(state.geo_places, key=lambda p: len(words & _distinctive(p["name"])), default=None)
    return best if best and words & _distinctive(best["name"]) else None


async def _resolve(state: State, place: str, gps: dict) -> dict | None:
    p = _match(state, place)
    if p is not None:
        return p
    raw = await provider().search(gps["lat"], gps["lon"], place, 3000, state.lang, 5)
    ranked = _rank(raw, gps, state, 5)
    if ranked:
        state.geo_places = ranked + [x for x in state.geo_places if x not in ranked]
        return ranked[0]
    return None


async def place_details(state: State, place: str) -> dict:
    lang = state.lang
    try:
        gps = gps_fix(state)
    except NoLocation:
        return _no_location(lang)
    p = await _resolve(state, place, gps)
    if p is None:
        return {"error": "not_found", "place": place}
    d = await provider().details(p, lang)
    d = {**p, **d, **_relative(state, d.get("lat") or p["lat"], d.get("lon") or p["lon"], gps)}
    return _public(d)


async def guide_to_place(state: State, place: str) -> dict:
    """Point the compass guidance at a place and give the walking route when the provider has one."""
    lang = state.lang
    try:
        gps = gps_fix(state)
    except NoLocation:
        return _no_location(lang)
    p = await _resolve(state, place, gps)
    if p is None:
        return {"error": "not_found", "place": place}
    rel = _relative(state, p["lat"], p["lon"], gps)
    state.target_place = {"name": p["name"], "lat": p["lat"], "lon": p["lon"], "arrived": False, "set_at": time.time()}
    await router.apply_compass_target(state, rel["_bearing"], label=p["name"], by="place")
    out = {"guiding_to": p["name"], **_public(rel),
           "note": "Compass cues will now guide the user toward it in a straight line; obstacles still trigger stops."}
    try:
        route = await asyncio.wait_for(provider().walking_route(gps["lat"], gps["lon"], p, lang), 6.0)
    except Exception as exc:
        trace.log("geo_route_error", error=f"{type(exc).__name__}: {exc}"[:160])
        route = None
    if route:
        out["walking_route"] = route
    return out


async def on_gps_update(state: State) -> str | None:
    """Re-aim compass guidance at a target place as the user walks; returns an arrival phrase once."""
    tp = state.target_place
    if not tp or tp.get("arrived") or not state.gps:
        return None
    gps = state.gps
    dist = geo_math.distance_m(gps["lat"], gps["lon"], tp["lat"], tp["lon"])
    if dist <= max(15.0, min(35.0, float(gps.get("acc") or 15.0))):
        tp["arrived"] = True
        await router.apply_compass_target(state, None, by="place_arrived")
        state.target_place = None
        return (f"Έφτασες κοντά στο {tp['name']}." if state.lang == "Greek" else f"You have arrived near {tp['name']}.")
    brg = geo_math.bearing_deg(gps["lat"], gps["lon"], tp["lat"], tp["lon"])
    if state.target_bearing_deg is None or abs(geo_math.signed_delta(brg, state.target_bearing_deg)) >= 5.0:
        await router.apply_compass_target(state, brg, label=tp["name"], by="place")
    return None


def context_line(state: State) -> str:
    """One line for the Q&A prompt: is GPS available and where (cached area), so the model knows to use tools."""
    gps = state.gps if state.gps and time.time() - state.gps_at <= GPS_MAX_AGE_S else None
    if not gps:
        return "GPS location: not available (if asked about places, say location access is needed)."
    area = state.geo_area
    where = ""
    if area:
        where = ", ".join(x for x in (area.get("street"), area.get("area"), area.get("city")) if x)
    acc = round(gps.get("acc") or 0)
    tp = state.target_place
    guiding = f" Guiding to place: {tp['name']}." if tp else ""
    return f"GPS location: available (±{acc} m){', near ' + where if where else ''}.{guiding}"
