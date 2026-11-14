# AR Spatial Stream & Fast Gemini Decision Model Implementation Plan

> **For Claude / Antigravity:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace slow multi-screenshot visual guessing with a continuous 5–10 Hz browser AR/spatial telemetry stream (`SpatialFrame`) paired with a 3-tier Fast Gemini Decision Model (`gemini-3.5-flash-lite` on compact spatial state + event-triggered 256px ROI crops), immediate directional guidance & spatial earcons, live 3D scene-graph injection into `gemini-3.8-live`, and optional continuous acoustic sonar feedback.

**Architecture:**
1. **Browser Spatial Pipeline (`app/static/looming.js`, `app/static/spatial.js`, `app/static/app.js`):** Produces a unified `SpatialFrame` stream at 5–10 Hz containing a 3-corridor clearance grid (`left`, `center`, `right` meters + `open_path_clock`), 6DoF ego-motion (`walking`, `speed_m_s`, `angularSpeed`, `pitchDeg`, `panning`, `pivot_settled`), and tracked 3D objects (`id`, `label`, `clock`, `dist_m`, `closing_m_s`, `ttc_s`, `elevation`, `in_path`), plus an event-triggered `256px` JPEG ROI crop (`roi_b64`) only when a new or unconfirmed hazard enters the trajectory cone. Seamlessly auto-detects WebXR `immersive-ar` (`depth-sensing`, `hit-test`, `local-floor`) when supported/toggled while defaulting to the non-intrusive `<video>` Universal Spatial pipeline (MediaPipe + optical-flow/corridor depth + IMU).
2. **Server Fast Decision Model & 3-Tier Trigger (`app/server/spatial_decision.py`, `app/server/watch.py`, `app/server/live.py`):**
   - **Tier 1 — Instant Reflex (`0ms`):** Unambiguous imminent collision (`ttc_s <= 1.2s` and `dist_m <= 1.2m`, steady camera) immediately triggers a directional spatial earcon + phrase (`"Step left, car ahead!"`) without waiting for a round-trip API call.
   - **Tier 2 — Fast Gemini Decision Model (`~200–350ms`):** Event-driven call to `gemini-3.5-flash-lite` (`decide_spatial()`) whenever a spatial trigger fires (new object in corridor with `ttc_s < 3.5s` or `dist_m < 3.0m`, corridor clearance drop `>= 0.6m`, or `pivot_settled` into a new corridor). Sends compact `SpatialFrame` JSON + optional `256px` ROI crop (`~80%` fewer input tokens than 2–3 full screenshots), returning both hazard notification AND `open_path_clock` evade direction.
   - **Tier 3 — Live 3D Scene Graph Sync (`get_spatial_scene` tool + live context):** Keeps a rolling 3D `SpatialSceneGraph` on `State` so the conversational `gemini-3.8-live` model has instant access to metric distances, clock bearings, and clear corridors when the user asks questions.
3. **Client Spatial Audio & Optional Acoustic Sonar (`app/static/app.js`):** Adds stereo clock-face panning (`StereoPannerNode`) for directional alerts and a user-toggleable continuous acoustic sonar tick (`sonarBtn`) whose rate and pitch track center-corridor clearance.

**Tech Stack:** Vanilla JS (ES2022, WebXR Device API `immersive-ar` + `depth-sensing`, MediaPipe Tasks Vision WASM, Web Audio API `StereoPannerNode`), Python 3.11+, FastAPI, `google-genai` SDK (`gemini-3.5-flash-lite`, `gemini-3.8-live`, `gemini-3.8-flash-lite-tts`), Pydantic v2.

---

### Task 1: Unified `SpatialFrame` Math, 3-Corridor Clearance, TTC & Trigger Detection (`app/static/looming.js`)

**Files:**
- Modify: `app/static/looming.js`
- Test: `app/tests/test_looming.js`

**Step 1: Write the failing test in `app/tests/test_looming.js`**

Append unit tests for `computeCorridors`, `ttcSeconds`, `SpatialFrameBuilder`, and `shouldTriggerDecision` at the bottom of `app/tests/test_looming.js`:

