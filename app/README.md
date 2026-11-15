# VoxEye (`app/`)

Real-time camera, voice, and spatial safety assistant for blind and low-vision users (English & Greek). Built with FastAPI (`uvicorn server.main:app`) and a zero-build WebSocket + WebAudio/WebGPU mobile web client.

---

## Codebase Structure

`app/server/` is organized by functional scope around a centralized core router (`server/core/router.py`):

```mermaid
flowchart LR
    subgraph Client["Mobile Client (app/static/ + android/)"]
        UI["index.html + app.js · landing.html"]
        MG["app.js push-to-talk (mic closed unless the button is held)"]
        DW["native_depth.js (ARCore) / xr_depth.js / depth_engine.js (WebGPU) / laptop ONNX -> spatial_sonar.js"]
        LM["looming.js (IMU, Compass, Depth Calibration & Sonar)"]
    end

    Entry["server/main.py (FastAPI + /live WS)"]

    subgraph Core["server/core/ (Centralized Logic)"]
        LIVE["live.py (WS Session Lifecycle)"]
        RTR["router.py (Command, Memory & Depth Routing)"]
        ST["state.py (Per-Connection State)"]
        MEM["memory.py (Explicit Goal & Notes)"]
    end

    subgraph Assistant["server/assistant/ (Voice Q&A)"]
        INFO["info_pipeline.py (Clause Stream & Resume)"]
        TRN["turns.py (Turn & Barge-In Tracker)"]
        TLS["tools.py + agent.py + live_bridge.py"]
    end

    subgraph Safety["server/safety/ (Background Speech)"]
        ALT["alerts.py (Compass Cues · Arrival Notices)"]
    end

    subgraph Depth["server/depth/"]
        LDP["local_depth.py (Laptop ONNX Depth V2)"]
        CPR["center_probe.py (Gemini Metric Anchor)"]
    end

    subgraph Audio["server/audio/"]
        SPK["speak.py + fal.py (Streaming PCM TTS)"]
        PHR["phrases.py (EN/EL Standard Codes)"]
    end

    subgraph Utils["server/utils/"]
        UTL["config.py · trace.py"]
    end

    UI <-->|"PCM16 + JPEG + JSON"| Entry
    Entry --> LIVE --> RTR
    RTR --> ST
    RTR --> MEM
    RTR --> INFO
    RTR --> ALT
    RTR --> LDP
    INFO --> SPK
    INFO --> PHR
    ALT --> INFO
    ALT --> SPK
    RTR --> CPR
    Core --> UTL
    Safety --> UTL
```

| Folder | Scope & Responsibility |
| :--- | :--- |
| `server/core/` | **Centralized brain**: `router.py` (user command/answer/memory classification + GPS / IMU / sonar depth routing + push-to-talk turns), `state.py` (isolated session state), `memory.py` (persisted explicit goals/notes), `live.py` (`/live` WebSocket loop). |
| `server/assistant/` | **Interactive voice pipeline**: `turns.py` (legacy voice-activity turns; push-to-talk turns are explicit `ptt_start`/`ptt_end`), `info_pipeline.py` (multimodal Gemini streaming, guaranteed reply fallback), `tools.py` (places & demo call tools). |
| `server/safety/` | **Background speech**: `alerts.py` (compass guidance cues toward the target bearing, arrival notices, shared `spawn` task helper). |
| `server/geo/` | **Places & GPS (tour guide)**: `providers.py` (Google Places API New + Geocoding + Routes walking with per-request OpenStreetMap fallback; uses `GOOGLE_MAPS_API_KEY`, or `GEMINI_API_KEY` when it is a standard `AIza…` Cloud key), `service.py` (GPS + compass -> distance, steps, "40 degrees to your right", place guidance that re-aims as you walk), `geo_math.py`. Exposed to the model by `assistant/geo_tools.py`. |
| `server/depth/` | **Server depth inference**: `local_depth.py` (Depth-Anything-V2-Small via ONNX Runtime for phones without fast WebGPU), `center_probe.py` (Gemini center-crop metric anchor for calibration). |
| `server/audio/` | **Speech synthesis & standard vocabulary**: `speak.py` & `fal.py` (24 kHz PCM TTS streaming + pre-warmed phrase cache), `phrases.py` (English/Greek compass cues + lookup filler). |
| `server/utils/` | **Shared utilities**: `config.py` (env thresholds), `trace.py` (`/panel` telemetry). |
| `static/` | **Browser & Android client**: `landing.html` (`/` landing page & playground), `index.html` + `app.js` (`/app` live assistant: WS auto-reconnect, camera, audio player, GPS, push-to-talk, always-on sonar), `spatial_sonar.js` + `depth_view.js` (3-sector stereo earphone sonar & HUD), `native_depth.js` (Android ARCore Depth API bridge), `xr_depth.js` (WebXR depth), `depth_engine.js` + `depth_worker.js` (WebGPU depth model fallback), `looming.js` (IMU, compass, depth calibration). |

