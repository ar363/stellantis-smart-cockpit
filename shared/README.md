# Shared

`schema.py` defines `DriverState` — the only contract between `/perception`, `/dashboard`, and `/logic`.
Do not modify it without agreement from Ashwin, Aditya, and Shahaan.

`io_utils.py` is the transport those three use to actually hand data across process
boundaries. It's plumbing, not contract — free to change without three-way sign-off.

## Wire format (files written into this folder at runtime, not committed)

| file | writer | reader(s) | contents |
|---|---|---|---|
| `state.json` | perception | logic, bridge | latest `DriverState`, overwritten every frame |
| `gesture.json` | perception | logic | `{"gesture": str \| null, "timestamp": float}`, latest detected hand gesture (stretch goal, not part of the `DriverState` contract) |
| `events.jsonl` | logic | bridge | append-only log, one JSON event per line, each with an increasing `seq` |
| `control.json` | dashboard / operator | logic | one-shot triggers, e.g. `{"ignition_off": true, "timestamp": ...}` for the occupant-left-behind demo |

All JSON files are written atomically (temp file + `os.replace`) so a reader never sees a
half-written file. `events.jsonl` is polled by seq number (`read_jsonl_since`) rather than
tailed byte-for-byte.

## Running the integrated demo

```
pip install -r perception/requirements.txt -r logic/requirements.txt
python perception/enroll.py profile_1     # repeat for profile_2
python main.py
```

`main.py` launches perception (webcam), logic (decision engine), and a small bridge HTTP
server that serves `/dashboard` plus `/api/state`, `/api/events`, `/api/control`. Open
`http://localhost:8000` — the dashboard auto-detects the live backend and switches its
badge from `MOCK DATA` to `LIVE`. See each folder's README for details and for running any
one piece standalone against the mocked/simulated version of its inputs.
