# Eyes: full characteristics of the app

Status as of 2026-11-14. Code lives in `app/`. This file describes what the app is and does today, what was tested, and what is not done. For the earlier idea and decision notes see [eyes-app.md](eyes-app.md).

## 1. Purpose

**Eyes** is a voice and camera assistant for blind and low-vision people. The user points a phone camera at the world and talks; the app answers out loud. It is built as an agent, not a captioner: it describes, finds, reads, guides and can take actions with tools, and it stays quiet when it has nothing useful to say.

- **User:** a blind or low-vision person using a phone (a smartphone on a lanyard or held in hand).
- **Job:** understand what is in front of them and get things done without sight (read a letter, a label or a sign; find something; get a direction; make a call).
- **Track fit:** Open track (hardware bonus: the phone is the sensor), also touches Voice & Enterprise (voice agent).
- **Hackathon rules it follows:** one user, one job, one wow moment; show the work (trace and debug); real data; demo first.

## 2. What the user experiences

1. Open the web address on the phone and tap the big button once.
2. The phone asks for camera and microphone permission. A chime plays when the assistant is ready.
3. The user talks naturally ("what is in front of me?", "read this", "call the pharmacy and ask for aspirin"). No wake word and no button hold.
4. The assistant answers in a natural voice, in one or two short sentences, usually within about 1.5 to 2 seconds of the user finishing.
5. The user can interrupt at any time by talking; the assistant stops mid-sentence and listens.
6. Tapping the button again stops everything (camera, mic, connection) and plays a lower chime.

### Behaviour rules built into the assistant
- Speaks warmly, one or two short sentences, no lists or markdown.
- Gives directions with clock positions and rough distances ("door at 2 o'clock, about 3 steps").
- Puts warnings first (steps, obstacles, traffic, hot or sharp things), then the answer.
- Reads text exactly as written when asked to read; explains bills and letters in plain language.
- When the picture is blurry, dark, cut off or uncertain, it says so and says what to do (move closer, add light, hold still). It never guesses.
- Never says a road or crossing is safe. It supports a cane or guide dog and does not replace them.
- Replies in the language the user speaks (Greek or English).
- Uses tools only when appropriate; if a tool result says it was simulated, it tells the user it was a demo.

## 3. Architecture

```
Phone browser (static page)                         Server (FastAPI, Python)                 Google
-----------------------------                       ---------------------------              ------------------
camera frame (JPEG, 1 per s)  --JSON over WS-->     /live  WebSocket bridge  --Live API-->   Gemini Live model
mic audio (PCM16 16 kHz)      --binary over WS-->   live.py                  (v1beta)         (native audio)
speech out (PCM16 24 kHz)     <--binary over WS--   tool execution (tools.py)
events (heard, reply, ...)    <--JSON over WS--     trace log (/trace, /panel)
```