---

## Centralized System Flow

```mermaid
flowchart TD
    subgraph VoiceFlow["1. Voice Command, Memory & Answer Pipeline"]
        Mic["User holds the button and speaks (EN / EL)"] --> Gate["push-to-talk: ptt_start / audio / ptt_end"]
        Gate --> LLM["info_pipeline.py (Audio + Frame)"]
        LLM --> CmdDec["core/router.py: decide_user_command()"]
        CmdDec -->|"intent = ignore"| Ign["Drop Background Noise"]
        CmdDec -->|"keep_memory = True"| SaveMem["memory.py: Save Explicit Goal / Note"]
        CmdDec -->|"action = lang / compass"| SysAct["Apply Language or Compass Target"]
        CmdDec -->|"should_answer = True"| SpeakAns["Clause-Stream TTS (+ Fallback Guarantee)"]
    end

    subgraph SonarFlow["2. Always-on Stereo Depth Sonar"]
        Feed["Depth model ~4-5 fps (phone WebGPU or laptop ONNX), metres re-anchored ~3 s"] --> Split["LEFT / CENTER / RIGHT nearest surface"]
        Split --> Stereo["spatial_sonar.js: per-ear beeps (closer = louder + faster), paused while the user talks"]
    end
```

### Minimal Flow Summary
1. **Voice Command & Memory Decision (`core/router.py` -> `assistant/info_pipeline.py`)**: Every spoken turn is transcribed in English or Greek and evaluated by `decide_user_command()`. Routine questions (`keep_memory=False`) never pollute memory; explicit goals/notes/clears (`keep_memory=True`) update `UserMemory` and broadcast to the UI; every valid question or command has `should_answer=True` so VoxEye always replies aloud (using deterministic fallback confirmation if the model omits `REPLY:`).
2. **Stereo Depth Sonar (`static/spatial_sonar.js`)**: The danger feedback is earphone beeps only (no braking, no spoken stops). While the assistant runs, the sonar is always on, fed by the depth model (~5 fps phone WebGPU when fast, otherwise ~4 fps laptop ONNX, metres re-anchored every ~3 s); it pauses while the user talks, ducks while VoxEye speaks, drops readings older than 1.5 s, and is toggled by the "sonar" button (`?sonar=0`). The view band is split into LEFT / CENTER / RIGHT and the nearest surface in each becomes earphone beeps in that ear: closer = louder and faster, strictly per ear (left only in the left ear, right only in the right ear, center in both; no bleed), parametric pitch per ear: each ear has its own base pitch, shifted per side, with a center split and a rise as surfaces get closer; all tunable from the **sonar settings** panel on the page: per ear pitch, max volume and max beep rate, plus the shared range limit, side offset, center split and closer-pitch rise (live, saved on the device, with test-left/center/right beeps and reset; URL overrides `?pitchL= ?pitchR= ?volL= ?volR= ?rateL= ?rateR= ?range=`). UX limits: silent beyond 2.5 m, at most two sectors at once (only those within 0.8 m of the closest), no overlapping beeps, capped volume behind a limiter.

---

## User Stories

