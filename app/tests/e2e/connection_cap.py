"""Needs a server started with EYES_MAX_CONNECTIONS=2 on port 8001:
   EYES_MAX_CONNECTIONS=2 uv run uvicorn server.main:app --port 8001
   uv run --with websockets python tests/e2e/connection_cap.py"""
import asyncio, json
import websockets

async def open_one(label):
    ws = await websockets.connect("ws://127.0.0.1:8001/live", max_size=None)
    first = json.loads(await asyncio.wait_for(ws.recv(), 15))
    print(f"{label}: first message = {first}")
    return ws, first

async def main():
    ok = []
    def chk(name, cond): ok.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name)
    a, fa = await open_one("connection 1")
    b, fb = await open_one("connection 2")
    c, fc = await open_one("connection 3 (over the limit)")
    chk("first two connections are accepted", fa["type"] == "ready" and fb["type"] == "ready")
    chk("third connection is told the service is busy", fc["type"] == "error" and "busy" in fc["text"].lower())
    try:
        await asyncio.wait_for(c.wait_closed(), 5); closed = True
    except Exception: closed = False
    chk("the rejected connection is closed by the server", closed)
    # a slot frees up when one disconnects
    await a.close(); await asyncio.sleep(1.5)
    d, fd = await open_one("connection 4 (after one closed)")
    chk("a new connection works once a slot is free", fd["type"] == "ready")
    # the existing second connection kept working throughout
    chk("connection 2 was never disturbed", b.close_code is None)
    await b.close(); await d.close()
    print(f"{sum(ok)}/{len(ok)} checks passed")
asyncio.run(main())
