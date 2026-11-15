"""Minimal explicit user memory shared as context across all agents.

Stores ONLY:
  - `goal`: what the user explicitly said they are currently trying to do / find / reach (1 item, <=80 chars).
  - `notes`: explicit facts, locations, or constraints the user asked to keep (max 4 short items, <=80 chars each).
Routine visual questions, greetings, and camera guesses are never stored.
"""
from dataclasses import dataclass, field
import json
from pathlib import Path
import re
import time

MEMORY_FILE = Path(__file__).resolve().parent.parent / ".user_memory.json"
MAX_NOTES = 4
MAX_ITEM_CHARS = 80
GOAL_TTL_S = 7200.0  # Active "what user is trying to do" expires after 2 hours on disk reload


def _clean_item(text: str) -> str:
    cleaned = re.sub(r"[*_`#>\[\]\r\n]+", " ", str(text or "")).strip(" .,:;-—")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:MAX_ITEM_CHARS].strip()


@dataclass
class UserMemory:
    """Compact explicit memory of user intent (`goal`) and remembered `notes`."""

    goal: str = ""
    notes: list[str] = field(default_factory=list)
    goal_updated_at: float = 0.0

    def is_empty(self) -> bool:
        return not self.goal and not self.notes

    def set_goal(self, goal: str, now: float | None = None) -> bool:
        val = _clean_item(goal)
        if not val or val.upper() == "NONE":
            return False
        changed = self.goal != val
        self.goal = val
        self.goal_updated_at = time.time() if now is None else now
        return changed

    def add_note(self, note: str) -> bool:
        val = _clean_item(note)
        if not val or val.upper() == "NONE":
            return False
        low = val.lower()
        for i, existing in enumerate(self.notes):
            if existing.lower() == low:
                return False
            # Update in place if same prefix/topic (e.g., "keys: on table" -> "keys: in pocket")
            if ":" in val and ":" in existing and existing.split(":", 1)[0].strip().lower() == val.split(":", 1)[0].strip().lower():
                self.notes[i] = val
                return True
        self.notes.append(val)
        if len(self.notes) > MAX_NOTES:
            self.notes = self.notes[-MAX_NOTES:]
        return True

    def clear(self, goal_only: bool = False) -> bool:
        if goal_only:
            had = bool(self.goal)
            self.goal = ""
            self.goal_updated_at = 0.0
            return had
        had = bool(self.goal or self.notes)
        self.goal = ""
        self.notes.clear()
        self.goal_updated_at = 0.0
        return had

    def apply_directive(self, raw_directive: str, heard_text: str = "") -> bool:
        """Apply an LLM `MEMORY:` header directive strictly when explicit. Returns True if mutated."""
        raw = re.sub(r"\s+", " ", str(raw_directive or "")).strip()
        if not raw or raw.upper() in ("NONE", "NO", "N/A", "-", "NULL"):
            return False

        # Guardrail: a 1-word utterance ("OK", "Yes", "Thanks") cannot write new memory unless clearing
        heard_words = [w for w in re.split(r"\s+", (heard_text or "").strip()) if w]
        upper = raw.upper()
        if len(heard_words) < 2 and not upper.startswith("CLEAR"):
            return False

        changed = False
        for part in [p.strip() for p in raw.split("|") if p.strip()]:
            pu = part.upper()
            if pu in ("NONE", "NO", "-"):
                continue
            if pu in ("CLEAR", "CLEAR_ALL", "FORGET"):
                changed = self.clear(goal_only=False) or changed
            elif pu in ("CLEAR_GOAL", "DONE", "GOAL: NONE", "GOAL: DONE"):
                changed = self.clear(goal_only=True) or changed
            elif pu.startswith("GOAL:"):
                changed = self.set_goal(part[5:]) or changed
            elif pu.startswith("NOTE:"):
                changed = self.add_note(part[5:]) or changed
            else:
                changed = self.set_goal(part) or changed
        return changed

    def context_text(self, extra_places: dict[str, str] | None = None) -> str:
        """Compact one-line summary injected into every agent's prompt (`''` when empty)."""
        parts: list[str] = []
        if self.goal:
            parts.append(f"trying to={self.goal}")
        combined_notes = list(self.notes)
        if extra_places:
            for k, v in extra_places.items():
                entry = _clean_item(f"{k}: {v}")
                if entry and all(entry.lower() != n.lower() for n in combined_notes):
                    combined_notes.append(entry)
        if combined_notes:
            parts.append("remembered=" + "; ".join(combined_notes[-MAX_NOTES:]))
        return " | ".join(parts)

    def to_dict(self) -> dict:
        return {"goal": self.goal, "notes": list(self.notes)}

    @classmethod
    def from_dict(cls, data: dict | None, *, now: float | None = None) -> "UserMemory":
        mem = cls()
        if not isinstance(data, dict):
            return mem
        now_t = time.time() if now is None else now
        goal_ts = float(data.get("goal_updated_at") or 0.0)
        raw_goal = _clean_item(data.get("goal", ""))
        if raw_goal and (goal_ts <= 0.0 or now_t - goal_ts <= GOAL_TTL_S):
            mem.goal = raw_goal
            mem.goal_updated_at = goal_ts or now_t
        raw_notes = data.get("notes")
        if isinstance(raw_notes, list):
            for n in raw_notes[-MAX_NOTES:]:
                mem.add_note(str(n))
        return mem


def load_persisted(path: Path | None = None, *, now: float | None = None) -> UserMemory:
    """Load persisted minimal user memory from disk, returning empty UserMemory if absent/corrupt."""
    target = path or MEMORY_FILE
    try:
        if target.exists():
            data = json.loads(target.read_text(encoding="utf-8"))
            return UserMemory.from_dict(data, now=now)
    except Exception:
        pass
    return UserMemory()


def save_persisted(mem: UserMemory, path: Path | None = None) -> None:
    """Persist minimal user memory atomically to disk."""
    target = path or MEMORY_FILE
    try:
        payload = {
            "goal": mem.goal,
            "notes": list(mem.notes[-MAX_NOTES:]),
            "goal_updated_at": mem.goal_updated_at,
        }
        target.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
