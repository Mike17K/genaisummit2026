# VoxEye Research TL;DR: Problem Spectrum, 2024–2026 SOTA, Competitors & Open-Source Upgrades

> **Date:** 15 November 2026  
> **Deep-Dive Reports:**
> 1. **[Competitors & Commercial Landscape (`competitors-solutions.md`)](competitors-solutions.md)** — 19 commercial apps, smart glasses/mobility rigs, and live VLMs benchmarked against VoxEye.
> 2. **[Open-Source Repositories & Codebase Upgrade Guide (`open-source-repos.md`)](open-source-repos.md)** — 21 GitHub repos & Hugging Face checkpoints mapped line-by-line to `app/static/` and `app/server/`.
> 3. **[BLV Problem Spectrum & 2024–2026 Academic SOTA (`problem-spectrum-sota.md`)](problem-spectrum-sota.md)** — 5-domain BLV taxonomy, kinematics of walking vs. VLM latency, and System-1/System-2 SOTA architectures.

---

## 1. The 5-Domain Spectrum of BLV Problems

Blind and low-vision (BLV) assistance spans five distinct operational regimes with incompatible latency, geometry, and cognitive-load constraints:

1. **Micro-Navigation & Immediate Physical Safety (`0–2.5 m`, `<300 ms` budget):**
   - **White Cane Blind Spots:** Canes only sweep ground-to-waist (`~0.8–1.0 m`), completely missing **head/chest overhangs** (tree branches, awnings, protruding signs, open cabinets — injuring >80% of cane users), drop-offs, and fast-closing hazards.
   - **Walking Kinematics vs. Cloud Latency:** At typical human walking speed (`1.2–1.4 m/s`), an obstacle at `0.9 m` leaves **only `600–750 ms` Time-to-Contact ($TTC$)**. A cloud video stream with `1.5–4.0 s` round-trip latency means the user walks `1.8–5.6 m` and collides before the alert is even spoken.
   - **Wall Paranoia:** Triggering alerts purely on static distance causes constant false alarms when walking parallel to walls or standing still in narrow corridors; alerts must be gated by **closing velocity ($\dot{d} \ge 0.2\text{ m/s}$) and $TTC$**, and suppressed during camera panning.
2. **Meso-Navigation & "The Last 10 Meters" (`2–10 m`):**
   - Consumer GPS drops users within ±5–15 m of a venue, leaving the hardest segment unsolved: finding the open walkable floor corridor around an obstacle, locating the actual door handle, crosswalk alignment, empty chair, or elevator button.
3. **Macro-Navigation & Orientation (`10 m–5 km`):**
   - Urban-canyon GPS multipath drift, topological mental mapping (ambient POI awareness in clock-face + step counts), and exact cardinal/degree orientation (where monocular VLMs fail completely and tilt-compensated magnetometers are required).
4. **Visual Q&A, Reading & Hallucination Safety (*VizWiz-LF* COLM 2024, ASSETS 2024):**
   - ~30–40% of blind-captured frames suffer from motion blur, bad framing, or occlusion. Standard VLMs hallucinate dosages, signs, or metric distances (35–70% error) instead of abstaining and giving physical camera-aiming recovery instructions.
5. **HCI, Ergonomics & Acoustic Safety (CHI / ASSETS 2024–2025):**
   - Verbose TTS masks environmental traffic acoustics that BLV travelers rely on for survival. Systems must stay silent by default, support `<200 ms` barge-in, adapt verbosity to walking speed, and provide non-verbal tactile/audio sonar.
   - **Transparency-Mode Earphones + 360° Directional Audio:** Modern earphones (AirPods Pro, Galaxy Buds, Sony, Pixel Buds) feature hardware **Transparency / Adaptive Audio Mode**, allowing BLV users to keep **both earbuds in at all times** with full ambient street awareness while unlocking **full 360° 3D spatial audio (HRTF)**—both for obstacle sonar (azimuth + elevation) and continuous 360° compass/GPS beacons.

