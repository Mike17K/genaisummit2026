"""Fast-warning paths against a running server with a real Gemini key.
  F1  an on-device alert arrives at once; uncached voice -> the PHONE speaks it (no PCM streamed)
  F2  after the voice bank is warm, an on-device alert streams cached audio immediately
  F3  the camera-pan gate: no watcher looks and no on-device alert while the phone reports panning
  F4  a fresh frame sent at speech start is forwarded early
Usage: PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/fast_warnings.py"""
import asyncio, base64, json, sys, time, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from frames import base, jpeg
import websockets

PORT = 8000
FRAME = base64.b64encode(jpeg(base()[0])).decode()
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + (f"   [{detail}]" if detail and not cond else ""))

class Phone:
    def __init__(self): self.events, self.audio, self.imu, self.t0 = [], [], {"walking": True, "panning": False, "angularSpeed": 5, "pitchDeg": 80}, time.time()
    T = property(lambda self: time.time() - self.t0)
    async def __aenter__(self):
        self.ws = await websockets.connect(f"ws://localhost:{PORT}/live", max_size=None)
        self.conn = json.loads(await self.ws.recv())["conn"]
        self.tasks = [asyncio.create_task(self._rx()), asyncio.create_task(self._frames())]
        await asyncio.sleep(1.5); return self
    async def __aexit__(self, *a):
        for t in self.tasks: t.cancel()
        await self.ws.close()
    async def _frames(self):
        while True:
            await self.ws.send(json.dumps({"type": "frame", "data": FRAME, "imu": self.imu})); await asyncio.sleep(1)
    async def _rx(self):
        async for m in self.ws:
            if isinstance(m, bytes): self.audio.append((self.T, len(m)))
            else: e = json.loads(m); e["t"] = self.T; self.events.append(e)
    async def local_alert(self, label, **kw):
        t = self.T; n_audio = len(self.audio)
        await self.ws.send(json.dumps({"type": "local_alert", "label": label, "confidence": 0.92, "growth": 1.9, "distM": 1.9, **kw}))
        return t, n_audio
    def trace(self, n=1000): return json.load(urllib.request.urlopen(f"http://localhost:{PORT}/trace?conn={self.conn}&n={n}"))
    def alerts(self, since=0): return [e for e in self.events if e["type"] == "alert" and e["t"] >= since]

def global_trace(): return json.load(urllib.request.urlopen(f"http://localhost:{PORT}/trace?n=1000"))

async def main():
    async with Phone() as p:
        print("\n=== F1: on-device alert, voice not ready yet (the voice bank is still being made)")
        t, n0 = await p.local_alert("car")
        await asyncio.sleep(1.2)
        a = p.alerts(t)
        check("the alert arrives", len(a) == 1, a)
        if a:
            e = a[0]
            print(f"   alert event {round((e['t'] - t) * 1000)} ms after the message was sent: {e['text']!r} source={e['source']} cached={e['voice_cached']} phone_voice={e['client_voice']}")
            check("it is marked as coming from the phone's own detector", e["source"] == "local")
            check("it uses the planned phrase", e["text"] == "Vehicle ahead, stop!", e["text"])
            check("it arrives within 300 ms", e["t"] - t < 0.3, round((e["t"] - t) * 1000))
            check("an uncached urgent alert is spoken by the phone", e["client_voice"] is True and e["voice_cached"] is False, e)
        await asyncio.sleep(2.5)
        check("and no audio is streamed from the server for it", len(p.audio) == n0, len(p.audio) - n0)

        print("\n=== wait for the voice bank to finish warming...")
        for _ in range(80):
            if any(e["kind"] == "tts_warm" for e in global_trace()): break
            await asyncio.sleep(0.5)
        warm = [e for e in global_trace() if e["kind"] == "tts_warm"]
        check("the common voices were made in the background", bool(warm), "never finished")
        if warm: print(f"   {warm[-1]['phrases']} phrases in {warm[-1]['ms']/1000:.1f} s")

        print("\n=== F2: on-device alert once the voice is ready")
        await asyncio.sleep(2.0)                      # clear the 1.5 s high-urgency cooldown
        t, n0 = await p.local_alert("person")
        await asyncio.sleep(2.5)
        a = p.alerts(t)
        check("the alert arrives", len(a) == 1, a)
        if a:
            e = a[0]
            check("its voice is cached and the phone does not need to speak", e["voice_cached"] is True and e["client_voice"] is False, e)
            first = next((ts for ts, n in p.audio[n0:]), None)
            print(f"   first audio {round((first - t) * 1000) if first else None} ms after the message was sent")
            check("the cached voice streams within 400 ms", first is not None and first - t < 0.4, first and round((first - t) * 1000))

        print("\n=== F3: camera panning")
        p.imu = {"walking": True, "panning": True, "angularSpeed": 120, "pitchDeg": 80}
        await asyncio.sleep(2.0)
        mark = time.time()
        await asyncio.sleep(1.0)
        t, _ = await p.local_alert("bicycle")
        await asyncio.sleep(2.0)
        check("an on-device alert is held while the phone pans", not p.alerts(t))
        tr = [e for e in p.trace() if e["t"] >= mark]
        check("the trace says why", any(e["kind"] == "local_alert" and "panning" in e.get("outcome", "") for e in tr), [e["kind"] for e in tr][:8])
        skipped = [e for e in tr if e["kind"] == "watch_skipped" and e.get("reason") == "camera panning"]
        looks = [e for e in tr if e["kind"] == "watch"]
        check("the cloud watcher skips its looks while panning", len(skipped) >= 1 and len(looks) == 0, f"skipped={len(skipped)} looks={len(looks)}")
        p.imu = {"walking": True, "panning": False, "angularSpeed": 5, "pitchDeg": 80}
        await asyncio.sleep(3.0)
        looks_after = [e for e in p.trace() if e["kind"] == "watch" and e["t"] > time.time() - 3.5]
        check("and resumes when the panning stops", len(looks_after) >= 1, len(looks_after))

        print("\n=== F4: a fresh picture at speech start")
        await p.ws.send(json.dumps({"type": "frame", "data": FRAME, "imu": p.imu}))
        await p.ws.send(json.dumps({"type": "frame", "data": FRAME, "imu": p.imu, "fresh": True}))
        await asyncio.sleep(0.5)
        check("a fresh frame sent right after another is forwarded early", any(e["kind"] == "fresh_frame" for e in p.trace()))

        print("\n=== the trace shows the sensors and the source")
        tr = p.trace()
        w = [e for e in tr if e["kind"] == "watch"]
        check("watcher looks record whether the user is moving", w and all("moving" in e for e in w))
        check("alerts record their source", any(e["kind"] == "alert" and e.get("source") == "local" for e in tr))
    print(f"\n{sum(results)}/{len(results)} checks passed")
asyncio.run(main())
