"""Turn-taking against a running server with a real Gemini key.
  S1  a 0.6 s pause inside a sentence (page asks for a 300 ms wait, which the server raises to 700) stays ONE turn
  S2  a short noise burst does not cut the assistant off; sustained speech does
  S3  the quiet tail no longer adds dead time: time from the last voice chunk to the first speech, new vs old protocol
Usage: PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/turn_taking.py"""
import asyncio, base64, io, json, statistics as st, sys, time, urllib.request, wave, audioop
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from frames import base, jpeg
from google import genai
from google.genai import types
import websockets
from server import config

PORT = 8000
c = genai.Client(api_key=config.API_KEY, http_options=types.HttpOptions(api_version="v1beta"))

def tts16k(text, voice="Puck"):
    r = c.models.generate_content(model="gemini-3.8-flash-lite-tts", contents=text,
        config=types.GenerateContentConfig(response_modalities=["AUDIO"], speech_config=types.SpeechConfig(
          voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)))))
    with wave.open(io.BytesIO(r.candidates[0].content.parts[0].inline_data.data)) as w:
        rate, ch, sw, fr = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.readframes(w.getnframes())
    if ch == 2: fr = audioop.tomono(fr, sw, 0.5, 0.5)
    out, _ = audioop.ratecv(fr, sw, 1, rate, 16000, None)
    return out

FRAME = base64.b64encode(jpeg(base()[0])).decode()
STEP = 3200   # 100 ms
results = []
def check(name, cond, detail=""):
    results.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + (f"   [{detail}]" if detail and not cond else ""))

class Phone:
    def __init__(self, silence=None):
        self.silence, self.events, self.audio, self.conn = silence, [], [], None
        self.t0 = time.time()
    T = property(lambda self: time.time() - self.t0)
    async def __aenter__(self):
        q = f"?silence={self.silence}" if self.silence else ""
        self.ws = await websockets.connect(f"ws://localhost:{PORT}/live{q}", max_size=None)
        self.conn = json.loads(await self.ws.recv())["conn"]
        self.tasks = [asyncio.create_task(self._rx()), asyncio.create_task(self._frames())]
        await asyncio.sleep(1.0)
        return self
    async def __aexit__(self, *a):
        for t in self.tasks: t.cancel()
        await self.ws.close()
    async def _frames(self):
        while True:
            await self.ws.send(json.dumps({"type": "frame", "data": FRAME})); await asyncio.sleep(1)
    async def _rx(self):
        async for m in self.ws:
            if isinstance(m, bytes): self.audio.append((self.T, len(m)))
            else:
                e = json.loads(m); e["t"] = self.T; self.events.append(e)
    # new protocol: 1 flag byte + PCM
    async def voice(self, pcm):
        for i in range(0, len(pcm), STEP):
            piece = pcm[i:i + STEP]
            if len(piece) % 2: piece += b"\x00"
            await self.ws.send(b"\x01" + piece); await asyncio.sleep(0.1)
        self.last_voice_t = self.T
    async def quiet(self, seconds, tail_pcm=None):
        for i in range(int(seconds * 10)):
            body = tail_pcm[i * STEP:(i + 1) * STEP] if tail_pcm and len(tail_pcm) >= (i + 1) * STEP else b"\x00" * STEP
            await self.ws.send(b"\x00" + body); await asyncio.sleep(0.1)
    # old protocol: raw PCM, any sound counts as voice
    async def raw(self, pcm, zeros=False):
        for i in range(0, len(pcm), STEP):
            await self.ws.send(b"\x00" * STEP if zeros else pcm[i:i + STEP]); await asyncio.sleep(0.1)
    def trace(self):
        return json.load(urllib.request.urlopen(f"http://localhost:{PORT}/trace?conn={self.conn}&n=1000"))
    def count(self, typ): return sum(1 for e in self.events if e["type"] == typ)
    def speech_s(self, since=0.0): return sum(n for t, n in self.audio if t >= since) / 48000

