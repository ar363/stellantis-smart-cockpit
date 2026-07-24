"""Thin wrapper around MediaPipe's FaceLandmarker (Tasks API, VIDEO mode)."""

import time

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision as mp_vision

from models import ensure_model


class FaceSource:
    def __init__(self):
        model_path = ensure_model("face_landmarker.task")
        options = mp_vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=mp_vision.RunningMode.VIDEO,
            num_faces=1,
        )
        self._landmarker = mp_vision.FaceLandmarker.create_from_options(options)
        self._start = time.monotonic()

    def process(self, bgr_frame):
        """Returns pixel-space (x, y) landmark points for the first detected
        face, or None if no face is present in this frame."""
        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts_ms = int((time.monotonic() - self._start) * 1000)
        result = self._landmarker.detect_for_video(mp_image, ts_ms)
        if not result.face_landmarks:
            return None
        h, w = bgr_frame.shape[:2]
        return [(lm.x * w, lm.y * h) for lm in result.face_landmarks[0]]

    def close(self):
        self._landmarker.close()