---

## 2. Competitive Landscape & 2024–2026 State of the Art

The commercial market is trapped in a **Hardware vs. Safety Trilemma**:

| Category | Representative Solutions | What They Do Well | Why They Fail vs. VoxEye |
| :--- | :--- | :--- | :--- |
| **$0 Cloud VLM & Smart Glasses** | *Be My Eyes (Be My AI), Seeing AI, Envision Ally, Gemini Live (Project Astra), GPT-4o Realtime, Meta Ray-Ban ($299–$379)* | Rich conversational VQA, OCR, and scene narration. | **Unsafe for obstacle stopping.** Sample video at ~1 FPS with `0.8–4.0 s` RTT, suffer 35–70% monocular metric distance error, hallucinate turn angles, and explicitly disclaim mobility use. |
| **GPS, Audio Beacons & Venue Apps** | *VoiceVista (Soundscape), Lazarillo, GoodMaps, RightHear, NaviLens, OKO by AYES, Aira ($26–$295/mo)* | 3D audio beacons (*VoiceVista*) and pedestrian traffic lights (*OKO*). | **Zero general obstacle detection.** Indoor apps (*GoodMaps, RightHear, NaviLens*) require venue QR/BLE installation; *Aira* is expensive and has no Greek interpreters. |
| **Dedicated Depth Mobility Hardware** | *Biped NOA vest (€4,990), .lumen glasses (€9,999 / 1 kg), Glidance Glide ($1,499 / 2.7 kg), WeWalk Cane 2 ($850+), OrCam ($3.5k+)* | Sub-second ToF/stereo depth obstacle avoidance & haptics. | **€1,000–€10,000 proprietary hardware**, heavy/stigmatizing rigs (0.9–2.7 kg), weak or non-existent conversational VQA and Greek (`Ελληνικά`) support. |

### How VoxEye (`app/`) Instantiates the 2026 SOTA on a $0 Smartphone
Modern academic SOTA (*PathFinder, MR.NAVI, DualVLN/SEDualVLN, WalkVLM*) has converged on a **Dual-Process (System 1 + System 2) Architecture**, which VoxEye implements end-to-end in a zero-install mobile web client:
- **System 1 (Fast Edge Depth & Stereo Earphone Sonar, `~5 Hz` always-on / full-speed on Hold-1s):** Continuous 3-sector (`LEFT` / `CENTER` / `RIGHT`) depth sensing via WebXR ARCore depth ([xr_depth.js](../../app/static/xr_depth.js)) or `Depth-Anything-V2` ([depth_worker.js](../../app/static/depth_worker.js), [local_depth.py](../../app/server/depth/local_depth.py)) calibrated to metric meters ([looming.js](../../app/static/looming.js), [center_probe.py](../../app/server/depth/center_probe.py)), driving per-ear parametric stereo sonar ([spatial_sonar.js](../../app/static/spatial_sonar.js)) that ducks while speaking and pauses while the user talks.
- **System 2 (Deliberative Cloud Brain + Deterministic Compass/GPS):** Evaluates every EN/EL utterance via [router.py](../../app/server/core/router.py) and [memory.py](../../app/server/core/memory.py), pairing bilingual clause-streamed VQA and exact compass readouts ([info_pipeline.py](../../app/server/assistant/info_pipeline.py)) with Google Places/OSM compass wayfinding and arrival cues ([service.py](../../app/server/geo/service.py), [alerts.py](../../app/server/safety/alerts.py)).

---

## 3. Prioritized Open-Source Upgrades for VoxEye (`app/`)

