"""
Downloads the MediaPipe Tasks model files perception needs, on first run.
Cached under perception/models/ (gitignored -- they're multi-MB binaries).
"""

import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).parent / "models"

MODEL_URLS = {
    "face_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/latest/face_landmarker.task"
    ),
    "hand_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
        "hand_landmarker/float16/latest/hand_landmarker.task"
    ),
}


def ensure_model(name: str) -> Path:
    """Return a local path to `name`, downloading it first if necessary."""
    if name not in MODEL_URLS:
        raise ValueError(f"unknown model {name!r}, expected one of {list(MODEL_URLS)}")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    dest = MODELS_DIR / name
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    print(f"[perception] downloading {name} (first run only)...")
    urllib.request.urlretrieve(MODEL_URLS[name], dest)
    print(f"[perception] saved {dest}")
    return dest
