"""Place data providers with one normalized shape.

- GoogleProvider: Places API (New) nearby/text search + details, Geocoding API (reverse), Routes API (walking).
  Needs GOOGLE_MAPS_API_KEY with those three APIs enabled.
- OsmProvider: free fallback (Nominatim reverse + Overpass nearby), no key, no walking route.

Normalized place: {id, name, type, lat, lon, address, rating, ratings, open_now, summary, wheelchair, source}
"""
import asyncio
import re
import time

import httpx

from ..utils import config, trace

_TIMEOUT = httpx.Timeout(6.0, connect=3.0)

# Google Places (New) Table A types per spoken category
GOOGLE_TYPES: dict[str, list[str]] = {
    "attractions": ["tourist_attraction", "museum", "historical_landmark", "monument", "park", "church",
                    "art_gallery", "cultural_landmark", "plaza"],
    "food": ["restaurant", "fast_food_restaurant"],
    "cafes": ["cafe", "coffee_shop", "bakery"],
    "transport": ["bus_stop", "subway_station", "train_station", "transit_station", "taxi_stand", "light_rail_station"],
    "shops": ["supermarket", "convenience_store", "shopping_mall", "store"],
    "pharmacy": ["pharmacy", "drugstore"],
    "health": ["hospital", "doctor", "pharmacy"],
    "services": ["atm", "bank", "post_office", "public_bathroom"],
}
_GOOGLE_SAFE_TYPES = {  # if a newer type is rejected, retry with these long-standing ones
    "attractions": ["tourist_attraction", "museum", "park", "church", "art_gallery"],
    "transport": ["bus_stop", "subway_station", "train_station", "transit_station"],
    "cafes": ["cafe", "bakery"],
    "pharmacy": ["pharmacy"],
    "services": ["atm", "bank", "post_office"],
}

OSM_FILTERS: dict[str, list[str]] = {
    "attractions": ['["tourism"~"attraction|museum|viewpoint|artwork|gallery"]', '["historic"]',
                    '["leisure"="park"]', '["amenity"="place_of_worship"]'],
    "food": ['["amenity"~"restaurant|fast_food"]'],
    "cafes": ['["amenity"="cafe"]', '["shop"="bakery"]'],
    "transport": ['["highway"="bus_stop"]', '["railway"~"station|halt|tram_stop"]', '["amenity"="taxi"]'],
    "shops": ['["shop"~"supermarket|convenience|mall|department_store"]'],
    "pharmacy": ['["amenity"="pharmacy"]'],
    "health": ['["amenity"~"hospital|clinic|doctors|pharmacy"]'],
    "services": ['["amenity"~"atm|bank|post_office|toilets"]'],
}
_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_NOMINATIM_KEYWORDS = {
    "attractions": ["museum", "monument", "park"],
    "food": ["restaurant"],
    "cafes": ["cafe"],
    "transport": ["bus stop", "metro station"],
    "shops": ["supermarket"],
    "pharmacy": ["pharmacy"],
    "health": ["hospital", "pharmacy"],
    "services": ["atm", "post office"],
    "any": ["museum", "cafe", "park"],
}
_OSM_ANY = ['["amenity"]["name"]', '["tourism"]["name"]', '["shop"]["name"]', '["historic"]["name"]',
            '["leisure"="park"]["name"]']


def _lang_code(lang: str) -> str:
    return "el" if lang == "Greek" else "en"