- **Transport:** one WebSocket per session at `/live`. Binary frames carry audio, JSON text frames carry camera frames and events.
- **Voice activity control** is done by the server (manual activity signals to Gemini), driven by the browser's noise gate. See section 6.
- **Proactive safety watcher** (section 5b) looks at the camera by itself and can interrupt the assistant with a short spoken alert.
- **Hosting:** uvicorn on port 8000. For phone use the camera and microphone need HTTPS, so a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:8000`) is used. Tunnel addresses are public to anyone with the link and change each run.
- **No Node, no build step, no database.** Everything is Python plus plain HTML and JavaScript.

## 4. Models and endpoints (verified with the project key on 2026-11-14)

| Role | Model | Notes |
|---|---|---|
| Realtime voice (main) | `gemini-2.5-flash-native-audio-latest` | Live API, `v1beta` endpoint. Hears, sees, calls tools, speaks. |
| Text and vision path (older, kept for tests) | `gemini-3.5-flash-lite` | About 1.5 s per answer. `/ws` and `server/agent.py`. |
| Larger model (reserved, not wired in) | `gemini-3.8-flash` | About 2.7 to 3.3 s. Planned for hard reading. |
| TTS models found (not used now) | `gemini-3.8-flash-lite-tts` (about 1.7 to 2.2 s), `gemini-3.8-flash-tts`, `gemini-2.5-flash-preview-tts`, `gemini-3.1-flash-tts-preview` | Only on `v1beta`. |

- `gemini-2.5-flash` is retired for new keys (404 error), which caused the first failure.
- The Live and TTS models exist only on the `v1beta` endpoint. The default `v1` endpoint rejects the speech settings.
- Gemini API keys come from AI Studio for the `@gcplab.me` project assigned by the organisers.

## 5. Client features (`app/static/`)

### 5.1 Audio in (microphone)
- Captured with `getUserMedia` with echo cancellation, noise suppression and auto gain on, mono.
- Converted in the browser to PCM16 mono at 16 kHz (linear-interpolation downsampling) and streamed in chunks of 4096 samples (about 85 ms at 48 kHz) using a `ScriptProcessor`.
- **Noise gate and voice tagging** (`static/micgate.js`):
  - Audio below the gate level is not treated as speech; zeros are sent in its place so the server keeps a steady clock. Default level 0.030 (RMS, 0 to 1), range 0.005 to 0.300, adjustable with **gate −/+**, `?gate=0.05`, remembered.
  - **A turn opens only after about 250 ms of sustained sound** above the gate (one quiet chunk in the middle is tolerated, since speech dips between syllables). Clicks, coughs and noise bursts are ignored. The chunk just before the voice began is included, so word starts are not clipped.
  - **While the assistant is speaking the gate is 2.5 times higher**, so only clearly louder speech can cut it off (its own echo no longer does).
  - **Every audio message carries a 1-byte tag:** 1 = voice, 0 = quiet. After your voice stops the page keeps sending 500 ms of real audio so word endings are not cut, but tags it quiet. The server therefore measures your pause from the true end of your voice and the tail adds no dead time (older pages that send raw audio still work; for them any sound counts as voice).
- **Wait after you stop talking:** default 900 ms, minimum 700 ms (the buttons stop there, `?silence=300` is raised to 700, and the server enforces it too). It is stored under a new key, so the 300 ms that was saved in an earlier version is ignored. Short utterances (under 1 s of voice) get 0.4 s more patience, because people pause after the first words.

### 5.2 Camera in
- Rear camera (`facingMode: environment`).
- One JPEG frame per second by default (2.5 or 4 per second when the server asks for a closer look, see section 5b), scaled to 640 px wide, quality 0.6, sent as base64 JSON.
- Requests a screen wake lock while running so the phone does not sleep.

### 5.3 Audio out (speech)
- Receives PCM16 mono at 24 kHz chunks and plays them through Web Audio, scheduled back to back for gapless playback.
- On an "interrupted" event the queue is stopped immediately.
- The audio context is created inside the first tap, which phones require to allow audio.
- Short chimes: ready (880 Hz), stop (440 Hz), error (330 Hz).

### 5.4 Interface
- **Branding (VoxEye):** the logo's shield-and-aperture mark sits at the left of the header, which uses the logo's own navy (`#1f1c2f`); the tab title is "VoxEye". Favicon (`/favicon.ico` with 16, 32 and 48 px, plus a 192 px PNG) and the iOS home-screen icon (`/apple-touch-icon.png`) are cropped from `context/VoxEye_logo.png` (original kept, 5 MB; the app only loads files of about 8 to 46 KB from `app/static/`). The browser's theme colour matches the logo navy. The trace page uses the same icon.
- One full-screen button (start and stop), large target, high contrast; blue idle, green running, red on error.
- A status line at the top with a coloured **state badge** and a short sentence.
- Marked up for assistive technology: button has a label and pressed state; transcripts and debug text are hidden from screen readers so they do not talk over the app.
- Works as a plain web page; no install.

### 5.5 On-screen state and debug panel
States shown by the badge: `idle`, `starting`, `connecting`, `listening`, `hearing`, `thinking`, `speaking`, `error`. They follow the real audio flow (hearing when the mic is above the gate; thinking after speech until audio returns; speaking while model audio plays).

The debug panel (add `?debug=0` to hide) shows:
- state and time running;
- camera status (or the exact permission error such as `blocked (NotAllowedError)`) and frames sent;
- microphone status, KB sent, a live level meter, current and peak level, the gate value and whether the app is sending your voice or silence;
- audio context state;
- WebSocket state and close code;
- Gemini session status;
- KB received, chunks received, and how long ago model audio last arrived;
- last thing heard, last reply, last event, and the last error;
- a rolling log of the last 14 timestamped steps.

