"""Watcher cadence against a running server with a real Gemini key.
  W1  the server announces its starting camera rate when you connect
  W2  a still scene is looked at much less often (but never less than every ~4 s)
  W3  a hazard that appears after a still period is still caught quickly
Usage: PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/watcher_speed.py"""
import asyncio, base64, json, sys, time, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from frames import base, car, jpeg
import websockets

PORT = 8000
def b64(im): return base64.b64encode(jpeg(im)).decode()
EMPTY = b64(base()[0])
def car_frame(scale):
    im, d = base(); car(d, scale); return b64(im)
CAR = [car_frame(0.10 + i * 0.03) for i in range(31)]     # 0.10 .. 1.00
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + (f"   [{detail}]" if detail and not cond else ""))

async def main():
    ws = await websockets.connect(f"ws://localhost:{PORT}/live", max_size=None)
    conn = json.loads(await ws.recv())["conn"]
    events, t0 = [], time.time()
    T = lambda: round(time.time() - t0, 2)
    async def rx():
        async for m in ws:
            if isinstance(m, str):
                e = json.loads(m); e["t"] = T(); events.append(e)
    rt = asyncio.create_task(rx())
    state = {"mode": "still", "i": 0, "fps": 2.0}
    async def frames():
        while True:
            if state["mode"] == "still": msg = {"type": "frame", "data": EMPTY, "motion": 0.003}
            else:
                msg = {"type": "frame", "data": CAR[min(30, state["i"])], "motion": 0.06}; state["i"] += 1
            await ws.send(json.dumps(msg))
            rates = [e for e in events if e["type"] == "rate"]
            if rates: state["fps"] = rates[-1]["fps"]
            await asyncio.sleep(1.0 / state["fps"])
    ft = asyncio.create_task(frames())
    await asyncio.sleep(1.0)
    first_rate = next((e for e in events if e["type"] == "rate"), None)
    print("\n=== W1: starting rate")
    check("the server announces the camera rate at connect", first_rate is not None and first_rate["fps"] == 2.0 and first_rate["attention"] == "normal", first_rate)

    print("\n=== W2: a still scene for 16 s")
    start = T()
    await asyncio.sleep(16)
    looks = [e for e in events if e["type"] == "watch" and e["t"] >= start]
    gaps = [round(b["t"] - a["t"], 1) for a, b in zip(looks, looks[1:])]
    print(f"   {len(looks)} looks in 16 s; gaps between looks: {gaps}")
    check("far fewer looks than one a second", len(looks) <= 8, len(looks))
    check("but still at least one about every 5 s", len(looks) >= 3 and all(g <= 5.5 for g in gaps), gaps)

    print("\n=== W3: a car appears after the still period (2 frames per second, growing for 15 s)")
    state["mode"] = "car"; state["i"] = 0
    t_car = T()
    for _ in range(100):
        await asyncio.sleep(0.1)
        if any(e["type"] == "alert" and e["t"] >= t_car for e in events): break
    alerts = [e for e in events if e["type"] == "alert" and e["t"] >= t_car]
    check("the car is caught", bool(alerts))
    if alerts:
        dt = alerts[0]["t"] - t_car
        scale_at = 0.10 + min(30, int(dt * 2)) * 0.03
        print(f"   alert {dt:.1f} s after the first changed frame (car at about {scale_at:.2f} of full size): {alerts[0]['text']!r}")
        check("within 3 s", dt < 3.0, dt)
    looks_car = [e for e in events if e["type"] == "watch" and e["t"] >= t_car]
    print(f"   {len(looks_car)} looks while the scene was moving")
    ft.cancel(); rt.cancel(); await ws.close()
    print(f"\n{sum(results)}/{len(results)} checks passed")
asyncio.run(main())
