# Eyes: voice and camera assistant for blind and low-vision users

Status: scaffold built in `app/` (2026-11-14). Not in the team's top-5 blueprint; it is a separate option (Open track, hardware bonus, "point and ask" idea #9 and Grandma's button #6).

## Pitch
A phone camera plus voice. The user asks, the app answers out loud: describe, find, read (menus, letters, medicine boxes), guide ("door at 2 o'clock, about 3 steps") and act (call, look up opening hours). It is an agent that speaks only when useful, not a captioner.

## Decisions made
- **Web app**, not native. **Backend: Python FastAPI**; **frontend: plain HTML/JS** (no Node, no Next.js). Reason: WebSockets for a continuous stream, one process, no build step.
- **Model: Gemini** via the Google credits (AI Studio key from the `@gcplab.me` account; see `sources/google-cloud-setup-*.pdf`). Plan: a Flash-class multimodal model for the main loop, the Gemini Live API for voice if available in the project, a larger model only when the fast one is unsure. **Exact model IDs not chosen yet**; copy them from the AI Studio model picker into `.env`.
- Why not Claude here: no hackathon credits and no live audio input.

## Components
- **Client:** camera frames (~1/s, rear camera), mic, audio playback with interruption, screen wake lock, one big full-screen button, eyes-free.
- **Transport:** WebSocket `/ws`; messages `frame`, `say`, `ping`.
- **Agent core:** decides to speak, call a tool or stay silent; warnings before answers before description; short sentences.
- **Tools (planned):** text reading, web lookup (treg), mock phone call, memory of places/objects.
- **Safety:** says when unsure ("move closer"), supports but does not replace a cane or guide dog, never claims a road is safe to cross, camera only while active.
- **Observability:** `/trace` endpoint logs steps and latency for the judges' screen. Plan B: cached run and demo video.

## Build order
1. Page opens camera and mic over HTTPS (done in scaffold; phone needs a tunnel or boxd).
2. WebSocket sends frames and speech text (done).
3. Real model call returning a short spoken answer (TODO, `app/server/agent.py`).
4. Interruptible playback (basic version done via `speechSynthesis.cancel()`).
5. "Read this" and "what's in front of me" flows (TODO).
6. One real tool action and spoken uncertainty (TODO).
7. Trace panel (endpoint done, UI TODO).

## Tested
Server start, page and static file served, WebSocket round trip, trace log: passed in a scripted test. Camera, mic and speech not tried in a real browser or phone yet.

## Open questions
- Which exact Gemini model IDs and is the Live API enabled in our project?
- Do we pursue this or the team's trial-matching / lab-bench direction? Is anyone blind or low-vision available to test with?
- Who has iPhone and Android to test (Safari is the strictest)?

## Demo idea (3 minutes)
Person: who it helps. Live: blindfolded teammate or real user points at a letter, hears it read and explained, says "call the pharmacy" and the agent acts. Show the unsure case (blurry label). Next: smart glasses and real navigation partner.
