"""Fixed alert phrases, in English and Greek.

Why: an alert is only instant if its voice is already made. Common alerts are spoken ahead of time (speak.warm_common) and
the watcher is told to prefer these exact words, so most alerts play with no wait. Alerts that come from the phone's own
on-device detector are built from these phrases, so they are always ready.
"""

# group -> (English, Greek). Used for alerts from the on-device detector (always "ahead": only things in the path alert).
LOCAL = {
    "vehicle": ("Vehicle ahead, stop!", "Όχημα μπροστά, σταμάτα!"),
    "bike": ("Bike ahead, stop!", "Ποδήλατο μπροστά, σταμάτα!"),
    "person": ("Person ahead, careful.", "Άτομο μπροστά, προσοχή."),
    "animal": ("Animal ahead, careful.", "Ζώο μπροστά, προσοχή."),
    "obstacle": ("Obstacle ahead, stop.", "Εμπόδιο μπροστά, σταμάτα."),
}

# Phrases the watcher is encouraged to reuse word for word (so their voices are already made).
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

# COCO labels from the on-device detector -> group
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


def all_phrases() -> list[str]:
    """Everything worth making ahead of time."""
    out = [p for pair in LOCAL.values() for p in pair]
    for phrases in WATCHER.values():
        out.extend(phrases)
    return out


def prefer_list(lang: str) -> str:
    phrases = WATCHER.get(lang) or WATCHER["English"]
    return " | ".join(phrases)
