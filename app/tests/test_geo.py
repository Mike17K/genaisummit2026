"""Geo math, place ranking/directions with a fake provider, and post-tool header stripping (no network)."""
import asyncio
import time
import types

import pytest

from server.assistant import info_pipeline
from server.geo import geo_math, service

SYNTAGMA = (37.9755, 23.7348)
ACROPOLIS = (37.9715, 23.7257)  # ~900 m south-west of Syntagma


def test_distance_and_bearing():
    d = geo_math.distance_m(*SYNTAGMA, *ACROPOLIS)
    assert 850 < d < 950
    b = geo_math.bearing_deg(*SYNTAGMA, *ACROPOLIS)
    assert 235 < b < 250  # WSW
    assert geo_math.bearing_deg(0, 0, 1, 0) == pytest.approx(0, abs=1e-6)
    assert geo_math.bearing_deg(0, 0, 0, 1) == pytest.approx(90, abs=1e-6)


@pytest.mark.parametrize("delta,clock", [(0, 12), (30, 1), (90, 3), (-90, 9), (180, 6), (-30, 11)])
def test_clock(delta, clock):
    assert geo_math.clock_position(delta) == clock


def test_direction_words():
    assert geo_math.direction_words(40, "English") == "40 degrees to your right (1 o'clock)"
    assert geo_math.direction_words(-90, "Greek") == "αριστερά σου 90 μοίρες (στις 9)"
    assert geo_math.direction_words(5, "Greek") == "ακριβώς μπροστά σου (στις 12)"
    assert "unknown" in geo_math.direction_words(None, "English")


class FakeProvider:
    name = "fake"

    async def nearby(self, lat, lon, category, radius_m, lang, limit):
        return [
            {"id": "a", "name": "Acropolis Museum", "type": "Museum", "lat": 37.9684, "lon": 23.7285,
             "summary": "Modern museum", "rating": 4.7, "wheelchair": True, "source": "fake"},
            {"id": "b", "name": "Kiosk", "type": "Store", "lat": SYNTAGMA[0] + 0.0004, "lon": SYNTAGMA[1],
             "source": "fake"},
            {"id": "c", "name": "kiosk", "type": "dup", "lat": 0, "lon": 0, "source": "fake"},  # duplicate name
        ]

    async def search(self, *a):
        return []

    async def details(self, place, lang):
        return {**place, "hours": ["Mon: 9-17"]}

    async def walking_route(self, *a):
        return None

    async def reverse(self, lat, lon, lang):
        return {"street": "Amalias", "area": "Syntagma", "city": "Athens", "source": "fake"}


def _state(compass=None, lang="English"):
    return types.SimpleNamespace(
        lang=lang, gps={"lat": SYNTAGMA[0], "lon": SYNTAGMA[1], "acc": 8.0}, gps_at=time.time(),
        imu={"compassDeg": compass} if compass is not None else None, imu_at=time.time(),
        geo_places=[], geo_area=None, target_place=None, target_bearing_deg=None,
    )


def test_nearby_ranked_with_relative_direction(monkeypatch):
    monkeypatch.setattr(service, "provider", lambda: FakeProvider())
    st = _state(compass=0)  # facing north
    res = asyncio.run(service.nearby_places(st, category="attractions"))
    names = [p["name"] for p in res["places"]]
    assert names == ["Kiosk", "Acropolis Museum"]  # sorted by distance, duplicate dropped
    kiosk, museum = res["places"]
    assert kiosk["direction_from_you"].startswith("straight ahead")  # due north while facing north
    assert "to your left" in museum["direction_from_you"]           # SSW-ish while facing north
    assert "lat" not in museum and "_bearing" not in museum and museum["wheelchair"] is True
    assert abs(kiosk["steps"] - geo_math.steps(kiosk["distance_m"])) <= 1


def test_no_gps():
    st = _state()
    st.gps = None
    assert asyncio.run(service.nearby_places(st))["error"] == "no_location"


def test_place_details_resolves_previous_result(monkeypatch):
    monkeypatch.setattr(service, "provider", lambda: FakeProvider())
    st = _state(compass=180)
    asyncio.run(service.nearby_places(st))
    d = asyncio.run(service.place_details(st, "the acropolis museum"))
    assert d["name"] == "Acropolis Museum" and d["hours"] == ["Mon: 9-17"]
    assert "to your right" in d["direction_from_you"] or "straight" in d["direction_from_you"]


@pytest.mark.parametrize(
    "buf,final,expected",
    [
        ("Here is what is around you.", False, "Here is what is around you."),
        ("HEA", False, None),                                  # might be a repeated header: wait
        ("HEARD: x\nINTENT: ANSWER\nREPLY: The museum is near.", False, "The museum is near."),
        ("I found three places.", False, "I found three places."),
        ("Η πλατεία είναι μπροστά σου.", False, "Η πλατεία είναι μπροστά σου."),  # Greek Eta, not Latin H
        ("HEARD: x\nINTENT: ANSWER", True, ""),                  # header only, no reply: say nothing
    ],
)
def test_strip_repeated_header(buf, final, expected):
    out = info_pipeline._strip_repeated_header(buf, final=final)
    if expected is None:
        assert out is None
    else:
        assert out.strip() == expected.strip()


def test_match_ignores_generic_words():
    st = _state()
    st.geo_places = [{"name": "Numismatic Museum"}, {"name": "Benaki Museum"}, {"name": "Καφενείο του Φωκιανού"}]
    assert service._match(st, "Acropolis Museum") is None          # must NOT pick the Numismatic Museum
    assert service._match(st, "the benaki museum")["name"] == "Benaki Museum"
    assert service._match(st, "Φωκιανού")["name"] == "Καφενείο του Φωκιανού"
    assert service._match(st, "museum") is None


@pytest.mark.parametrize(
    "text,expected",
    [
        ("HEARD: Πού καφετέριες υπάρχουν κοντά μου;\nINTENT: ANSWER", True),   # the failing real case
        ("HEARD: Can you describe the area around me like a tour guide?", True),
        ("HEARD: Please take me to the Acropolis Museum.", True),
        ("HEARD: Πού είμαι;", True),
        ("HEARD: Ξενάγησέ με", True),
        ("HEARD: What is in front of me?", False),
        ("HEARD: Τι γράφει η πινακίδα;", False),
        ("HEARD: Is there anyone near me?", False),                # camera question, not a map lookup
        ("HEARD: Τι υπάρχει γύρω μου;", False),                    # ambiguous: left to the model
        ("HEARD: Is there a pharmacy nearby?", True),
        ("HEARD: Υπάρχει στάση λεωφορείου εδώ;", True),
        ("HEARD: What's the closest bus stop?", True),
        ("no header at all", False),
    ],
)
def test_place_intent(text, expected):
    assert info_pipeline._needs_place_tool(text) is expected
