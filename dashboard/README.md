# Dashboard (Aditya)

Owns the on-screen "cockpit brain" UI. Consumes `DriverState` (see `/shared/schema.py`) and events from `/logic`.

## Scope
- Live dashboard: status tiles for present/drowsy/distracted/emotion, driver avatar/state
- Alarm trigger (sound + flashing visual) on drowsy/distracted
- Personalization: theme color, "temperature" display, playlist widget per `face_id`
- Emotion-based ambient color shift (stretch) — done
- FSD-style simulated pull-over animation, triggered by `/logic`'s `pull_over` event

## Running it
Plain static site, no build step or dependencies.

```
cd dashboard
python -m http.server 8000
```

Open `http://localhost:8000`. (Opening `index.html` directly also works — no ES modules or
fetch calls are used, everything runs off `<script>` tags.)

It boots straight into a self-running demo: an unattended 40s scripted loop drives a driver
through presence, emotion changes, a distraction event, a drowsy event that escalates into an
alarm and then a `pull_over`, and a profile switch — so the whole dashboard is demoable with
nobody touching it. Use the **Demo Controls** footer to take over manually at any point (this
auto-pauses the script); "Resume Auto-Demo" hands control back.

## Architecture
- `index.html` / `style.css` — structure and the dark cockpit theme
- `mock.js` — stands in for perception + logic. Owns a local `DriverState` and calls two
  callbacks: one with a fresh `DriverState` every ~200ms (~5fps, simulating "every frame"),
  one with logic events as they occur.
- `app.js` — the only file that touches the DOM. Exposes exactly two entry points that are the
  real integration surface:
  - `applyDriverState(state)` — render tiles/avatar/ambient color/basic alarm from a `DriverState`
  - `applyLogicEvent(event)` — render personalization/notifications/escalation/pull-over from a
    logic event
  Everything else in `app.js` is pure rendering — no detection or decision logic lives here per
  the team contract.

## Integration swap point
`app.js` currently wires itself up with:
```js
window.Mock.startMock(applyDriverState, applyLogicEvent);
```
To go live, replace that one call with whatever Ashwin/Shahaan land on (poll a JSON file,
`fetch` an HTTP endpoint, or a WebSocket) as long as it calls `applyDriverState(state)` with a
`DriverState`-shaped object and `applyLogicEvent(event)` with an event as described below. No
other file needs to change.

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

## Mock logic events
Shape: `{ "type": "...", "timestamp": <float>, ...payload }`.

| type | payload | dashboard reaction |
|---|---|---|
| `profile_settings` | `face_id, theme, temperature, playlist` | updates Personalization card |
| `notification_hold` | `id, message` | adds a held item to Notifications |
| `notification_release` | `id, message` | marks that item released (or adds it if never held) |
| `alarm` | `reason` (`"drowsy"` \| `"distracted"` \| `"manual"`) | shows the Escalation banner |
| `pull_over` | — | hides Escalation, plays the pull-over drift/hazards animation |

Note: the flashing/sound alarm overlay is driven directly off `DriverState.drowsy \|\|
distracted` (dashboard's own immediate reaction, per scope). The `alarm` **event** from `/logic`
is the separate escalation notification shown in the Escalation card — that's `/logic`'s
alarm-escalation state machine talking, not the dashboard deciding anything.

## Status
MVP complete: status tiles, avatar, alarm (flash + Web Audio beep), personalization panel,
notification queue, ambient emotion color shift, and the pull-over drift/hazards animation are
all implemented against the mocked feed above. Not yet wired to real perception/logic — swap in
at the integration checkpoint per the section above.