## 5b. Proactive safety alerts (the app speaks without being asked)

The assistant does not only answer. Every ~2 seconds a separate AI **watcher** looks at the **last 3 camera frames** (about 3 seconds, oldest to newest, so it can see motion) and **decides whether the user needs to be told something**. Silence is the normal answer.

### What the AI watcher is told
- Interrupt only for a real, current danger the user probably does not know about: something in or next to their path they are about to reach (steps, curb, drop-off, pole, wall, glass door, parked vehicle, low branch, open door, wet floor), something that gets **closer or bigger across the frames** (vehicle, bike, scooter, person on a collision course, animal), a hot or sharp object in reach, or a clear threat.
- Never interrupt for ordinary scenery, distant or side objects not coming toward them, static things not in their path, things already announced recently, blurry or dark frames, or vague unease. If unsure, stay silent: a false alarm is worse than missing a minor detail.
- Output (structured JSON): `notify`, `urgency` (`low` or `high`; high only if impact or a fall is likely within about 3 seconds), `confidence`, a stable `hazard_key` (for example `car-right`, `step-down`), a `message` of at most 8 words with direction or distance, and a one-line `reason`.
- It is shown the alerts it already made in the last minutes so it does not repeat them unless things got clearly worse. The message is written in the language the user last spoke (Greek or English).

### The policy that makes it hard to speak (`server/watch.py`, 26 automated checks)
The AI's wish to speak only passes if all of these allow it:
| Gate | Default |
|---|---|
| Alert mode is not `off`; in `urgent_only` only high urgency passes | `normal` |
| Confidence at least | 0.75 (low urgency), 0.60 (high urgency) |
| Low urgency must be seen on **two checks in a row** (confirmation) | high urgency fires at once |
| Same hazard not repeated within | 25 s, unless it escalated from low to high; keys are compared loosely (car, vehicle and truck count as the same kind of object) |
| Gap between alerts | 6 s (low), 1.5 s (high) |
| Rate limit per minute | 6 (low), 12 (high) |
| Not while the user is talking (low urgency); danger still gets through | |

Settings are environment variables (`EYES_ALERT_*`, `EYES_WATCH_S`).

### What happens when an alert fires
1. The page is told immediately: whatever was playing **stops at once**, a short beep plays (one tone for low, two for high urgency) and the phone vibrates.
2. If the assistant was speaking, the server interrupts it with a manual activity signal (a plain message does not interrupt) and throws away its audio that is still in flight. The interrupt turn is left open so the assistant does not resume or answer the old request until the user speaks.
3. The alert is spoken by a **text-to-speech model** in the same voice: exact words, never an instruction read aloud. Spoken alerts are cached, and when an alert is one confirmation away from firing the voice is prepared in advance, so repeats play instantly.
4. The assistant gets a silent note of what was said, so "what was that?" works.
Typical timing in tests: about 2 s from the hazard appearing to the alert decision, then about 2 to 3 s until the words are heard (the beep and the cut come first).

### Adaptive attention: images and looks speed up when the AI wants a closer look
The camera normally sends **1 image per second** and the watcher looks about **every 2 seconds**. The watcher model also says how closely to watch (`attention`), and the rates follow:

| Attention | When (the model decides) | Camera images | Watcher looks | Frames shown to the watcher |
|---|---|---|---|---|
| `normal` | nothing relevant is happening | 1 per second | every 2.0 s | 3 frames about 1.0 s apart |
| `elevated` | something could become a danger soon (object or person moving toward the user, road or crossing nearby, stairs or a drop coming, a crowded or fast-changing scene, or the model is unsure) | 2.5 per second | every 1.2 s | 3 frames about 0.7 s apart |
| `high` | a warning is justified now or expected within a couple of seconds | 4 per second | every 0.8 s (in practice about every 1.2 s, the time one look takes) | 3 frames about 0.5 s apart |

