# Perception (Ashwin)

Owns the webcam + CV pipeline. Produces `DriverState` (see `/shared/schema.py`) every frame.

## Scope
- Webcam capture loop
- Face detection + recognition for 2 enrolled profiles
- Drowsiness detection (eye-aspect-ratio / blink duration)
- Distraction detection (head pose / gaze -> `eyes_on_road`)
- Basic emotion classification (calm / stressed / tired)

## Interface
Document here how `/dashboard` and `/logic` consume your output (function call, socket, file, queue, etc.)
once decided.

## Status
Not started.
