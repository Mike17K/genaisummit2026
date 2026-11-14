import asyncio, base64, io, json, sys, time, wave, audioop
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from frames import empty_road, approaching_car
from google import genai
from google.genai import types
import websockets
from server import config

c = genai.Client(api_key=config.API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
def speak16k(text):
    r = c.models.generate_content(model="gemini-3.8-flash-lite-tts", contents=text,
        config=types.GenerateContentConfig(response_modalities=["AUDIO"], speech_config=types.SpeechConfig(
          voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Puck")))))
    with wave.open(io.BytesIO(r.candidates[0].content.parts[0].inline_data.data)) as w:
        rate, ch, sw, fr = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.readframes(w.getnframes())
    if ch == 2: fr = audioop.tomono(fr, sw, 0.5, 0.5)
    out, _ = audioop.ratecv(fr, sw, 1, rate, 16000, None)
    return out + b"\x00" * 48000

EMPTY = [base64.b64encode(j).decode() for j in empty_road(1)]
CAR = [base64.b64encode(j).decode() for j in approaching_car((0.2, 0.5, 0.95))]
CAR_PHASE_AT = float(sys.argv[1]) if len(sys.argv) > 1 else 18.0

async def main():
    question = speak16k("Please tell me a long story about a lighthouse keeper, at least a minute.")
    follow = speak16k("What did you just warn me about?")
    follow_at = {"t": None}
    t0 = time.time(); T = lambda: round(time.time() - t0, 2)
    events, chunks = [], []          # chunks: (t, n_bytes)
    car_started = {"t": None}
    async with websockets.connect("ws://localhost:8000/live?silence=1200", max_size=None) as ws:
        print("server:", json.loads(await ws.recv()))
        async def frames():
            i = 0
            while True:
                if T() < CAR_PHASE_AT:
                    f = EMPTY[0]
                else:
                    if car_started["t"] is None: car_started["t"] = T()
                    f = CAR[min(i, 2)]; i += 1
                await ws.send(json.dumps({"type": "frame", "data": f})); await asyncio.sleep(1)
        async def speech():
            for k in range(0, len(question), 3200):
                await ws.send(question[k:k+3200]); await asyncio.sleep(0.1)
        async def rx():
            async for m in ws:
                if isinstance(m, bytes): chunks.append((T(), len(m)))
                else:
                    e = json.loads(m); e["t"] = T(); events.append(e)
        async def followup():
            await asyncio.sleep(CAR_PHASE_AT + 11)
            follow_at["t"] = T()
            for k in range(0, len(follow), 3200):
                await ws.send(follow[k:k+3200]); await asyncio.sleep(0.1)
        ft, st, rt, fu = asyncio.create_task(frames()), asyncio.create_task(speech()), asyncio.create_task(rx()), asyncio.create_task(followup())
        await asyncio.sleep(CAR_PHASE_AT + 25)
        ft.cancel(); st.cancel(); rt.cancel(); fu.cancel()
    print("follow-up question sent at t =", follow_at["t"])
    print(f"\ncar frames started at t={car_started['t']}s")
    for e in events:
        if e["type"] in ("watch", "alert", "suppressed", "interrupted", "heard", "reply", "tool"):
            extra = {k: v for k, v in e.items() if k not in ("type", "t")}
            print(f"  t={e['t']:>5}  {e['type']:<11} {json.dumps(extra)[:150]}")
    alert = next((e for e in events if e["type"] == "alert"), None)
    if alert:
        before = [t for t, n in chunks if t <= alert["t"]]
        after = [(t, n) for t, n in chunks if t > alert["t"]]
        gap_start = after[0][0] if after else None
        print(f"\nalert at t={alert['t']}s ({round(alert['t'] - car_started['t'], 1)}s after the first car frame)")
        print(f"story audio stopped at t={max(before) if before else None}; next audio after the alert at t={gap_start}")
        # speech after alert: group chunks after the alert into bursts
        # find bursts: gaps > 0.6 s between audio chunks mark where speech stopped and restarted
        ts = [t for t, n in chunks]
        gaps = [(round(a, 2), round(b, 2)) for a, b in zip(ts, ts[1:]) if b - a > 0.6]
        print("audio gaps longer than 0.6 s (speech stopped, then restarted):", gaps)
        print("total audio chunks before alert:", len(before), " after alert:", len(after))
        # describe audio after the alert as bursts (gap > 0.5 s starts a new burst)
        bursts, cur = [], []
        for t, n in after:
            if cur and t - cur[-1][0] > 0.5: bursts.append(cur); cur = []
            cur.append((t, n))
        if cur: bursts.append(cur)
        for b in bursts:
            tot = sum(n for _, n in b)
            print(f"  audio burst t={b[0][0]}..{b[-1][0]}  {len(b)} chunks  {tot/48000:.1f}s of speech  chunk sizes {sorted(set(n for _, n in b))[:4]}")
        intr = next((e["t"] for e in events if e["type"] == "interrupted" and e["t"] >= alert["t"] - 0.1), None)
        if intr is not None:
            nxt = next((t for t, n in chunks if t > intr + 0.02), None)
            print(f"interrupted at t={intr}s ({round(intr - alert['t'], 2)}s after the alert); the alert was spoken starting t={nxt}s, {round(nxt - alert['t'], 1) if nxt else None}s after the alert fired")
    else:
        print("\nNO ALERT was sent")
asyncio.run(main())