```javascript
// ---- AR spatial frame: 3-corridor clearance, TTC, and event-driven trigger
{
  const { computeCorridors, ttcSeconds, SpatialFrameBuilder } = require("../static/looming.js");

  check("TTC is distance divided by closing speed when approaching", Math.abs(ttcSeconds(2.4, 1.2) - 2.0) < 0.05);
  check("TTC is null when receding or stationary", ttcSeconds(2.4, 0) === null && ttcSeconds(2.4, -0.5) === null);

  const objs = [
    { label: "pole", cx: 0.50, cy: 0.55, distM: 1.4, clock: "12 o'clock", inPath: true },
    { label: "chair", cx: 0.82, cy: 0.65, distM: 1.8, clock: "2 o'clock", inPath: false },
  ];
  const corr = computeCorridors(objs, null);
  check("center corridor reflects the 1.4m pole at 12 o'clock", corr.centerM === 1.4 && corr.rightM === 1.8 && corr.leftM >= 4.0, JSON.stringify(corr));
  check("open_path_clock recommends the clearest corridor (10 o'clock left)", corr.openPathClock === "10 o'clock", corr.openPathClock);

  const builder = new SpatialFrameBuilder();
  const f1 = builder.build({
    detections: [{ label: "person", cx: 0.5, cy: 0.5, normW: 0.20, normH: 0.35 }],
    imu: { angularSpeed: 10, panning: false, stable: true, walking: true, pitchDeg: 78 },
    depthCorridors: null,
    now: 1000,
  });
  const f2 = builder.build({
    detections: [{ label: "person", cx: 0.5, cy: 0.5, normW: 0.32, normH: 0.50 }],
    imu: { angularSpeed: 10, panning: false, stable: true, walking: true, pitchDeg: 78 },
    depthCorridors: null,
    now: 1400,
  });
  check("SpatialFrame tracks closing speed and TTC across frames", f2.objects[0].closingMs > 0.5 && f2.objects[0].ttcS !== null && f2.objects[0].ttcS < 3.0, JSON.stringify(f2.objects[0]));
  check("SpatialFrame raises decisionTrigger when obstacle approaches in center corridor", f2.trigger.fire === true && f2.trigger.reason === "corridor_approach", JSON.stringify(f2.trigger));
}
```

**Step 2: Run test to verify it fails**

Run: `node app/tests/test_looming.js`
Expected: FAIL with `computeCorridors is not a function` / `SpatialFrameBuilder is not a constructor`.

**Step 3: Write minimal implementation in `app/static/looming.js`**

Add `ttcSeconds`, `computeCorridors`, and `SpatialFrameBuilder` (including post-pivot settling detection and 3-tier trigger calculation) to `app/static/looming.js` and export them in `api`:

