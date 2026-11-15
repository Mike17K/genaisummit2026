# VoxEye Video Demo Blueprint & 2025–2026 Programmatic Video SOTA

> **Canonical Reference for Creating the VoxEye (`genaisummit2026`) Hackathon Demo & Launch Video**  
> Backed by the installed `/brag` skill ([`.agents/skills/brag/SKILL.md`](../.agents/skills/brag/SKILL.md)) and verified SOTA research across **Remotion**, **Revideo / Motion Canvas**, **OpenMontage (`openmontaz`)**, **Playwright Recast**, and **HTML/DOM Virtual-Clock Frame Capture (`brag` + `animate`)**.

---

## 1. Executive Summary: Why `brag` (`product-native`) Wins for VoxEye

### What is `brag-skill.zip` (`.agents/skills/brag/`)?
Our in-repo `.agents/skills/brag/` skill (also installed globally at `~/.gemini/antigravity/skills/brag/` and `~/.claude/skills/brag/`) is a **self-contained, zero-cloud-dependency hybrid video engine** that merges two MIT-licensed open-source projects into one workflow:
1. **`product-native` HTML/DOM Renderer (`runtime/timeline.js` + `tools/export-dom.mjs`)** from [latent-spaces/brag](https://github.com/latent-spaces/brag):
   - Renders a real HTML/CSS/DOM stage (`composition/index.html`) where every frame is a pure function of time `t` (`window.seek(t)`, `BRAG.onFrame(t)`, `BRAG.p(t, t0, d, ease)`).
   - Pauses all Web/CSS animations (`document.getAnimations()`), sets `a.currentTime = t * 1000`, synchronously seeks any embedded `<video data-start="...">` clips frame-accurately, captures PNG frames across 4 parallel headless Playwright Chromium workers (`--workers 4`), and mixes multi-track audio (`composition/audio.json`) via FFmpeg with **`sidechaincompress` voice auto-ducking** and **`-14 LUFS` `loudnorm`**.
2. **Procedural 2D Canvas Engine (`engine/`)** from [cth9191/animate](https://github.com/cth9191/animate) (commit `7e5eb56feb2dd573f890e1b7b34748af43d58263`):
   - Provides 7 hand-drawn/procedural 2D canvas styles (`cut-paper`, `crosshatch`, `riso`, `sketchbook`, `math`, `pixel`, `isometric`), shape-morph bridges (`kit/morph.js`), `faster-whisper` word alignment (`engine/tools/voice_words.py`), and automated text-overlap/LUFS QA (`engine/tools/review.mjs`).
3. **Hard Visual Storyboard Gate (`tools/panels.mjs` + `tools/review-server.mjs`)**:
   - Before spending time animating or rendering 1,500+ frames, `panels.mjs` renders settled keyframe JPEGs (`storyboard/panels/v1/pNN.jpg`) in ~2 seconds and `review-server.mjs` serves an interactive browser review UI (`http://127.0.0.1:4517/`) where you can edit on-screen copy inline, mark panels Keep / Change / Cut, and approve.

### What is "OpenMontaz" (`calesthio/OpenMontage`)?
- **"OpenMontaz"** is the phonetic/Greek (*μοντάζ* = montage) spelling of **OpenMontage** ([github.com/calesthio/OpenMontage](https://github.com/calesthio/OpenMontage), [openmontage.video](https://openmontage.video), AGPLv3 license).
- OpenMontage is a heavyweight, full-repository **agentic video production studio** (~700+ skill/knowledge files, 181 Python tool modules across 60+ cloud/local providers, 12+ YAML pipelines) that routes through a 7-stage state machine (`research -> proposal -> script -> scene_plan -> assets -> edit -> compose -> publish`) and delegates rendering to **Remotion** (`remotion-composer/`), **HyperFrames** (`npx hyperframes`), or **FFmpeg**.

### Head-to-Head Comparison: `brag` (`.agents/skills/brag`) vs. `OpenMontage` (`openmontaz`)

| Dimension | `brag` (`.agents/skills/brag` = `latent-spaces/brag` + `cth9191/animate`) | `OpenMontaz` / `OpenMontage` (`calesthio/OpenMontage`) | Winner for `genaisummit2026` (VoxEye) |
| :--- | :--- | :--- | :--- |
| **Architecture & Footprint** | Lightweight, self-contained agent skill (`SKILL.md` + Node/Playwright scripts) running **directly inside this repo**. Zero Python/cloud orchestrator needed. | Monolithic external studio repo (~700+ skill files, 181 Python tools, 7-stage YAML state machine, JSON schema checkpoints). | **`brag`** (Zero repo bloat; instant execution) |
| **Rendering Engine** | **100% deterministic frame-by-frame capture**: `timeline.js` + `export-dom.mjs` (4-worker Playwright Chromium + FFmpeg) for `product-native` DOM, or `engine/` for 2D Canvas. | Multi-runtime via `video_compose.py`: delegates to **Remotion** (React), **HyperFrames** (`npx hyperframes` HTML/GSAP), or **FFmpeg** stitching + AI B-roll generators. | **`brag`** (Direct DOM + `<video>` seek without Remotion/HyperFrames install) |
| **Real UI Fidelity (`app/static/`)** | **Native DOM reuse (9.5/10):** VoxEye's `app/static/index.html` (5.9 KB) and `trace.html` (3.1 KB) are zero-build vanilla HTML/CSS and mount **verbatim** inside `composition/index.html`. | **Indirect (6.5/10):** Defaults to templated Remotion cards/charts unless overridden into `atelier` (bespoke GSAP/React) or external OS/Playwright `screen-demo` capture. | **`brag` (`product-native` mode)** |
| **Storyboard & Iteration Loop** | **Visual keyframe gate (`panels.mjs` + `review-server.mjs`):** Renders actual settled frames in ~2s; full 45s 1080p30 export takes ~20–40s on Apple Silicon. | Heavy 7-stage artifact ceremony (`brief.json` -> `script.json` -> `scene_plan.json` -> `backlot/` SSE server); renders occur late in Stage 6 (`compose`), taking 15–60+ mins. | **`brag`** (10x faster iteration under hackathon deadline) |
| **Audio, TTS & Mixing** | Built-in FFmpeg `audio.json` mixer with **`sidechaincompress` auto-ducking** (music ducks under voice), sample-accurate SFX offsets (`adelay`), and `-14 LUFS` `loudnorm` + `faster-whisper` word sync. | 18 TTS wrappers (Piper, ElevenLabs, Chirp3), 6 AI music tools, WhisperX captions, `audio_mixer`. High capability when generating synthetic media from scratch. | **`brag` + VoxEye `speak.py`** (Feeds real VoxEye bilingual TTS & sonar audio directly into `audio.json`) |
| **Dependencies & License** | **Node 18+, Playwright Chromium, FFmpeg** (all local). **MIT License.** | Python 3.10 venv + Node 22 + Remotion `npm install` + `npx hyperframes` + cloud API keys. **AGPLv3 License.** | **`brag`** |

---

## 2. Broader 2025–2026 Programmatic Video SOTA Matrix

| SOTA Paradigm | Representative Tools / Skills | Polish | Determinism | Real-UI Fidelity | Setup Friction | Verdict for VoxEye (`genaisummit2026`) |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **1. HTML/DOM + Virtual Clock Playwright Capture** | **`.agents/skills/brag` (`product-native`)**, `latent-spaces/brag`, HeyGen `hyperframes` | **9.0/10** | **10/10** (`window.seek(t)`) | **9.5/10** (Mounts real `app/static/` DOM + `<video>`) | **Very Low** | **#1 PRIMARY ENGINE** — Zero build step; mounts VoxEye's exact vanilla HTML/CSS + real camera clips + TTS audio with 100% frame accuracy. |
| **2. Hybrid Audio-First Timestamped TTS + Code** | **VoxEye `speak.py` + `spatial_sonar.js` + `faster-whisper` (`voice_words.py`) + `brag` `audio.json`** | **9.5/10** | **9.5/10** | **9.5/10** | **Low** | **#1 AUDIO LAYER** — Driving `timeline.js` cuts from exact spoken English/Greek TTS & `"Stop!"` timestamps guarantees broadcast sync. |
| **3. React Programmatic Video + Agent Skills** | **Remotion** (`remotion-dev/remotion` + official `remotion-dev/skills`) | **9.5/10** | **10/10** | **7.0/10** (Requires porting vanilla DOM to React or `<OffthreadVideo>`) | **Medium** | **Runner-Up** — Great ecosystem, but unnecessary React scaffolding since VoxEye's frontend is already vanilla HTML/CSS. |
| **4. Procedural 2D Canvas Animation** | **`cth9191/animate`** (`brag/engine/`), **Revideo** (`midrender/revideo`), **Motion Canvas** | **8.5/10** | **10/10** | **3.0/10** (Canvas-only; hides real app UI) | **Low–Med** | **Supplemental Only** — Do NOT use hand-drawn styles (`cut-paper`, `riso`) as primary style; hackathon judges reward seeing the real product (`kickoff-deck.md`). |
| **5. Live Playwright Journey + Auto-Zoom** | **`playwright-recast`**, `smallstack/playwright-marketing-videos` | **8.5/10** | **6.5/10** (Async WS/camera jitter) | **10/10** | **Medium** | **Insufficient Alone** — A phone-browser-only screen recording misses the physical obstacle, depth heatmap, and tactile sonar feedback. |
| **6. Multi-Provider Agentic Video Studio** | **OpenMontage** (`calesthio/OpenMontage`) | **8.5/10** | **7.5/10** | **6.5/10** | **High** | **Overkill** — Built for AI B-roll/documentary pipelines; too much ceremony for a hackathon codebase demo. |

---

## 3. The VoxEye 3-Zone `product-native` Demo Stage Blueprint

### Why VoxEye Requires a 3-Zone Split-Screen Stage
VoxEye's core magic is **embodied, multimodal, and partially invisible on a single phone screen**:
- Physical world obstacles & closing velocity (`app/static/looming.js` + `app/server/depth/local_depth.py`)
- Bilingual (English & Greek) voice Q&A + explicit-only memory routing (`app/server/core/router.py`)
- Sub-second `<= 0.9 m` depth emergency stop & compass steering (`app/server/safety/alerts.py` + `app/server/assistant/info_pipeline.py`)
- Hold-1s stereo Geiger depth sonar & tactile vibration (`app/static/spatial_sonar.js` + `app/static/depth_worker.js`)

A plain screen recording of `app/static/index.html` alone looks like a single button changing color. To score maximum **Usefulness, Craft, and Aura** (`context/hackathon/kickoff-deck.md`), build `<output-dir>/composition/index.html` as a **synchronized 3-Zone `1920x1080` (`16:9`, `30fps`, ~45–60s) `product-native` stage**:

```text
+--------------------------------------------------------------------------------------------------+
|  TOP BAR / STAGE HEADER (Optional subtle context strip: VoxEye · GenAI Summit 2026 · Beat Title) |
+-------------------------------+----------------------------------+-------------------------------+
|   LEFT ZONE (~640px wide)     |    CENTER ZONE (~480px wide)     |   RIGHT ZONE (~680px wide)    |
|  Physical World & Depth HUD   |   Real VoxEye Mobile UI (DOM)    |  Real Judges' Live Trace UI   |
|                               |    (from app/static/index.html)  |   (from app/static/trace.html)|
|  +-------------------------+  |  +----------------------------+  |  +-------------------------+  |
|  | <video data-start="...">|  |  | [Logo] [badge] status text |  |  | VoxEye: live trace (N)  |  |
|  | or POV Corridor Scene   |  |  +----------------------------+  |  +-------------------------+  |
|  |                         |  |  |                            |  |  | memories: [goal] exit   |  |
|  | + Depth-Anything-V2     |  |  |            #go             |  |  |   [note 1] cane by door |  |
|  |   Plasma Heatmap Overlay|  |  |       Giant Tactile        |  |  +-------------------------+  |
|  |                         |  |  |         State Button       |  |  | 12:04:01 heard "What.." |  |
|  |   [ + ] Center: 0.82 m  |  |  |  (#0b5fff -> #1a7f37 ->    |  |  | 12:04:01 tool  decide.. |  |
|  |   v_close: +0.65 m/s    |  |  |   #8250df -> #d92d20 ->    |  |  | 12:04:02 reply "Clear.."|  |
|  +-------------------------+  |  |   #0e7490)                 |  |  | 12:04:08 error depth_.. |  |
|  | Compass & Sonar Radar   |  |  +----------------------------+  |  | 12:04:08 reply "Stop!.."|  |
|  |  Heading: 203° SW       |  |  | #gatebar / #sonarbar       |  |  +-------------------------+  |
|  |  Steering: +30° Right   |  |  | #debug: #membox + #meter   |  |  | Audio Waveform & Bilingual|
|  |  Sectors: L 1.8 C 0.8 R |  |  | #dbgTable (live telemetry) |  |  | Caption / Sonar Callout |  |
|  +-------------------------+  |  +----------------------------+  |  +-------------------------+  |
+-------------------------------+----------------------------------+-------------------------------+
```

### Exact DOM & CSS Tokens to Mount Verbatim

#### 1. Center Zone — Real VoxEye Mobile Client (`app/static/index.html`)
Copy the exact markup and styles from [`app/static/index.html`](../app/static/index.html) into a phone-viewport container (`390x844` or `420x880` with rounded bezel inside the Center Zone) and copy `/Users/kdimitropoulos/Documents/Projects/genaisummit2026/app/static/logo.png` into `<output-dir>/composition/assets/logo.png`:
- **Header (`#top`)**: `background: #1f1c2f; border-bottom: 1px solid #33304a;` containing `#logo`, `#badge`, and `#status`.
- **State Colors for `#badge` and `#go` Button**:
  - **Idle**: `#badge` = `#444` (`"idle"`), `#go` = `#0b5fff` (`"Tap to start"`)
  - **Hearing / Standby**: `#badge.hearing` = `#0b5fff` (`"hearing"`), `#go` = `#0b5fff` (`"Tap to stop · hold 1s for depth"`)
  - **Listening (User Speaking)**: `#badge.listening` = `#1a7f37` (`"listening"`), `#go[aria-pressed="true"]` = `#1a7f37`, `#meter > div` width animated with speech envelope (`background: #7ee787`)
  - **Thinking**: `#badge.thinking` = `#9a6700` (`"thinking"`)
  - **Speaking (VoxEye Replying)**: `#badge.speaking` = `#8250df` (`"speaking"`)
  - **Emergency Depth Stop (`<= 0.9 m`)**: `#badge.error` = `#b42318` / `#d92d20` (`"STOP · 0.82m"`), `#go[data-state="error"]` = `#b42318` with high-contrast red pulse ring
  - **Hold-1s Tactile Depth Sonar**: `#badge.depth` = `#0e7490` (`"depth"`), `#go[data-state="depth"]` = `#0e7490` (`"L 1.85m · C 0.78m · R 2.10m"`)
- **Memory Box (`#membox`)**:
  - `background: #161b22; border: 1px solid #30363d;`
  - `#memTitle` (`color: #79c0ff; font-weight: 700;`) transitioning from `memories (0)` (`#memempty: "no memories saved"`) -> `memories (2)` with `<span class="mem-tag">[goal]</span> exit` and `<span class="mem-tag">[note 1]</span> cane is by the door` (`color: #e3b341`).

#### 2. Right Zone — Real Judges' Live Trace Panel (`app/static/trace.html` at `/panel`)
Copy the exact GitHub-dark table and styles from [`app/static/trace.html`](../app/static/trace.html):
- **Container**: `background: #0d1117; color: #e6edf3; font: 14px ui-monospace, monospace;`
- **Memory Bar (`#membar`)**: `background: #161b22; border-bottom: 1px solid #30363d;` showing `memories: [goal] ... · [note 1] ...`
- **Event Row Classes (`#rows`)**:
  - `.heard` (`color: #79c0ff`): User speech transcripts in English & Greek (`"What is ahead?"`, `"Ψάχνω την έξοδο"`, `"Remember my cane is by the door"`)
  - `.tool` (`color: #d2a8ff`): Router & tool decisions (`decide_user_command -> kind=answer, keep_memory=False, should_answer=True`, `decide_user_command -> kind=command, keep_memory=True`, `set_compass_direction(SW, 225°)`)
  - `.reply` (`color: #7ee787`): Clause-streamed spoken responses (`"Path ahead is clear. Door at 12 o'clock, 4 steps."`, `"Θα θυμάμαι τον στόχο σου: έξοδος."`)
  - `.error` (`color: #ff7b72`): Safety preemptions (`depth_stop: dist=0.82m, v_close=0.68m/s, emergency_active=True`, `barge_in: cancelled in-flight speech`)
  - `.meta` (`color: #8b949e`): Timestamps, connection ID (`a7f3c1`), latency (`ttfa=460ms`, `webgpu=142ms`).

#### 3. Left Zone — Physical World Camera + `Depth-Anything-V2` + Compass & Stereo Sonar HUD
- **Top Half (Camera + Depth Overlay)**:
  - Either a real recorded smartphone POV video clip (`<video src="assets/pov-walk.mp4" data-start="0" muted playsinline>`) or a high-contrast animated 3D perspective corridor canvas/SVG synced to `t`, overlaid with a semi-transparent `Depth-Anything-V2` plasma/inferno heatmap (`#0d0887 -> #cc4778 -> #f0f921`).
  - Center reticle `[ + ]` displaying real-time metric distance (`2.40 m -> 1.65 m -> 0.82 m`) and approach velocity (`looming.js`).
- **Bottom Half (Compass Vector & Stereo Earphone Sonar Visualizer)**:
  - Circular compass dial showing current phone heading (`compassDeg: 195° -> 225° SW`), target bearing (`target_bearing_deg: 225° SW`), and steering turn arrow (`+30° Right` around obstacle).
  - 3-sector (`LEFT` / `CENTER` / `RIGHT`) stereo sonar bar showing left-ear (`440 Hz` base) and right-ear (`587 Hz` base) pulse rings driven by `SpatialSonarLib.sonarVoice(sector, distM)`.

---

## 4. Recommended 55-Second Storyboard Beat Structure (`storyboard.json`)

| Panel `#` & `id` | Time (`start–end`) | Keyframe `t` | Narrative Beat & Architectural Pillar Shown |
| :--- | :---: | :---: | :--- |
| **1. `hook`** | `0.0s – 5.0s` | `3.5s` | **The Hook (Eyes-Free Reality):** A blind walker approaches an obstacle while asking a question. Existing VLM apps take 3 seconds and talk over the collision. **VoxEye** unifies sub-second spatial safety, bilingual voice Q&A, and tactile depth sonar in one zero-install mobile web app. |
| **2. `qa-clean-mem`** | `5.0s – 14.0s` | `11.5s` | **Pillar 1A — Ask & Always Hear an Answer (Zero Memory Clutter):** User asks *"What is ahead?"* (`#badge.listening` `#1a7f37`). `router.py` logs `kind=answer, keep_memory=False, should_answer=True`. VoxEye speaks clock-face & step distance (`#badge.speaking` `#8250df`: *"Clear path ahead. Door at 12 o'clock, 4 steps."*) while `#membox` stays clean (`memories (0)`). |
| **3. `bilingual-mem`** | `14.0s – 25.0s` | `21.5s` | **Pillar 1B — Explicit Bilingual Memory & Barge-In (EN + EL):** User barges in mid-sentence (cutting audio immediately) and speaks in Greek & English: *"Ψάχνω την έξοδο"* (*"I'm looking for the exit"*) and *"Remember my cane is by the door."* `router.py` sets `keep_memory=True`. `#membox` and `/panel` `#membar` lock in `[goal] exit` and `[note 1] cane is by the door`. |
| **4. `depth-stop`** | `25.0s – 37.0s` | `32.5s` | **Pillar 2 — Closing-Velocity Depth Emergency Stop & Steering:** As the user walks forward, Left Zone depth drops `1.9m -> 0.82m` (`<= 0.9m` threshold with forward closing velocity). Server fires `"Stop!"` / `"Στοπ!"` (`#go` turns `#d92d20` red), sets `emergency_active=True`, computes open floor gap + compass turn, and speaks at `1.35x`: *"Turn right 30 degrees. Box one step ahead."* |
| **5. `hold-sonar`** | `37.0s – 48.0s` | `44.0s` | **Pillar 3 — Hold-1s Tactile Stereo Depth Sonar (`WebGPU <= 280ms` / ONNX):** User holds `#go` for 1 second (`#badge.depth` `#0e7490`). Mobile WebGPU / Laptop ONNX `Depth-Anything-V2-Small` streams `L / C / R` sector distances. Stereo Geiger beeps (`440Hz` L / `587Hz` R, climbing pitch & rate as `C` drops `1.8m -> 0.65m`) + haptic vibration guide the user smoothly through the doorway. |
| **6. `places-cta`** | `48.0s – 55.0s` | `52.0s` | **Places & Compass Tour Guide + Podium Close:** GPS + Google Places / OSM + `COMPASS_ALIGNED` cue (*"Είσαι στη σωστή κατεύθυνση, ακριβώς μπροστά σου"*). Closing lockup: **VoxEye** — Spatial Safety · Bilingual Voice · Tactile Depth Sonar (`GenAI Summit Hackathon 2026`). |

---

## 5. Audio-First Bilingual TTS & Stereo Sonar Pipeline

In `brag`, **audio is the clock**. Never use generic robotic `say` audio for the final render when VoxEye has its own production Gemini/FAL 24 kHz TTS (`app/server/audio/speak.py`), pre-cached bilingual action phrases (`app/server/audio/phrases.py`), and pure-JS stereo Geiger sonar (`app/static/spatial_sonar.js`).

### Step A: Generate Real Bilingual VoxEye TTS Clips (`app/server/audio/speak.py`)
Run a short one-off script from the repo root (or `app/`) to synthesize VoxEye's exact spoken lines (`24 kHz` mono PCM16 wrapped as `.wav`) into `<output-dir>/composition/assets/audio/`:

```bash
PYTHONPATH=app python3 - << 'EOF'
import asyncio, pathlib, wave
from server.audio import speak, phrases

OUT = pathlib.Path("brag-output/composition/assets/audio")
OUT.mkdir(parents=True, exist_ok=True)

CLIPS = {
    "reply_ahead_en.wav": "Path ahead is clear. Door at 12 o'clock, four steps.",
    "reply_goal_el.wav": "Θα θυμάμαι τον στόχο σου: έξοδος.",
    "reply_note_en.wav": "Got it, I'll remember your cane is by the door.",
    "alert_stop_en.wav": "Stop!",
    "alert_steer_en.wav": "Turn right 30 degrees. Box one step ahead.",
    "compass_aligned_el.wav": phrases.code_phrase("COMPASS_ALIGNED", "Greek"),
}

async def main():
    for filename, text in CLIPS.items():
        pcm = await speak.synthesize(text)
        with wave.open(str(OUT / filename), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(speak.OUT_RATE)
            w.writeframes(pcm)
        print(f"Wrote {OUT / filename} ({len(pcm) / (2 * speak.OUT_RATE):.2f}s)")

asyncio.run(main())
EOF
```
*(Tip: For the `1.35x` urgent steering phrase `alert_steer_en.wav`, pass it through `ffmpeg -i alert_steer_en.wav -filter:a "atempo=1.35" alert_steer_fast.wav` to match VoxEye's urgent speech cadence.)*

### Step B: Synthesize the Exact Stereo Geiger Sonar Ramp (`app/static/spatial_sonar.js`)
Because `app/static/spatial_sonar.js` exports `SpatialSonarLib` (`sonarVoice`, `planVoices`, `DEFAULTS`) cleanly in Node.js (`if (typeof module !== "undefined" && module.exports) module.exports = api;`), you can generate a sample-accurate stereo 48 kHz WAV file (`sonar_ramp.wav`) of the Hold-1s Geiger sonar ramp (`2.2m -> 0.55m`) using the exact `freqL`, `freqR`, `gainL`, `gainR`, and `intervalMs` math from `SpatialSonarLib`:

```bash
node -e '
const fs = require("node:fs");
const sonar = require("./app/static/spatial_sonar.js");
console.log("Sample sonar voice at 0.8m center:", sonar.sonarVoice("center", 0.8));
'
```

### Step C: Wire Everything into `<output-dir>/composition/audio.json`
`tools/export-dom.mjs` reads `<output-dir>/composition/audio.json` and runs an FFmpeg filtergraph with **automatic `sidechaincompress` music ducking under `voice`**, sample-accurate `adelay` on every `sfx` item, and `-14 LUFS` `loudnorm`:

```json
{
  "music": {
    "file": "../.agents/skills/brag/assets/music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3",
    "start": 0,
    "gain": -14,
    "fadeIn": 0.4,
    "fadeOut": 2.0
  },
  "voice": {
    "file": "voice/voice.wav",
    "gain": 0,
    "musicUnderVoice": -12
  },
  "sfx": [
    { "file": "assets/audio/reply_ahead_en.wav", "t": 7.2, "gain": 0 },
    { "file": "assets/audio/reply_goal_el.wav", "t": 17.5, "gain": 0 },
    { "file": "assets/audio/reply_note_en.wav", "t": 21.0, "gain": 0 },
    { "file": "assets/audio/alert_stop_en.wav", "t": 27.8, "gain": 2 },
    { "file": "assets/audio/alert_steer_fast.wav", "t": 28.6, "gain": 1 },
    { "file": "assets/audio/sonar_ramp.wav", "t": 38.0, "gain": -2 },
    { "file": "assets/audio/compass_aligned_el.wav", "t": 49.0, "gain": 0 },
    { "file": "../.agents/skills/brag/assets/sfx/interface/click_003.ogg", "t": 5.2, "gain": -12 },
    { "file": "../.agents/skills/brag/assets/sfx/impact/impactSoft_medium_001.ogg", "t": 27.8, "gain": -6 }
  ],
  "lufs": -14
}
```
> **Note on Music Tone:** The bundled `ende.app` tracks are upbeat; for VoxEye's high-contrast accessibility tone (`polished` or `cinematic`), keep `"gain": -14` and `"musicUnderVoice": -12` (or omit `"music"` during the emergency/sonar demonstration) so the bilingual TTS and stereo Geiger sonar cues remain crystal clear.

---

## 6. Exact CLI Commands for This Repository

All commands below run from the repository root (`/Users/kdimitropoulos/Documents/Projects/genaisummit2026`), where `<skill-dir>` is `.agents/skills/brag` and `<output-dir>` is `brag-output`:

### 1. Verify Runtime Dependencies (`node`, `ffmpeg`, `playwright`)
```bash
node -v && ffmpeg -version | head -n 1 && node -e "import('./.agents/skills/brag/tools/_pw.mjs').then(async m => { const b = await m.loadPlaywright().chromium.launch(); console.log('Playwright Chromium OK:', b.version()); await b.close(); })"
```

### 2. Initialize Composition Directory & Copy `timeline.js` + VoxEye Assets
```bash
mkdir -p brag-output/storyboard brag-output/composition/assets
cp .agents/skills/brag/runtime/timeline.js brag-output/composition/timeline.js
cp app/static/logo.png brag-output/composition/assets/logo.png
cp app/static/icon-192.png brag-output/composition/assets/icon-192.png
```

### 3. Render Storyboard Keyframe Panels (`panels.mjs`)
Renders every panel's settled keyframe time `t` from `brag-output/composition/index.html` into `brag-output/storyboard/panels/v1/pNN.jpg` in ~2 seconds:
```bash
node .agents/skills/brag/tools/panels.mjs brag-output/composition brag-output/storyboard/storyboard.json
```
*(To re-render only specific modified panels on v2+: add `--only hook,depth-stop`)*

### 4. Launch the Interactive Storyboard Review Server (`review-server.mjs`)
Starts the local review server on `http://127.0.0.1:4517/`, writes a static `brag-output/storyboard/index.html` copy, and automatically exits with code `0` once the user clicks Approve / Request Changes (writing `feedback-v1.json`):
```bash
node .agents/skills/brag/tools/review-server.mjs brag-output/storyboard --port 4517
# In another shell or agent command, open the URL in the browser:
open http://127.0.0.1:4517/
```

### 5. Render the Final `1080p30` Master Video & Poster (`export-dom.mjs`)
Spawns 4 parallel Playwright Chromium workers, seeks every frame deterministically via `window.seek(t)`, bakes the `--poster` frame at `t=32.5` as frame 0 (and `brag-output/brag.jpg`), mixes `brag-output/composition/audio.json` with `sidechaincompress` ducking and `-14 LUFS` normalization, and encodes `brag-output/brag.mp4` (`libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart`):
```bash
node .agents/skills/brag/tools/export-dom.mjs brag-output/composition \
  --out brag-output/brag.mp4 \
  --poster 32.5 \
  --poster-out brag-output/brag.jpg \
  --workers 4
```
*(For fast partial range testing during development, append `--from 750 --to 1110` to render only frames 750–1110.)*
