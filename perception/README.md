# Perception (Ashwin)

Owns the webcam + CV pipeline. Produces `DriverState` (see `/shared/schema.py`) every frame.

## Scope
- Webcam capture loop
- Face detection + recognition for 2 enrolled profiles
- Drowsiness detection (eye-aspect-ratio / blink duration)
- Distraction detection (head pose / gaze -> `eyes_on_road`)
- Basic emotion classification (calm / stressed / tired)
- Gesture detection (stretch goal, `--gestures`)

## Run
```
pip install -r perception/requirements.txt
python perception/capture.py
```
First run downloads the MediaPipe Tasks model files (~4MB each) into `perception/models/`
(gitignored, cached after that). Needs internet the first time only.

Face recognition works out of the box with `face_id` staying `None` (nobody enrolled yet).
Enroll profiles from the dashboard's **Manage Profiles** panel while `capture.py` (or
`main.py`, which launches it) is running -- no separate command needed. See the "Web
enrollment flow" section below for how that works under the hood. `enroll.py` still exists
as a standalone CLI fallback for developing perception in isolation.

Flags: `--camera N` (default 0), `--fps N` (default 12), `--no-recognition`, `--gestures`,
`--show` (debug preview window with landmarks/EAR/yaw overlay).

## How detection works
- **Drowsiness**: eye-aspect-ratio (EAR) from the 6 landmarks around each eye, averaged.
  Sustained low EAR (blink held past a threshold, i.e. eyes closing) or a sustained high
  mouth-aspect-ratio (yawning) sets `drowsy`. Hysteresis + a several-frame rolling window
  (see `RollingFlag` in `capture.py`) stop a single noisy frame from flipping the flag.
- **Distraction**: head pose (yaw/pitch) via `cv2.solvePnP` against a generic 3D face model.
  The absolute angles carry a per-camera/person offset with no calibration step, so
  `capture.py` samples a rolling baseline over the first ~20 frames a face is seen and
  thresholds on *deviation from that baseline* rather than absolute degrees -- robust to
  camera mounting angle without per-user calibration.
- **Emotion**: a first-pass heuristic (EAR/mouth-aspect-ratio/eyebrow-to-eye distance) per
  the "basic emotion classification from landmarks" scope -- not a trained classifier.
- **Recognition**: OpenCV's LBPH face recognizer (`cv2.face`, ships in
  `opencv-contrib-python`), not dlib/face_recognition -- much easier to install on Windows
  for a 2-profile use case.
- All thresholds live at the top of `capture.py` and are first-pass numbers -- recalibrate
  against your own webcam/lighting.

## Web enrollment flow
No terminal commands: the dashboard's Manage Profiles panel drives enrollment entirely
through the bridge server.
1. Dashboard `POST /api/enroll/start {face_id}` -> bridge writes `shared/enroll_control.json`.
2. `capture.py`'s main loop notices the mode change, captures ~40 face crops into
   `perception/enrollment/<face_id>/` (replacing any previous session for that id), and
   writes progress to `shared/enroll_status.json` every sample.
3. Dashboard polls `GET /api/enroll/status` and shows a live progress bar, plus a live
   camera preview from `GET /api/preview.jpg` (perception writes this every frame).
4. On reaching the target sample count, `capture.py` retrains the LBPH model in-process
   (`recognizer.train_from_enrollment()`), hot-swaps the loaded recognizer, and flips the
   control file back to idle. `POST /api/enroll/stop` cancels early and discards that
   session's partial samples.

## Interface (how /dashboard and /logic consume this)
File-based, via `shared/`, documented in full in `shared/README.md`:
- Every frame, `capture.py` overwrites `shared/state.json` with the current `DriverState`
  (atomic write -- readers never see a torn file).
- With `--gestures`, also overwrites `shared/gesture.json` with the latest detected hand
  gesture (not part of the `DriverState` contract -- an extra channel for the stretch goal).
- Always overwrites `shared/preview.jpg` with the latest frame, for the live enrollment
  preview.
- Neither `/dashboard` nor `/logic` import anything from `/perception` directly -- they only
  read these files (or, for the dashboard, the bridge server's HTTP wrapper around them).

## Status
MVP complete: webcam capture, face landmarks, EAR-based drowsiness, head-pose-based
distraction, landmark-based emotion heuristic, LBPH 2-profile recognition with a web-driven
enrollment flow, and `DriverState` publishing are all implemented and unit-validated against
a real face photo. Gesture detection (`--gestures`) is a basic heuristic stretch goal. Not
yet tested against a live webcam in this environment (no camera available here) -- run
`python capture.py --show` locally to sanity-check the debug overlay.
