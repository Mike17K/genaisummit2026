import asyncio, base64, io, json, sys, time, wave, audioop
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from frames import empty_road, approaching_car
from google import genai
from google.genai import types
import websockets, urllib.request
from server import config

c = genai.Client(api_key=config.API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
def speak16k(text, voice="Puck"):
    r = c.models.generate_content(model="gemini-3.8-flash-lite-tts", contents=text,
        config=types.GenerateContentConfig(response_modalities=["AUDIO"], speech_config=types.SpeechConfig(
          voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)))))
    with wave.open(io.BytesIO(r.candidates[0].content.parts[0].inline_data.data)) as w:
        rate, ch, sw, fr = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.readframes(w.getnframes())
    if ch == 2: fr = audioop.tomono(fr, sw, 0.5, 0.5)
    out, _ = audioop.ratecv(fr, sw, 1, rate, 16000, None)
    return out + b"\x00" * 48000

EMPTY = base64.b64encode(empty_road(1)[0]).decode()
CAR = [base64.b64encode(j).decode() for j in approaching_car((0.2, 0.5, 0.95))]
T0 = time.time()
now = lambda: time.time() - T0

async def phone(name, script, car_at=None, duration=36):
    r = {"name": name, "conn": None, "alerts": [], "tools": [], "replies": [], "heard": [], "audio_bytes": 0, "errors": [], "watches": 0}
    async with websockets.connect("ws://localhost:8000/live?silence=1200", max_size=None) as ws:
        ready = json.loads(await ws.recv()); r["conn"] = ready.get("conn")
        async def frames():
            i = 0
            while True:
                if car_at is not None and now() >= car_at:
                    f = CAR[min(i, 2)]; i += 1
                else: f = EMPTY
                await ws.send(json.dumps({"type": "frame", "data": f})); await asyncio.sleep(1)
        async def talk():
            for at, audio in script:
                await asyncio.sleep(max(0, at - now()))
                for k in range(0, len(audio), 3200):
                    await ws.send(audio[k:k+3200]); await asyncio.sleep(0.1)
        async def rx():
            async for m in ws:
                if isinstance(m, bytes): r["audio_bytes"] += len(m); continue
                e = json.loads(m)
                t = e["type"]
                if t == "alert": r["alerts"].append(e["text"])
                elif t == "tool": r["tools"].append(e["name"])
                elif t == "reply" and e["text"]: r["replies"].append(e["text"])
                elif t == "heard": r["heard"].append(e["text"])
                elif t == "error": r["errors"].append(e["text"])
                elif t == "watch": r["watches"] += 1
        tasks = [asyncio.create_task(x()) for x in (frames, talk, rx)]
        await asyncio.sleep(max(1, duration - now()))
        for t in tasks: t.cancel()
    return r

async def main():
    q_remember = speak16k("Save a place called blue door in your memory, with the note: second floor, on the left.")
    q_recall = speak16k("List all the places you have saved for me.")
    q_chat = speak16k("What do you see in front of me?")
    print("questions ready; starting 4 phones at the same time")
    results = await asyncio.gather(
        phone("A memory", [(1, q_remember), (18, q_recall)]),
        phone("B hazard", [(18, q_recall)], car_at=10),
        phone("C chat", [(2, q_chat)]),
        phone("D idle", []),
    )
    byname = {r["name"]: r for r in results}
    for r in results:
        print(f"\n[{r['name']}] conn={r['conn']} watches={r['watches']} audio={r['audio_bytes']/48000:.1f}s")
        print("   alerts :", r["alerts"]); print("   tools  :", r["tools"]); print("   heard  :", [h[:50] for h in r["heard"]])
        print("   replies:", [x[:110] for x in r["replies"]]); print("   errors :", r["errors"])
    ok = []
    def chk(name, cond):
        ok.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name)
    print("\n=== checks")
    chk("4 distinct connection ids", len({r["conn"] for r in results}) == 4)
    chk("only B (car) received an alert", byname["B hazard"]["alerts"] and not any(byname[k]["alerts"] for k in ("A memory", "C chat", "D idle")))
    chk("A saved a place by voice", "remember_place" in byname["A memory"]["tools"])
    chk("A can recall its place", any("blue door" in x.lower() for x in byname["A memory"]["replies"]))
    chk("B does NOT see A's place", not any("blue door" in x.lower() or "door" in x.lower() for x in byname["B hazard"]["replies"]))
    chk("C got an answer", byname["C chat"]["replies"] and byname["C chat"]["audio_bytes"] > 0)
    chk("every phone's watcher kept running", all(r["watches"] >= 5 for r in results))
    chk("no connection got an error", not any(r["errors"] for r in results))
    # server-side: per-connection trace filtering
    for r in results:
        ev = json.load(urllib.request.urlopen(f"http://localhost:8000/trace?conn={r['conn']}&n=1000"))
        chk(f"trace?conn={r['conn']} contains only that connection ({len(ev)} events)", ev and all(e["conn"] == r["conn"] for e in ev))
    print(f"\n{sum(ok)}/{len(ok)} checks passed")
asyncio.run(main())
