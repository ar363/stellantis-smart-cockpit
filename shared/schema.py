"""
Shared contract between perception (Ashwin), dashboard (Aditya), and logic (Shahaan).
Do not change this file without agreement from all three.
"""

from typing import TypedDict, Optional


class DriverState(TypedDict):
    face_id: Optional[str]   # "profile_1" | "profile_2" | None
    present: bool
    drowsy: bool
    distracted: bool
    eyes_on_road: bool
    emotion: str              # "calm" | "stressed" | "tired"
    timestamp: float


def make_default_driver_state() -> DriverState:
    return {
        "face_id": None,
        "present": False,
        "drowsy": False,
        "distracted": False,
        "eyes_on_road": True,
        "emotion": "calm",
        "timestamp": 0.0,
    }
