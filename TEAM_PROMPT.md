PROJECT: Smart Cockpit (COC-04) — live driver-monitoring dashboard using only a laptop webcam.

TEAM:
  Ashwin  -> Perception / CV engine   -> works in /perception
  Aditya  -> Dashboard / UX           -> works in /dashboard
  Shahaan -> Logic / integration      -> works in /logic

MY NAME: [Ashwin / Aditya / Shahaan]  <-- fill this in before running

REPO LAYOUT (do not create or edit files outside your own folder + shared/):
  /shared/
    schema.py          <- the DriverState contract, shared by everyone
    README.md          <- how to run the full integrated demo
  /perception/            <- owned by Ashwin
  /dashboard/             <- owned by Aditya
  /logic/                 <- owned by Shahaan
  /main.py                <- integration entrypoint, edited only during merge checkpoints, coordinate before touching

SHARED CONTRACT (do not change without telling the other two — this is the only interface between folders):
  DriverState = {
    "face_id": str | None,      # "profile_1" | "profile_2" | None
    "present": bool,
    "drowsy": bool,
    "distracted": bool,
    "eyes_on_road": bool,
    "emotion": str,             # "calm" | "stressed" | "tired"
    "timestamp": float
  }
  Ashwin writes this dict to shared/schema.py (or emits it as JSON on a queue/socket) every frame.
  Aditya and Shahaan only ever read DriverState — they never touch the webcam or CV code directly.

--------------------------------------------------------------
IF I AM ASHWIN — Perception / CV engine (/perception):
Build the perception pipeline that watches the driver and produces DriverState every frame:
  - Webcam capture loop
  - Face detection + recognition for exactly 2 enrolled profiles
  - Drowsiness detection (eye-aspect-ratio / blink duration via MediaPipe Face Mesh)
  - Distraction detection (head pose / gaze -> eyes_on_road boolean)
  - Basic emotion classification (calm / stressed / tired) from landmarks
  - Publish DriverState per shared/schema.py at a steady frame rate (aim 10-15fps)
Deliverable: a runnable module in /perception that Aditya/Shahaan can import or connect to (function call, socket, or file/queue — pick one and document it in perception/README.md) without needing to know any CV internals.
Do not build any UI or alerting logic — that's Aditya and Shahaan.

--------------------------------------------------------------
IF I AM ADITYA — Dashboard / UX (/dashboard):
Build the on-screen "cockpit brain" dashboard that consumes DriverState:
  - Live dashboard screen: status tiles for present/drowsy/distracted/emotion, driver avatar/state
  - Alarm trigger (sound + flashing visual) when drowsy or distracted
  - Personalization: theme color, "temperature" display, playlist widget that switches per recognized face_id
  - Emotion-based ambient color shift (stretch goal)
  - FSD-style simulated pull-over animation: a mini top-down road/car view that auto-plays (drift to shoulder, hazards flash, "Pulling over — driver unresponsive" banner) when Shahaan's escalation logic fires a "pull_over" event. Trigger condition is decided jointly with Shahaan (e.g. alarm ignored 5-8s) — confirm before hardcoding it.
Deliverable: a runnable dashboard in /dashboard that reads DriverState (mocked with a fake generator if Ashwin isn't ready yet) and reads escalation/notification events from Shahaan (also mockable). Document your mock format in dashboard/README.md so integration is a drop-in swap later.
Do not write detection logic or notification rules — just render what you're told.

--------------------------------------------------------------
IF I AM SHAHAAN — Logic / integration / stretch (/logic):
Build the decision layer that sits between perception and dashboard:
  - Notification hold/release engine: queue non-urgent notifications while distracted/eyes-off-road, always pass safety-critical alerts immediately
  - Profile store: face_id -> {theme, temperature, playlist} settings
  - Alarm escalation state machine: drowsy/distracted -> alarm -> if ignored past threshold -> fire "pull_over" event for Aditya's animation
  - Occupant-left-behind: presence check after simulated "ignition off" + timer -> alarm
  - Voice commands + gesture control (stretch): both must check eyes_on_road from DriverState and ignore input if false
  - Own the final main.py integration wiring (coordinate with Ashwin and Aditya before editing shared code)
Deliverable: a runnable logic module in /logic that takes DriverState in and emits events (notification_hold, notification_release, alarm, pull_over, profile_settings) that Aditya's dashboard consumes. Document the event format in logic/README.md.
Do not touch webcam/CV code or UI rendering.

--------------------------------------------------------------
RULES FOR EVERYONE:
1. Only edit files inside your own folder + shared/README.md (never shared/schema.py without team agreement).
2. If you need something from another person's folder, mock it locally first (fake data generator) and swap it at the integration checkpoint — don't wait on each other.
3. Commit and push early/often — since folders don't overlap, there should be zero merge conflicts.
4. Two integration checkpoints: midpoint (wire real Ashwin -> Aditya -> Shahaan once each has a basic version) and T-1hr before demo (final polish + rehearse the pull-over demo beat).
