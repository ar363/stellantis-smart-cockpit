# Logic (Shahaan)

Owns the decision layer between `/perception` and `/dashboard`. Takes `DriverState` in, emits events out.

## Scope
- Notification hold/release engine (hold non-urgent while distracted/eyes-off-road, always pass safety alerts)
- Profile store: `face_id` -> `{theme, temperature, playlist}`
- Alarm escalation state machine (drowsy/distracted -> alarm -> ignored past threshold -> `pull_over` event)
- Occupant-left-behind: presence check after simulated "ignition off" + timer -> alarm
- Voice commands + gesture control (stretch) -- both check `eyes_on_road` and ignore input when false
- Owns final `/main.py` integration wiring

## Run
```
pip install -r logic/requirements.txt   # only needed for --voice
python logic/engine.py                  # notifications, escalation, occupant-watch, gestures
python logic/engine.py --voice          # also start the voice-command listener
```
Reads `shared/state.json` (perception's output) ~5x/sec and appends decision events to
`shared/events.jsonl`. Runs fine before perception exists/starts -- it just waits, since a
missing `state.json` is treated as "no update yet", not an error.

## Events emitted (consumed by /dashboard)
Every event is `{"type": ..., "seq": int, "timestamp": float, ...payload}`. `seq` is a
strictly increasing counter so consumers (the bridge server) can ask for "everything after
seq N" without re-parsing the whole log.

| type | payload | when |
|---|---|---|
| `profile_settings` | `face_id, theme, temperature, playlist` | a recognized face becomes present (looked up from `logic/profiles.json`) |
| `notification_hold` | `id, message` | a simulated notification arrives while distracted/eyes off road |
| `notification_release` | `id, message` | a notification is safety-critical (always passes immediately), or a held one becomes safe to show |
| `alarm` | `reason` (`"drowsy"` \| `"distracted"` \| `"occupant_left_behind"`), `seconds_remaining` (float, drowsy/distracted alarms only) | repeats every ~1.5s while drowsy/distracted persists (stops once `pull_over` fires), or once for occupant-left-behind |
| `pull_over` | -- | drowsy/distracted has persisted unacknowledged for ~3s |
| `pull_over_cancelled` | -- | driver becomes safe again, or acknowledges (voice/gesture dismiss), after a `pull_over` had fired |

There's no real phone/notification source hooked up here (no such integration exists for a
laptop-only demo), so `notifications.py` simulates one arriving every 15-25s -- the point is
to exercise the real hold/release gating against `DriverState`, not to fake urgency.

## Stretch goals
- **Occupant-left-behind** (`occupant_watch.py`): there's no real ignition signal, so this
  watches `shared/control.json`'s `ignition_off` flag, which the dashboard's demo controls
  toggle. After `TIMER_S` (8s, demo-scale) with it set and a driver still `present`, fires an
  `alarm` with `reason: "occupant_left_behind"` -- reuses the existing event type instead of
  adding a new one, so the dashboard needs no changes to render it.
- **Voice commands** (`voice.py`, `--voice`): listens continuously via `SpeechRecognition` +
  a PyAudio mic and transcribes with the free Google Web Speech API (needs internet).
  Recognized phrases map to commands (`COMMANDS` list): dismiss/cancel alarm, next/previous
  song, pause/play, call, confirm. Optional: if the packages aren't installed, this silently
  no-ops instead of crashing the rest of logic.
- **Gesture control** (`gesture_policy.py`): perception (`capture.py --gestures`) publishes a
  raw directional swipe to `shared/gesture.json` (movement only, no static hand-pose
  classification -- that proved too ambiguous to be reliable). Maps `swipe_left` ->
  `next_track`, `swipe_right` -> `prev_track`, `swipe_up` -> `toggle_playback`, `swipe_down`
  -> `dismiss_alarm`. Both stretch inputs check `eyes_on_road` before acting, per the team
  contract.
- `dismiss_alarm` resets the escalation countdown so a fresh alarm/pull-over cycle can occur,
  and also emits `pull_over_cancelled` if a `pull_over` had already fired, so the dashboard
  retracts the pull-over UI instead of leaving it stuck on screen.

## Status
MVP complete: profile store, notification hold/release, and the alarm escalation state
machine are implemented and driven off the real `DriverState` file contract. Occupant-left-behind,
voice commands, and gesture control (all stretch) are implemented and gated correctly, but
voice/gesture depend on hardware (mic/camera) not available to verify in this environment --
exercised here via synthetic `DriverState`/control-file inputs instead, see the root README's
"what's tested" note.
