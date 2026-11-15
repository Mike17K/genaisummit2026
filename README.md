# VoxEye — Gen AI Summit Hackathon 2026
> **Athens LifeTech Park (Spata) & SNFCC (Book Castle) · 14–16 November 2026**  
> Co-organised by GenAI Summit (100mentors × Wiserwork) × Panathēnea · Title Sponsor: **Quintessential (€8,500 Cash Podium)**

Real-time spatial safety, voice Q&A, and tactile depth assistant for blind and low-vision users (English & Greek). Full application documentation: **[app/README.md](app/README.md)**.

---

## VoxEye Architecture & Flow (`app/`)

```mermaid
flowchart LR
    Phone["Mobile Web Client (app/static/)"] <-->|"WebSocket /live"| Main["server/main.py"]
    Main --> Core["server/core/ (live, router, state, memory)"]
    Core -->|"Questions & Commands"| Asst["server/assistant/ (info_pipeline, turns, tools)"]
    Core -->|"Compass cues · notices"| Safe["server/safety/alerts.py (background speech)"]
    Core -->|"Always-on stereo sonar"| Depth["server/depth/ (local_depth ONNX, center_probe)"]
    Asst --> Audio["server/audio/ (speak, fal, phrases)"]
    Safe --> Audio
    Core --> Utils["server/utils/ (config, trace)"]
```

### Core Pipeline Summary
1. **Centralized Command, Memory & Answer Router (`app/server/core/router.py`)**: Evaluates every English/Greek utterance to decide whether to ignore room noise, execute a system/memory command, or answer a visual question—keeping `UserMemory` strictly for explicit goals/notes (`keep_memory=True`) while guaranteeing a spoken reply (`should_answer=True`) whenever asked.
2. **Places & Tour Guide (`app/server/geo/`)**: Phone GPS + compass with Google Places (or OpenStreetMap) tools: where am I, what is around, place details and guiding to a place, with exact steps and directions relative to where the user faces.
3. **Always-on Stereo Depth Sonar (`app/static/spatial_sonar.js` + depth model)**: Left / center / right nearest surfaces become earphone beeps in that ear (closer = louder and faster), tunable per ear; the mic stays closed (push-to-talk) so the earphones keep stereo.

### Core User Stories
- **Ask & Always Hear an Answer**: Ask *"What is ahead?"* or *"Πού είναι η πόρτα;"* and receive an immediate spoken clock-face + step answer without cluttering memory.
- **Explicit Memory Only When Needed**: Say *"I'm looking for the exit"* or *"Remember my cane is by the door"* to persist explicit context across turns and safety detours.
- **Talk Over It Anytime**: Speaking cuts whatever VoxEye is saying or doing and it listens.
- **Push-to-Talk**: Hold the button to talk, release to send; pressing cuts whatever VoxEye is saying.

---

## Hackathon Context & Strategy Docs (`context/` & `project-context/`)

- **[VoxEye Application Guide](app/README.md)** — Detailed server/client module diagram, dual-pipeline flow, user stories, and quickstart.
- **[TrialPulse Blueprint (ALTP Clinical Trials)](project-context/ideas/trialpulse-altp-challenge.md)** — Athens LifeHack challenge brief analysis.
- **[Top 5 Winning Ideas & 4-Stream Grand Slam](project-context/top-5-winning-ideas.md)** — Track concepts and architecture notes.
- **[Championship Blueprint](project-context/championship-blueprint.md)** — Hardware setup and sprint plan.
- **[Kickoff Deck Notes](project-context/kickoff-deck.md)** & **[Credits & Claim Links](project-context/credits-and-tools.md)** — Event schedule, judging criteria (*Usefulness*, *Craft*, *Aura*), and partner credits.