```javascript
  function ttcSeconds(distM, closingMs) {
    if (distM == null || !(distM > 0) || !(closingMs > 0.15)) return null;
    return Number((distM / closingMs).toFixed(2));
  }

  // 3-Corridor Clearance Grid (left: 9-11 o'clock, center: 11-1 o'clock, right: 1-3 o'clock)
  function computeCorridors(objects, depthCorridors = null, maxClearM = 5.0) {
    let leftM = depthCorridors?.leftM ?? maxClearM;
    let centerM = depthCorridors?.centerM ?? maxClearM;
    let rightM = depthCorridors?.rightM ?? maxClearM;
    for (const o of objects || []) {
      if (o.distM == null) continue;
      if (o.inPath || o.clock === "12 o'clock") centerM = Math.min(centerM, o.distM);
      else if (o.clock === "10 o'clock" || o.clock === "11 o'clock") leftM = Math.min(leftM, o.distM);
      else if (o.clock === "1 o'clock" || o.clock === "2 o'clock") rightM = Math.min(rightM, o.distM);
    }
    leftM = Number(leftM.toFixed(1));
    centerM = Number(centerM.toFixed(1));
    rightM = Number(rightM.toFixed(1));
    let openPathClock = "12 o'clock";
    if (centerM < 2.0) {
      openPathClock = leftM >= rightM ? "10 o'clock" : "2 o'clock";
    }
    return { leftM, centerM, rightM, openPathClock, dropOffM: depthCorridors?.dropOffM ?? 0.0 };
  }

  class SpatialFrameBuilder {
    constructor() {
      this.prevDist = new Map();
      this.prevCenterM = 5.0;
      this.wasPanning = false;
      this.lastTriggerAt = -Infinity;
    }
    reset() {
      this.prevDist.clear();
      this.prevCenterM = 5.0;
      this.wasPanning = false;
      this.lastTriggerAt = -Infinity;
    }
    build({ detections = [], imu = null, depthCorridors = null, source = "video-spatial", now = Date.now() }) {
      const steady = !imu || (!imu.panning && imu.stable !== false);
      const pivotSettled = Boolean(this.wasPanning && steady);
      this.wasPanning = Boolean(imu && imu.panning);

      const tracked = [];
      const seenKeys = new Set();
      for (const d of detections) {
        const z = zone(d.cx, d.cy);
        const key = `${d.label}-${z.inPath ? "ahead" : z.clock}`;
        seenKeys.add(key);
        const distM = d.distM != null ? Number(d.distM.toFixed(2)) : distanceMeters(d.label, d.normW);
        const prev = this.prevDist.get(key);
        let closingMs = 0;
        if (prev && distM != null && prev.distM != null) {
          const dt = (now - prev.ts) / 1000;
          if (dt >= 0.08 && dt <= 2.0) {
            closingMs = Number(Math.max(-3.0, Math.min(8.0, (prev.distM - distM) / dt)).toFixed(2));
          }
        }
        if (distM != null) this.prevDist.set(key, { distM, ts: now });
        const ttcS = ttcSeconds(distM, closingMs);
        tracked.push({
          id: key, label: d.label, clock: z.clock, inPath: z.inPath, elevation: z.elevation,
          distM, closingMs, ttcS, cx: Number(d.cx.toFixed(2)), cy: Number(d.cy.toFixed(2)),
          normW: Number((d.normW || 0).toFixed(2)), normH: Number((d.normH || 0).toFixed(2)),
        });
      }
      for (const k of [...this.prevDist.keys()]) if (!seenKeys.has(k)) this.prevDist.delete(k);
      tracked.sort((a, b) => (a.distM ?? 99) - (b.distM ?? 99));

      const corridors = computeCorridors(tracked, depthCorridors);
      const centerDrop = this.prevCenterM - corridors.centerM;
      this.prevCenterM = corridors.centerM;

      // 3-Tier Trigger evaluation
      let reflex = null;
      let fire = false;
      let reason = "none";
      let roiTarget = null;

      if (steady) {
        const imminent = tracked.find((o) => o.inPath && ((o.ttcS !== null && o.ttcS <= 1.2 && (o.distM ?? 99) <= 2.2) || ((o.distM ?? 99) <= 1.1 && o.closingMs > 0.3)));
        if (imminent) {
          reflex = { label: imminent.label, clock: imminent.clock, distM: imminent.distM, ttcS: imminent.ttcS, openPathClock: corridors.openPathClock };
        }
        const approaching = tracked.find((o) => o.inPath && ((o.ttcS !== null && o.ttcS <= 3.5) || ((o.distM ?? 99) <= 2.8 && o.closingMs > 0.25)));
        if (approaching && now - this.lastTriggerAt >= 450) {
          fire = true; reason = "corridor_approach"; roiTarget = approaching;
        } else if (centerDrop >= 0.6 && corridors.centerM <= 2.5 && now - this.lastTriggerAt >= 450) {
          fire = true; reason = "clearance_drop"; roiTarget = tracked[0] || null;
        } else if (pivotSettled && now - this.lastTriggerAt >= 350) {
          fire = true; reason = "pivot_settled"; roiTarget = tracked[0] || null;
        } else if (Math.abs(corridors.dropOffM) >= 0.15 && now - this.lastTriggerAt >= 450) {
          fire = true; reason = "dropoff_anomaly";
        }
        if (fire) this.lastTriggerAt = now;
      }

      return {
        ts: now,
        source,
        corridors,
        ego: {
          walking: imu ? imu.walking : null,
          angularSpeed: imu ? imu.angularSpeed : 0,
          panning: Boolean(imu && imu.panning),
          pitchDeg: imu ? imu.pitchDeg : null,
          pivotSettled,
        },
        objects: tracked.slice(0, 6),
        reflex,
        trigger: { fire, reason, roiTarget },
      };
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `node app/tests/test_looming.js`
Expected: PASS (all existing + new spatial frame tests pass).

**Step 5: Commit**

```bash
git add app/static/looming.js app/tests/test_looming.js
git commit -m "feat(spatial): add SpatialFrameBuilder, 3-corridor clearance, TTC, and 3-tier trigger logic"
```

---

### Task 2: Hybrid WebXR AR Depth/Pose + Universal Camera Spatial Stream & 256px ROI Cropper (`app/static/spatial.js`)

**Files:**
- Modify: `app/static/spatial.js`
- Test: `app/tests/test_looming.js`

**Step 1: Write the failing test for ROI crop box math in `app/tests/test_looming.js`**

Add a pure helper `computeRoiRect(target, vw, vh, pad)` in `app/static/looming.js` (used by `spatial.js`) and test it in `app/tests/test_looming.js`:

```javascript
{
  const { computeRoiRect } = require("../static/looming.js");
  const rect = computeRoiRect({ cx: 0.5, cy: 0.5, normW: 0.25, normH: 0.25 }, 640, 480);
  check("ROI rect centers on target with padding and stays within frame bounds",
    rect.sx >= 0 && rect.sy >= 0 && rect.sw > 160 && rect.sh > 120 && rect.sx + rect.sw <= 640 && rect.sy + rect.sh <= 480,
    JSON.stringify(rect));
}
```

**Step 2: Run test to verify it fails**

Run: `node app/tests/test_looming.js`
Expected: FAIL (`computeRoiRect is not a function`).

**Step 3: Implement `computeRoiRect` in `app/static/looming.js` and upgrade `app/static/spatial.js`**

1. In `app/static/looming.js`, add `computeRoiRect(target, vw, vh, pad = 0.35)` that computes `{ sx, sy, sw, sh }` clamped to `[0, vw] x [0, vh]`.
2. In `app/static/spatial.js`:
   - Enable `SpatialSentry` by default in universal `<video>` spatial mode and add WebXR `immersive-ar` (`depth-sensing`, `hit-test`, `local-floor`) probing (`SpatialSentry.probeWebXR()`) and optional session attachment (`startWebXR()`).
   - On every tick (`8–12 Hz`), build a `SpatialFrame` via `SpatialFrameBuilder`.
   - When `spatialFrame.trigger.fire` is true, crop a `256x256` JPEG (`quality = 0.62`) around `spatialFrame.trigger.roiTarget` (or center corridor if `roiTarget` is null) and emit `onSpatialFrame(spatialFrame, roiB64)`.
   - When `spatialFrame.reflex` is non-null (and respects `minGapMs`), emit `onLocalAlert(spatialFrame.reflex)`.

**Step 4: Run test to verify it passes**

Run: `node app/tests/test_looming.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add app/static/looming.js app/static/spatial.js app/tests/test_looming.js
git commit -m "feat(spatial): upgrade SpatialSentry with hybrid WebXR depth probe and 256px ROI cropping"
```

---

### Task 3: Server Fast Gemini Decision Model on Spatial Telemetry + Live Scene Graph (`app/server/spatial_decision.py`)

**Files:**
- Create: `app/server/spatial_decision.py`
- Modify: `app/server/config.py`
- Test: `app/tests/test_spatial_decision.py`

**Step 1: Write the failing test `app/tests/test_spatial_decision.py`**

Create `app/tests/test_spatial_decision.py` testing:
1. `SpatialTelemetry` validation and compact prompt serialization (`format_spatial_prompt()`).
2. `SpatialSceneGraph.update()` and `SpatialSceneGraph.summary_for_live()` (allocentric/clock-face live spatial summary for `gemini-3.8-live`).
3. `SpatialDecisionEngine.should_invoke_gemini()` 3-tier gating (reflex vs. event-driven Gemini Flash-Lite call vs. background sync cooldown).
4. `decide_spatial()` calling `gemini-3.5-flash-lite` with compact telemetry JSON + optional `256px` ROI JPEG and returning `WatchDecision` + `evade_clock`.

```python
"""Tests for the AR Spatial Stream & Fast Gemini Decision Model (spatial_decision.py).
Run: uv run python tests/test_spatial_decision.py"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import agent, spatial_decision  # noqa: E402

results = []


def check(name: str, cond: bool, detail: str = "") -> None:
    results.append(bool(cond))
    print(("PASS" if cond else "FAIL"), name, "" if cond else detail)


 SAMPLE_FRAME = {
    "ts": 1000,
    "source": "webxr-depth",
    "corridors": {"leftM": 3.8, "centerM": 1.3, "rightM": 2.9, "openPathClock": "10 o'clock", "dropOffM": 0.0},
    "ego": {"walking": True, "angularSpeed": 8, "panning": False, "pitchDeg": 78, "pivotSettled": False},
    "objects": [
        {"id": "bicycle-ahead", "label": "bicycle", "clock": "12 o'clock", "inPath": True,
         "elevation": "mid", "distM": 1.3, "closingMs": 1.4, "ttcS": 0.93}
    ],
    "trigger": {"fire": True, "reason": "corridor_approach"},
}


def run() -> bool:
    # 1. Prompt formatting is compact and includes corridor clearance, TTC, and evade path
    prompt = spatial_decision.format_spatial_prompt(SAMPLE_FRAME, recent=[], lang="English")
    check("prompt includes center corridor clearance and open path",
          "center=1.3m" in prompt and "10 o'clock" in prompt and "ttc=0.93s" in prompt, prompt)

    # 2. Scene graph updates and formats concise summary for Gemini Live
    sg = spatial_decision.SpatialSceneGraph()
    sg.update(SAMPLE_FRAME, now=10.0)
    summary = sg.summary_for_live(now=10.5)
    check("scene graph summary reports clearances and tracked objects",
          "bicycle at 12 o'clock (1.3m" in summary and "Clearest path: 10 o'clock" in summary, summary)

    # 3. 3-tier trigger gating
    eng = spatial_decision.SpatialDecisionEngine()
    fire1, why1 = eng.should_call_model(SAMPLE_FRAME, now=10.0)
    check("event trigger fires immediately on corridor_approach", fire1 is True and why1 == "corridor_approach", why1)
    eng.record_call(now=10.0)
    fire2, why2 = eng.should_call_model(SAMPLE_FRAME, now=10.2)
    check("debounces back-to-back calls within min interval", fire2 is False and why2 == "debounce", why2)

    # 4. Fast Gemini Decision Model call with mocked client
    class FakeModels:
        async def generate_content(self, *, model, contents, config):
            class R:
                parsed = None
                text = '{"notify": true, "urgency": "high", "confidence": 0.93, "hazard_key": "bike-ahead", "message": "Bike ahead, step left!", "reason": "approaching 1.3m ttc 0.9s", "attention": "high", "hazard_type": "moving"}'
                usage_metadata = None
            return R()

    class FakeClient:
        def __init__(self):
            self.aio = type("A", (), {"models": FakeModels()})()

    orig = agent._get_client
    agent._get_client = lambda: FakeClient()
    try:
        d, meta = asyncio.run(spatial_decision.decide_spatial(SAMPLE_FRAME, recent=[], lang="English", roi_jpeg=b"fakejpeg"))
        check("decide_spatial parses WatchDecision with directional guidance",
              d.notify is True and d.urgency == "high" and "step left" in d.message.lower(), str(d))
    finally:
        agent._get_client = orig

    print(f"\n{sum(results)}/{len(results)} passed")
    return all(results)


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
```

**Step 2: Run test to verify it fails**

Run: `uv run --directory app python tests/test_spatial_decision.py`
Expected: FAIL with `ImportError: cannot import name 'spatial_decision' from 'server'`.

**Step 3: Implement `app/server/spatial_decision.py` and config settings in `app/server/config.py`**

Create `app/server/spatial_decision.py` with:
- `SPATIAL_DECISION_SYSTEM`: Fast spatial decision prompt instructing `gemini-3.5-flash-lite` to act on metric 3-corridor clearances (`leftM`, `centerM`, `rightM`, `openPathClock`, `dropOffM`), ego-motion, and object `distM`/`closingMs`/`ttcS` (plus optional `256px` ROI crop), producing a `WatchDecision` with directional evasion coaching (e.g. `"Pole 1.4m ahead, step left."`).
- `format_spatial_prompt(frame_dict, recent, lang)`
- `decide_spatial(frame_dict, recent, lang, roi_jpeg=None)`
- `SpatialSceneGraph` (stores latest corridor clearances, objects, and last decision; exposes `summary_for_live(now)` and `as_dict(now)`).
- `SpatialDecisionEngine` (3-tier gating: debounce `>= 0.45s` for triggered events, periodic sync every `2.5s` while walking).

**Step 4: Run test to verify it passes**

Run: `uv run --directory app python tests/test_spatial_decision.py`
Expected: PASS (`5/5 passed`).

**Step 5: Commit**

```bash
git add app/server/config.py app/server/spatial_decision.py app/tests/test_spatial_decision.py
git commit -m "feat(server): add Fast Gemini Spatial Decision Engine and Live 3D Scene Graph"
```

---

### Task 4: Wire Spatial Stream, Live Scene Graph Tool & Directional Earcons into `live.py` and `app.js`

**Files:**
- Modify: `app/server/live.py`
- Modify: `app/static/app.js`
- Modify: `app/static/index.html`
- Test: `app/tests/test_spatial_decision.py`

**Step 1: Write failing integration tests in `app/tests/test_spatial_decision.py`**

Add tests verifying:
1. `_handle_spatial_frame(state, msg)` updates `state.scene_graph`, triggers reflex alerts when `reflex` is present, and dispatches `decide_spatial` when `should_call_model` returns `True`.
2. The `get_spatial_scene` tool returns the live 3D corridor clearances, tracked objects, and recommended open path to the Gemini Live session.
3. Clock-to-stereo pan mapping (`clock_to_pan("10 o'clock") == -0.65`, `clock_to_pan("12 o'clock") == 0.0`, `clock_to_pan("2 o'clock") == 0.65`).

**Step 2: Run test to verify it fails**

Run: `uv run --directory app python tests/test_spatial_decision.py`
Expected: FAIL.

**Step 3: Implement the server & browser wiring**

1. **`app/server/live.py`:**
   - Add `scene_graph: spatial_decision.SpatialSceneGraph` and `spatial_engine: spatial_decision.SpatialDecisionEngine` to `State`.
   - Register `get_spatial_scene()` per-connection tool in `_serve()` so `gemini-3.8-live` can query exact 3D metric distances, clock bearings, and open corridors at any time, and automatically include the compact scene graph summary when injecting fresh context.
   - Handle `kind == "spatial_frame"` messages in `live.py`:
     - Update `state.scene_graph.update(msg, now)`.
     - If `msg.get("reflex")` is present, run `_local_alert(state, msg["reflex"])` immediately (`0ms` wait).
     - Otherwise, if `state.spatial_engine.should_call_model(msg, now)` is true, spawn `_spatial_watch_once(state, msg, now)` which calls `spatial_decision.decide_spatial()`, passes the resulting `WatchDecision` through `state.policy.decide(..., fast_confirm=True)`, and fires `_fire_alert(state, d, source="spatial", clock=clock)`.
2. **`app/static/index.html` & `app/static/app.js`:**
   - Add `AR Spatial` mode button (`arBtn`: `auto` / `webxr` / `off`) and optional `Sonar` toggle button (`sonarBtn`: `off` / `on`) to the control bar.
   - Start `SpatialSentry` by default in `auto` mode, sending `{ type: "spatial_frame", ...frame, roi: roiB64 }` over the WebSocket.
   - Upgrade `alertCue(urgency, clock)` to pan the earcon in stereo (`StereoPannerNode`) matching the obstacle's clock position (`10 o'clock` left `-0.65` to `2 o'clock` right `+0.65`).
   - Implement optional continuous acoustic sonar ticks (`sonarTick(centerM, openPathClock)`) when the user toggles `sonar: on`.

**Step 4: Run all Python and Node tests to verify everything passes**

Run:
```bash
node app/tests/test_looming.js && node app/tests/test_micgate.js && uv run --directory app python tests/test_spatial_decision.py && uv run --directory app python tests/test_fast_warnings.py && uv run --directory app python tests/test_watch_policy.py && uv run --directory app python tests/test_turns.py && uv run --directory app python tests/test_attention.py && uv run --directory app python tests/test_isolation.py
```
Expected: All test suites PASS with 0 regressions.

**Step 5: Commit**

```bash
git add app/server/live.py app/static/app.js app/static/index.html app/tests/test_spatial_decision.py
git commit -m "feat(live,ui): wire 5-10Hz spatial telemetry stream, Live 3D scene tool, stereo earcons, and optional sonar"
```
