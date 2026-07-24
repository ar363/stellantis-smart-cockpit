# Dashboard (Aditya)

Owns the on-screen "cockpit brain" UI. Consumes `DriverState` (see `/shared/schema.py`) and events from `/logic`.

## Scope
- Live dashboard: status tiles for present/drowsy/distracted/emotion, driver avatar/state
- Alarm trigger (sound + flashing visual) on drowsy/distracted
- Personalization: theme color, "temperature" display, playlist widget per `face_id`
- Emotion-based ambient color shift (stretch)
- FSD-style simulated pull-over animation, triggered by `/logic`'s `pull_over` event

## Interface
Document here the mock format you use for `DriverState` and `/logic` events while working standalone,
so integration is a drop-in swap later.

## Status
Not started.
