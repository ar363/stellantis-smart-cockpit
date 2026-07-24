# Smart Cockpit (COC-04)

A live "cockpit brain" that watches the driver via webcam to make the car safer and more personal.

See `TEAM_PROMPT.md` for role assignments and scope. See `shared/schema.py` for the `DriverState` contract
that connects `/perception`, `/dashboard`, and `/logic`.

## Structure
- `/perception` — Ashwin: webcam capture, face recognition, drowsiness/distraction/emotion detection
- `/dashboard` — Aditya: live UI, alarms, personalization, pull-over animation
- `/logic` — Shahaan: notification gating, profiles, escalation, occupant-left-behind, voice/gesture
- `/shared` — contract + docs shared by all three
- `main.py` — final integration entrypoint (edited only at integration checkpoints)
