# Fast-warnings plan: evaluation and what was built (branch `fast-warnings`)

Assessment of [fast-warnings-master-plan.md](fast-warnings-master-plan.md) against the current app, what was implemented on the branch `fast-warnings`, and what was left out. The plan was written against an earlier version of the app (before the turn-taking fixes and the adaptive camera rate), so some of it overlaps or conflicts with work that already exists.

## 1. Verdict on each idea

| Idea in the plan | Verdict | Why |
|---|---|---|
| On-device detector (MediaPipe) with growth rate, so an approaching vehicle or person is warned about without the cloud | **Built (simplified)** | Biggest idea. The cloud path takes 3 to 6 s end to end; an on-device reflex avoids the network and the model. Hand-pointing and the 48x48 optical fallback were left out |
| Phone motion sensors: ignore camera panning, know if the user walks or stands | **Built** | Cheap, and it addresses the false alerts in the phone logs (a chair or pole announced while the user was sitting) |
| Single-sighting confirmation for very confident hazards (>= 0.88) | **Built** | Removes one watcher look (about 2 s) for confident low-urgency hazards |
| Instant spoken alerts (phone voice when the better voice is not ready) and pre-made common voices | **Built** | Removes the 1.7 to 2.6 s wait for the alert's voice |
| Send a fresh camera frame at the moment you start talking | **Built** | The voice model otherwise sees a frame up to 1 s old |
| Echo guard after an alert (higher gate for 1.8 s) | **Built** | The alert's own beep and the phone's own voice are not covered by the existing "assistant is speaking" gate |
| `thinking_budget=0` on the watcher | **Changed** | See 2.1: the model rejects it. Using `thinking_level=LOW` with an automatic fallback instead |
| 21 ms audio chunks (`ScriptProcessor(1024)`) | **Not taken** | Saves about 60 ms but multiplies main-thread work and messages by 4. The audio lost on the phone (see the optimization analysis) points at main-thread load, so this goes the wrong way. An AudioWorklet is the better fix |
| Watcher every 1.2 s by default | **Not taken** | The adaptive attention already speeds up when the model asks; a permanent 1.2 s is about 70% more cost |
| 512 px frames | **Not taken** | Smaller text is harder to read for the voice model; no measured benefit |
| 6-frame ring buffer picking 3 frames | **Not taken** | The existing spacing-based selection over a 40-frame buffer already does this |
| Oumi Iris scoring (`iris.py`) | **Not taken** | The plan makes it optional and uses it only for logging; its API could not be verified (nothing public was found earlier) |
| Hand-pointing ("what is this?") | **Deferred** | Second model (about 8 MB), more load on the phone, not needed for warnings |

## 2. Checked facts, including two things in the plan that do not work as written

### 2.1 `thinking_budget=0` breaks the watcher
Tested on this API key, 4 runs each, car-approaching frames:

| Model and setting | Median per look |
|---|---|
| `gemini-3.5-flash-lite`, no setting (before) | 1209 ms |
| `gemini-3.5-flash-lite`, `thinking_budget=0` (the plan) | **HTTP 400 INVALID_ARGUMENT: every look would fail** |
| `gemini-3.5-flash-lite`, `thinking_level=MINIMAL` | 1060 ms |
| `gemini-3.5-flash-lite`, `thinking_level=LOW` (used) | **946 ms** |
| `gemini-3.1-flash-lite`, no setting | 1047 ms |

The plan's claim of "about 0.75 s" was not reached; the real gain is about 0.25 s (22%). The code uses `thinking_level=LOW` (`GEMINI_WATCH_THINKING`) and, if the model ever rejects a thinking setting, retries once without it and remembers.

### 2.2 The plan's `dbg` collision
The MediaPipe loader does `if (typeof dbg !== "undefined") dbg(...)`. This app's page script had a top-level `const dbg = {...}` (its debug state), so on the real page the detector failed to load with `TypeError: dbg is not a function` on every library version (0.10.14, 0.10.18 and 1.2.3 were all tried). The plan avoids it only by accident, because it loads `app.js` as an ES module (own scope). On this branch `app.js` is wrapped in its own function scope so nothing leaks into the page. Setting a global `dbg` does not help because the loader shadows it.

