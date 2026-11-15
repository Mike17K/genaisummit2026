"""Structured debug artifact writer for safety watcher triggers.

Every time an alert triggers, writes a timestamped folder containing:
  - frame_1.jpg .. frame_N.jpg (the exact frames piped into the watcher)
  - composite_sheet.jpg (the tiled single image sent to the model, if composed)
  - danger_frame.jpg (the newest frame latched in memory to skip similar subsequent scenes)
  - report.md (full timing breakdown, delays from session/start/frames to trigger, stats, and templated narrative)
"""
from datetime import datetime
import os
from pathlib import Path
import re

from . import compose, config, trace
from .policy import WatchDecision

APP_DIR = Path(__file__).resolve().parent.parent


def _resolve_base_dir() -> Path:
    """Always write to app/debug_triggers; if an empty root-owned dir blocks writes, replace it."""
    preferred = APP_DIR / "debug_triggers"
    try:
        if preferred.exists() and not os.access(preferred, os.W_OK) and not any(preferred.iterdir()):
            preferred.rmdir()
        preferred.mkdir(parents=True, exist_ok=True)
        if os.access(preferred, os.W_OK):
            return preferred
    except OSError:
        pass
    fallback = APP_DIR / "trigger_logs"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _fmt_ts(epoch_s: float) -> str:
    return datetime.fromtimestamp(epoch_s).strftime("%H:%M:%S.%f")[:-3]


