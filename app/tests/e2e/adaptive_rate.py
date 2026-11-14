"""A car grows steadily toward the camera. The client obeys the server's "rate" messages like the phone does.
Reports when the alert came and how the camera rate changed.
Usage: PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/adaptive_rate.py <port> [car_start_s] [grow_s]"""
import asyncio, base64, io, json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from frames import base, car, jpeg
import websockets

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
CAR_START = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
GROW = float(sys.argv[3]) if len(sys.argv) > 3 else 10.0
DURATION = CAR_START + GROW + 8

def make_bank():
    bank = []
    for i in range(0, 91):                       # scales 0.10 .. 1.00
        im, d = base(); car(d, 0.10 + i * 0.01); bank.append(base64.b64encode(jpeg(im)).decode())
    empty = base64.b64encode(jpeg(base()[0])).decode()
    return empty, bank

async def main():
    empty, bank = make_bank()
    t0 = time.time(); T = lambda: round(time.time() - t0, 2)
    r = {"port": PORT, "alert_t": None, "rates": [], "frames_sent": 0, "looks": 0, "watch_ms": []}
    async with websockets.connect(f"ws://localhost:{PORT}/live?silence=1200", max_size=None) as ws:
        await ws.recv()
        state = {"fps": 1.0}
        async def frames():
            while True:
                t = T()
                if t < CAR_START: f = empty
                else:
                    k = min(90, int((t - CAR_START) / GROW * 90))
                    f = bank[k]
                await ws.send(json.dumps({"type": "frame", "data": f})); r["frames_sent"] += 1
                await asyncio.sleep(1.0 / state["fps"])
        async def rx():
            async for m in ws:
                if isinstance(m, bytes): continue
                e = json.loads(m)
                if e["type"] == "rate": state["fps"] = e["fps"]; r["rates"].append((T(), e["attention"], e["fps"]))
                elif e["type"] == "alert" and r["alert_t"] is None: r["alert_t"] = T(); r["alert_text"] = e["text"]
                elif e["type"] == "watch": r["looks"] += 1; r["watch_ms"].append(e["ms"])
        tasks = [asyncio.create_task(frames()), asyncio.create_task(rx())]
        await asyncio.sleep(DURATION)
        for t in tasks: t.cancel()
    r["after_car_start_s"] = None if r["alert_t"] is None else round(r["alert_t"] - CAR_START, 1)
    r["avg_look_ms"] = round(sum(r["watch_ms"]) / max(1, len(r["watch_ms"])))
    del r["watch_ms"]
    print(json.dumps(r))

asyncio.run(main())