### 2.3 The plan's growth measure alerts on a single bad detection
The plan averages the two halves of a time window. One wrong detection box stays in the newest half for almost a second, long enough to pass the 350 ms sustain filter and fire an alert (a test with one spike frame produced an alert). The branch compares the **median** of each half instead, and measures time between the middles of the halves.

### 2.4 The plan's walking detector threshold
A variance threshold of 1.1 on acceleration magnitude is probably too high for a phone held in the hand, and a missed walk would be read as "standing still" and hide alerts. The branch uses three answers (walking, stationary, unknown) with a low walking threshold (0.3), a low stationary threshold (0.06) and "unknown" in between. Unknown is never treated as stationary. The thresholds are not tuned on a real phone.

## 3. What was built on the branch

### Server
- `server/phrases.py`: 30 fixed alert phrases in English and Greek. On-device alerts use them; the watcher is told to reuse them word for word.
- `server/speak.py`: `warm_common()` makes all of them in the background once per server run (30 phrases took 9.6 s in the test).
- `server/watch.py`:
  - `thinking_level` with fallback.
  - The watcher is told the phone's motion state (`sensors_text`).
  - New `hazard_type` (`moving` or `static`).
  - `AlertPolicy.decide` has `fast_confirm` and `user_moving`: confident (>= 0.88, or >= 0.80 while walking) low-urgency hazards are announced on the first sighting; a fixed obstacle is held back while the user is known to be stationary (`user_stationary`); urgent hazards are never held back.
- `server/live.py`:
  - Frames carry the phone's sensors, and the watcher skips its looks while the camera pans fast (more than 65 deg/s), saving a model call.
  - New message `local_alert` from the phone, handled in its own task (it never blocks audio): fast-confirmed through the same policy (cooldown, dedupe, rate limit still apply), then fired like any alert.
  - Alert messages now say `voice_cached`, `client_voice` and `source`. An uncached urgent alert is spoken by the phone at once while the better voice is made in the background for next time; cached alerts stream immediately.
  - A frame marked `fresh` is forwarded to the voice model at once.
  - Failures in background tasks now appear in the trace (`task_error`); before, they were silent.

### Page
- `static/looming.js` (pure logic, tested in Node): growth measure, tracker with sustain and minimum gap, phone motion state.
- `static/spatial.js`: loads the MediaPipe object detector (GPU, falling back to CPU) from the CDN in the background and feeds the tracker; slows itself down if inference is slow.
- `static/app.js`: motion sensors (with the iPhone permission requested first thing in the tap), local alerts sent to the server, a fresh frame at speech start, the phone's own voice for urgent alerts (Greek or English), a higher gate for 1.8 s after an alert, new debug rows ("on-device", "phone motion"), and a function scope so no global `dbg`.

## 4. Test results (all without a phone)
- **Offline:** 187 checks pass: policy 26, fast-warning logic 35, isolation 22, attention 31, turn-taking 23, mic gate 12, looming 38. New ones cover the fast confirmation, the stationary rule, the phrase bank, the thinking fallback (including a refused setting), voice-bank warming, the growth measure (including the one-spike case), the motion state, and the tracker (no alert for static, off-path, slow, panning or unsteady cases).
- **Real browser, real detector** (the Browser pane, a Wikimedia car photo zooming toward the camera on a canvas): the detector loaded in 2.1 s on the GPU path, found the car (about 6.9 m static), measured growth of 1.9 to 2.3 per second during the zoom, and raised an on-device alert. In that environment inference averaged about 108 ms per frame with 3 s for the first frame (only 2 to 4 fps in a hidden pane), so the alert came about 2 s after the zoom began. A phone GPU should do better, but that is unmeasured. A one-frame misclassification (car seen as person) also reset the history once, since the tracker keys on the label.
- **Server end to end** (17 checks): an on-device alert reached the page within 1 ms of arriving; with the voice not ready, the phone is told to speak and the server streams nothing; once the bank was warm the cached voice started streaming 4 ms after the message; panning suppresses both on-device alerts and watcher looks, and looks resume afterwards; a fresh frame is forwarded early; the trace records the phone's movement and the alert's source.
- **Regression:** four simultaneous phones 12 of 12; turn-taking 8 of 8 (dead time median 3.13 s against 4.08 s for the old protocol this run); an alert cut a story, its words started 10 ms later because the watcher chose a pre-made phrase (before: 2.2 to 2.7 s), the story did not resume, and the follow-up question was answered.

