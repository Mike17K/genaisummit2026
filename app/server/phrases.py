"""Fixed alert phrases, in English and Greek, including 1-5 danger level phrases.

Common alerts and calibrated danger-level commands are pre-synthesized at startup (speak.warm_common)
so urgent warnings play with zero synthesis delay.
"""

LOCAL = {
    "vehicle": ("Vehicle ahead, stop!", "Όχημα μπροστά, σταμάτα!"),
    "bike": ("Bike ahead, stop!", "Ποδήλατο μπροστά, σταμάτα!"),
    "person": ("Person ahead, careful.", "Άτομο μπροστά, προσοχή."),
    "animal": ("Animal ahead, careful.", "Ζώο μπροστά, προσοχή."),
    "obstacle": ("Obstacle ahead, stop.", "Εμπόδιο μπροστά, σταμάτα."),
}

# Calibrated short commands for danger_level 1..5 (minimal tokens, clear escalation of urgency).
DANGER_LEVEL = {
    "English": {
        1: "Careful ahead.",
        2: "Slow down.",
        3: "Slow down now.",
        4: "Stop!",
        5: "Stop now!",
    },
    "Greek": {
        1: "Προσοχή μπροστά.",
        2: "Πιο αργά.",
        3: "Επιβράδυνε τώρα.",
        4: "Σταμάτα!",
        5: "Σταμάτα τώρα!",
    },
}

WATCHER = {
    "English": [
        "Car ahead, stop!", "Car from the right, stop.", "Car from the left, stop.", "Vehicle approaching, stop!",
        "Bicycle ahead, caution.", "Scooter ahead, caution.", "Person right ahead.",
        "Step down ahead.", "Step up ahead.", "Stairs ahead.", "Stairs ahead, caution.", "Curb ahead, careful.", "Curb ahead, watch your step.",
        "Wall ahead, stop.", "Wall right ahead, stop.", "Pole ahead.", "Pole at twelve o'clock.", "Glass door ahead, stop.", "Door ahead.", "Hole ahead, stop.",
    ],
    "Greek": [
        "Αυτοκίνητο μπροστά, σταμάτα!", "Αυτοκίνητο από δεξιά, σταμάτα.", "Αυτοκίνητο από αριστερά, σταμάτα.", "Πλησιάζει όχημα, σταμάτα!",
        "Ποδήλατο μπροστά, προσοχή.", "Πατίνι μπροστά, προσοχή.", "Άτομο ακριβώς μπροστά.",
        "Σκαλί προς τα κάτω μπροστά.", "Σκαλί προς τα πάνω μπροστά.", "Σκάλες μπροστά.", "Σκάλες μπροστά, προσοχή.",
        "Πεζοδρόμιο μπροστά, προσοχή.", "Τοίχος μπροστά, σταμάτα.", "Τοίχος ακριβώς μπροστά, σταμάτα.", "Κολόνα μπροστά.",
        "Γυάλινη πόρτα μπροστά, σταμάτα.", "Πόρτα μπροστά.", "Λάκκος μπροστά, σταμάτα.",
    ],
}

_GROUP = {
    "car": "vehicle", "truck": "vehicle", "bus": "vehicle", "motorcycle": "vehicle", "train": "vehicle",
    "bicycle": "bike",
    "person": "person",
    "dog": "animal", "cat": "animal", "horse": "animal", "cow": "animal", "sheep": "animal",
}


def group_of(label: str) -> str:
    return _GROUP.get(label.lower().strip(), "obstacle")


def local_alert(label: str, lang: str = "English") -> tuple[str, str]:
    """(hazard_key, spoken text) for an on-device detection of `label` directly ahead."""
    group = group_of(label)
    english, greek = LOCAL[group]
    return f"{group}-ahead", greek if lang == "Greek" else english


def danger_phrase(level: int, lang: str = "English") -> str:
    """Return the calibrated warning phrase for danger level 1..5."""
    clamped = max(1, min(5, int(level)))
    bank = DANGER_LEVEL.get(lang) or DANGER_LEVEL["English"]
    return bank[clamped]


def all_phrases() -> list[str]:
    """Every unique phrase worth pre-synthesizing, ordered with active 1-5 danger phrases first."""
    out: list[str] = []
    for level_map in DANGER_LEVEL.values():
        out.extend(level_map.values())
    out.extend(p for pair in LOCAL.values() for p in pair)
    for items in WATCHER.values():
        out.extend(items)
    return list(dict.fromkeys(out))


def prefer_list(lang: str) -> str:
    items = WATCHER.get(lang) or WATCHER["English"]
    return " | ".join(items)
