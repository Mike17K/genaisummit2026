# VoxEye: communication efficiency and why questions go unanswered

Analysis of the real phone sessions in the server logs (2026-11-14) plus a model-latency benchmark. Nothing was changed in the app; this lists what to optimize, ranked, with the evidence for each.

## 0. Status (updated after the first fixes)

**Implemented and tested without a phone:** A1 (wait floor 700 ms, default 900 ms, old saved value reset), A3 (250 ms onset), A4 (gate raised 2.5 times while the assistant speaks, plus 450 ms sustained voice on the server), B1 (1-byte voice/quiet tag, so the tail adds no dead time).
**A2 was adapted:** a finished turn cannot be reopened in the Gemini API, so true merging of fragments is not possible. Instead short utterances (under 1 s of voice) wait 0.4 s longer, and the 700 ms floor covers normal pauses.
**Not done yet:** A5 (better voice detector, auto-gate), A6 (push-to-talk), B2 to B4 (reasoning off, less video to the voice model), C1 to C6 (transport and phone robustness), D (watcher cost), E (extra measurement).
**Measured:** pause inside a sentence stays one turn (it did not before); a 0.2 s burst no longer cuts the assistant off; end of voice to first speech median 3.80 s versus 4.24 s with the old tail handling (4 runs each, a 0.44 s saving, within noise). The model's own time (about 2 to 3 s) is now the largest part of the delay.
**Still unverified:** all of this on a real phone, in a real noisy room. Check the debug panel (voice open, raised gate) and the `user_turn` trace events (`voiced_s`).

## 1. What the phone sessions show

Phone sessions were identified by their microphone chunk size (2730 bytes from the phone page, 3200 from my test scripts). Two substantial sessions, plus two odd ones.

| Session | Length | Your turns | Answered with speech | Notes |
|---|---|---|---|---|
| `3aa6dc` | 74 s | 10 | 5 | wait setting 300 ms |
| `06ffd4` | 180 s | 17 | 5 | wait setting 300 ms; 8 alerts |
| `4081e6` | 40 s | 0 | 0 | only 44% of the expected audio and 38% of the expected frames arrived |
| `b1e226` | 44 s | 0 | 0 | connected, never sent any audio or frames |

- **Only 10 of 27 turns got a spoken answer.**
- **Turns are short and fragmented:** median 1.6 to 1.7 s, shortest 0.0 s, 8 turns under 1.5 s. In `06ffd4` a new turn started about 0.3 to 0.5 s after the previous one ended, over and over.
- **24 of 26 transcripts are noise or fragments in unrelated languages** (`<noise>`, Telugu, Georgian, Russian, Chinese, Arabic) mixed with short Greek and English phrases. The Greek fragments look like people talking around the phone ("it hears here"), so many "turns" were probably not questions to the assistant. I cannot tell which turns were real questions.
- **Every new turn cancelled the one before it:** the log shows `interrupted by user` about 0.1 s after almost every `user_turn start`, followed by a `heard` with an empty reply. The assistant had started to answer, the next fragment cancelled it.
- **5 turns began while the assistant was speaking**, which cut its own answers (echo from the phone speaker, or the room).
- **Delay when it did answer:** 1.7 to 3.6 s from the end of the turn to the first speech, median 2.0 to 2.6 s. On top of that, about 1.05 to 1.2 s passes before the server even ends the turn (see 3.1).

## 2. Why questions go unanswered (root causes, in order of impact)

1. **The wait after you stop talking was saved at 300 ms** in the browser (both phone sessions connected with `silence_ms: 300`). The server then waits only 0.25 s of silence, so any natural pause splits one sentence into several turns, and each new turn cancels the answer to the previous one. The wait buttons allow 300 ms as a floor, and a lower number looks like "faster".
2. **Noise and echo open the gate.** The gate is a plain loudness level (0.03). Room talk, TV, keyboard and the phone's own speaker pass it, so the app starts turns that are not questions, and a turn that starts while the assistant is talking cancels it.
3. **Nothing merges fragments or ignores tiny bursts.** A burst of 0.0 to 0.5 s still becomes a full turn and interrupts.
4. **The phone sometimes loses data.** `4081e6` delivered 44% of the audio and 38% of the frames; `06ffd4` delivered 86% of the audio. Lost audio means lost questions. Cause not determined (see 4).

## 3. Optimization elements, ranked

### A. Turn-taking (fixes the unanswered questions)
| # | Change | Effect | Effort |
|---|---|---|---|
| A1 | Enforce a minimum effective end-of-turn wait of about 700 to 900 ms; limit the wait buttons to 800 ms or more; version the saved setting so the stuck 300 ms is reset | Stops sentences being split; the single biggest fix | small |
| A2 | Merge fragments: if new voice starts within about 1 s of the last end and the assistant has not begun speaking, continue the same turn instead of starting a new one | No more cancelled answers from natural pauses | small |
| A3 | Onset debounce: open a turn only after about 250 ms of sustained sound above the gate | Ignores clicks, coughs and noise bursts | small |
| A4 | Raise the gate (about 2 to 3 times) while the assistant's audio is playing, so only clearly louder speech can cut it off | Fixes the assistant interrupting itself with its own echo | small |
| A5 | A better voice detector than loudness: speech-band energy (300 to 3400 Hz) and zero-crossing rate; auto-set the gate from the measured room noise (for example 3 times the noise floor) | Fewer false starts from TV and chatter | medium |
| A6 | Offer push-to-talk (hold to speak) as a noisy-room option | Removes false turns entirely when needed | small |

