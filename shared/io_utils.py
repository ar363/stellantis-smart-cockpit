"""
File-based IPC plumbing shared by perception, logic, and the bridge server.
Not part of the DriverState contract in schema.py -- just the transport those
processes use to hand DriverState/events to each other across process
boundaries. Safe to change without the three-way sign-off schema.py needs.

Layout (all under shared/):
  state.json    <- perception overwrites every frame with the latest DriverState
  gesture.json  <- perception overwrites with the latest raw hand gesture (optional stretch)
  events.jsonl  <- logic appends one JSON object per line, each with an increasing "seq"
  control.json  <- dashboard/operator writes one-shot triggers (e.g. ignition_off) for logic to consume
"""

import json
import os
import tempfile
from pathlib import Path

SHARED_DIR = Path(__file__).parent
STATE_PATH = SHARED_DIR / "state.json"
GESTURE_PATH = SHARED_DIR / "gesture.json"
EVENTS_PATH = SHARED_DIR / "events.jsonl"
CONTROL_PATH = SHARED_DIR / "control.json"


def atomic_write_json(path, data):
    """Write JSON so readers never see a partial file (write temp + os.replace)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def read_json(path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        # Reader raced a writer mid-replace on a slow filesystem -- caller
        # just tries again next poll tick, so stale/default is fine here.
        return default


def append_jsonl(path, record):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record))
        f.write("\n")


def read_jsonl_since(path, since_seq):
    """Return every record with seq > since_seq, in file order."""
    path = Path(path)
    if not path.exists():
        return []
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("seq", 0) > since_seq:
                out.append(record)
    return out


def next_seq(path):
    path = Path(path)
    if not path.exists():
        return 1
    last = 0
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            last = max(last, record.get("seq", 0))
    return last + 1