- **US-1 · Ask & Always Get a Spoken Answer**: *As a blind user, when I ask "What is in front of me?" or "Τι γράφει η πινακίδα;", VoxEye answers aloud within ~1 second using clock positions and step counts, without saving routine questions to memory.*
- **US-1b · Talk Over It Anytime**: *Whenever I start speaking, VoxEye stops whatever it is saying or doing (answer, thinking, compass cue or notice) instantly on the phone and on the server, and listens to me.*
- **US-1c · Tour Guide & Places**: *When I ask "Ξενάγησέ με στην περιοχή", "Is there a pharmacy nearby?" or "Take me to the Acropolis Museum", VoxEye uses my phone GPS + compass and Google Places (or OpenStreetMap) to tell me where I am and what is around, with exact steps and directions relative to where I face, and can aim compass guidance at a place until I arrive.*
- **US-2 · Explicit Goal & Note Memory**: *As a user navigating an unfamiliar space, when I say "I'm looking for the pharmacy" or "Remember my bag is by the couch", VoxEye decides `keep_memory=True`, persists the goal/note across reconnects, confirms aloud, and prioritizes that goal in subsequent answers and obstacle detours.*
- **US-3 · Exact Compass Answers**: *When I ask "Πόσες μοίρες κοιτάω;" VoxEye answers straight from the phone compass ("Κοιτάς 203 μοίρες, νοτιοδυτικά. Ο στόχος σου, νότια, είναι αριστερά σου, 23 μοίρες."), never a model guess.*
- **US-4 · Hands-Free System Control**: *As a user in a loud venue, when I say "Forget everything", or "Μίλα ελληνικά", VoxEye applies the setting immediately and speaks a short confirmation.*
- **Depth view**: the main button's background shows the depth image the sonar inspects (`static/depth_view.js`, near = bright/warm, far = dark), the two dashed lines that split it into LEFT EAR / BOTH EARS / RIGHT EAR, the inspected band (ignored floor/ceiling dimmed), each part's distance, and an outline on the parts beeping right now. Thumbnails come from the phone model (64×64) or laptop ONNX (48×48).
- **Stereo after the mic**: on Android, opening the mic switches running AudioContexts to mono call audio (often left channel only) and they stay that way, so the sonar and test beeps use their own AudioContext that is recreated ~0.4 s after every mic close (start's permission check, each push-to-talk, stop); speech and talk earcons stay on the main context.
- **Push-to-talk**: hold the main button (or Space on a laptop) to talk, release to send: the answer starts right away with no silence timeout, pressing again cuts whatever VoxEye is saying, a short tap starts / stops the assistant, and two soft earcons mark mic open / mic closed. The mic is closed the rest of the time, so the earphones stay in stereo.
- **Stereo needs media audio (verified over ADB on a realme C55 + REDMI Buds 8 Pro)**: on Android, Chrome's "default" mic *is* the Bluetooth headset when one is connected; opening it pins Chrome's call route to the Buds' SCO link (mono, 8–16 kHz) and it stays pinned after the mic closes, so all audio loses stereo. In "audio: earphones (stereo)" mode VoxEye therefore always opens the phone's built-in mic explicitly (never "default"/Bluetooth, language-independent), and briefly opens it at start to release a stuck call link. "audio: speaker" keeps echo cancellation for use without earphones.
- **US-5 · Stereo Depth Sonar**: *As a user wearing earphones, while VoxEye runs I hear where the nearest surfaces are: a wall on my right beeps in my right ear, getting louder and faster as I get closer, from the phone or laptop depth model.*

---

## Quickstart

```bash
# Configure environment
cp app/.env.example app/.env

# Run server (from repo root or app/)
./restart_server.sh
# Or directly:
cd app && uv run uvicorn server.main:app --host 0.0.0.0 --port 8000

# Or via Docker:
cd app && docker build -t voxeye . && docker run --rm -p 8000:8000 --env-file .env voxeye
```

- **Landing Page & Sonar Playground**: `http://localhost:8000/`
- **Live Phone WebApp**: `http://localhost:8000/app` (use `adb reverse tcp:8000 tcp:8000` over USB or an HTTPS tunnel for mobile mic/camera/GPS)
- **Signed Android APK**: `http://localhost:8000/voxeye.apk` (native ARCore depth source live in `../android/`)
- **Live Judges' Trace Panel**: `http://localhost:8000/panel`