class GoogleProvider:
    name = "google"
    _NEARBY_MASK = ",".join(f"places.{f}" for f in (
        "id", "displayName", "primaryType", "primaryTypeDisplayName", "location", "rating", "userRatingCount",
        "currentOpeningHours.openNow", "editorialSummary", "accessibilityOptions", "shortFormattedAddress",
    ))
    _DETAIL_MASK = ",".join((
        "id", "displayName", "primaryTypeDisplayName", "location", "formattedAddress", "rating", "userRatingCount",
        "currentOpeningHours", "editorialSummary", "generativeSummary", "accessibilityOptions", "reviews",
    ))

    def __init__(self, key: str):
        self.key = key

    def _h(self, mask: str) -> dict:
        return {"X-Goog-Api-Key": self.key, "X-Goog-FieldMask": mask, "Content-Type": "application/json"}

    @staticmethod
    def _norm(p: dict) -> dict:
        loc = p.get("location") or {}
        acc = p.get("accessibilityOptions") or {}
        summary = ((p.get("editorialSummary") or {}).get("text")
                   or ((p.get("generativeSummary") or {}).get("overview") or {}).get("text") or "")
        return {
            "id": p.get("id", ""),
            "name": (p.get("displayName") or {}).get("text", ""),
            "type": (p.get("primaryTypeDisplayName") or {}).get("text") or p.get("primaryType", ""),
            "lat": loc.get("latitude"),
            "lon": loc.get("longitude"),
            "address": p.get("shortFormattedAddress") or p.get("formattedAddress", ""),
            "rating": p.get("rating"),
            "ratings": p.get("userRatingCount"),
            "open_now": (p.get("currentOpeningHours") or {}).get("openNow"),
            "summary": summary,
            "wheelchair": acc.get("wheelchairAccessibleEntrance"),
            "source": "google",
        }

    async def reverse(self, lat: float, lon: float, lang: str) -> dict:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
            r = await http.get("https://maps.googleapis.com/maps/api/geocode/json", params={
                "latlng": f"{lat},{lon}", "language": _lang_code(lang), "key": self.key})
        r.raise_for_status()
        data = r.json()
        if data.get("status") not in ("OK", "ZERO_RESULTS"):
            raise RuntimeError(f"geocode {data.get('status')}: {data.get('error_message', '')[:120]}")
        res = (data.get("results") or [{}])[0]
        comps = {t: c.get("long_name") for c in res.get("address_components", []) for t in c.get("types", [])}
        return {
            "address": res.get("formatted_address", ""),
            "street": comps.get("route", ""),
            "number": comps.get("street_number", ""),
            "area": comps.get("neighborhood") or comps.get("sublocality") or comps.get("sublocality_level_1", ""),
            "city": comps.get("locality") or comps.get("administrative_area_level_3", ""),
            "source": "google",
        }

    async def nearby(self, lat: float, lon: float, category: str, radius_m: int, lang: str, limit: int) -> list[dict]:
        types = GOOGLE_TYPES.get(category)
        body: dict = {
            "maxResultCount": min(20, limit),
            "rankPreference": "DISTANCE" if category in ("transport", "pharmacy", "services", "health") else "POPULARITY",
            "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": float(radius_m)}},
            "languageCode": _lang_code(lang),
        }
        if types:
            body["includedTypes"] = types
        async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
            r = await http.post("https://places.googleapis.com/v1/places:searchNearby",
                                headers=self._h(self._NEARBY_MASK), json=body)
            if r.status_code == 400 and types and category in _GOOGLE_SAFE_TYPES:
                body["includedTypes"] = _GOOGLE_SAFE_TYPES[category]
                r = await http.post("https://places.googleapis.com/v1/places:searchNearby",
                                    headers=self._h(self._NEARBY_MASK), json=body)
        r.raise_for_status()
        return [self._norm(p) for p in r.json().get("places", [])]

    async def search(self, lat: float, lon: float, query: str, radius_m: int, lang: str, limit: int) -> list[dict]:
        body = {
            "textQuery": query,
            "maxResultCount": min(20, limit),
            "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": float(min(radius_m, 50000))}},
            "languageCode": _lang_code(lang),
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
            r = await http.post("https://places.googleapis.com/v1/places:searchText",
                                headers=self._h(self._NEARBY_MASK), json=body)
        r.raise_for_status()
        return [self._norm(p) for p in r.json().get("places", [])]

    async def details(self, place: dict, lang: str) -> dict:
        pid = place.get("id")
        if not pid:
            return place
        async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
            r = await http.get(f"https://places.googleapis.com/v1/places/{pid}",
                               headers=self._h(self._DETAIL_MASK), params={"languageCode": _lang_code(lang)})
        r.raise_for_status()
        p = r.json()
        out = self._norm(p)
        hours = p.get("currentOpeningHours") or {}
        out["hours"] = hours.get("weekdayDescriptions") or []
        out["reviews"] = [
            ((rv.get("text") or {}).get("text") or "")[:220]
            for rv in (p.get("reviews") or [])[:2] if (rv.get("text") or {}).get("text")
        ]
        out["address"] = p.get("formattedAddress") or out["address"]
        return out

    async def walking_route(self, lat: float, lon: float, place: dict, lang: str) -> dict | None:
        dest = ({"placeId": place["id"]} if place.get("id")
                else {"location": {"latLng": {"latitude": place["lat"], "longitude": place["lon"]}}})
        body = {
            "origin": {"location": {"latLng": {"latitude": lat, "longitude": lon}}},
            "destination": dest,
            "travelMode": "WALK",
            "languageCode": _lang_code(lang),
        }
        mask = "routes.distanceMeters,routes.duration,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters"
        async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
            r = await http.post("https://routes.googleapis.com/directions/v2:computeRoutes",
                                headers=self._h(mask), json=body)
        r.raise_for_status()
        routes = r.json().get("routes") or []
        if not routes:
            return None
        rt = routes[0]
        legs = rt.get("legs") or [{}]
        steps = [
            {"instruction": (s.get("navigationInstruction") or {}).get("instructions", ""), "distance_m": s.get("distanceMeters")}
            for s in (legs[0].get("steps") or [])[:4]
        ]
        dur = str(rt.get("duration", "0s")).rstrip("s")
        return {
            "distance_m": rt.get("distanceMeters"),
            "minutes": round(float(dur or 0) / 60) if dur.replace(".", "").isdigit() else None,
            "first_steps": steps,
        }