- **Rises at once, falls gradually.** The level goes up the moment it is asked for. It only steps down one level at a time, after a hold (5 s at elevated, 8 s at high) with no further need, so it does not flap.
- **Our own signals also raise it:** an alert that just fired sets `high`; a suspected hazard that is being held back (waiting for confirmation, low confidence, cooldown) sets at least `elevated`.
- **Cost guard:** more than 30 s continuously above normal forces it back to normal for 12 s (only a real alert can break through). Settings: `EYES_ATTENTION_MAX_S`, `EYES_ATTENTION_COOLDOWN_S`.
- **The Live (voice) model still gets about 1 image per second**; only the watcher uses the extra frames, so the voice session does not cost more. The server keeps the last ~10 s of frames and picks 3 well-separated ones.
- **The page** is told the new rate (`rate` message) and changes its timer; the debug panel shows the rate set, the measured rate, and the attention level.
- Settings: `EYES_FPS_NORMAL/ELEVATED/HIGH` (1, 2.5, 4), `EYES_LOOK_ELEVATED_S` (1.2), `EYES_LOOK_HIGH_S` (0.8).
- **Measured (honest):** in three side-by-side runs on a synthetic growing car, the adaptive server sent 56 to 66 images against 24 and made 13 to 15 looks against 10 to 11, so it does work as built. But it did **not** detect the car earlier (alert 4.1, 3.7, 4.1 s after the car appeared, against 2.4, 3.7, 4.3 s for a fixed 1 fps server). The reason: the model went from `normal` straight to `high` in a single look, with no `elevated` step first, so the extra images were used only after the warning. Faster looks are also limited by the time one look takes (about 1.2 s). Extra images help most when the model notices something developing before it is certain; that did not happen in this synthetic test. A cheap non-AI trigger (for example, a sudden change between frames) could raise the rate earlier; it is not built.
- Cost while raised: a look is about 3,800 tokens, so about 190,000 tokens a minute at elevated and about 285,000 at high, for at most 30 s at a time.

### User control
- Button on the page cycles **alerts: normal / urgent only / off** (remembered). The user can also say "only warn me about serious things" or "be quiet" (tool `set_alert_mode`).
- `/panel` and the debug panel show every check (silent, held back with the reason, or ALERT) with confidence, key and time.

## 5b-3. Speed-ups from master's plan v3 (branch `fast-warnings`)
Details and measurements: [fast-warnings-evaluation.md](fast-warnings-evaluation.md) sections 8 to 11.
- **Voice model is now `gemini-3.8-live`** (`GEMINI_LIVE_MODEL`): median 0.84 s to first speech in the benchmark against 2.45 s for `gemini-2.5-flash-native-audio-latest`, which stays as the automatic fallback (`GEMINI_LIVE_FALLBACK_MODEL`). Answers are shorter; the model is chosen once per server run (trace event `live_model`).
- **Audible tracking:** the server estimates how long the phone will keep playing the speech it has sent (the new model sends it much faster than real time). Barge-in debounce uses it, and if you talk over an answer the phone is told to stop it.
- **Watcher:** shown 2 frames (about 1 s apart), looks every 1.0 s (0.8 s elevated, 0.6 s high); camera 2 frames per second normally; confident single sighting at 0.85.
- **Static-scene skip:** the page sends a 16x16 greyscale motion score with each frame; looks are skipped while the picture is still (at least one every 4 s, never while attention is raised).
- **Frames:** 512 px normally, 640 px for the fresh frame at speech start. The server announces the starting camera rate at connect.
- **Phrase bank:** 48 phrases (English and Greek); 15 of 15 watcher alerts in a test used an exact pre-made phrase.
- **On-device detector is opt-in:** add `?ondevice=1` to the address.

