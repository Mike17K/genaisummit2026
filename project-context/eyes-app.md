# Eyes & PharmaEyes: Unified Vision-Voice Assistant
## Two-Stage Championship Strategy: V1 (Universal MVP) → V2 (Clinical Trials Specialization)

> **Status:** Working scaffold built in `app/` (FastAPI backend + WebSocket + HTML/JS client).  
> **Hardware Configuration:** Android Phone (Camera + Mic + Speaker) + PC (Coordinator Dashboard & Trace).  
> **Tracks Hit:** **Open Track (Hardware Bonus)** $\times$ **Biotech & AI (ALTP)** $\times$ **Voice (Wonderful)**.

---

## Decisions made
- **Web app**, not native. **Backend: Python FastAPI**; **frontend: plain HTML/JS** (no Node, no Next.js). Reason: WebSockets for a continuous stream, one process, no build step.
- **Model: Gemini** via the Google credits (AI Studio key from the `@gcplab.me` account; see `sources/google-cloud-setup-*.pdf`). Plan: a Flash-class multimodal model for the main loop, the Gemini Live API for voice if available in the project, a larger model only when the fast one is unsure. **Verified with our key (2026-11-14):** `gemini-3.5-flash-lite` as the fast default (~1.5 s), `gemini-3.8-flash` as the larger model (~3 s; thinking off ~2.7 s). `gemini-2.5-flash` is retired for new keys. `models.list` showed no Live (`bidiGenerateContent`) models under the filter I used, so the Live API is unconfirmed. Others available: gemini-3.5-flash, 3.6/3.7-flash, 3.1-flash-lite, 2.5-pro, plus gemini-4-* previews.
- Why not Claude here: no hackathon credits and no live audio input.

Rather than fragmenting into two separate codebases, the team builds **one robust multimodal streaming engine** and ships it across two progressive phases:

## Build order
1. Page opens camera and mic over HTTPS (done in scaffold; phone needs a tunnel or boxd).
2. WebSocket sends frames and speech text (done).
3. Real model call returning a short spoken answer (done and tested live in `app/server/agent.py`).
4. Interruptible playback (basic version done via `speechSynthesis.cancel()`).
5. "Read this" and "what's in front of me" flows (handled by the system prompt; needs tuning with real images).
6. Tool action and spoken uncertainty (done: remember_place, recall_places, call_contact as a demo-only simulation; uncertainty rules in the prompt).
7. Trace panel (done: `/panel` page, shows heard text, tools, replies, latency, tokens).

## Tested
Real Gemini call tested with a generated text image: read text, simulated call, remember/recall, and it refuses to say a road is safe; ~1-2 s per answer on the flash-lite model. With a fake model: routing, history, missing-frame note, model-error handling, tools, trace panel. Server start, page and static file served, WebSocket round trip, trace log: passed in a scripted test. Camera, mic and speech not tried in a real browser or phone yet.

## Open questions
- Is the Gemini Live API enabled in our project? (not in the model list I filtered)
- Do we pursue this or the team's trial-matching / lab-bench direction? Is anyone blind or low-vision available to test with?
- Who has iPhone and Android to test (Safari is the strictest)?

---

## 2. V1 MVP: Universal "Eyes" (Open Track / Accessibility)

* **The Pitch:** An embodied eyes-free phone assistant. A visually impaired or elderly user points their phone camera at physical objects; the agent answers out loud: describes, reads (medicine boxes, bills, expiration dates), guides, and takes actions.
* **Why it wins Open Track:** 
  * Captures the **"Hardware gets extra points"** bonus by using the physical Android phone as a sensory camera-eye and tactile audio intercom.
  * Solves real user pain without being a generic chattering chatbot.
* **Core Loop:**
  1. User holds up an item and taps the screen: *"What medicine is this and when does it expire?"*
  2. Phone camera sends JPEG frame via WebSocket to `server/main.py`.
  3. `server/agent.py` calls **Gemini Flash Multimodal**.
  4. **Oumi Iris** evaluates image clarity (`is_image_readable: 0.88`). If blurry, agent interrupts: *"Too blurry, move the bottle 2 inches closer."*
  5. Agent speaks aloud: *"Augmentin 1000mg. Expiration date is November 2027. Do you want me to read the dosage instructions?"*