class OsmProvider:
    """Free OpenStreetMap fallback (Nominatim + Overpass). Respect their usage policies: low volume, cached."""

    name = "osm"
    _UA = {"User-Agent": "VoxEye/0.1 (accessibility hackathon demo)"}
    _last_call = 0.0

    async def _polite(self) -> None:
        wait = 1.05 - (time.time() - OsmProvider._last_call)  # Nominatim: max 1 request per second
        if wait > 0:
            await asyncio.sleep(wait)
        OsmProvider._last_call = time.time()

    async def reverse(self, lat: float, lon: float, lang: str) -> dict:
        await self._polite()
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=self._UA) as http:
            r = await http.get("https://nominatim.openstreetmap.org/reverse", params={
                "format": "jsonv2", "lat": lat, "lon": lon, "zoom": 18, "accept-language": _lang_code(lang)})
        r.raise_for_status()
        d = r.json()
        a = d.get("address") or {}
        return {
            "address": d.get("display_name", ""),
            "street": a.get("road") or a.get("pedestrian") or a.get("footway", ""),
            "number": a.get("house_number", ""),
            "area": a.get("neighbourhood") or a.get("suburb") or a.get("quarter", ""),
            "city": a.get("city") or a.get("town") or a.get("municipality", ""),
            "source": "osm",
        }

    @staticmethod
    def _norm(el: dict) -> dict | None:
        tags = el.get("tags") or {}
        name = tags.get("name:el") or tags.get("name") or tags.get("name:en")
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if not name or lat is None:
            return None
        kind = (tags.get("tourism") or tags.get("amenity") or tags.get("historic") or tags.get("shop")
                or tags.get("leisure") or tags.get("railway") or tags.get("highway") or "")
        summary = tags.get("description") or tags.get("description:en") or ""
        if not summary and tags.get("wikipedia"):
            summary = f"Wikipedia: {tags['wikipedia']}"
        return {
            "id": f"osm:{el.get('type')}/{el.get('id')}",
            "name": name,
            "type": kind.replace("_", " "),
            "lat": lat,
            "lon": lon,
            "address": " ".join(x for x in (tags.get("addr:street", ""), tags.get("addr:housenumber", "")) if x),
            "rating": None,
            "ratings": None,
            "open_now": None,
            "summary": summary,
            "hours": [tags["opening_hours"]] if tags.get("opening_hours") else [],
            "wheelchair": {"yes": True, "no": False}.get(tags.get("wheelchair", "")),
            "source": "osm",
        }

    async def _overpass(self, lat: float, lon: float, category: str, radius_m: int) -> list[dict]:
        filters = OSM_FILTERS.get(category) or _OSM_ANY
        sel = "".join(f"nwr(around:{int(radius_m)},{lat},{lon}){f};" for f in filters)
        q = f"[out:json][timeout:5];({sel});out center tags 60;"
        async with httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=2.0), headers=self._UA) as http:
            r = await http.post(_OVERPASS_URL, data={"data": q})
        r.raise_for_status()
        return [p for p in (self._norm(e) for e in r.json().get("elements", [])) if p]

    async def _keywords(self, lat: float, lon: float, category: str, radius_m: int, lang: str) -> list[dict]:
        out: list[dict] = []
        for kw in _NOMINATIM_KEYWORDS.get(category, _NOMINATIM_KEYWORDS["any"]):
            try:
                out += await self.search(lat, lon, kw, radius_m, lang, 8)
            except Exception as exc:
                trace.log("geo_nominatim_failed", keyword=kw, error=type(exc).__name__)
        return out

    async def nearby(self, lat: float, lon: float, category: str, radius_m: int, lang: str, limit: int) -> list[dict]:
        """Public Overpass servers are often overloaded or refuse requests, so race one quick Overpass attempt
        against Nominatim keyword searches (reliable, ~1-2 s) and take Overpass only if it answers in time."""
        kw_task = asyncio.create_task(self._keywords(lat, lon, category, radius_m, lang))
        try:
            found = await asyncio.wait_for(self._overpass(lat, lon, category, radius_m), 3.5)
            if found:
                kw_task.cancel()
                return found
        except Exception as exc:
            trace.log("geo_overpass_failed", error=type(exc).__name__)
        return await kw_task

    async def search(self, lat: float, lon: float, query: str, radius_m: int, lang: str, limit: int) -> list[dict]:
        await self._polite()
        d = min(0.03, max(0.006, radius_m / 111_000 * 2))  # viewbox half-size in degrees around the user
        async with httpx.AsyncClient(timeout=_TIMEOUT, headers=self._UA) as http:
            r = await http.get("https://nominatim.openstreetmap.org/search", params={
                "q": query, "format": "jsonv2", "limit": min(15, max(limit, 8)), "accept-language": _lang_code(lang),
                "viewbox": f"{lon - d},{lat + d},{lon + d},{lat - d}", "bounded": 1, "extratags": 1})
        r.raise_for_status()
        out = []
        for e in r.json():
            name = (e.get("name") or "").strip()
            if not name or name.isdigit():
                continue  # unnamed features come back as their address ("11", a street) - useless to a listener
            tags = dict(e.get("extratags") or {})
            tags["name"] = name
            tags.setdefault(e.get("category") or "amenity", e.get("type") or "")
            p = self._norm({"type": e.get("osm_type"), "id": e.get("osm_id"), "lat": float(e["lat"]),
                            "lon": float(e["lon"]), "tags": tags})
            if p:
                p["address"] = ", ".join((e.get("display_name") or "").split(", ")[1:3])
                out.append(p)
        return out

    async def details(self, place: dict, lang: str) -> dict:
        return place

    async def walking_route(self, lat: float, lon: float, place: dict, lang: str) -> dict | None:
        return None


