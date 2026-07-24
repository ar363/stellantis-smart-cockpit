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
| `control.json` | dashboard / operator | logic | toggleable flags, e.g. `{"ignition_off": true, "timestamp": ...}` for the occupant-left-behind demo |
| `preview.jpg` | perception | bridge | latest camera frame as JPEG, polled by the dashboard for the live enrollment preview |
| `enroll_control.json` | bridge | perception | `{"mode": "idle" \| "enrolling", "face_id": str \| null}` -- set by the dashboard's Manage Profiles panel |
| `enroll_status.json` | perception | bridge | `{"face_id", "saved", "target", "training", "done", "error"}` -- enrollment progress the dashboard polls |

All JSON files are written atomically (temp file + `os.replace`) so a reader never sees a
half-written file. `events.jsonl` is polled by seq number (`read_jsonl_since`) rather than
tailed byte-for-byte.

## Running the integrated demo

```
pip install -r perception/requirements.txt -r logic/requirements.txt
python main.py
```

`main.py` launches perception (webcam), logic (decision engine), and a small bridge HTTP
server that serves `/dashboard` plus `/api/state`, `/api/events`, `/api/control`. Open
`http://localhost:8000` — the dashboard auto-detects the live backend and switches its
badge from `MOCK DATA` to `LIVE`, and driver profiles are enrolled from the dashboard's
Manage Profiles panel (no terminal commands). See each folder's README for details and for
running any one piece standalone against the mocked/simulated version of its inputs.
