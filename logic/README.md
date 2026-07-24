# Logic (Shahaan)

Owns the decision layer between `/perception` and `/dashboard`. Takes `DriverState` in, emits events out.

## Scope
- Notification hold/release engine (hold non-urgent while distracted/eyes-off-road, always pass safety alerts)
- Profile store: `face_id` -> `{theme, temperature, playlist}`
- Alarm escalation state machine (drowsy/distracted -> alarm -> ignored past threshold -> `pull_over` event)
- Occupant-left-behind: presence check after simulated "ignition off" + timer -> alarm
- Voice commands + gesture control (stretch) — must ignore input when `eyes_on_road` is false
- Owns final `/main.py` integration wiring (coordinate with Ashwin and Aditya before editing)

## Events emitted (consumed by /dashboard)
Document the exact event schema here once decided, e.g.:
`{"type": "notification_hold" | "notification_release" | "alarm" | "pull_over" | "profile_settings", ...}`

## Status
Not started.
