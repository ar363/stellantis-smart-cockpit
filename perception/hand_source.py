"""Thin wrapper around MediaPipe's HandLandmarker (Tasks API, VIDEO mode).

Only used for the gesture-control stretch goal. Kept optional: capture.py
only imports this when --gestures is passed, so a missing/broken model
download doesn't take down the drowsiness/distraction MVP.

Tracks hand position over time and reports a swipe (left/right/up) when
it crosses a movement threshold. Deliberately movement-only, not
static hand-pose classification (thumbs up, peace, etc.) -- pose
classification from a single frame is unreliable across hand angles/sizes
and was firing on poses it shouldn't. A raw directional swipe is far less
ambiguous and is all the song-control/dismiss commands actually need.
"""

import time
from collections import deque

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision as mp_vision

from models import ensure_model

_SWIPE_HISTORY = 8
_SWIPE_THRESHOLD = 0.12  # fraction of frame width/height
# Once detected, keep reporting the swipe for a bit so a poller slower than
# the camera (engine.py reads shared/gesture.json at 5Hz, well under the
# ~12fps this publishes at) doesn't miss a signal that only existed on the
# one frame it was computed on.
_SWIPE_HOLD_S = 0.5


class HandSource:
    def __init__(self):
        model_path = ensure_model("hand_landmarker.task")
        options = mp_vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=mp_vision.RunningMode.VIDEO,
            num_hands=1,
        )
        self._landmarker = mp_vision.HandLandmarker.create_from_options(options)
        self._start = time.monotonic()
        self._positions = deque(maxlen=_SWIPE_HISTORY)
        self._held_gesture = None
        self._held_until = 0.0

    def _palm_center(self, landmarks):
        wrist = landmarks[0]
        middle_mcp = landmarks[9]
        return ((wrist[0] + middle_mcp[0]) / 2, (wrist[1] + middle_mcp[1]) / 2)

    def _detect_swipe(self):
        if len(self._positions) < _SWIPE_HISTORY:
            return None
        dx = self._positions[-1][0] - self._positions[0][0]
        dy = self._positions[-1][1] - self._positions[0][1]
        self._positions.clear()
        if abs(dx) > abs(dy):
            if dx > _SWIPE_THRESHOLD:
                return "swipe_right"  # hand moved right -> prev track
            if dx < -_SWIPE_THRESHOLD:
                return "swipe_left"  # hand moved left -> next track
        else:
            if dy < -_SWIPE_THRESHOLD:
                return "swipe_up"  # hand moved up -> play/pause
        return None

    def process(self, bgr_frame):
        """Returns (pixel_landmarks, gesture_or_None). gesture is a swipe
        string if one was recently detected (see _SWIPE_HOLD_S), otherwise
        None. Landmarks are always returned when a hand is present."""
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts_ms = int((time.monotonic() - self._start) * 1000)
        result = self._landmarker.detect_for_video(mp_image, ts_ms)
        if not result.hand_landmarks:
            self._positions.clear()
            self._held_gesture = None
            self._held_until = 0.0
            return None, None
        h, w = bgr_frame.shape[:2]
        landmarks = [(lm.x * w, lm.y * h) for lm in result.hand_landmarks[0]]
        center = self._palm_center(landmarks)
        # Normalized (fraction of frame width/height) so _SWIPE_THRESHOLD means
        # what its comment says -- comparing raw pixel deltas against a 0.12
        # threshold made any few-pixel jitter register as a swipe.
        self._positions.append((center[0] / w, center[1] / h))

        now = time.monotonic()
        swipe = self._detect_swipe()
        if swipe:
            self._held_gesture = swipe
            self._held_until = now + _SWIPE_HOLD_S
        gesture = self._held_gesture if now < self._held_until else None
        return landmarks, gesture

    def close(self):
        self._landmarker.close()
