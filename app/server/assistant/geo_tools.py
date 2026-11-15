"""Location / places tools exposed to the voice model (Gemini function calling).

The model calls these only when the user asks about where they are, what is around, a specific place, or how to
get somewhere. Results come back to the model, which answers like a calm tour guide for a blind person.
"""
from google.genai import types

from ..core.state import State
from ..geo import service

SLOW_TOOLS = frozenset({"where_am_i", "nearby_places", "place_details", "guide_to_place"})

DECLARATIONS = [
    types.FunctionDeclaration(
        name="where_am_i",
        description=(
            "Street address, neighbourhood and city of the user's current GPS position, plus which way they face. "
            "Use when the user asks where they are or wants the area described."
        ),
        parameters=types.Schema(type=types.Type.OBJECT, properties={}),
    ),
    types.FunctionDeclaration(
        name="nearby_places",
        description=(
            "Places around the user with distance in metres/steps and direction relative to where they face "
            "(e.g. '40 degrees to your right'). Use for 'what is around me', tour-guide requests, or finding the "
            "nearest cafe/pharmacy/bus stop. Give `query` for a specific name or kind (e.g. 'Acropolis Museum', "
            "'vegan restaurant'), otherwise a `category`."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "category": types.Schema(
                    type=types.Type.STRING,
                    enum=list(service.CATEGORIES),
                    description="Kind of place; 'attractions' for sights/history, 'any' for a general look around.",
                ),
                "query": types.Schema(type=types.Type.STRING, description="Optional free-text name or kind of place."),
                "radius_m": types.Schema(type=types.Type.INTEGER, description="Search radius in metres (default 400)."),
            },
        ),
    ),
    types.FunctionDeclaration(
        name="place_details",
        description=(
            "Details about one place (from the last nearby_places results or by name): description, opening hours, "
            "wheelchair-accessible entrance, rating, short review snippets, distance and direction."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={"place": types.Schema(type=types.Type.STRING, description="Place name as the user said it.")},
            required=["place"],
        ),
    ),
    types.FunctionDeclaration(
        name="guide_to_place",
        description=(
            "Start guiding the user to a place: points the phone's compass guidance at it and returns distance, "
            "direction and the first walking-route steps. Use when the user asks to go / be taken somewhere."
        ),
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={"place": types.Schema(type=types.Type.STRING, description="Place name as the user said it.")},
            required=["place"],
        ),
    ),
]

TOOL = types.Tool(function_declarations=DECLARATIONS)


async def run(state: State, name: str, args: dict) -> dict:
    """Execute a geo tool for `state`. Raises KeyError for unknown names."""
    if name == "where_am_i":
        return await service.where_am_i(state)
    if name == "nearby_places":
        return await service.nearby_places(
            state,
            category=str(args.get("category") or "any"),
            query=str(args.get("query") or ""),
            radius_m=int(args.get("radius_m") or 400),
        )
    if name == "place_details":
        return await service.place_details(state, str(args.get("place") or ""))
    if name == "guide_to_place":
        return await service.guide_to_place(state, str(args.get("place") or ""))
    raise KeyError(name)