def save_trigger_report(
    *,
    frames: list[tuple[float, bytes]],
    danger_jpeg: bytes | None,
    decision: WatchDecision,
    session_started_at: float,
    look_started_at: float,
    model_ms: float,
    trigger_at: float,
    policy_reason: str,
    attention_level: str,
    fps: float,
    sensors_desc: str,
    token_info: dict,
    conn_id: str = "-",
) -> Path | None:
    """Persist trigger images and markdown report. Safe to call in a background thread."""
    if not config.DEBUG_TRIGGERS_ENABLED:
        return None
    try:
        base_dir = _resolve_base_dir()
        stamp = datetime.fromtimestamp(trigger_at).strftime("%Y%m%d_%H%M%S_%f")
        safe_key = re.sub(r"[^a-z0-9\-]", "", (decision.hazard_key or "hazard").lower())[:24] or "hazard"
        folder = base_dir / f"{stamp}_lvl_{decision.danger_level}_{safe_key}"
        folder.mkdir(parents=True, exist_ok=True)

        # 1. Save individual piped frames
        for idx, (_, jpeg) in enumerate(frames, start=1):
            (folder / f"frame_{idx}.jpg").write_bytes(jpeg)

        # 2. Save composite sheet if enabled and >1 frame
        has_sheet = False
        if config.WATCH_COMPOSE and len(frames) > 1:
            try:
                sheet_bytes = compose.compose(frames, trigger_at, config.COMPOSE_TILE_W)
                (folder / "composite_sheet.jpg").write_bytes(sheet_bytes)
                has_sheet = True
            except Exception:
                has_sheet = False

        # 3. Save latched danger frame used for post-trigger similarity skipping
        if danger_jpeg:
            (folder / "danger_frame.jpg").write_bytes(danger_jpeg)

        # 4. Compute timestamps & end-to-end delays
        oldest_t = frames[0][0] if frames else look_started_at
        newest_t = frames[-1][0] if frames else look_started_at
        session_elapsed_s = max(0.0, trigger_at - session_started_at)
        watcher_delay_ms = max(0.0, (trigger_at - look_started_at) * 1000.0)
        oldest_to_trigger_ms = max(0.0, (trigger_at - oldest_t) * 1000.0)
        newest_to_trigger_ms = max(0.0, (trigger_at - newest_t) * 1000.0)
        capture_span_ms = max(0.0, (newest_t - oldest_t) * 1000.0)
        overhead_ms = max(0.0, watcher_delay_ms - model_ms)

        frame_lines = []
        prev_t = None
        for idx, (ft, jpeg) in enumerate(frames, start=1):
            age_at_look_ms = (look_started_at - ft) * 1000.0
            age_at_trigger_ms = (trigger_at - ft) * 1000.0
            gap_str = f"+{(ft - prev_t) * 1000.0:.0f} ms" if prev_t is not None else "baseline"
            prev_t = ft
            frame_lines.append(
                f"| Frame {idx} | `{_fmt_ts(ft)}` (`{ft:.3f}`) | {gap_str} | "
                f"{age_at_look_ms:.0f} ms | {age_at_trigger_ms:.0f} ms | {len(jpeg) / 1024:.1f} KB |"
            )

        image_embeds = []
        if has_sheet:
            image_embeds.append("### Composite Contact Sheet Sent to Model\n![Composite Sheet](composite_sheet.jpg)\n")
        for idx in range(1, len(frames) + 1):
            image_embeds.append(f"### Piped Frame {idx}\n![Frame {idx}](frame_{idx}.jpg)\n")
        if danger_jpeg:
            image_embeds.append(
                "### Stored Danger Reference Frame (Similarity Latch)\n"
                "![Danger Frame](danger_frame.jpg)\n"
            )

        lines = [
            f"# Safety Watcher Trigger Report — Level {decision.danger_level} (`{decision.hazard_key or 'unknown'}`)",
            "",
            "## What Happened & Why (Templated Summary)",
            (
                f"At **{_fmt_ts(trigger_at)}** (`+{session_elapsed_s:.2f}s` after session start), the stateless safety "
                f"watcher inspected **{len(frames)} camera frames** spanning **{capture_span_ms:.0f} ms** "
                f"({'tiled into 1 composite image' if has_sheet else 'sent as individual frames'}). "
                f"The model detected a **{decision.hazard_type}** hazard (`{decision.hazard_key or 'unspecified'}`) "
                f"with **danger level {decision.danger_level}/5** and confidence **{decision.confidence:.2f}**, "
                f"explaining: *\"{decision.reason or 'obstacle detected in path'}\"*. "
                f"Alert policy approved the trigger (`{policy_reason}`), cancelled any active assistant speech, "
                f"spoke **\"{decision.message}\"** (`urgency={decision.urgency}`), and latched `danger_frame.jpg` "
                f"in memory so subsequent frames with visual difference `< {config.DANGER_SIMILARITY_DIFF}` are skipped "
                f"until the user clears the scene."
            ),
            "",
            "## Timestamps & End-to-End Delay Breakdown",
            "| Metric | Value |",
            "| :--- | :--- |",
            f"| **Connection ID** | `{conn_id}` |",
            f"| **Session Started At** | `{_fmt_ts(session_started_at)}` (`{session_started_at:.3f}`) |",
            f"| **Watcher Cycle Started At** | `{_fmt_ts(look_started_at)}` (`{look_started_at:.3f}`) |",
            f"| **Actual Trigger Fired At** | `{_fmt_ts(trigger_at)}` (`{trigger_at:.3f}`) |",
            f"| **Elapsed From Session Start** | **{session_elapsed_s:.2f} s** ({session_elapsed_s * 1000:.0f} ms) |",
            f"| **Delay: Watcher Start -> Trigger** | **{watcher_delay_ms:.1f} ms** (Model API: `{model_ms:.1f} ms`, Prep/Policy: `{overhead_ms:.1f} ms`) |",
            f"| **Delay: Newest Frame -> Trigger** | **{newest_to_trigger_ms:.1f} ms** |",
            f"| **Delay: Oldest Frame -> Trigger** | **{oldest_to_trigger_ms:.1f} ms** (Frame span: `{capture_span_ms:.0f} ms`) |",
            "",
            "## Per-Frame Timestamps",
            "| Frame | Captured At | Step Gap | Age at Check Start | Delay to Trigger | Size |",
            "| :--- | :--- | :--- | :--- | :--- | :--- |",
            *frame_lines,
            "",
            "## Model & Policy Stats",
            f"- **Spoken Command**: `{decision.message}` (`code={getattr(decision, 'action_code', '') or '-'}`, `next={getattr(decision, 'next_code', '') or '-'}`)",
            f"- **Danger Level**: `{decision.danger_level}` / 5 (`urgency={decision.urgency}`)",
            f"- **Inferred Movement / Steer**: `move={getattr(decision, 'user_direction', '') or '-'}` | `steer={getattr(decision, 'steer', '') or 'none'}`",
            f"- **Confidence**: `{decision.confidence:.2f}`",
            f"- **Hazard Key / Type**: `{decision.hazard_key}` (`{decision.hazard_type}`)",
            f"- **Model Reason**: {decision.reason or '-'}",
            f"- **Policy Outcome**: `ALERT` (`{policy_reason}`)",
            f"- **Watcher Attention / Camera Rate**: `{attention_level}` (`{fps} fps`)",
            f"- **Phone Sensors**: {sensors_desc or 'none'}",
            f"- **Model & Tokens**: `{config.WATCH_MODEL}` (prompt: `{token_info.get('prompt_tokens')}`, output: `{token_info.get('output_tokens')}`)",
            f"- **Similarity Skip Threshold**: `{config.DANGER_SIMILARITY_DIFF}`",
            "",
            "## Piped & Stored Images",
            *image_embeds,
        ]
        (folder / "report.md").write_text("\n".join(lines), encoding="utf-8")
        return folder
    except Exception as exc:
        trace.log("debug_report_failed", error=f"{type(exc).__name__}: {exc}"[:200])
        return None
