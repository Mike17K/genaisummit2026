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
- **Voice activity detection** is done by Gemini (with settings below), not in the browser. The browser only applies a noise gate.
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
- **Noise gate:**
  - Audio below a level threshold is replaced by silence of the same length, so room noise and speaker echo are not sent, and the server can still detect the end of a sentence.
  - Default threshold 0.030 (RMS, 0 to 1). It was 0.015 before. Range 0.005 to 0.300.
  - Hang time 450 ms after the voice drops, plus the chunk just before the voice starts is included, so word starts and ends are not clipped.
  - Adjustable live with **gate −** and **gate +** buttons (steps of 0.005), saved in the browser, or set with `?gate=0.05` in the address.

### 5.2 Camera in
- Rear camera (`facingMode: environment`).
- One JPEG frame per second, scaled to 640 px wide, quality 0.6, sent as base64 JSON.
- Requests a screen wake lock while running so the phone does not sleep.

### 5.3 Audio out (speech)
- Receives PCM16 mono at 24 kHz chunks and plays them through Web Audio, scheduled back to back for gapless playback.
- On an "interrupted" event the queue is stopped immediately.
- The audio context is created inside the first tap, which phones require to allow audio.
- Short chimes: ready (880 Hz), stop (440 Hz), error (330 Hz).

### 5.4 Interface
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

## 6. Server features (`app/server/`)

| File | Role |
|---|---|
| `main.py` | FastAPI app. Routes: `/` (page), `/panel` (judges' trace screen), `/trace` (JSON events), `/live` (WebSocket for voice), `/ws` (older text path), `/static/*`. |
| `live.py` | The Gemini Live bridge. Opens one Live session per browser connection, forwards audio and frames, streams speech back, runs tools, logs everything. |
| `agent.py` | The older turn-based path (text plus one frame through `generate_content`), with per-connection history, a silence token and error handling. Kept for tests and as a fallback design. |
| `tools.py` | The agent's tools (section 8). |
| `config.py` | Loads `.env` without extra libraries (real environment variables win) and defines models, voice, and the key. |
| `trace.py` | In-memory ring buffer of the last 200 events, also printed as JSON lines. |

### Live session settings (`live.py`)
- Response modality: audio. Voice: `Kore` by default (`GEMINI_VOICE`; others: Aoede, Puck, Charon, Fenrir, Leda, Zephyr).
- Input and output **transcription on**, which gives text for the trace and debug panel.
- **Automatic voice activity detection:** start-of-speech sensitivity high, end-of-speech sensitivity high, silence needed to end a turn 500 ms (`EYES_SILENCE_MS`). This keeps answers fast.
- **Sliding-window context compression on**, to extend audio-plus-video sessions beyond the roughly 2-minute default.
- Barge-in (interruption) handled by the model; the server forwards an `interrupted` event and the browser stops playback.
- A `go_away` notice from the server is passed to the page.

### WebSocket protocol (`/live`)
- Browser to server: binary = PCM16 mono 16 kHz audio; JSON `{"type":"frame","data":"<base64 jpeg>"}`.
- Server to browser: binary = PCM16 mono 24 kHz speech; JSON events `ready`, `heard` (what the user said), `reply` (what the assistant said), `tool` (name and arguments), `interrupted`, `go_away`, `error`.

## 7. Observability (show the work)
- `/panel` live table of events (heard, tool calls, replies, errors) refreshed every second; `/trace` returns the same as JSON.
- Events recorded: `live_connect`, `first_mic_audio`, `first_frame`, `first_audio` (with latency in ms), `heard`, `reply`, `tool`, `interrupted`, `go_away`, `error`, `live_input_totals` (KB of microphone audio and frames received), `live_disconnect`. The text path also logs token counts.
- The input counters answer "did the phone's audio and camera actually reach the server?".

## 8. Tools the agent can call
All tool calls are logged and shown in the trace.
- `remember_place(name, note)`: saves a place or object the user mentions (kept in memory, lost on restart).
- `recall_places()`: lists what was saved.
- `call_contact(name, message)`: **demo only**. No call is placed. It returns a "simulated" result and the assistant tells the user it was a demo call.

## 9. Configuration (`app/.env`, never committed)
| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | none | AI Studio key from the hackathon Google project. Without it the app says "The model is not connected yet". |
| `GEMINI_LIVE_MODEL` | `gemini-2.5-flash-native-audio-latest` | Realtime voice model. |
| `GEMINI_VOICE` | `Kore` | Assistant voice. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Text and vision model for the older path. |
| `GEMINI_HARD_MODEL` | `gemini-3.8-flash` | Reserved, not used yet. |
| `EYES_SILENCE_MS` | `500` | Silence that ends the user's turn (server side). |

URL options on the page: `?gate=0.05` (noise gate level) and `?debug=0` (hide debug panel).

## 10. Performance (measured)
- **Realtime voice:** first speech audio about 1.2 to 2.1 s after the end of the user's question (the test appends about 1 s of silence, so real latency from the end of speech is about 1.5 s).
- **Text and vision path:** about 1 to 2 s on `gemini-3.5-flash-lite`; the bigger model about 3 to 6 s with tools.
- **TTS only:** about 1.7 to 2.8 s per short sentence (not used now).
- Camera: 1 frame per second, about 640 px wide.

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
- **Echo:** speaker audio can reach the mic and make the assistant interrupt itself. The noise gate, echo cancellation and headphones or low volume mitigate this; the gate level needs tuning per phone.
- **iPhone Safari** is the strictest about audio and may need extra handling; Chrome on Android is the primary target.
- **Session length:** audio plus video sessions are normally limited to about 2 minutes; compression is enabled but long sessions are untested. Connections can drop outdoors; the page shows the close code and asks for a tap.
- **Browser audio nodes:** `ScriptProcessor` is deprecated but widely supported; a later cleanup can move to `AudioWorklet`.
- Memory of places is in RAM only.
- Gate too high can cut quiet speech.
- Camera frames are 1 per second, so fast motion can be missed.
- The larger "hard reading" model is configured but not used.

## 13. What was tested
- **Real Gemini calls (text path):** read text from a generated image, ran the simulated call, remember and recall, refused to call a road safe.
- **Live voice path, without a phone:** a spoken question synthesized with a TTS model and sent with a camera frame to `/live`. It was heard and transcribed, the picture was read aloud, and a spoken "call the pharmacy and ask for aspirin" triggered the demo tool. Input counters appeared in the trace.
- **Fake-model tests:** routing, history, missing frame note, model-error handling, silence token, tools, trace panel.
- **UI:** page loads, noise-gate buttons change and save the value (range 0.005 to 0.300), debug panel renders, permission failure shows the red error state with `NotAllowedError`.
- **Not tested:** real phone, real microphone, real playback, long sessions, iPhone.

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