### B. Latency from "you stop" to "you hear speech" (about 3.0 to 3.7 s today)
| Stage | Today | Optimization |
|---|---|---|
| Page keeps sending quiet audio after you stop | 0.8 s, and the server counts it as voice | **B1:** tag each audio chunk with a 1-byte voice/quiet flag. The server counts silence from the true end of speech and still forwards the tail to Gemini. Saves about 0.6 to 0.8 s |
| Server end-of-turn wait | 0.25 to 0.4 s | goes up to about 0.7 s with A1, but B1 makes the total about 0.7 s instead of 1.05 to 1.2 s |
| Model time to first speech | median 2.0 to 2.6 s in the phone sessions; 2.28 s in the benchmark | **B2:** reasoning off, fewer tools in the first turn, smaller video context (table below) |
| Spoken alert (separate path) | watcher 1.2 s plus voice 1.7 to 2.6 s | **B3:** a bank of about 30 common alerts in English and Greek, pre-spoken at startup; the watcher picks one by id. Common alerts become instant |

**Benchmark (5 questions per setting, same question and picture, seconds from end of turn to first speech):**

| Setting | Median | Range |
|---|---|---|
| baseline (current) | 2.28 | 1.22 to 2.68 |
| reasoning off | 1.89 | 1.34 to 2.24 |
| lower image resolution | 2.18 | 1.82 to 2.61 |
| reasoning off + lower resolution | 1.94 | 1.13 to 2.04 |
| no tool declarations | 1.87 | 1.55 to 2.01 |
| no video at all | 1.94 | 1.88 to 2.20 |

Reading it: each change saves about 0.1 to 0.4 s, within the run-to-run noise of about 0.5 s. The model floor for this voice model is about 1.9 s. **Model settings alone will not make it feel fast; the dead time before the model starts and the cancelled turns matter more.** Reasoning off is free to try; answer quality is not checked. "No tools" is not an option (the tools are needed), but fewer tools or declaring them only when relevant might help.

**B4. Send video to the voice model only when needed.** Today every second a frame goes in (180 frames in a 3-minute session). Send one at the start of a turn and every 2 s while you talk, instead. Cuts the voice session's tokens and context a lot; the benchmark suggests about 0.3 s too. The watcher keeps its own full stream.

### C. Transport and phone side
| # | Change | Why |
|---|---|---|
| C1 | Check `socket.bufferedAmount` before sending a frame and drop frames when more than about 64 KB is queued; always send audio first | One connection carries audio and video, so a 20 to 80 KB frame in front of an audio chunk delays it. This also protects against weak signal |
| C2 | Send frames as binary with a 1-byte type tag instead of base64 JSON | About 25% fewer bytes and no JSON work on either side |
| C3 | Move microphone capture to an AudioWorklet and encode frames with an async `toBlob` or OffscreenCanvas | Today audio, canvas and JSON all run on the page's main thread (ScriptProcessor plus a synchronous `toDataURL`), a likely cause of the lost audio on the phone |
| C4 | Report phone health to the server trace: page visibility changes, audio gaps, queue size, measured chunk jitter | The 44% and 38% sessions and the one that never sent anything cannot be explained without this |
| C5 | Smaller or lower-quality frames for the watcher (about 480 px) | Lower upload and tokens; accuracy not tested |
| C6 | Host closer to the user and to Google (for example a VM in Europe) instead of a quick tunnel | A tunnel adds a hop and variable delay; not measured |

### D. Cost and noise in the watcher
- **Skip looks when the scene has not changed** (a cheap comparison of consecutive frames). A static scene still costs about 3,800 tokens every 2 s. Likely a large saving.
- **Alert repetition about furniture indoors:** `06ffd4` had 8 alerts in 180 s about a pole, a wall, a chair and a glass door. The dedupe window is 25 s, so turning around brings them back. A "seen and already announced" memory would reduce this.

### E. Measurement to add first (cheap)
- Log the Live model's token usage per turn (not logged today).
- One `turn` trace event per question: end of speech, end-of-turn signal sent, first speech heard, with the three gaps. Show "time to first speech" on the debug panel.
- Show on the debug panel how many turns were started, answered and cancelled.

## 4. What is not known
- Which of the logged turns were real questions to the assistant; many look like conversation near the phone.
- Why `4081e6` lost most of its audio and frames, and why `b1e226` sent nothing (phone in the background, a busy page, or the network).
- Whether reasoning off or lower resolution changes answer quality.
- The benchmark is small (5 runs per setting, synthetic speech, a still picture); differences under about 0.5 s are not reliable.

## 5. Suggested order
1. **A1 to A4** (small changes, fix the unanswered and cancelled turns).
2. **B1** (saves up to 0.8 s) and **E** (so the next phone test explains itself).
3. **B2 and B4** (reasoning off, less video to the voice model), then check quality.
4. **C1 to C4** (make the phone side robust).
5. **B3 and D** (alert speed and cost).
Expected result of steps 1 to 3: roughly 2.0 to 2.4 s from the end of speech to the first word, and far fewer cancelled answers, down from about 3.0 to 3.7 s.