| Rank | Upgrade & Open-Source Repo / Checkpoint | Target Files in `app/` | Effort | Impact & Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **#1** | **Vertical Overhang & Drop-Off Depth Zones** (`onnx-community/depth-anything-v2-small`) | `static/depth_worker.js`, `server/depth/local_depth.py`, `static/spatial_sonar.js` | **Low** (~40 LOC) | `depth_worker.js` and `local_depth.py` already slice the view band horizontally into `LEFT` / `CENTER` / `RIGHT` (`spatial_sonar.js`). Adding an upper **head-height overhang band** (`y ∈ [0.08, 0.30]`) and lower **drop-off/curb band** (`y ∈ [0.75, 0.95]`) catches tree branches, signs, and stairs that white canes miss. |
| **#2** | **3D HRTF Elevation & Soundscape Target Beacons** (`microsoft/soundscape`, `drwjf/VoiceVista`, `SynnIA/sonic-vision`, WebAudio `PannerNode`) | `static/spatial_sonar.js`, `static/app.js`, `server/safety/alerts.py` | **Low** (~50 LOC) | Complements `spatial_sonar.js` per-ear stereo panning with optional 3D HRTF `PannerNode({ panningModel: "HRTF" })` elevation cues and a non-verbal Soundscape-style audio beacon at `target_bearing_deg - imu.compassDeg`. |
| **#3** | **Browser WASM Silero VAD v5 + `AudioWorklet`** (`ricky0123/vad` / `@ricky0123/vad-web`, `snakers4/silero-vad`) | `static/micgate.js`, `static/app.js` | **Low–Med** (~80 LOC) | Replaces the deprecated main-thread `ScriptProcessorNode(4096)` (`app.js:479`, ~85 ms lag) and RMS-only noise gate with a 1.8 MB WASM neural speech detector ($p_{\text{speech}}$ every 30 ms), preventing false barge-ins in noisy exhibition halls. |
| **#4** | **Apple Silicon `CoreMLExecutionProvider` + Metric Depth Checkpoints** (`depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf`, `apple/ml-depth-pro`) | `server/depth/local_depth.py`, `static/depth_worker.js`, `server/depth/center_probe.py` | **Low–Med** (3–40 LOC) | Adding `"CoreMLExecutionProvider"` to `local_depth.py:48` unlocks 3× faster Apple Neural Engine/Metal inference (`~15–22 ms`) on M-series Macs. Swapping in the Metric-Indoor/Outdoor ViT-S ONNX checkpoint outputs absolute meters directly without cloud `center_probe.py` calls. |
| **#5** | **Motion-Conditioned Verbosity (`WalkVLM` / `WorldScribe`)** (`xiaoyuan1996/walkvlm`, UIST 2024 `WorldScribe`) | `server/assistant/info_pipeline.py` | **Low** (~25 LOC) | Uses `state.last_imu` walking state to switch `info_pipeline.py` between 1-clause ultra-brief safety answers while walking and richer descriptions while stationary. |
| **#6** | **WebGPU Semantic Free-Space & Stair Segmentation** (`Xenova/segformer-b0-finetuned-ade-512-512`) | `static/depth_worker.js`, `server/safety/steering.py` | **Med** | Runs a 3.7M-parameter SegFormer-B0 in the existing `transformers.js` WebGPU worker on stop frames to verify that the open depth corridor is truly walkable floor (`floor`/`sidewalk`) rather than glass or stairs. |
| **#7** | **Prosodic End-of-Turn Detection** (`pipecat-ai/pipecat` `smart-turn-v3`, `livekit/turn-detector`) | `server/assistant/turns.py` | **Med** | Distinguishes mid-thought hesitation pauses from completed questions in `TurnTracker`, reducing `COMMIT_MS` latency from 320 ms to ~120 ms. |
| **#8** | **Zero-Cost Local Neural TTS Fallback (EN + EL)** (`k2-fsa/sherpa-onnx`, `OHF-Voice/piper1-gpl`, `hexgrad/kokoro`) | `server/audio/speak.py` | **Med** | Provides `<35 ms` offline English (`kokoro-82m` / `piper`) and Greek (`el_GR-rapunzelina-low`) ONNX TTS so VoxEye never goes silent if Wi-Fi drops. |
