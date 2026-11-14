# Tests

No test framework needed. Run from the `app/` folder.

**Offline, instant:**
```bash
uv run python tests/test_watch_policy.py   # alert policy: when the app is allowed to speak (26 checks)
uv run python tests/test_isolation.py      # several connections never share data (22 checks)
```

**Against a running server with a real Gemini key** (they create synthetic speech and drawn camera frames):
```bash
uv run uvicorn server.main:app --port 8000      # in another terminal
PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/multi_connections.py      # 4 phones at once
PYTHONPATH=. uv run --with pillow --with websockets python tests/e2e/alert_during_story.py 18  # a car appears mid-story
EYES_MAX_CONNECTIONS=2 uv run uvicorn server.main:app --port 8001                              # then:
uv run --with websockets python tests/e2e/connection_cap.py
```
