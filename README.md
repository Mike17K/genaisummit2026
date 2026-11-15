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
    Core -->|"Depth <= 0.9 m: image + compass"| Safe["server/safety/alerts.py (depth emergency stop)"]
    Core -->|"Hold 1s Sonar · Stop Guard"| Depth["server/depth/ (local_depth ONNX, center_probe)"]
    Asst --> Audio["server/audio/ (speak, fal, phrases)"]
    Safe --> Audio
    Safe -->|"Blocks answers, asks what to do"| Asst
    Core --> Utils["server/utils/ (config, trace)"]
```

### Core Pipeline Summary
1. **Centralized Command, Memory & Answer Router (`app/server/core/router.py`)**: Evaluates every English/Greek utterance to decide whether to ignore room noise, execute a system/memory command, or answer a visual question—keeping `UserMemory` strictly for explicit goals/notes (`keep_memory=True`) while guaranteeing a spoken reply (`should_answer=True`) whenever asked.
2. **Depth Emergency Stop (`app/server/safety/alerts.py`)**: The camera-video watcher is gone. An always-on Depth-Anything-V2 guard (phone WebGPU or laptop ONNX) watches the camera center; at `<= 0.9 m` the phone sends one image + compass, the server says "Stop!", blocks the answering pipeline, and speaks the model's instruction on what to do (e.g. *"Turn right 30 degrees. Box one step ahead."*, spoken fast) before releasing the block.
3. **Auto Mobile / Laptop Depth Sonar (`app/static/depth_worker.js` + `app/server/depth/local_depth.py`)**: Holding the screen for 1 second runs continuous proximity sonar on Mobile WebGPU when fast (`<= 280 ms`) or auto-switches to Laptop ONNX Depth-Anything-V2-Small.

### Core User Stories
- **Ask & Always Hear an Answer**: Ask *"What is ahead?"* or *"Πού είναι η πόρτα;"* and receive an immediate spoken clock-face + step answer without cluttering memory.
- **Explicit Memory Only When Needed**: Say *"I'm looking for the exit"* or *"Remember my cane is by the door"* to persist explicit context across turns and safety detours.
- **Depth Emergency Stop with Guidance**: Walk up to an obstacle—VoxEye cuts whatever it was saying, says "Stop!", then tells you what is there and which way to go using the picture and your compass heading.
- **Hold-1s Tactile Depth Sonar**: Press and hold for 1 second for continuous Geiger-style beep and vibration distance feedback.

---

## Hackathon Context & Strategy Docs (`context/` & `project-context/`)

- **[VoxEye Application Guide](app/README.md)** — Detailed server/client module diagram, dual-pipeline flow, user stories, and quickstart.
- **[TrialPulse Blueprint (ALTP Clinical Trials)](project-context/ideas/trialpulse-altp-challenge.md)** — Athens LifeHack challenge brief analysis.
- **[Top 5 Winning Ideas & 4-Stream Grand Slam](project-context/top-5-winning-ideas.md)** — Track concepts and architecture notes.
- **[Championship Blueprint](project-context/championship-blueprint.md)** — Hardware setup and sprint plan.
- **[Kickoff Deck Notes](project-context/kickoff-deck.md)** & **[Credits & Claim Links](project-context/credits-and-tools.md)** — Event schedule, judging criteria (*Usefulness*, *Craft*, *Aura*), and partner credits.
