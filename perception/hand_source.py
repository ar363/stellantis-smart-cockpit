"""Thin wrapper around MediaPipe's HandLandmarker (Tasks API, VIDEO mode).

Only used for the gesture-control stretch goal. Kept optional: capture.py
only imports this when --gestures is passed, so a missing/broken model
download doesn't take down the drowsiness/distraction MVP.

Tracks hand position over time to detect swipes (left/right/up/down).
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
                return "swipe_left"  # hand moves right = prev track
            if dx < -_SWIPE_THRESHOLD:
                return "swipe_right"  # hand moves left = next track
        else:
            if dy < -_SWIPE_THRESHOLD:
                return "swipe_up"  # hand moves up = play/pause
        return None

    def process(self, bgr_frame):
        """Returns (pixel_landmarks, gesture_or_None). gesture is a swipe
        string if detected, otherwise None. Landmarks are always returned
        when a hand is present."""
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts_ms = int((time.monotonic() - self._start) * 1000)
        result = self._landmarker.detect_for_video(mp_image, ts_ms)
        if not result.hand_landmarks:
            self._positions.clear()
            return None, None
        h, w = bgr_frame.shape[:2]
        landmarks = [(lm.x * w, lm.y * h) for lm in result.hand_landmarks[0]]
        center = self._palm_center(landmarks)
        self._positions.append(center)
        gesture = self._detect_swipe()
        return landmarks, gesture

    def close(self):
        self._landmarker.close()