## 5b-2. Fast warnings (branch `fast-warnings`; not on master yet)
See [fast-warnings-evaluation.md](fast-warnings-evaluation.md) for the evaluation of the plan and the full results. Summary:
- **On-device detector:** the phone runs a MediaPipe object detector and measures how fast things in the walking path grow (median-based growth, 350 ms sustain, at most one alert per 4 s). An approaching vehicle, bike or person is warned about with no network and no cloud model; the server still applies its cooldown, de-duplication and rate limit.
- **Phone motion sensors:** gyro and accelerometer. A camera swinging faster than 65 deg/s pauses the on-device alerts and the watcher's looks; a user known to be standing still is not told about fixed obstacles (urgent hazards are never held back); unknown movement is never treated as standing still.
- **Instant voice:** 30 common alert phrases (English and Greek) are made once in the background and the watcher is told to reuse them, so most alerts play instantly; an urgent alert whose voice is not ready is spoken by the phone at once while the better voice is made for next time.
- **Confident single sighting:** a low-urgency hazard at confidence 0.88 or more (0.80 while walking) is announced on the first look.
- **Fresh frame at speech start** goes to the voice model immediately; **echo guard** raises the gate for 1.8 s after an alert; the watcher uses `thinking_level=LOW` (the plan's `thinking_budget=0` is rejected by the model).
- **Tests:** 187 offline checks, a real-browser detector run, a 17-check server run, and the older end-to-end suites as regression. Not tested on a phone.

## 5c. Several people at once (multiple connections)

Many phones can use one server at the same time without affecting each other. Each connection gets its own Gemini Live session, its own state and its own id (6 characters, shown on the phone's debug panel and in every trace event).

| What | How it is kept apart |
|---|---|
| Remembered places | Per connection (a context variable set at the start of each connection). Before this fix it was one shared dictionary, so one user's places were visible to everyone. Places live in RAM only and disappear when that connection closes. |
| Camera frames, alert policy, alert history, alert mode, "user is talking" flags, language | Per connection (`State` object; no shared mutable defaults). One person's alert cooldown or mode never affects another. |
| Voice (Live session) and noise gate | One Live session per connection; the gate and wait settings live in each browser. |
| Trace | One shared ring buffer (last 1000 events), but every event carries `conn`. `/trace?conn=<id>` and `/panel?conn=<id>` (click an id) show one connection. |
| Alert voice cache | Shared on purpose: it maps alert text to audio only, so identical alerts share one TTS call. Failed calls are not cached. |
| Gemini clients | Shared (safe to use concurrently). |

**Protecting the quota.** Limits apply across all connections: at most `EYES_MAX_CONNECTIONS` (10) open connections; further ones are told "The assistant is busy right now. Please try again in a minute." and closed. At most `EYES_MAX_PARALLEL_CALLS` (6) watcher and alert-voice model calls run at once; a watcher look that finds all slots busy is skipped (never queued), because the next look has a fresher frame. Remember each connection costs about 100,000 tokens a minute for the watcher alone, so ten phones is about a million tokens a minute.

**Tested:** 22 offline isolation checks (memory, trace tags, state objects, TTS cache sharing and failure) and a live test with 4 phones at once against the real API (12 checks): a car alert reached only the phone that saw the car; one phone saved "blue door" by voice and recalled it while another phone, calling the same tool at the same time, was told it had nothing saved; every watcher kept running; no errors; each connection's trace filtered cleanly. Connection cap: 3rd connection rejected with "busy", a freed slot accepted a new one (5 checks).

**Not tested / limits:** more than 4 simultaneous real sessions; whether Google limits concurrent Live sessions per key (unknown, the cap is a guess); one uvicorn process only (several workers would each count their own connections); no login, so anyone with the link can connect until the cap is reached.

## 6. Server features (`app/server/`)

| File | Role |
|---|---|
| `main.py` | FastAPI app. Routes: `/` (page), `/panel` (judges' trace screen), `/trace` (JSON events), `/live` (WebSocket for voice), `/ws` (older text path), `/static/*`. |
| `live.py` | The Gemini Live bridge. Opens one Live session per browser connection, forwards audio and frames, controls voice activity, streams speech back, runs tools, runs the watcher loop and the alert interrupt, logs everything. |
| `watch.py` | The AI watcher (prompt, structured decision) and the alert policy. |
| `speak.py` | Text-to-speech for alerts, with a cache. |
| `agent.py` | The older turn-based path (text plus one frame through `generate_content`), with per-connection history, a silence token and error handling. Kept for tests and as a fallback design. |
| `tools.py` | The agent's tools (section 8). |
| `config.py` | Loads `.env` without extra libraries (real environment variables win) and defines models, voice, and the key. |
| `trace.py` | In-memory ring buffer of the last 200 events, also printed as JSON lines. |

### Live session settings (`live.py`)
- Response modality: audio. Voice: `Kore` by default (`GEMINI_VOICE`; others: Aoede, Puck, Charon, Fenrir, Leda, Zephyr).
- Input and output **transcription on**, which gives text for the trace and debug panel.
- **Voice activity is controlled by the server, not by Gemini** (automatic detection is off); the logic is in `server/turns.py` (`TurnTracker`, 23 unit checks). It sends "you started" to Gemini at the first voice chunk and "you stopped" after the wait: `EYES_SILENCE_MS` (default 900), or `?silence=<ms>` from the page, clamped 700 to 4000, counted from the last chunk tagged voice. Rules: the wait never goes below 700 ms; a short utterance waits 0.4 s longer; **while the assistant is speaking, 0.45 s of sustained voice is needed to cut it off** (a short burst is ignored even if the page let it through); after an alert the interrupt turn stays open until you really speak. A longer wait avoids cutting in on pauses but delays the answer by about the same amount. Manual control is also what lets an alert force an interrupt. The `user_turn end` trace event now includes `voiced_s` (seconds of voice in that turn).
- **Sliding-window context compression on**, to extend audio-plus-video sessions beyond the roughly 2-minute default.
- Barge-in (interruption) handled by the model; the server forwards an `interrupted` event and the browser stops playback.
- A `go_away` notice from the server is passed to the page.

### WebSocket protocol (`/live`)
- Browser to server: binary = PCM16 mono 16 kHz audio; JSON `{"type":"frame","data":"<base64 jpeg>"}`.
- Browser to server also sends `{"type":"mode","mode":"normal|urgent_only|off"}`.
- Server to browser: binary = PCM16 mono 24 kHz speech (model speech and spoken alerts); JSON events `ready`, `heard` (what the user said), `reply` (what the assistant said), `tool` (name and arguments), `interrupted`, `alert` (urgency and text: stop playing, beep, vibrate), `watch` (each look), `suppressed` (an alert held back, with the reason), `mode`, `speak_text` (fallback if the alert voice fails), `go_away`, `error`.

## 7. Observability (show the work)
- `/panel` live table of events (heard, tool calls, replies, errors) refreshed every second; `/trace` returns the same as JSON; add `?conn=<id>` to filter one connection.
- Events recorded: `watch` (every look: silent, held back with the reason, or ALERT, with confidence, key, ms and tokens), `alert`, `alert_spoken`, `alert_mode`, `attention` (a change of camera and look rate, with the reason), `user_turn` (start and end), `live_connect`, `first_mic_audio`, `first_frame`, `first_audio` (with latency in ms), `heard`, `reply`, `tool`, `interrupted`, `go_away`, `error`, `live_input_totals` (KB of microphone audio and frames received), `live_disconnect`. The text path also logs token counts.
- The input counters answer "did the phone's audio and camera actually reach the server?".

## 8. Tools the agent can call
All tool calls are logged and shown in the trace.
- `remember_place(name, note)`: saves a place or object the user mentions (kept in memory, lost on restart).
- `recall_places()`: lists what was saved.
- `set_alert_mode(mode)`: `normal`, `urgent_only` or `off`, by voice command.
- `call_contact(name, message)`: **demo only**. No call is placed. It returns a "simulated" result and the assistant tells the user it was a demo call.

## 9. Configuration (`app/.env`, never committed)
| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | none | AI Studio key from the hackathon Google project. Without it the app says "The model is not connected yet". |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` | Realtime voice model. |
| `GEMINI_LIVE_FALLBACK_MODEL` | `gemini-2.5-flash-native-audio-latest` | Used if the preferred model cannot be opened. |
| `EYES_WATCH_S` | `1.0` | Seconds between watcher looks at normal attention. |
| `EYES_WATCH_FRAMES` | `2` | Frames shown to the watcher. |
| `EYES_STATIC_SKIP` / `EYES_STATIC_MOTION` / `EYES_STATIC_MAX_SKIP_S` | `1` / `0.012` / `4` | Skip looks while the picture is still. |
| `GEMINI_VOICE` | `Kore` | Assistant voice. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Text and vision model for the older path. |
| `GEMINI_HARD_MODEL` | `gemini-3.8-flash` | Reserved, not used yet. |
| `EYES_SILENCE_MS` | `900` | Wait after the user stops talking before the assistant answers (ms). The page can override it per connection. |
| `GEMINI_WATCH_MODEL` | `gemini-3.5-flash-lite` | Model that decides from the last 3 frames whether to alert (about 1 to 1.4 s per look). |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-lite-tts` | Voice for spoken alerts. |
| `EYES_WATCH_S` | `2.0` | Seconds between looks. |
| `EYES_ALERT_MIN_CONF` / `_HIGH` | `0.75` / `0.6` | Confidence needed for low / high urgency. |
| `EYES_ALERT_COOLDOWN_S` / `_HIGH_S` | `6` / `1.5` | Minimum gap between alerts. |
| `EYES_ALERT_DEDUPE_S` | `25` | Same hazard is not repeated within this time. |
| `EYES_ALERT_MAX_PER_MIN` | `6` | Rate limit (double for high urgency). |
| `EYES_FPS_NORMAL` / `_ELEVATED` / `_HIGH` | `2` / `3` / `4` | Camera images per second at each attention level. |
| `EYES_LOOK_ELEVATED_S` / `_HIGH_S` | `0.8` / `0.6` | Watcher look interval at elevated and high attention. |
| `EYES_ATTENTION_MAX_S` / `_COOLDOWN_S` | `30` / `12` | Longest stretch above normal, then forced back to normal for this long. |
| `EYES_MAX_CONNECTIONS` | `10` | Open voice connections allowed at once; more are told the assistant is busy. |
| `EYES_MAX_PARALLEL_CALLS` | `6` | Watcher and alert-voice model calls running at once across all connections. |

URL options on the page: `?gate=0.05` (noise gate level), `?silence=1500` (wait after you stop talking, in ms, minimum 700) and `?debug=0` (hide debug panel). The page also has **gate −/+** and **wait −/+** buttons (wait in steps of 200 ms from 700 ms up, saved in the browser, applied the next time you tap Start).

## 10. Performance (measured)
- **Realtime voice:** in a synthetic-speech test, first speech audio arrived about 3.9 s after the end of speech with a 600 ms wait, and about 4.7 to 5.6 s with a 2000 ms wait (the wait adds roughly its own length; the rest is model and network time, which varies). An earlier test with a 500 ms wait measured 1.2 to 2.1 s after a padded end, so expect 2 to 4 s in practice; real phone latency is untested.
- **Text and vision path:** about 1 to 2 s on `gemini-3.5-flash-lite`; the bigger model about 3 to 6 s with tools.
- **TTS only:** about 1.7 to 2.8 s per short sentence (not used now).
- Camera: 1 frame per second, about 640 px wide.

## 10b. Cost of the watcher
Each look sends 3 images and costs about 3,800 input tokens. At one look every ~2 s that is roughly 100,000 tokens per minute while the session runs (plus the Live session itself). It only runs while the app is started and not in `off` mode. Raise `EYES_WATCH_S` or use `off` to reduce it. Credits are limited, so this is worth watching.

## 11. Safety, privacy and limits
- **Not a navigation safety system.** It supports a cane or guide dog. It must never claim a road is safe; this is in the prompt and was tested ("I cannot tell if the road is safe").
- **Uncertainty is spoken** instead of guessing.
- **Camera and mic are on only while the session runs**; the stop button turns both off and closes the connection.
- **Data flow:** camera frames and audio are sent to the server and on to Google's Gemini API. Nothing is stored by the app beyond the in-memory trace and the "remembered places". Do not point the camera at other people's sensitive documents without consent.
- **Secrets:** the API key lives only in the gitignored `app/.env`; the page and the client never see it.
- **Public tunnel:** anyone who has the tunnel link can use the app (and spend the key's quota) while the tunnel runs. Stop the tunnel when not testing.
- **Simulated actions are labelled:** the call tool never claims to have placed a real call.

## 12. Known limits and risks
- Not tested on a real phone yet with the Live client (camera, mic, playback, gate). The debug panel was verified in a desktop browser pane where camera and mic are blocked.
- **Alerts are decision support, not a safety guarantee.** The watcher can miss a hazard or raise a false one. It was tested on synthetic images only (an empty road stayed silent, a growing car triggered a high-urgency alert), not on real streets.
- **Echo:** speaker audio can reach the mic and make the assistant interrupt itself. The gate (raised 2.5 times while it speaks), a 450 ms sustained-voice requirement, echo cancellation and headphones or low volume mitigate this; the gate level needs tuning per phone.
- **iPhone Safari** is the strictest about audio and may need extra handling; Chrome on Android is the primary target.
- **Session length:** audio plus video sessions are normally limited to about 2 minutes; compression is enabled but long sessions are untested. Connections can drop outdoors; the page shows the close code and asks for a tap.
- **Browser audio nodes:** `ScriptProcessor` is deprecated but widely supported; a later cleanup can move to `AudioWorklet`.
- Memory of places is in RAM only and private to one connection (lost when it closes).
- Gate too high can cut quiet speech.
- Camera frames are 1 per second normally (up to 4 when the watcher asks), so very fast motion can still be missed.
- The larger "hard reading" model is configured but not used.

## 13. What was tested
- **Real Gemini calls (text path):** read text from a generated image, ran the simulated call, remember and recall, refused to call a road safe.
- **Live voice path, without a phone:** a spoken question synthesized with a TTS model and sent with a camera frame to `/live`. It was heard and transcribed, the picture was read aloud, and a spoken "call the pharmacy and ask for aspirin" triggered the demo tool. Input counters appeared in the trace.
- **Fake-model tests:** routing, history, missing frame note, model-error handling, silence token, tools, trace panel.
- **UI:** page loads, noise-gate buttons change and save the value (range 0.005 to 0.300), debug panel renders, permission failure shows the red error state with `NotAllowedError`.
- **Proactive alerts, tested without a phone:** 26 automated policy checks (silence default, confirmation, thresholds, duplicates and synonyms, escalation, cooldown, rate limit, not talking over the user, modes). AI watcher on synthetic frames: empty road and a car that does not grow stayed silent, a growing car gave high urgency with confidence 0.95 to 1.0. 30 seconds of an empty road gave 14 looks and 0 alerts. End to end: while a long story was playing a car approached; the alert stopped the story at once, was spoken about 2 to 3 s later in exact words, the story did not resume, and the follow-up "What did you just warn me about?" was answered correctly.
- **Observed once and not explained:** in two of about six story tests the model produced no answer to the long-story request until the alert arrived; normal short questions worked every time. Worth re-checking on a phone.
- **Turn-taking fixes, tested without a phone:** 23 unit checks for `server/turns.py` (wait floor, voice-versus-tail, short-utterance patience, a 0.6 s pause staying one turn, a 300 ms wait no longer splitting a sentence, barge-in needing sustained voice, hold-open after an alert, older raw clients) and 12 for the page's gate (`node tests/test_micgate.js`). Live: a 0.6 s pause inside a sentence stayed one turn and was answered even though the page asked for 300 ms; a 0.2 s burst did not cut the assistant off while 0.9 s of speech did (cut-off about 1.4 s after speech began); end of voice to first speech was a median 3.80 s with the new tagging against 4.24 s with the old tail handling (4 runs each, a 0.44 s saving, within noise). Regression: 4 simultaneous phones 12 of 12, alert cutting a story and a follow-up answered.
- **Not tested:** the new gate and tagging on a real phone, real microphone, real playback, long sessions, iPhone.

## 14. Run it
```bash
cd app
uv sync
cp .env.example .env          # then put your GEMINI_API_KEY in .env
uv run uvicorn server.main:app --host 0.0.0.0 --port 8000
cloudflared tunnel --url http://localhost:8000     # second terminal; open the printed https link on the phone
```
Open `http://localhost:8000/panel` on the PC to watch the trace. `cloudflared` was installed to `~/.local/bin` (no sudo).

## 15. Repo layout
```
app/
  pyproject.toml, uv.lock        dependencies: fastapi, uvicorn[standard], google-genai
  .env.example, .gitignore       .env is ignored
  README.md                      run notes
  server/  main.py live.py agent.py tools.py config.py trace.py
  static/  index.html app.js trace.html
project-context/
  eyes-app.md                    idea, decisions, update log
  eyes-app-characteristics.md    this file
```

## 16. Next steps
1. Test on a real Android phone and an iPhone; tune the gate and the silence setting.
2. Wire in the larger model for hard reading (small print, blurry labels) when the fast model is unsure.
3. Replace demo tools with real ones where safe (web lookup through treg; real calling only with consent and a clear label).
4. Add durable memory for places and a way to name and find them by voice.
5. Move microphone capture to `AudioWorklet`; add reconnect with session resumption.
6. Prepare the 3-minute demo: one user, one job (read a letter or medicine box, then act on it), the "unsure" case, and a cached run or video as backup.
