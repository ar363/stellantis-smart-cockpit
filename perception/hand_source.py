"""Thin wrapper around MediaPipe's HandLandmarker (Tasks API, VIDEO mode).

Only used for the gesture-control stretch goal. Kept optional: capture.py
only imports this when --gestures is passed, so a missing/broken model
download doesn't take down the drowsiness/distraction MVP.

Classifies a static hand pose each frame (see vision.classify_gesture) and
requires it to hold steady for a few consecutive frames before reporting
it, so one noisy frame doesn't flicker a false gesture.
"""

import time

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision as mp_vision

from models import ensure_model
from vision import classify_gesture

_STABLE_FRAMES = 4  # consecutive matching frames required before reporting
# Once reported, keep reporting for a bit so a poller slower than the camera
# (engine.py reads shared/gesture.json at 5Hz, well under the ~12fps this
# publishes at) doesn't miss a signal that only existed on the one frame it
# was computed on.
_HOLD_S = 0.6


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
        self._candidate = None
        self._candidate_count = 0
        self._held_gesture = None
        self._held_until = 0.0

    def process(self, bgr_frame):
        """Returns (pixel_landmarks, gesture_or_None). gesture is "peace" or
        "thumbs_up" if one was recently held steady (see _STABLE_FRAMES /
        _HOLD_S), otherwise None. Landmarks are always returned when a hand
        is present."""
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts_ms = int((time.monotonic() - self._start) * 1000)
        result = self._landmarker.detect_for_video(mp_image, ts_ms)
        if not result.hand_landmarks:
            self._candidate = None
            self._candidate_count = 0
            self._held_gesture = None
            self._held_until = 0.0
            return None, None
        h, w = bgr_frame.shape[:2]
        landmarks = [(lm.x * w, lm.y * h) for lm in result.hand_landmarks[0]]

        pose = classify_gesture(landmarks)
        if pose == self._candidate:
            self._candidate_count += 1
        else:
            self._candidate = pose
            self._candidate_count = 1

        now = time.monotonic()
        if pose is not None and self._candidate_count >= _STABLE_FRAMES:
            self._held_gesture = pose
            self._held_until = now + _HOLD_S
        gesture = self._held_gesture if now < self._held_until else None
        return landmarks, gesture

    def close(self):
        self._landmarker.close()