## 5. Latency, before and after (as measured here)
| Stage | Before | After |
|---|---|---|
| Alert text to alert words, common hazard (pre-made phrase) | 1.7 to 2.6 s | about 0.01 s |
| Alert text to alert words, new text | 1.7 to 2.6 s | the phone speaks it at once (voice is the phone's, not Gemini's); better voice cached for next time |
| Approaching object: first sign to alert | 3 to 6 s (cloud) | server side about 1 ms after the phone's message; phone side depends on detector speed (about 2 s in the slow test pane, unmeasured on a phone) |
| Low-urgency hazard the model is sure about | two looks (about 4 s) | one look |
| Each watcher look | 1.2 s | about 0.95 s |

## 6. Limits and what to check on a real phone
- Detector speed, battery and heat on a phone, and whether it disturbs the audio (it shares the page's main thread; it slows itself down above 90 ms per frame). Check the debug panel row "on-device" (status, fps, ms per frame).
- It needs internet the first time to fetch the detector (jsdelivr and storage.googleapis.com). If that fails the app continues without it ("unavailable").
- It only recognizes the 80 everyday object kinds of its training set (vehicles, people, bikes, chairs and so on). Walls, stairs, curbs, poles and glass doors still depend on the cloud watcher.
- All thresholds (growth 0.35 and 0.8 per second, 1.1 m, 350 ms sustain, 4 s gap, walking 0.3 and stationary 0.06) are untuned guesses. Expect to adjust them after a real walk-through. False alarms from the phone itself moving toward an object are possible.
- The phone's voice is the browser's built-in voice, which is more robotic than Gemini's. It is used only for urgent alerts whose better voice is not ready.
- iPhone: the motion-sensor permission prompt and the sensor-driven features are untested.

## 7. How to switch things off
- `?client_tts=0` in the page address (or no speech support): the server always speaks alerts itself.
- `GEMINI_WATCH_THINKING=` (empty): no thinking setting for the watcher.
- On-device detector: it is created when the app starts; if the CDN is blocked it simply reports "unavailable". Remove the `spatial.js` line from `index.html` to disable it entirely (the page checks that it exists).


---

# Round 2: plan v3 ("API-models-first"), merged from master

Master's plan was rewritten (commit `de6728d`): cloud models plus phone sensors, with local on-device models deferred to a later version. Merged into this branch and checked claim by claim on this API key.

## 8. What was verified, and what changed as a result

| Plan v3 claim | Measured here | Decision |
|---|---|---|
| `gemini-3.1-flash-live-preview` gives about 586 ms to first audio, 3x faster | Median **1.61 s** (0.7 to 3.4 s, wide spread) against 2.45 s for the model in use. Faster, but not 586 ms in the app's full setup | Not chosen |
| (not in the plan) `gemini-3.8-live` | Median **0.84 s**, range 0.60 to 1.53 s, **12 of 12** answered; plain questions 0.80 s, tool requests 1.28 s; accurate transcription; tools, manual turn control, transcription, video and compression all accepted | **Now the default**, with an automatic fallback to the old model (`GEMINI_LIVE_FALLBACK_MODEL`) if it cannot be opened |
| 2 frames at 512 px make the watcher about 0.94 s instead of about 1.3 s | 3 frames 640 px 1006 ms, 2 frames 640 px 1036 ms, **2 frames 512 px 1054 ms**, 3 frames 512 px 942 ms: no latency difference (about 1.0 s); detections identical (car 6/6, empty road 6/6). Two frames use **27% fewer tokens** (3,025 against 4,135); 512 px does not change tokens | 2 frames adopted for cost; 512 px used for upload size only; the fresh frame at speech start stays 640 px |
| Watcher every 1.0 s (was 2.0 s) | Halves the average wait before a hazard is noticed (about 0.5 s). Alone it would cost about 46% more tokens | Adopted, with a **static-scene skip** (below) so a still scene costs less than before |
| Single-sighting confirmation at 0.85 | Same logic as round 1 | Threshold changed from 0.88 to 0.85 |
| `3.5-flash-lite` "already has thinking off" | Not true here: `thinking_level=LOW` made it 22% faster (946 ms against 1209 ms) | Kept `thinking_level=LOW` with fallback |
| Pre-warm common phrases, align the watcher's wording, hit rate above 85% | 48 phrases (English and Greek) pre-made in about 13 s; across 15 looks of 5 drawn hazards (wall, pole, steps, person, bicycle) **15 of 15 used an exact pre-made phrase (100%)** | Adopted; the plan's extra phrases were added |
| `ScriptProcessor(1024)` (21 ms audio chunks), 15 ms playback lookahead | Not built: saves about 60 ms, quadruples main-thread work and messages | Not adopted (an AudioWorklet is the better fix) |
| Keep `WAIT_DEFAULT_MS = 1200` and `GATE_HANG_MS = 800` | Conflicts with the turn-taking work already on master (900 ms default, 500 ms tail tagged quiet) | Not adopted; the tagged tail removes the cost the plan wanted to avoid |
| 6-frame ring buffer | Existing spacing-based selection over a 40-frame buffer already does it | Not needed |
| Oumi Iris API (`iris.py`) | API not verifiable (no key, no public documentation found); IMU gating already exists | Not built |
| Phone IMU: skip looks while panning | Already built in round 1 | Done |
| Local MediaPipe models deferred | Already built in round 1 | Kept, but now **opt-in** (`?ondevice=1`), off by default |

## 9. What was added in round 2
- **Voice model `gemini-3.8-live`** (about 3x faster answers) with fallback; checked once per server run.
- **Audible tracking:** the new model sends speech much faster than it plays (about 6 s of audio in a burst). The server now estimates when the phone will finish playing what it has sent, so barge-in logic is right during playback, and when you start talking over an answer the phone is told to stop it at once. Before, nothing stopped the buffered speech.
- **Watcher:** 2 frames, look every 1.0 s (0.8 s elevated, 0.6 s high), camera 2 frames per second normally (3 and 4 when raised), fast confirmation at 0.85.
- **Static-scene skip:** the phone sends a tiny motion score (16x16 greyscale difference) with each frame; the server skips looks while the picture is still, with a look at least every 4 s and never while attention is raised or after a look that found something. `EYES_STATIC_SKIP=0` turns it off. The 0.012 threshold is untuned on a real phone.
- **Starting rate announced** at connect, so the page always matches the server's settings.
- **48 pre-made phrases**, more of them aligned with what the watcher says.

## 10. Round 2 results (without a phone)
- **Offline:** policy 26, fast-warning logic 46, isolation 22, attention 31, turn-taking 23, mic gate 12, looming and motion score 42.
- **Voice model:** end of your voice to first speech, median 1.77 s in the full pipeline test (old tail handling 2.39 s; before the model change: 3.1 to 3.8 s).
- **Watcher cadence:** a still scene was looked at 4 times in 16 s (gaps 4.3 to 4.8 s; about 16 before); a car appearing after the still period was caught 1.8 to 2.1 s after the first changed frame (car still only about 20% of full size).
- **Barge-in during playback:** a 0.2 s burst did not start a turn or stop the phone; 0.9 s of speech told the phone to stop 0.41 s after it began.
- **Alerts:** an alert cut speech and its words played within 18 ms from the pre-made voice; with a not-yet-made voice the phone speaks it at once. The car alert fired 1.1 s after the first car frame in the story test.
- **Regression:** four simultaneous phones 12 of 12; fast-warning server run 17 of 17; turn-taking 11 of 11.

## 11. Limits added by round 2
- `gemini-3.8-live` gives noticeably shorter answers (it declined to tell a story in one test, citing its role), and its speech style differs from the old model. Check the voice and wording on a phone.
- Measured on a few turns of synthetic speech; real speech, noise and a cellular connection will add delay.
- The static-scene skip depends on the phone's motion score; on a real camera, sensor noise or auto-exposure may keep the score above the threshold (less saving, same safety) or hold it below it for a slowly approaching object (the look every 4 s still happens).