---

## 3. V2 Extension: "PharmaEyes" (ALTP Clinical Trials Challenge)

* **The Pitch:** Applies the exact same vision-voice hardware engine to solve the **Athens LifeHack Clinical Trials Challenge** (Topics 2, 3, and 4):
  * **Patient Selection & Protocol Verification (Topic 2):** Patient points phone at their trial medication kit. The agent verifies the batch number, dosage, and scheduled administration window against the ALTP oncology protocol.
  * **Continuous Patient Experience (Topic 3):** Between site visits, the patient speaks daily symptoms in natural Greek/English (*"I've had nausea and tingling fingers since taking this morning's pill"*).
  * **Risk-Based Monitoring (Topic 4):** The agent automatically translates the spoken vernacular into clinical **CTCAE Grade 2 Nausea** and **Grade 1 Peripheral Neuropathy**, uses **Oumi Iris** to score `dropout_risk: 84%`, and alerts the hospital study coordinator via a `boxd` microVM before the patient drops out.

---

## 4. The 3-Minute Winning Pitch Script

* **`0:00 – 0:30` | Universal Pain (V1):**  
  *(Presenter blindfolds a teammate on stage. They hold up a Greek medicine box.)*  
  *"Sight is our primary interface with medication and documents. For low-vision and elderly people, misreading a dosage label is dangerous. Watch our teammate point their phone."*
* **`0:30 – 1:30` | Live V1 MVP Demo:**  
  * Blindfolded user taps phone: *"What is this?"*  
  * Agent speaks: *"Augmentin 1000mg, expires Nov 2027."*  
  * Presenter shakes the box to show uncertainty: Oumi Iris flags blurriness $\rightarrow$ Agent says: *"Hold steady, move 2 inches closer."*  
  * Audience watches live steps on the `/trace` monitor.
* **`1:30 – 2:30` | The High-Stakes Clinical Pivot (V2):**  
  *"Now take that exact technology and place it inside an oncology trial here at Athens LifeTech Park. 30% of clinical trial patients drop out because of unmonitored side effects at home between hospital visits."*  
  * Blindfolded user says: *"I feel dizzy and nauseous after my morning dose."*  
  * On the PC monitor, the coordinator view lights up: speech auto-coded to **CTCAE Grade 2 Nausea**, Oumi Iris calculates `dropout_risk: 82%`, and `boxd` triggers a priority alert to the investigator.
* **`2:30 – 3:00` | What's Next:**  
  *"One core engine. In the morning, an accessibility aid; at night, a clinical safety monitor saving pharmaceutical sponsors \$30,000 per retained patient. Thank you."*

---

## 5. Immediate Execution Roadmap

```mermaid
timeline
    title Execution Sprint: V1 MVP to V2 Clinical Extension
    Saturday Evening : Wire Gemini Flash in agent.py : Hook Oumi Iris uncertainty : Tunnel to Android phone via cloudflared
    Saturday Night : Test live camera & voice on phone : Verify latency under 1.5s : Polish single-button UI
    Sunday Morning : Add ALTP protocol system prompt : Add CTCAE symptom auto-coding : Build simple /trace UI for judges
    Sunday Afternoon : Practice 3-minute blindfold pitch : Record backup insurance video : Code Freeze 18:00
```

### Next Immediate Coding Steps:
1. **`app/server/agent.py`:** Implement the real Google Gemini Flash API call passing the latest JPEG frame and transcribed voice text.
2. **Oumi Iris Integration:** Add parallel decision call to score `is_image_clear` and `is_safe_to_answer`.
3. **Tunnel Setup:** Run `cloudflared tunnel --url http://localhost:8000` so your Android phone opens `https://<tunnel-url>` with full camera/mic permissions enabled.
