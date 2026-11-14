"""fal API access. The key stays on the server; the phone page must call fal through a route in this app.

No model is wired in yet. Pick an endpoint, read https://fal.ai/models/<endpoint-id>/llms.txt for its exact input schema, then:

    result = await fal.run("fal-ai/<endpoint-id>", {...arguments from the schema...})

For long jobs use submit() and keep the request id; a second submit is a new billable job.
"""
import fal_client

from . import config

_client: fal_client.AsyncClient | None = None


def available() -> bool:
    return bool(config.FAL_KEY)


def _get_client() -> fal_client.AsyncClient:
    global _client
    if _client is None:
        if not config.FAL_KEY:
            raise RuntimeError("FAL_API_KEY is not set in app/.env")
        _client = fal_client.AsyncClient(key=config.FAL_KEY)
    return _client


async def run(endpoint: str, arguments: dict) -> dict:
    """Call a fal endpoint and wait for the result."""
    return await _get_client().subscribe(endpoint, arguments=arguments)


async def submit(endpoint: str, arguments: dict) -> str:
    """Queue a job and return its request id (poll with status()/result())."""
    handle = await _get_client().submit(endpoint, arguments=arguments)
    return handle.request_id


async def status(endpoint: str, request_id: str):
    return await _get_client().status(endpoint, request_id)


async def result(endpoint: str, request_id: str) -> dict:
    return await _get_client().result(endpoint, request_id)
