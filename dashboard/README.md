# Dashboard (Aditya)

Owns the on-screen "cockpit brain" UI. Consumes `DriverState` (see `/shared/schema.py`) and events from `/logic`.

## Scope
- Live dashboard: status tiles for present/drowsy/distracted/emotion, driver avatar/state
- Alarm trigger (sound + flashing visual) on drowsy/distracted
- Personalization: theme color, "temperature" display, playlist widget per `face_id`
- Emotion-based ambient color shift (stretch) — done
- FSD-style simulated pull-over animation, triggered by `/logic`'s `pull_over` event
- Web-based face enrollment ("Manage Profiles" panel) — no terminal commands needed

## Running it
Two ways to run, same URL either way (`http://localhost:8000`):

**Full live demo** (real webcam-driven perception + logic): from the repo root,
```
python main.py
```
This is `logic/server.py`'s bridge server serving `/dashboard` directly, plus `/api/*`. The
dashboard auto-detects it (`GET /api/health`) within ~1s of load and switches its topbar badge
from `MOCK DATA` to `LIVE`.

**Dashboard alone, no backend** (what you get without `main.py` running):
```
cd dashboard
python -m http.server 8000
```
Boots straight into a self-running mock demo: an unattended 40s scripted loop drives a driver
through presence, emotion changes, a distraction event, a drowsy event that escalates into an
alarm and then a `pull_over`, and a profile switch. Use the **Demo Controls** footer to take
over manually at any point (this auto-pauses the script); "Resume Auto-Demo" hands control back.

In **LIVE** mode, those sensor-injection demo buttons are disabled (grayed out, with a tooltip)
since `DriverState` now comes from the real webcam, not button clicks -- only **Manage
Profiles** and **Toggle Ignition Off** (which drives the occupant-left-behind stretch goal via
`/api/control`) stay active, because those correspond to real control channels logic listens on.

## Manage Profiles (web enrollment)
Click **Manage Profiles** in the topbar. If a live backend is running, pick Driver 1 or Driver
2, hit **Start Enrollment**, and a live camera preview appears with a progress bar as
`perception/capture.py` captures ~40 face samples and retrains its recognizer -- no
`python enroll.py` or any other terminal command required. If no live backend is detected, the
panel just says so instead of pretending to work. See `perception/README.md` for how this flow
is implemented on the perception side.

## Architecture
- `index.html` / `style.css` — structure, the dark cockpit theme, and the enrollment modal
- `app.js` — the only file that touches the DOM for the main dashboard. Exposes exactly two
  entry points that are the real integration surface:
  - `applyDriverState(state)` — render tiles/avatar/ambient color/basic alarm from a `DriverState`
  - `applyLogicEvent(event)` — render personalization/notifications/escalation/pull-over from a
    logic event

  Everything else in `app.js` is pure rendering — no detection or decision logic lives here.
- `mock.js` — stands in for perception + logic when there's no backend. Owns a local
  `DriverState` and calls the same two callbacks above: one with a fresh `DriverState` every
  ~200ms (~5fps, simulating "every frame"), one with logic events as they occur.
- `live.js` — the real data source. Polls `GET /api/state` (~5/sec) and `GET /api/events?since=`
  (~2.5/sec, tracking a `seq` cursor so nothing is double-applied), feeding the same
  `applyDriverState`/`applyLogicEvent` functions. Also exposes `setControl()` (posts to
  `/api/control`, used by Toggle Ignition Off) and `checkHealth()`.
- `boot.js` — the only place that decides Mock vs Live: checks `/api/health` once at load and
  starts the matching source. Nothing else in the codebase needs to know which one is active.
- `enroll.js` — drives the Manage Profiles modal against `/api/enroll/*`.

## Live API (served by logic/server.py via main.py)
| endpoint | method | purpose |
|---|---|---|
| `/api/health` | GET | `{"ok": true}` — used to detect a live backend |
| `/api/state` | GET | latest `DriverState` |
| `/api/events?since=N` | GET | `{"events": [...], "latest_seq": N}` — events with `seq > N` |
| `/api/control` | POST | merge-patch `shared/control.json`, e.g. `{"ignition_off": true}` or `{"dismiss_alarm_at": <epoch seconds>}` (sent when the pull-over popup's "Resume Driving" button is clicked) |
| `/api/preview.jpg` | GET | latest camera frame, for the enrollment preview |
| `/api/enroll/start` | POST | `{"face_id": "profile_1" \| "profile_2"}` — begin capturing |
| `/api/enroll/stop` | POST | cancel the in-progress enrollment session |
| `/api/enroll/status` | GET | `{face_id, saved, target, training, done, error}` |

## Mock `DriverState`
Exactly the `shared/schema.py` contract:
```json
{
  "face_id": "profile_1",
  "present": true,
  "drowsy": false,
  "distracted": false,
  "eyes_on_road": true,
  "emotion": "calm",
  "timestamp": 1737662400.123
}
```

## Logic events (mocked and real use the same shape)
Shape: `{ "type": "...", "seq": <int>, "timestamp": <float>, ...payload }` (mock.js omits `seq`
since it isn't polling a log).

| type | payload | dashboard reaction |
|---|---|---|
| `profile_settings` | `face_id, theme, temperature, playlist` | updates Personalization card |
| `notification_hold` | `id, message` | adds a held item to Notifications |
| `notification_release` | `id, message` | marks that item released (or adds it if never held) |
| `alarm` | `reason` (`"drowsy"` \| `"distracted"` \| `"occupant_left_behind"` \| `"manual"`), `seconds_remaining` | shows the Escalation banner + live countdown to pull-over |
| `pull_over` | — | hides Escalation, opens the pull-over takeover popup (first-person road cam + top-down, drifting to the shoulder) |
| `pull_over_cancelled` | — | emitted if the driver recovers or dismisses after a `pull_over` fired, but the dashboard deliberately ignores it — see below |

The pull-over takeover popup always plays its drive/steer/stop sequence through to a full stop
(~3s) and then waits there indefinitely with hazards blinking — it does **not** auto-close and
does **not** react to `pull_over_cancelled`. It only closes when the driver clicks **Resume
Driving**, which does two things: resets the popup locally, and (live mode only) posts
`{"dismiss_alarm_at": ...}` to `/api/control` so `logic/engine.py` calls
`escalation.acknowledge()` server-side too -- otherwise the backend's `pulled_over` latch would
stay stuck and never fire another `pull_over` event. `mock.js` mirrors the same acknowledge
semantics locally for the no-backend demo path.

Note: the flashing/sound alarm overlay is driven directly off `DriverState.drowsy \|\|
distracted` (dashboard's own immediate reaction, per scope). The `alarm` **event** from `/logic`
is the separate escalation notification shown in the Escalation card — that's `/logic`'s
alarm-escalation state machine talking, not the dashboard deciding anything.

## Status
MVP complete and wired to the real backend: status tiles, avatar, alarm (flash + Web Audio
beep), personalization panel, notification queue, ambient emotion color shift, the pull-over
drift/hazards animation, live/mock auto-detection, and web-based enrollment are all implemented
and tested end-to-end (bridge server + a synthetic `DriverState`/event feed standing in for a
physical webcam — see root README's "what's tested" note).
