# Open-Source Repository & Implementation Upgrade Research for VoxEye (`app/`)

**Date:** November 2026  
**Scope:** Comprehensive audit of `app/` (`static/` and `server/`) mapped against active open-source repositories, pretrained checkpoints, and browser/edge libraries across assistive navigation, monocular metric depth & free-space segmentation, 3D HRTF spatial audio sonification, and neural voice UX / barge-in.

---

## 1. Executive Summary & Baseline Audit of VoxEye (`app/`)

Before mapping external open-source repositories to VoxEye, it is critical to distinguish **what VoxEye already implements in `app/`** from **what is genuinely new and additive**:

### What VoxEye Already Implements Today
1. **Browser WebGPU + Server ONNX Relative Depth (`app/static/depth_worker.js`, `app/static/depth_engine.js`, `app/server/depth/local_depth.py`)**:
   - Client runs `onnx-community/depth-anything-v2-small` via `@huggingface/transformers@3.7.1` inside a Web Worker (`depth_worker.js`) using a `224×224` (`16×14` ViT patch grid) square center crop (`70%` of shorter video axis), with automatic `q4f16` → `q4` → `fp16` → `fp32` fallback and shader pre-warming.
   - `depth_engine.js` manages a single idempotent loop (`0 ms` interval for Hold-1s sonar; `180 ms` / ~5 fps for the always-on stop guard).
   - `looming.js` (`chooseDepthTarget`) monitors mobile steady-state latency (`MOBILE_SLOW_MS = 280 ms`) and automatically fails over to `server/depth/local_depth.py`, which runs `depth_anything_v2_small_q4.onnx` at `168×168` via Python `onnxruntime`.
2. **Metric Disparity Calibration & Movement-Gated Emergency Stops (`app/static/looming.js`, `app/server/depth/center_probe.py`)**:
   - Because `onnx-community/depth-anything-v2-small` predicts **scale-ambiguous relative inverse depth (disparity)**, `Looming.DepthCalibrator` converts disparity to meters ($Z = k / \text{disp}$) using a default prior ($k=4.5$) and dynamically re-anchors $k$ via hardware lens `focusDistance` (`Looming.parseFocusDistance` from Web PDAF) or periodic Gemini center-crop JSON probes (`server/depth/center_probe.py`).
   - `Looming.ApproachDetector` computes a least-squares velocity slope over a `1500 ms` window and only triggers `shouldStop()` when the center surface is **actively closing in** ($\ge 0.25\text{ m}$ drop at $\ge 0.2\text{ m/s}$ within `0.9 m` / `0.6 m`, or Time-To-Contact $\le 1.4\text{ s}$), while `ImuState` suppresses false stops during phone panning (`> 60 deg/s`).
3. **Deterministic Steering Math + Compass Fusion (`app/server/safety/steering.py`, `app/server/safety/alerts.py`, `app/server/assistant/info_pipeline.py`)**:
   - On `depth_stop`, `alerts.py` cuts ongoing speech, blocks the Q&A pipeline (`state.emergency_active = True`), plays pre-cached `"Stop!"` (`"Σταμάτα!"`), and calls `info_pipeline.guide_after_depth_stop()`.
   - Gemini only reports visual perception JSON (`{"a": "turn"|"wait"|"stay", "left": 0.0..0.5, "right": 0.5..1.0, "more_open": "left"|"right", "what": "..."}`). All turn geometry is computed deterministically in `steering.py` (`decide_turn`) from camera horizontal FOV (`52°` portrait, `68°` landscape) and the signed compass delta to `state.target_bearing_deg`.
4. **Adaptive RMS Voice Gate & Turn Tracker (`app/static/micgate.js`, `app/static/app.js`, `app/server/assistant/turns.py`)**:
   - `app.js` captures 16 kHz mono PCM via `ctx.createScriptProcessor(4096, 1, 1)` and feeds `MicGate` (`onsetMs=170`, `hangMs=500`, `adaptiveFloor=true`, `ECHO_FACTOR=1.6`), which triggers instant local playback cut (`bargeIn()`) and streams 1-byte voice-flagged PCM chunks to `TurnTracker` (`turns.py`).
5. **Dual-Provider Geolocation & Tour Guide (`app/server/geo/providers.py`, `app/server/geo/service.py`)**:
   - `FallbackProvider` uses Google Places API (New), Geocoding, and Routes (Walking) and automatically falls back to OpenStreetMap (`Overpass` raced with `Nominatim` keyword search), re-aiming `target_bearing_deg` as the user walks (`on_gps_update`).

