# Tests

No test framework needed. Run from the `app/` folder.

**Offline, instant:**
```bash
uv run python tests/test_watch_policy.py   # alert policy: when the app is allowed to speak (26 checks)
uv run python tests/test_isolation.py      # several connections never share data (22 checks)
uv run python tests/test_turns.py          # turn-taking: wait floor, tail, barge-in debounce (23 checks)
uv run python tests/test_fast_warnings.py   # confident single sightings, phone-sensor rules, phrase bank, thinking fallback (46 checks)
node tests/test_looming.js                 # on-device approaching-object logic and phone motion (42 checks)
node tests/test_micgate.js                 # the page's microphone gate (12 checks; Node is needed only for this test)
uv run python tests/test_attention.py      # adaptive camera rate and frame selection (31 checks)
```

**Against a running server with a real Gemini key** (they create synthetic speech and drawn camera frames):
```bash
uv run uvicorn server.main:app --port 8000      # in another terminal
PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/multi_connections.py      # 4 phones at once
PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/alert_during_story.py 18  # a car appears mid-story
PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/fast_warnings.py          # on-device alerts, instant voice, pan gate (start a FRESH server first: it checks the voice bank warming)
PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/watcher_speed.py          # watcher cadence: still scene skipped, hazard after it still caught
PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/turn_taking.py            # pauses, barge-in, dead time
PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/adaptive_rate.py 8000   # growing car; compare against a fixed-rate server on 8001
EYES_MAX_CONNECTIONS=2 uv run uvicorn server.main:app --port 8001                              # then:
uv run --with websockets python tests/e2e/connection_cap.py
```
