"""Watcher with separate frames vs one composite of 5, real Gemini key. Usage: PYTHONPATH=. uv run python tests/e2e/compose_bench.py"""
import asyncio, sys, time, statistics
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from frames import base, car, jpeg
from server import config, watch

def mk(scale):
    im, d = base()
    if scale: car(d, scale)
    return jpeg(im)
EMPTY = [(time.time() - 4 + i, mk(0)) for i in range(5)]
CAR = [(time.time() - 4 + i, mk(0.1 + 0.2 * i)) for i in range(5)]

async def run(label, compose, n, frames):
    config.WATCH_COMPOSE = compose
    lat, toks, notes = [], [], []
    for _ in range(4):
        t = time.time()
        d, info = await watch.judge(frames[-n:], [], "English")
        lat.append(time.time() - t); toks.append(info["prompt_tokens"]); notes.append(d.notify)
    print(f"{label:22s} median {statistics.median(lat):.2f}s  prompt_tokens {toks[-1]}  notify={notes}")

async def main():
    for name, fr in (("EMPTY road", EMPTY), ("CAR approaching", CAR)):
        print("==", name)
        await run("2 separate frames", False, 2, fr)
        await run("5 separate frames", False, 5, fr)
        await run("5 composed in 1", True, 5, fr)
asyncio.run(main())