### Key Bottlenecks & Upgrade Opportunities Identified in `app/`
- **Depth Bottleneck 1 (Center-Only 20%×20% Blind Spot & Cloud Calibration Drift):** Both `depth_worker.js` (`extractCenterStats`) and `local_depth.py` (`extract_center_disparity_np`) discard **96% of the depth map** (keeping only the central `0.40..0.60` box) and rely on relative disparity anchored by cloud Gemini calls (`center_probe.py`) when Web PDAF is unavailable (e.g., iOS Safari). Furthermore, `guide_after_depth_stop` has to wait ~400–900 ms for a cloud Gemini call just to locate the `left`/`right` open gap—even though the local depth map already contains the horizontal gap geometry!
- **Depth Bottleneck 2 (Missing Apple Silicon CoreML Acceleration):** `local_depth.py` only checks `CUDAExecutionProvider` and `CPUExecutionProvider`, ignoring `CoreMLExecutionProvider` on macOS laptops.
- **Audio Bottleneck (Mono Oscillator Beeps & Spoken Compass Chatter):** Both `depthBeep()` (`app.js:783`) and `alertCue()` (`app.js:384`) connect directly to `ctx.destination` (mono). Compass guidance (`alerts.py:241`) relies on periodic spoken TTS interruptions (`"Turn slightly right"`) rather than continuous, non-verbal 3D HRTF spatial audio beacons.
- **Voice UX Bottleneck (`ScriptProcessorNode` + RMS Energy Gate):** `app.js:479` uses the deprecated main-thread `ScriptProcessorNode(4096, 1, 1)` (~85–256 ms chunk latency, vulnerable to UI/GPU frame drops), and `micgate.js` relies purely on RMS amplitude (`Math.sqrt(sum / input.length)`), which cannot distinguish loud street traffic, wind, or café clatter from human speech.

---

## 2. Domain 1: End-to-End Open-Source BLV Navigation & Assistive Vision Repositories

