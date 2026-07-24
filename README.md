# Smart Cockpit (COC-04)

A live "cockpit brain" that watches the driver via webcam to make the car safer and more personal.

See `TEAM_PROMPT.md` for role assignments and scope. See `shared/schema.py` for the `DriverState` contract
that connects `/perception`, `/dashboard`, and `/logic`.

## Run the full demo
```
pip install -r perception/requirements.txt -r logic/requirements.txt
python main.py
```
Open `http://localhost:8000`. That's it — enrolling driver profiles happens in the browser
(**Manage Profiles**, top right), not the terminal. First run downloads ~8MB of MediaPipe
model files (needs internet once, then cached).

- `--gestures` — enable the hand-gesture stretch goal
- `--voice` — enable the voice-command stretch goal (needs `pip install -r logic/requirements.txt` and a mic)
- `--no-perception` — skip the webcam (e.g. developing the dashboard/logic without a camera handy)
- `--camera N` — pick a different camera index

No webcam, or want to poke at just the dashboard? `cd dashboard && python -m http.server 8000`
runs it standalone against a built-in mock data generator instead — see `dashboard/README.md`.

## Structure
- `/perception` — Ashwin: webcam capture, face landmarks (MediaPipe Tasks), EAR-based
  drowsiness, head-pose-based distraction, a landmark emotion heuristic, LBPH 2-profile face
  recognition with web-driven enrollment, and (stretch) hand-gesture detection
- `/dashboard` — Aditya: live UI, alarms, personalization, notifications, pull-over animation,
  the Manage Profiles enrollment panel, and live/mock auto-detection
- `/logic` — Shahaan: notification hold/release, profile store, alarm escalation, occupant-left-behind,
  and (stretch) voice commands + gesture policy -- plus the bridge server that wires it all to the browser
- `/shared` — the `DriverState` contract (`schema.py`) and the file-based IPC transport (`io_utils.py`)
  those three processes use to talk to each other (documented in `shared/README.md`)
- `main.py` — integration entrypoint: launches perception + logic + the bridge server together

## What's actually been tested
No physical webcam is available in the environment this was built in, except for one machine
that turned out to have one -- so most of this was validated without live camera hardware, and
then confirmed end-to-end once a camera was available:
- **Perception's CV math** (EAR, mouth-aspect-ratio, head pose, LBPH train/predict) validated
  against a real face photo, not synthetic data.
- **Perception's enrollment state machine** (start/auto-finish/cancel) validated offline by
  feeding it real detected landmarks from that photo.
- **Logic's decision engines** (escalation timing, notification hold/release gating,
  occupant-left-behind, gesture eyes-on-road gating) unit-tested directly.
- **The bridge server's API** (`/api/state`, `/api/events`, `/api/control`, `/api/enroll/*`,
  static file serving, path-traversal protection) exercised with curl and with synthetic
  `DriverState`/event writes standing in for perception/logic.
- **The full browser UI**, in both mock mode and live mode (a real bridge server backing it),
  driven headlessly end-to-end: status tiles, avatar, alarm flash + sound, ambient color,
  personalization, notifications, pull-over animation, and the live/mock badge switch.
- **The complete pipeline end-to-end against a real camera** once one was available in this
  environment: `python main.py` launched perception + logic + the bridge with no crashes, a
  face was detected and its `DriverState` served live, and a full **real enrollment through the
  browser** (click Manage Profiles -> Start Enrollment -> 40 real samples captured -> LBPH
  retrained -> recognizer hot-swapped) completed in ~8 seconds with the driver correctly
  recognized as `profile_1` immediately after. That run also surfaced and fixed a real bug: a
  transient Windows `PermissionError` on `os.replace()` that could crash perception's capture
  loop -- `shared/io_utils.py` now retries through it.
- **Not tested**: voice commands (needs a working mic + speaking during a live run) and hand
  gestures beyond the offline landmark-based heuristic check -- both are optional stretch flags
  (`--voice`, `--gestures`), gracefully absent if their dependencies aren't installed, and
  should be tried live before relying on them for a demo.

## Rules for everyone
See `TEAM_PROMPT.md` for the original role split and folder-ownership rules. This build filled
in all three folders end-to-end so the whole thing is demoable now -- treat it as a first draft
per-part for Ashwin/Aditya/Shahaan to refine (tune the drowsiness/distraction thresholds against
your own camera, adjust styling, tighten the emotion heuristic, etc.), not a final answer.
