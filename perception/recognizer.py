"""
2-profile face recognition via OpenCV's LBPH recognizer (cv2.face, ships in
opencv-contrib-python) -- deliberately not dlib/face_recognition, which are
painful to install on Windows and overkill for "tell 2 enrolled faces apart".
"""

import json
from pathlib import Path

import cv2
import numpy as np

MODEL_DIR = Path(__file__).parent / "models"
ENROLL_DIR = Path(__file__).parent / "enrollment"
MODEL_PATH = MODEL_DIR / "lbph.yml"
LABELS_PATH = MODEL_DIR / "labels.json"

FACE_SIZE = (200, 200)
CONFIDENCE_THRESHOLD = 75.0  # LBPH distance -- lower is a more confident match


class FaceRecognizer:
    """Loads a trained model if one exists; predict() is a no-op (returns
    None) until perception/enroll.py has been run at least once."""

    def __init__(self):
        self.recognizer = cv2.face.LBPHFaceRecognizer_create()
        self.labels = {}
        self.loaded = False
        if MODEL_PATH.exists() and LABELS_PATH.exists():
            self.recognizer.read(str(MODEL_PATH))
            self.labels = {int(k): v for k, v in json.loads(LABELS_PATH.read_text()).items()}
            self.loaded = True

    def predict(self, gray_face):
        if not self.loaded or gray_face.size == 0:
            return None
        face = cv2.resize(gray_face, FACE_SIZE)
        label, confidence = self.recognizer.predict(face)
        if confidence > CONFIDENCE_THRESHOLD:
            return None
        return self.labels.get(label)


def train_from_enrollment():
    """Rebuild models/lbph.yml + labels.json from perception/enrollment/<face_id>/*.png."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    images, labels, label_names = [], [], {}
    next_label = 0
    profile_dirs = sorted(ENROLL_DIR.iterdir()) if ENROLL_DIR.exists() else []
    for profile_dir in profile_dirs:
        if not profile_dir.is_dir():
            continue
        face_id = profile_dir.name
        count = 0
        for img_path in profile_dir.glob("*.png"):
            img = cv2.imread(str(img_path), cv2.IMREAD_GRAYSCALE)
            if img is None:
                continue
            images.append(cv2.resize(img, FACE_SIZE))
            labels.append(next_label)
            count += 1
        if count == 0:
            continue
        label_names[next_label] = face_id
        next_label += 1

    if not images:
        raise RuntimeError("No enrollment images found. Run `python enroll.py <face_id>` first.")

    recognizer = cv2.face.LBPHFaceRecognizer_create()
    recognizer.train(images, np.array(labels))
    recognizer.write(str(MODEL_PATH))
    LABELS_PATH.write_text(json.dumps(label_names))
    print(f"[perception] trained on {len(images)} images across {next_label} profile(s): {label_names}")