class FallbackProvider:
    """Google first; any failure falls back to OSM for that call. Auth/quota denials pause Google for 10 min
    (a wrong key or a disabled API must never make the tour guide fail)."""

    PAUSE_S = 600.0

    def __init__(self, google: GoogleProvider, osm: OsmProvider):
        self.google, self.osm = google, osm
        self.paused_until = 0.0

    @property
    def name(self) -> str:
        return "osm (google paused)" if time.time() < self.paused_until else "google"

    async def _call(self, method: str, *args):
        if time.time() >= self.paused_until:
            try:
                return await getattr(self.google, method)(*args)
            except Exception as exc:
                msg = str(exc)
                denied = any(t in msg for t in ("401", "403", "REQUEST_DENIED", "PERMISSION_DENIED", "OVER_QUERY_LIMIT", "429"))
                if denied:
                    self.paused_until = time.time() + self.PAUSE_S
                trace.log("geo_google_failed", method=method, paused=denied,
                          error=re.sub(r"(key=)[^&\s]+", r"\1***", f"{type(exc).__name__}: {msg}")[:160])
        return await getattr(self.osm, method)(*args)

    async def reverse(self, *a):
        return await self._call("reverse", *a)

    async def nearby(self, *a):
        return await self._call("nearby", *a)

    async def search(self, *a):
        return await self._call("search", *a)

    async def details(self, place: dict, lang: str) -> dict:
        if place.get("source") != "google":
            return place  # OSM ids cannot be looked up on Google
        return await self._call("details", place, lang)

    async def walking_route(self, lat, lon, place, lang):
        if time.time() < self.paused_until:
            return None
        try:
            return await self.google.walking_route(lat, lon, place, lang)
        except Exception as exc:
            trace.log("geo_google_failed", method="walking_route", error=type(exc).__name__)
            return None


_fallback: FallbackProvider | None = None
_osm = OsmProvider()


def provider():
    """Google (with automatic OSM fallback) when a Maps key is configured, otherwise OSM only."""
    global _fallback
    if config.GEO_PROVIDER != "osm" and config.GOOGLE_MAPS_API_KEY:
        if _fallback is None:
            _fallback = FallbackProvider(GoogleProvider(config.GOOGLE_MAPS_API_KEY), _osm)
            trace.log("geo_provider", provider="google+osm_fallback")
        return _fallback
    return _osm
