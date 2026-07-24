# Stretch Goals — Implementation Summary

## 1. Voice Commands

**Status:** Fully wired and functional

**What was done:**
- Rewrote `logic/voice.py` — replaced blocking `sounddevice` recorder with `SpeechRecognition` + `sr.Microphone()` for continuous listening with energy-based silence detection
- Installed `SpeechRecognition` and `pyaudio` dependencies
- Added `prev_track`, `toggle_playback`, and `confirm` to the command list
- Voice is gated by `eyes_on_road` — commands are dropped when eyes are off road

**Voice commands:**

| Phrase | Action |
|--------|--------|
| "next song" / "skip" | Skip to next track |
| "previous song" / "go back" | Go to previous track |
| "pause" / "play" / "resume" | Toggle playback |
| "dismiss" / "cancel alarm" | Dismiss active alarm |
| "call" | Initiate phone call |

**Files changed:** `logic/voice.py`, `logic/requirements.txt`

---

## 2. Gesture Control (Swipe-Based)

**Status:** Fully wired, uses hand movement tracking

**What was done:**
- Rewrote `perception/hand_source.py` — added position history tracking (8-frame rolling window) and swipe detection from palm center deltas
- Swipe triggers when hand movement exceeds 12% of frame width/height
- Falls back to static pose detection (`classify_gesture`) when no swipe is detected
- Updated `perception/vision.py:classify_gesture()` — added peace, thumbs_down, wave gesture detection
- Rewrote `logic/gesture_policy.py` — mapped swipe gestures to song control commands
- Updated `perception/capture.py` to use new `(landmarks, gesture)` return format from hand_source

**Gesture mappings:**

| Gesture | Action |
|---------|--------|
| Swipe left (hand moves right in camera) | Next track |
| Swipe right (hand moves left in camera) | Previous track |
| Swipe up | Play / Pause |
| Open palm (static) | Dismiss alarm |
| Peace sign (static) | Dismiss alarm (alt) |

**Files changed:** `perception/hand_source.py`, `perception/vision.py`, `perception/capture.py`, `logic/gesture_policy.py`

---

## 3. Emotion-Based Color + Music

**Status:** Fully functional with persistent song player

**What was done:**
- Added `EMOTION_PLAYLISTS` mapping in `logic/engine.py`: calm→Focus Flow, stressed→Ambient Calm, tired→Upbeat Energy
- Built full song player state machine in `logic/engine.py` — track list, play/pause, skip, prev, auto-advance on track end
- Each playlist has 5 tracks with title, artist, and duration
- Emotion changes automatically switch the playlist (resets to track 1)
- Emotion-based ambient color shift was already working (calm=teal, stressed=red, tired=purple via CSS `--ambient-hue`)

**Song player features:**
- Persistent dashboard card with track name, artist, progress bar, elapsed/total time
- Play/pause, next, prev buttons (wired to `Live.setControl()` in live mode)
- Client-side progress ticker updates every 500ms when playing
- Auto-advances to next track when duration is reached
- Playlist name displayed below controls

**Files changed:** `logic/engine.py`, `dashboard/app.js`, `dashboard/index.html`, `dashboard/style.css`, `dashboard/mock.js`

---

## 4. Occupant-Left-Behind Alert

**Status:** Already fully functional, added visual polish

**What was done:**
- Added distinct amber/warn styling for occupant-left-behind alarms (vs red/danger for drowsiness)
- Escalation card gets `.warn-alarm` class when reason is `occupant_left_behind`
- Different message: "Occupant may still be in vehicle" vs "ALARM — drowsy. Escalating if unresponsive…"

**Files changed:** `dashboard/app.js`, `dashboard/style.css`

---

## 5. Toast Notifications

**Status:** Built from scratch

**What was done:**
- Added `#toast-container` to `index.html`
- Built `showToast(text, variant)` function in `app.js` — auto-dismissing after 3.5s
- Toasts are large (1rem font, 16px/24px padding, 2px border) with slide-in animation
- Color variants: ok (green), warn (amber), danger (red)
- Gesture icons displayed in toasts (← → ↑ ✋ etc.)

**Triggered by:** gesture_detected, track_changed, phone_call_initiated, command_confirmed events

**Files changed:** `dashboard/index.html`, `dashboard/style.css`, `dashboard/app.js`

---

## 6. Demo Updates

**What was done:**
- Updated `dashboard/mock.js` — added song player state, track lists, swipe gesture events in scripted demo
- Auto-demo now cycles through: presence → profile → gesture → emotion → skip → play/pause → distraction → prev → drowsiness → profile switch → emotion → swipe up → emotion
- Removed old notification hold/release demo buttons (replaced by song player)
- Updated gesture reference card with new swipe-based mappings

**Files changed:** `dashboard/mock.js`, `dashboard/index.html`, `dashboard/live.js`

---

## Files Modified (total: 10)

| File | Changes |
|------|---------|
| `perception/hand_source.py` | Swipe detection with position history tracking |
| `perception/vision.py` | Added peace, thumbs_down, wave gesture detection |
| `perception/capture.py` | Updated for new hand_source return format |
| `logic/engine.py` | Song player state machine, all command handlers, emotion→playlist switching |
| `logic/voice.py` | Rewrote to use SpeechRecognition + PyAudio, added new commands |
| `logic/gesture_policy.py` | Swipe-based gesture→command mapping |
| `logic/requirements.txt` | Added pyaudio dependency |
| `dashboard/app.js` | Song player rendering, toast system, new event handlers, occupant-left-behind styling |
| `dashboard/index.html` | Song player card, toast container, gesture reference card, removed notification card |
| `dashboard/style.css` | Song player styles, bigger toasts, occupant-left-behind colors |
| `dashboard/mock.js` | Song player state, gesture events in demo script |
| `dashboard/live.js` | Updated transient event types |

## Dependencies Installed

```
SpeechRecognition  3.17.0
pyaudio            0.2.14
```

## How to Test

- **Mock mode:** `cd dashboard && python -m http.server 8000`
- **Live mode:** `python main.py --gestures --voice`