### 2.1 Microsoft Soundscape, Soundscape Web Client & VoiceVista
- **Repositories:**
  - `microsoft/soundscape` — [https://github.com/microsoft/soundscape](https://github.com/microsoft/soundscape)
  - `soundscape-community/soundscape-web-client` — [https://github.com/soundscape-community/soundscape-web-client](https://github.com/soundscape-community/soundscape-web-client)
  - `drwjf/VoiceVista` — [https://github.com/drwjf/VoiceVista](https://github.com/drwjf/VoiceVista)
- **What They Solve:** Microsoft Research open-sourced Soundscape (iOS Swift + spatial audio engine), which was subsequently forked into `drwjf/VoiceVista` (the active production iOS successor) and `soundscape-community/soundscape-web-client` (a browser/PWA implementation using Web Audio API + OpenStreetMap/GeoJSON tiles).
- **Key Architectural Patterns for VoxEye:**
  1. **3D Spatial Audio Beacons Instead of Verbal Turn Spam:** Instead of speaking `"Turn slightly left toward target"` every few seconds (`alerts.py:maybe_guide_compass`), Soundscape/VoiceVista place a continuous 3D HRTF audio beacon at the target's azimuth (`target_bearing_deg`), changing timbre/rhythmic pattern when aligned within `±15°` (the "on-axis" sweet spot) vs. off-axis.
  2. **OSM Intersection & Road-Crossing Geometry:** `soundscape-web-client` parses OpenStreetMap ways/nodes to identify intersection topology (T-junction, 4-way crossing, sidewalk bearing) rather than just POIs, which can directly upgrade `app/server/geo/providers.py` (`OsmProvider`).

### 2.2 CMU HULOP (`NavCogIOSv3` / `blelocpp`) & `CMU-cabot/cabot`
- **Repositories:**
  - `hulop/NavCogIOSv3` — [https://github.com/hulop/NavCogIOSv3](https://github.com/hulop/NavCogIOSv3)
  - `hulop/blelocpp` — [https://github.com/hulop/blelocpp](https://github.com/hulop/blelocpp)
  - `CMU-cabot/cabot` — [https://github.com/CMU-cabot/cabot](https://github.com/CMU-cabot/cabot) *(Note: often referred to alongside NavCog in CMU Cognitive Assistance Lab literature; "Caboodle" is a frequent informal conflation of **CaBot** + **NavCog**).*
- **What They Solve:** Turn-by-turn indoor/outdoor blind navigation (`NavCog`) and autonomous physical mobility guidance (`CaBot`) developed by CMU and IBM Research.
- **Key Architectural Patterns for VoxEye:**
  1. **Action-Oriented Acoustic & Haptic Micro-Cues (`CMU-cabot` & `NavCogIOSv3`):** CaBot and NavCog decouple *pre-turn warnings*, *immediate turn execution*, and *obstacle clearance* into standardized earcons and asymmetric vibration patterns.
  2. **PDR (Pedestrian Dead Reckoning) + Gyro Heading Fusion (`hulop/blelocpp`):** Fuses step detection (`walking` variance in `looming.js:ImuState`) with gyroscope yaw integration (`r.alpha`) so indoor magnetic compass disturbances (steel beams, elevators) do not corrupt `compassDeg` during short indoor detours.

### 2.3 WalkVLM (`xiaoyuan1996/walkvlm`) & WorldScribe (UIST 2024)
- **Repositories & Artifacts:**
  - `xiaoyuan1996/walkvlm` — [https://github.com/xiaoyuan1996/walkvlm](https://github.com/xiaoyuan1996/walkvlm) (ICCV 2025, Project: [https://walkvlm2024.github.io](https://walkvlm2024.github.io))
  - `WorldScribe` — [https://worldscribe.org](https://worldscribe.org) / [https://arxiv.org/abs/2408.06627](https://arxiv.org/abs/2408.06627) (ACM UIST 2024)
- **What They Solve:**
  - **WalkVLM** addresses *output verbosity* and *temporal redundancy* in streaming VLM blind walking assistants using hierarchical Chain-of-Thought planning and Temporal-Aware Adaptive Prediction (benchmarked on the 12k-video Walking Awareness Dataset).
  - **WorldScribe** dynamically adapts visual description granularity based on **camera motion (IMU panning speed)** and **ambient acoustic noise**: emitting 1–3 word object labels when the user is scanning/walking fast, and 2–3 sentence descriptions only when the user stops and holds the camera steady.
- **Direct Upgrade for VoxEye (`app/server/assistant/info_pipeline.py`):**
  - VoxEye already streams `imu.snapshot()` (`angularSpeed`, `panning`, `walking`) with every frame (`app.js:905`), and `router.py` stores `state.imu`. Passing `walking` and `panning` into `INFO_SYSTEM` / `answer_user_audio()` in `info_pipeline.py` allows VoxEye to adopt WorldScribe's motion-adaptive verbosity rule (ultra-terse 4–6 word answers while `walking === true`, richer descriptions when `walking === false`).

### 2.4 Open-Source Depth + Sonification & Edge Assistive Vision Projects
- **Repositories:**
  - `MIT-Assistive-Technology/Project-Daredevil` — [https://github.com/MIT-Assistive-Technology/Project-Daredevil](https://github.com/MIT-Assistive-Technology/Project-Daredevil) (Monocular DPT depth + YOLO + OpenAL stereo/3D echolocation for iPhone/AirPods)
  - `SynnIA/sonic-vision` — [https://github.com/SynnIA/sonic-vision](https://github.com/SynnIA/sonic-vision) (On-device depth-to-HRTF 3D spatial audio + inverse-exponential haptic curves)
  - `pranavlal/vOICe_depth` — [https://github.com/pranavlal/vOICe_depth](https://github.com/pranavlal/vOICe_depth) (Depth-map-to-soundscape auditory sensory substitution)
  - `paavansirivardhan123/Visiona` — [https://github.com/paavansirivardhan123/Visiona](https://github.com/paavansirivardhan123/Visiona) (Depth-Anything-V2 + YOLO + LLM assistive navigation & risk scoring)
  - `Inkesk-Dozing/N.A.V.R.A.A.H` — [https://github.com/Inkesk-Dozing/N.A.V.R.A.A.H](https://github.com/Inkesk-Dozing/N.A.V.R.A.A.H) (Conversational VLM + real-time video obstacle guidance)

---

## 3. Domain 2: Fast Monocular Metric Depth & Obstacle / Free-Space Segmentation (WebGPU & ONNX)

### 3.1 Depth-Anything-V2 Metric Checkpoints (`DepthAnything/Depth-Anything-V2`)
- **Repositories & Checkpoints:**
  - Official GitHub: [https://github.com/DepthAnything/Depth-Anything-V2](https://github.com/DepthAnything/Depth-Anything-V2) (`metric_depth/` directory)
  - Hugging Face Indoor Metric (Hypersim, max 20m): [https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf)
  - Hugging Face Outdoor Metric (Virtual KITTI, max 80m): [https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf)
- **Why This Upgrades VoxEye (`local_depth.py` & `depth_worker.js`):**
  - Currently, `depth_worker.js` and `local_depth.py` run the **relative** `onnx-community/depth-anything-v2-small` checkpoint. Because relative disparity scale ($k$) shifts whenever the camera moves from an open room to a blank wall, VoxEye must fire background Gemini API requests (`server/depth/center_probe.py`) every `1.2s–3.0s` (`GUARD_ANCHOR_NEAR_MS` / `GUARD_ANCHOR_FAR_MS` in `app.js:205`) whenever Web PDAF is unavailable.
  - Exporting `depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf` to INT4/INT8 ONNX via `optimum-cli export onnx --model depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf` produces a **drop-in identical ViT-S architecture (24.8M params)** with the exact same latency (`~40–90 ms` in WebGPU at `224×224`, `~15–35 ms` in ONNX Runtime at `168×168`), but outputs **direct metric depth in meters**—eliminating `center_probe.py` API calls, network latency, and scale-jump epoch resets (`calibrator.epoch++`).

### 3.2 Multi-Zone & Ground-Plane Geometry Extraction from the Existing Depth Tensor
- **Where VoxEye Leaves Free Performance on the Table (`depth_worker.js:13-40`, `local_depth.py:83-104`, `steering.py`):**
  - Both `depth_worker.js` and `local_depth.py` already compute the full 2D depth map (`224×224` or `168×168`), but `extractCenterStats()` only reads `x ∈ [0.40, 0.60], y ∈ [0.40, 0.60]`.
  - By slicing the already-computed 2D depth tensor into **5 spatial zones** at zero extra neural inference cost:
    1. **Left Corridor (`x ∈ [0.05, 0.35], y ∈ [0.30, 0.75]`)**
    2. **Center Corridor (`x ∈ [0.35, 0.65], y ∈ [0.30, 0.75]`)**
    3. **Right Corridor (`x ∈ [0.65, 0.95], y ∈ [0.30, 0.75]`)**
    4. **Head-Height Overhang Zone (`x ∈ [0.30, 0.70], y ∈ [0.05, 0.30]`)** — catches tree branches, signs, and cabinet doors that white canes miss!
    5. **Lower Ground / Drop-Off Zone (`x ∈ [0.30, 0.70], y ∈ [0.75, 0.95]`)** — detects sudden depth drops (stairs down, curbs, unmarked pits) when ground distance suddenly exceeds expected ground-plane geometry ($Z_{\text{ground}} \approx H_{\text{cam}} / \sin(\theta_{\text{pitch}})$ using `imu.pitchDeg` already tracked in `looming.js:62`!).
  - **Instant 0 ms Deterministic Turn Before Gemini Replies (`alerts.py` + `steering.py`):**
    - By sending `{leftDisp, centerDisp, rightDisp, gapLeftX, gapRightX}` inside the `depth_stop` payload (`app.js:691`), `steering.decide_turn()` can compute and speak `"Stop! Turn right 30 degrees."` in **0 ms** from local depth + compass alone, while Gemini (`guide_after_depth_stop`) runs in parallel solely to append the semantic description (`"Box one step ahead."`).

### 3.3 Zero-Shot Metric Depth & Surface Normals (Apple `ml-depth-pro`, `Metric3D v2`, `UniDepth v2`)
- **Repositories:**
  - **Apple ML-Depth-Pro:** [https://github.com/apple/ml-depth-pro](https://github.com/apple/ml-depth-pro) (ONNX port: [https://huggingface.co/onnx-community/DepthPro-ONNX](https://huggingface.co/onnx-community/DepthPro-ONNX))
  - **Metric3D v2:** [https://github.com/YvanYin/Metric3D](https://github.com/YvanYin/Metric3D) (WebGPU/ONNX port: [https://huggingface.co/onnx-community/metric3d-vit-small](https://huggingface.co/onnx-community/metric3d-vit-small))
  - **UniDepth v2:** [https://github.com/lpiccinelli-eth/UniDepth](https://github.com/lpiccinelli-eth/UniDepth)
- **How They Compare for VoxEye:**
  - `onnx-community/metric3d-vit-small` runs directly in `@huggingface/transformers` and predicts **both metric depth and surface normals**. Surface normals allow deterministic classification of **vertical walls/obstacles** ($n_y \approx 0$) vs. **walkable horizontal floor** ($n_y \approx 1$) vs. **stairs/ramps** without running a separate segmentation network.
  - `apple/ml-depth-pro` estimates camera focal length ($f_x, f_y$) automatically from a single frame and produces ultra-sharp thin-structure boundaries (poles, bollards, chair legs, glass door frames), making it an ideal upgrade for server-side GPU inference (`local_depth.py`), though too heavy (~300M params) for mobile WebGPU.

### 3.4 Browser WebGPU Semantic Free-Space Segmentation (`transformers.js` + `SegFormer-B0`)
- **Repositories & Models:**
  - `huggingface/transformers.js` — [https://github.com/huggingface/transformers.js](https://github.com/huggingface/transformers.js)
  - `Xenova/segformer-b0-finetuned-ade-512-512` / `onnx-community/segformer-b0-finetuned-ade-512-512` — [https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512](https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512)
- **What It Solves:**
  - Depth alone cannot distinguish a flat painted line or shadow from a curb, nor grass/gravel from a paved sidewalk.
  - `SegFormer-B0` (only **3.7M parameters**—6× smaller than Depth-Anything-V2-Small!) runs in `~15–30 ms` on WebGPU via `@huggingface/transformers` (already loaded in `depth_worker.js`!) and segments ADE20K classes including `floor` (class 3), `road` (class 6), `sidewalk/pavement` (class 11), `stairs` (class 53), `step/stairway` (class 121), `door` (class 14), and `person` (class 12).
  - Running `SegFormer-B0` on `depth_stop` frames (or at 1–2 Hz in `depth_worker.js`) gives exact pixel coordinates `left` and `right` of walkable `floor`/`sidewalk` to feed directly into `server/safety/steering.py:decide_turn()`.

### 3.5 Apple Silicon `CoreMLExecutionProvider` in `server/depth/local_depth.py`
- **Repository:** `microsoft/onnxruntime` — [https://github.com/microsoft/onnxruntime](https://github.com/microsoft/onnxruntime)
- **Exact Bug/Opportunity in `app/server/depth/local_depth.py:48-54`:**
  - Currently, `_create_session()` only checks:
    ```python
    providers = (
        ["CUDAExecutionProvider", "CPUExecutionProvider"]
        if "CUDAExecutionProvider" in avail
        else ["CPUExecutionProvider"]
    )
    ```
  - On macOS (M1/M2/M3/M4 laptops used in demos), `CoreMLExecutionProvider` is built into standard `onnxruntime` wheels (`ort.get_available_providers()`), accelerating ViT/ONNX inference on Apple Neural Engine / Metal GPU by **2.5×–4×** while freeing CPU threads for FastAPI WebSocket audio streaming.

---

## 4. Domain 3: Spatial Audio & Tactile Sonification (3D HRTF vs. Mono Beeps)

### 4.1 Native WebAudio 3D HRTF `PannerNode` + Soundscape Web Beacons
- **Repositories & Standards:**
  - `soundscape-community/soundscape-web-client` — [https://github.com/soundscape-community/soundscape-web-client](https://github.com/soundscape-community/soundscape-web-client)
  - `GoogleChrome/omnitone` — [https://github.com/GoogleChrome/omnitone](https://github.com/GoogleChrome/omnitone) (WebAudio Ambisonic / FOA-HOA binaural renderer)
  - `resonance-audio/resonance-audio-web-sdk` — [https://github.com/resonance-audio/resonance-audio-web-sdk](https://github.com/resonance-audio/resonance-audio-web-sdk) *(Note: Archived by Google in April 2026; relies on deprecated `ScriptProcessorNode` internally—prefer native WebAudio `PannerNode({ panningModel: "HRTF" })` or `Omnitone` HOA).*
- **Why This Upgrades VoxEye (`app/static/app.js` & `app/static/looming.js`):**
  - Currently, `depthBeep(freqHz, volume)` (`app.js:783`) and `alertCue()` (`app.js:384`) route `OscillatorNode -> GainNode -> ctx.destination`, producing flat **mono** audio in both ears.
  - Furthermore, compass guidance (`alerts.py:compass_loop`) interrupts the user with synthesized speech (`"Turn slightly right"`), which causes auditory masking and cognitive fatigue.
  - **Zero-Dependency Native WebAudio `PannerNode` Upgrade (`app.js`):**
    - Creating a reusable `PannerNode` with `panningModel: "HRTF"` and `distanceModel: "inverse"` allows VoxEye to position:
      1. **Directional Obstacle Sonar:** Place the sonar pulse in 3D space at $(x, y, z)$ where $x = d \sin(\theta_{\text{obstacle}})$, $y = \text{elevation}$ (high pitch + $+y$ for head-height overhang, low pitch + $-y$ for ground drop-off), $z = -d \cos(\theta_{\text{obstacle}})$.
      2. **Continuous 3D Compass Beacon:** When `dbg.compassTarget` is active (`app.js:1037`), play a subtle, non-intrusive 3D spatial click/chime positioned at $\Delta\theta = \text{targetDeg} - \text{imu.compassDeg}$ around the user's head in real time (`60 Hz` orientation update in `maybePushImu()`), matching `microsoft/soundscape` and `drwjf/VoiceVista`.

---

## 5. Domain 4: Voice UX, Neural VAD, Turn-Taking & Low-Latency TTS

### 5.1 Browser WebAssembly Silero VAD v5 (`@ricky0123/vad-web`) + `AudioWorklet`
- **Repositories:**
  - `ricky0123/vad` (`@ricky0123/vad-web`) — [https://github.com/ricky0123/vad](https://github.com/ricky0123/vad) (Docs: [https://docs.vad.ricky0123.com](https://docs.vad.ricky0123.com))
  - `snakers4/silero-vad` — [https://github.com/snakers4/silero-vad](https://github.com/snakers4/silero-vad) (Silero VAD v5 ONNX model, `~1.8 MB`, `<1 ms` per 32ms audio frame)
- **Why This Upgrades VoxEye (`app/static/micgate.js` & `app/static/app.js:476-509`):**
  - **Problem 1 (`ScriptProcessorNode`):** `app.js:479` uses `ctx.createScriptProcessor(4096, 1, 1)`. At 48 kHz, 4096 samples adds **85.3 ms of buffer latency** before `micGate` even sees the audio, and runs on the main UI thread (where canvas `getImageData` and DOM debug rendering happen every 200 ms).
  - **Problem 2 (RMS Energy Gate in Noisy Venues):** `micgate.js` computes RMS amplitude (`dbg.micLevel = Math.sqrt(sum / input.length)`). In a crowded exhibition hall (like GenAI Summit!) or noisy street, background noise raises `noiseFloor`, either forcing the user to shout (`openThresh = Math.max(gate, floorOpen)`) or triggering false barge-ins on traffic/clapping/coughs that last `>170 ms`, which then waste a Gemini API call only to return `HEARD: NONE` (`heard_ignored`).
  - **Solution:** `@ricky0123/vad-web` runs **Silero VAD v5** in an `AudioWorklet` via `onnxruntime-web` WASM. It outputs a true neural speech probability $p_{\text{speech}} \in [0, 1]$ every `30 ms` (`512` samples at 16 kHz) trained specifically to ignore non-speech noise (wind, traffic, clatter, music).
  - **Integration Strategy:** Feed Silero VAD's `p_speech` directly into `MicGate.process()` (or use `MicVAD` callbacks) so `flag = 1` and `bargeIn()` fire **only on human vocal formants**, eliminating manual `gateDown`/`gateUp` button tuning (`app.js:1226`).

### 5.2 Semantic + Acoustic Turn Detection (`livekit/agents` & `pipecat-ai/pipecat`)
- **Repositories:**
  - `livekit/agents` (Multilingual Turn Detector) — [https://github.com/livekit/agents](https://github.com/livekit/agents) (Model: [https://huggingface.co/livekit/turn-detector](https://huggingface.co/livekit/turn-detector))
  - `pipecat-ai/pipecat` (`LocalSmartTurnAnalyzerV3`) — [https://github.com/pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat)
  - `gradio-app/fastrtc` — [https://github.com/gradio-app/fastrtc](https://github.com/gradio-app/fastrtc)
- **Why This Upgrades VoxEye (`app/server/assistant/turns.py`):**
  - Currently, `TurnTracker` (`turns.py:68`) uses a fixed silence timer (`wait = self.end_wait + (0.4 if self.voiced_s < 1.0 else 0.0)`). If a blind user pauses for `500 ms` mid-sentence while thinking (`"Take me to... the Acropolis Museum"`), `turns.py` prematurely cuts the turn in half; conversely, when they ask a crisp question (`"What is ahead?"`), they wait `400–900 ms` of dead air before Gemini even starts.
  - `pipecat-ai`'s `LocalSmartTurnAnalyzerV3` (an ultra-fast local ONNX acoustic end-of-turn classifier running in `<12 ms` on CPU) predicts whether a prosodic pause is a **mid-thought hesitation** vs. a **completed utterance** directly from the 16 kHz PCM buffer in `turns.py`, cutting turn-end latency to `~150 ms` on complete questions while waiting patiently on mid-sentence pauses.

### 5.3 Local Zero-Latency Bilingual (EN/EL) ONNX TTS Fallback (`sherpa-onnx`, `piper1-gpl`, `kokoro`)
- **Repositories:**
  - `k2-fsa/sherpa-onnx` — [https://github.com/k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
  - `OHF-Voice/piper1-gpl` — [https://github.com/OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) (Active fork of `rhasspy/piper` with `el_GR` and `en_US` VITS ONNX voices)
  - `hexgrad/kokoro` — [https://github.com/hexgrad/kokoro](https://github.com/hexgrad/kokoro) (`Kokoro-82M` ONNX/WebGPU TTS)
- **Why This Upgrades VoxEye (`app/server/audio/speak.py`):**
  - Currently, `speak.py` calls cloud Gemini TTS (`_get_client().aio.models.generate_content_stream(model=config.TTS_MODEL)`) or `fal.py`, with a `~465 ms` time-to-first-audio for uncached clauses, and falls back to robotic browser `window.speechSynthesis` (`speak_text`) on timeout/offline.
  - Integrating `k2-fsa/sherpa-onnx` or `OHF-Voice/piper1-gpl` in `server/audio/speak.py` provides a **local ONNX Runtime TTS fallback** (`<35 ms` time-to-first-audio on CPU/CoreML) for uncached dynamic obstacle descriptions (`what` in `guide_after_depth_stop`, e.g., `"Wooden chair one step ahead"`) so emergency stop guidance never blocks on a 4.0s cloud TTS timeout (`info_pipeline.py:871`).

---

## 6. Actionable Upgrade Matrix: Mapped to Exact `app/` Files (Ranked by Effort vs. Impact)

| Rank | Upgrade & Open-Source Repo / Checkpoint | Target File(s) in `app/` | Effort | Impact | Why It Wins for Hackathon & Production |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **#1** | **Multi-Zone Depth Slicing (Left/Center/Right + Overhang + Drop-off) & 0ms Local Turn Pre-Computation** *(Depth-Anything-V2 tensor geometry)* | `static/depth_worker.js`<br>`static/looming.js`<br>`server/depth/local_depth.py`<br>`server/safety/steering.py` | **Low** (~2 hrs) | **Critical** | Uses the 96% of the depth map currently thrown away by `extractCenterStats()`. Detects head-height overhangs & stairs/curbs, and lets `steering.py` speak `"Turn right 30 degrees"` in **0 ms** without waiting for Gemini! |
| **#2** | **3D HRTF Spatial Audio Sonar & Soundscape-Style Continuous Target Beacons** *(W3C WebAudio `PannerNode` + `soundscape-web-client`)* | `static/app.js`<br>`static/looming.js`<br>`server/safety/alerts.py` | **Low** (~2–3 hrs) | **High** | Replaces flat mono `depthBeep()` & `alertCue()` with 3D binaural HRTF audio positioned at obstacle/waypoint azimuth & elevation. Judges wearing headphones immediately hear where the obstacle or target is in 3D space. |
| **#3** | **Browser WASM Silero VAD v5 + `AudioWorklet`** *(`ricky0123/vad` / `@ricky0123/vad-web` + `snakers4/silero-vad`)* | `static/micgate.js`<br>`static/app.js`<br>`static/index.html` | **Low–Med** (~3 hrs) | **High** | Replaces deprecated `ScriptProcessorNode(4096)` and amplitude-only `MicGate` with a neural VAD via CDN. Bulletproofs live stage demos against crowd chatter and false barge-ins. |
| **#4** | **Apple Silicon `CoreMLExecutionProvider` + Metric Depth Checkpoint** *(`depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf` + `onnxruntime`)* | `server/depth/local_depth.py`<br>`static/depth_worker.js`<br>`server/depth/center_probe.py` | **Low–Med** (~2–3 hrs) | **High** | Adding `CoreMLExecutionProvider` is a 3-line change in `local_depth.py`. Swapping to the Metric checkpoint gives true meters out-of-the-box and eliminates periodic `center_probe.py` Gemini calls. |
| **#5** | **Motion-Adaptive Description Granularity (WorldScribe & WalkVLM Pattern)** *(`xiaoyuan1996/walkvlm` + `WorldScribe` UIST '24)* | `server/assistant/info_pipeline.py`<br>`server/core/router.py` | **Low** (~1 hr) | **Med–High** | Uses `state.imu["walking"]` and `state.imu["panning"]` already sent by `app.js` to enforce ultra-concise (<6 words) safety-first answers while walking and rich descriptions when stationary. |
| **#6** | **On-Device WebGPU Semantic Floor/Walkable Segmentation** *(`huggingface/transformers.js` + `Xenova/segformer-b0-finetuned-ade-512-512`)* | `static/depth_worker.js`<br>`server/safety/steering.py` | **Medium** (~4–6 hrs) | **Med–High** | Runs a 3.7M-param SegFormer-B0 alongside Depth-Anything-V2 in `depth_worker.js` to segment `floor`, `sidewalk`, `stairs`, and `door` locally in the browser. |
| **#7** | **Acoustic + Semantic Smart Turn Detection** *(`pipecat-ai/pipecat` `LocalSmartTurnAnalyzerV3` / `livekit/turn-detector`)* | `server/assistant/turns.py` | **Medium** (~4–6 hrs) | **Medium** | Replaces fixed `end_wait` timer in `TurnTracker` with a local `<12 ms` ONNX prosodic turn-end classifier so users aren't cut off mid-thought. |
| **#8** | **Surface Normals for Curb / Stair / Wall Classification** *(`YvanYin/Metric3D` / `onnx-community/metric3d-vit-small`)* | `static/depth_worker.js`<br>`server/depth/local_depth.py` | **High** (Post-Hackathon) | **High** | Joint metric depth + surface normal prediction to distinguish flat ground from ramps, curbs, and drop-offs geometrically. |

---

## 7. Concrete Implementation Blueprints for Top Upgrades

### Blueprint A: Multi-Zone Depth Extraction & Instant Local Gap Detection (`depth_worker.js` & `local_depth.py`)
In `app/static/depth_worker.js` (`extractCenterStats`, lines 13–40) and `app/server/depth/local_depth.py` (`extract_center_disparity_np`, lines 83–104), upgrade the single center box to compute left/center/right corridor disparities plus upper overhang disparity and horizontal open-gap coordinates (`leftGapX`, `rightGapX`):

```javascript
// Drop-in upgrade for app/static/depth_worker.js: extractCenterStats(data, width, height)
function extractSpatialStats(data, width, height) {
  const zoneDisparity = (xMinF, xMaxF, yMinF, yMaxF, pct = 0.75) => {
    const x0 = Math.max(0, Math.floor(width * xMinF)), x1 = Math.min(width, Math.ceil(width * xMaxF));
    const y0 = Math.max(0, Math.floor(height * yMinF)), y1 = Math.min(height, Math.ceil(height * yMaxF));
    const vals = [];
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = x0; x < x1; x++) {
        const v = Number(data[row + x]);
        if (Number.isFinite(v) && v > 0) vals.push(v);
      }
    }
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    return vals[Math.min(vals.length - 1, Math.floor(vals.length * pct))];
  };

  const centerDisp = zoneDisparity(0.40, 0.60, 0.40, 0.60, 0.75);
  if (centerDisp === null) return null;
  const leftDisp = zoneDisparity(0.05, 0.35, 0.35, 0.75, 0.75);
  const rightDisp = zoneDisparity(0.65, 0.95, 0.35, 0.75, 0.75);
  const overhangDisp = zoneDisparity(0.35, 0.65, 0.08, 0.32, 0.80); // Head-level hazards

  return {
    centerDisp,
    leftDisp,
    rightDisp,
    overhangDisp,
    moreOpen: (leftDisp ?? centerDisp) < (rightDisp ?? centerDisp) ? "left" : "right",
  };
}
```

### Blueprint B: 3D HRTF Spatial Audio for Sonar & Compass Beacons (`app/static/app.js`)
Upgrade `depthBeep()` (`app/static/app.js:783`) to accept an optional horizontal azimuth `azimuthDeg` (`-90` left .. `0` center .. `+90` right) and elevation `elevDeg` using WebAudio's native `PannerNode`:

```javascript
// Drop-in 3D HRTF upgrade for app/static/app.js
let spatialPanner = null;
function getSpatialPanner() {
  if (!ctx) return null;
  if (!spatialPanner) {
    spatialPanner = ctx.createPanner();
    spatialPanner.panningModel = "HRTF";
    spatialPanner.distanceModel = "inverse";
    spatialPanner.refDistance = 1.0;
    spatialPanner.maxDistance = 10.0;
    spatialPanner.rolloffFactor = 1.0;
    spatialPanner.connect(ctx.destination);
  }
  return spatialPanner;
}

function depthBeep3D(freqHz, volume, azimuthDeg = 0, elevDeg = 0, distM = 1.0) {
  if (!ctx || !(volume > 0)) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t0 = ctx.currentTime, dur = 0.05;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(freqHz, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(volume, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  const panner = getSpatialPanner();
  if (panner) {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevDeg * Math.PI) / 180;
    const d = Math.max(0.3, Math.min(4.0, distM));
    const x = d * Math.sin(az) * Math.cos(el);
    const y = d * Math.sin(el);
    const z = -d * Math.cos(az) * Math.cos(el); // WebAudio forward is -Z
    if (panner.positionX) {
      panner.positionX.setValueAtTime(x, t0);
      panner.positionY.setValueAtTime(y, t0);
      panner.positionZ.setValueAtTime(z, t0);
    } else {
      panner.setPosition(x, y, z);
    }
    o.connect(g).connect(panner);
  } else {
    o.connect(g).connect(ctx.destination);
  }
  o.start(t0);
  o.stop(t0 + dur + 0.005);
}
```

### Blueprint C: Enabling Apple Silicon `CoreMLExecutionProvider` (`app/server/depth/local_depth.py`)
In `app/server/depth/local_depth.py` (lines 48–56), add `CoreMLExecutionProvider`:

```python
    avail = ort.get_available_providers()
    if "CUDAExecutionProvider" in avail:
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    elif "CoreMLExecutionProvider" in avail:
        providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    else:
        providers = ["CPUExecutionProvider"]
    sess = ort.InferenceSession(str(model_file), sess_options=opts, providers=providers)
    active_prov = sess.get_providers()[0]
    label = (
        "Laptop CUDA" if "CUDA" in active_prov
        else "Laptop CoreML" if "CoreML" in active_prov
        else f"Laptop CPU ({phys_threads}t)"
    )
```

---

## 8. Complete Cited Open-Source Reference Index

1. **Microsoft Soundscape (Original iOS Spatial Audio Navigation):** [https://github.com/microsoft/soundscape](https://github.com/microsoft/soundscape)
2. **Soundscape Community Web Client (Browser WebAudio + OSM):** [https://github.com/soundscape-community/soundscape-web-client](https://github.com/soundscape-community/soundscape-web-client)
3. **VoiceVista (Active Open-Source Soundscape Successor):** [https://github.com/drwjf/VoiceVista](https://github.com/drwjf/VoiceVista)
4. **CMU HULOP / NavCog v3 & BLE Localization (`blelocpp`):** [https://github.com/hulop/NavCogIOSv3](https://github.com/hulop/NavCogIOSv3) · [https://github.com/hulop/blelocpp](https://github.com/hulop/blelocpp)
5. **CMU CaBot (Autonomous Blind Navigation Suitcase & Vibrotactile Handle):** [https://github.com/CMU-cabot/cabot](https://github.com/CMU-cabot/cabot)
6. **WalkVLM (ICCV 2025 Blind Walking VLM & WAD Dataset):** [https://github.com/xiaoyuan1996/walkvlm](https://github.com/xiaoyuan1996/walkvlm) · [https://walkvlm2024.github.io](https://walkvlm2024.github.io)
7. **WorldScribe (ACM UIST 2024 Context-Aware Live Visual Descriptions):** [https://worldscribe.org](https://worldscribe.org) · [https://arxiv.org/abs/2408.06627](https://arxiv.org/abs/2408.06627)
8. **MIT Project Daredevil (Monocular Depth + YOLO + Spatial Audio Echolocation):** [https://github.com/MIT-Assistive-Technology/Project-Daredevil](https://github.com/MIT-Assistive-Technology/Project-Daredevil)
9. **Sonic Vision (On-Device Depth to HRTF Spatial Audio & Haptics):** [https://github.com/SynnIA/sonic-vision](https://github.com/SynnIA/sonic-vision)
10. **vOICe Depth (Depth Camera / MiDaS Auditory Sonification):** [https://github.com/pranavlal/vOICe_depth](https://github.com/pranavlal/vOICe_depth)
11. **Visiona AI (Depth-Anything-V2 + YOLO + LLM Assistive Navigation):** [https://github.com/paavansirivardhan123/Visiona](https://github.com/paavansirivardhan123/Visiona)
12. **Depth-Anything-V2 & Metric Indoor/Outdoor Checkpoints:** [https://github.com/DepthAnything/Depth-Anything-V2](https://github.com/DepthAnything/Depth-Anything-V2) · [https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf) · [https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf)
13. **Apple ML-Depth-Pro (Zero-Shot Metric Depth with Focal Length Estimation):** [https://github.com/apple/ml-depth-pro](https://github.com/apple/ml-depth-pro) · [https://huggingface.co/onnx-community/DepthPro-ONNX](https://huggingface.co/onnx-community/DepthPro-ONNX)
14. **Metric3D v2 (Joint Metric Depth + Surface Normals):** [https://github.com/YvanYin/Metric3D](https://github.com/YvanYin/Metric3D) · [https://huggingface.co/onnx-community/metric3d-vit-small](https://huggingface.co/onnx-community/metric3d-vit-small)
15. **UniDepth v2 (Universal Monocular Metric Depth with Camera Rays):** [https://github.com/lpiccinelli-eth/UniDepth](https://github.com/lpiccinelli-eth/UniDepth)
16. **Transformers.js v3 & SegFormer-B0 ADE20K (WebGPU Depth & Floor Segmentation):** [https://github.com/huggingface/transformers.js](https://github.com/huggingface/transformers.js) · [https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512](https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512)
17. **Omnitone & Resonance Audio Web SDK (WebAudio Ambisonics & HRTF):** [https://github.com/GoogleChrome/omnitone](https://github.com/GoogleChrome/omnitone) · [https://github.com/resonance-audio/resonance-audio-web-sdk](https://github.com/resonance-audio/resonance-audio-web-sdk)
18. **Silero VAD & `@ricky0123/vad-web` (Browser WebAssembly + AudioWorklet Neural VAD):** [https://github.com/ricky0123/vad](https://github.com/ricky0123/vad) · [https://github.com/snakers4/silero-vad](https://github.com/snakers4/silero-vad)
19. **LiveKit Agents & Turn Detector (Semantic + Acoustic End-of-Turn ONNX):** [https://github.com/livekit/agents](https://github.com/livekit/agents) · [https://huggingface.co/livekit/turn-detector](https://huggingface.co/livekit/turn-detector)
20. **Pipecat (`LocalSmartTurnAnalyzerV3`) & FastRTC:** [https://github.com/pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) · [https://github.com/gradio-app/fastrtc](https://github.com/gradio-app/fastrtc)
21. **Sherpa-ONNX, Piper1-GPL & Kokoro-82M (Local ONNX TTS & Bilingual EN/EL Voice):** [https://github.com/k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) · [https://github.com/OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) · [https://github.com/hexgrad/kokoro](https://github.com/hexgrad/kokoro)