async def s1():
    print("\n=== S1: a 0.6 s pause inside a sentence, page asking for a 300 ms wait")
    pcm = tts16k("What do you see in front of me right now?")
    half = (len(pcm) // 2) // 2 * 2
    async with Phone(silence=300) as p:
        await p.voice(pcm[:half]); await p.quiet(0.6); await p.voice(pcm[half:]); await p.quiet(4.0)
        await asyncio.sleep(8)
        tr = p.trace()
        live = next(e for e in tr if e["kind"] == "live_connect")
        starts = [e for e in tr if e["kind"] == "user_turn" and e["state"] == "start"]
        heard = [e["text"] for e in p.events if e["type"] == "heard"]
        print(f"   server used silence_ms={live['silence_ms']}; turns started={len(starts)}; heard={heard}; speech chunks={len(p.audio)}")
        check("the 300 ms request is raised to the 700 ms floor", live["silence_ms"] == 700, live)
        check("the sentence stays ONE turn", len(starts) == 1, f"{len(starts)} turns")
        check("one heard message holds the whole sentence", len(heard) == 1 and "front of me" in heard[0].lower() and "what" in heard[0].lower(), heard)
        check("and it was answered with speech", len(p.audio) > 0)

async def s2():
    print("\n=== S2: noise burst vs sustained speech while the assistant is audible")
    story = tts16k("Please count out loud from one to one hundred, slowly, one number at a time, and do not stop until you reach one hundred.")
    word = tts16k("Stop. Stop right now, please.")
    async with Phone() as p:
        await p.voice(story); await p.quiet(2.0)
        for _ in range(100):                         # wait for the first speech
            if p.audio: break
            await asyncio.sleep(0.1)
        check("the assistant starts speaking", bool(p.audio))
        first_t = p.audio[0][0] if p.audio else p.T
        await asyncio.sleep(1.2)                     # a fast model has sent most of its speech by now; the phone is still playing it
        total = p.speech_s()
        audible_end = first_t + total
        print(f"   {total:.1f} s of speech received; the phone would be playing it until t+{audible_end - p.T:.1f} s")
        check("there is enough speech left to play for the test", audible_end - p.T > 3.0, f"{audible_end - p.T:.1f} s left")
        t_burst = p.T
        await p.voice(word[:STEP * 2]); await p.quiet(0.8)        # 0.2 s burst
        starts = [e for e in p.trace() if e["kind"] == "user_turn" and e["state"] == "start" and e["t"] >= time.time() - (p.T - t_burst) - 0.2]
        interrupted = [e for e in p.events if e["type"] == "interrupted" and e["t"] >= t_burst]
        check("a 0.2 s burst does NOT start a turn or stop the phone's playback", not starts and not interrupted, f"turns={len(starts)} interrupted={len(interrupted)}")
        t_speech = p.T
        remaining = audible_end - t_speech
        check("the sustained speech still starts while the answer is audible", remaining > 0.4, f"{remaining:.1f} s left")
        await p.voice(word[:STEP * 9]); await p.quiet(0.5)         # 0.9 s sustained speech
        await asyncio.sleep(2.5)
        interrupted = [e for e in p.events if e["type"] == "interrupted" and e["t"] >= t_speech]
        check("0.9 s of sustained speech DOES stop the phone's playback", bool(interrupted), "no interrupted message was sent to the phone")
        if interrupted: print(f"   the phone was told to stop {round(interrupted[0]['t'] - t_speech, 2)} s after the speech began")
        tr = p.trace()
        check("the server logged that the assistant was audible when you barged in", any(e["kind"] == "user_turn" and e["state"] == "start" and e.get("audible") for e in tr))

async def one_run(new_protocol):
    pcm = tts16k("What do you see in front of me right now?")
    tail = (pcm[-STEP * 8:] if len(pcm) > STEP * 8 else pcm)              # real audio to use as the quiet tail / old-style tail
    async with Phone() as p:
        if new_protocol:
            await p.voice(pcm); t_voice_end = p.T
            await p.quiet(0.8, tail_pcm=b"\x02\x00" * (STEP * 8 // 2))   # old-style hang kept, but tagged quiet
            await p.quiet(4.0)
        else:
            await p.raw(pcm); t_voice_end = p.T
            await p.raw(b"\x02\x00" * (STEP * 8 // 2))                    # the old page's 0.8 s tail: real audio counted as voice
            await p.raw(b"", zeros=False)
            for _ in range(40): await p.ws.send(b"\x00" * STEP); await asyncio.sleep(0.1)
        await asyncio.sleep(6)
        first = next((t for t, n in p.audio), None)
        return None if first is None else first - t_voice_end

async def s3():
    print("\n=== S3: dead time after you stop talking (end of voice -> first speech), 4 runs each")
    new, old = [], []
    for _ in range(4):
        old.append(await one_run(False)); new.append(await one_run(True))
    new, old = [x for x in new if x is not None], [x for x in old if x is not None]
    print(f"   old protocol (tail counted as voice): {[round(x, 1) for x in old]}  median {st.median(old):.2f} s")
    print(f"   new protocol (tail tagged quiet)    : {[round(x, 1) for x in new]}  median {st.median(new):.2f} s")
    check("the new protocol answers sooner (median)", st.median(new) < st.median(old), f"{st.median(new):.2f} vs {st.median(old):.2f}")
    print(f"   saving at the median: {st.median(old) - st.median(new):.2f} s")

async def main():
    only = sys.argv[1:] or ["s1", "s2", "s3"]
    for name in only:
        await {"s1": s1, "s2": s2, "s3": s3}[name]()
    print(f"\n{sum(results)}/{len(results)} checks passed")
asyncio.run(main())
