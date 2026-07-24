"""
Pure landmark-math: eye/mouth ratios, head pose, a basic emotion heuristic,
and a basic hand-gesture heuristic. No I/O, no webcam -- these are plain
functions over pixel-space landmark lists so they're testable without a
camera (validated against a real face photo during development; indices are
the standard MediaPipe FaceMesh/HandLandmarker topology).

Thresholds here are first-pass hackathon numbers, not calibrated -- tune
them against your own webcam/lighting.
"""

import numpy as np
import cv2

# ---- Face landmark indices (MediaPipe FaceMesh topology, 478 points) ----
LEFT_EYE = [362, 385, 387, 263, 373, 380]
RIGHT_EYE = [33, 160, 158, 133, 153, 144]
MOUTH_TOP_BOTTOM = (13, 14)
MOUTH_CORNERS = (78, 308)
LEFT_BROW, LEFT_BROW_EYE = 105, 159
RIGHT_BROW, RIGHT_BROW_EYE = 334, 386
EYE_OUTER_CORNERS = (33, 263)  # used as a scale reference

# 6-point head pose model (generic adult face, mm) + matching landmark indices.
_POSE_MODEL_POINTS = np.array(
    [
        (0.0, 0.0, 0.0),  # nose tip
        (0.0, -63.6, -12.5),  # chin
        (-43.3, 32.7, -26.0),  # left eye outer corner
        (43.3, 32.7, -26.0),  # right eye outer corner
        (-28.9, -28.9, -24.1),  # left mouth corner
        (28.9, -28.9, -24.1),  # right mouth corner
    ],
    dtype=np.float64,
)
_POSE_LANDMARKS = [1, 152, 33, 263, 61, 291]

# ---- Hand landmark indices (MediaPipe HandLandmarker topology, 21 points) ----
_WRIST = 0
_THUMB_TIP, _THUMB_IP = 4, 3
_FINGER_TIPS_PIPS = [(8, 6), (12, 10), (16, 14), (20, 18)]  # index, middle, ring, pinky


def _dist(a, b):
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


def eye_aspect_ratio(points, indices):
    p1, p2, p3, p4, p5, p6 = (points[i] for i in indices)
    return (_dist(p2, p6) + _dist(p3, p5)) / (2.0 * _dist(p1, p4) + 1e-6)


def average_ear(points):
    """Scale-invariant (it's a ratio of distances). Lower = eyes more closed."""
    return (eye_aspect_ratio(points, LEFT_EYE) + eye_aspect_ratio(points, RIGHT_EYE)) / 2.0


def mouth_aspect_ratio(points):
    """Scale-invariant. Higher = mouth more open (yawning)."""
    top, bottom = points[MOUTH_TOP_BOTTOM[0]], points[MOUTH_TOP_BOTTOM[1]]
    left, right = points[MOUTH_CORNERS[0]], points[MOUTH_CORNERS[1]]
    return _dist(top, bottom) / (_dist(left, right) + 1e-6)


def brow_raise(points):
    """Normalized by inter-eye distance so it doesn't depend on face size in
    frame. Lower = brows pulled down/together (furrowed, a stress cue)."""
    scale = _dist(points[EYE_OUTER_CORNERS[0]], points[EYE_OUTER_CORNERS[1]]) + 1e-6
    left = _dist(points[LEFT_BROW], points[LEFT_BROW_EYE])
    right = _dist(points[RIGHT_BROW], points[RIGHT_BROW_EYE])
    return ((left + right) / 2.0) / scale


def head_pose(points, frame_w, frame_h):
    """Returns (yaw, pitch, roll) in degrees. These carry a systematic offset
    from the generic 3D model (no per-person/camera calibration) -- capture.py
    tracks a rolling baseline and thresholds on *deviation* from it rather
    than on these absolute angles."""
    image_points = np.array([points[i] for i in _POSE_LANDMARKS], dtype=np.float64)
    focal_length = frame_w
    center = (frame_w / 2, frame_h / 2)
    camera_matrix = np.array(
        [[focal_length, 0, center[0]], [0, focal_length, center[1]], [0, 0, 1]],
        dtype=np.float64,
    )
    dist_coeffs = np.zeros((4, 1))
    ok, rvec, _tvec = cv2.solvePnP(
        _POSE_MODEL_POINTS, image_points, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_ITERATIVE
    )
    if not ok:
        return 0.0, 0.0, 0.0
    rmat, _ = cv2.Rodrigues(rvec)
    sy = np.sqrt(rmat[0, 0] ** 2 + rmat[1, 0] ** 2)
    if sy < 1e-6:
        pitch = np.degrees(np.arctan2(-rmat[2, 0], sy))
        yaw = 0.0
        roll = np.degrees(np.arctan2(-rmat[1, 2], rmat[1, 1]))
    else:
        pitch = np.degrees(np.arctan2(-rmat[2, 0], sy))
        yaw = np.degrees(np.arctan2(rmat[1, 0], rmat[0, 0]))
        roll = np.degrees(np.arctan2(rmat[2, 1], rmat[2, 2]))
    return float(yaw), float(pitch), float(roll)


def face_bbox(points, frame_w, frame_h, margin=0.25):
    """Axis-aligned crop box around all face landmarks, with a bit of margin,
    clamped to the frame. Used to grab a face crop for LBPH recognition."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    mx, my = (x1 - x0) * margin, (y1 - y0) * margin
    x0, y0 = max(0, int(x0 - mx)), max(0, int(y0 - my))
    x1, y1 = min(frame_w, int(x1 + mx)), min(frame_h, int(y1 + my))
    return x0, y0, x1, y1


_OVERLAY_OK = (151, 220, 61)  # BGR, matches dashboard --ok (#3ddc97)
_OVERLAY_ALERT = (94, 77, 255)  # BGR, matches dashboard --danger (#ff4d5e)


def draw_face_overlay(frame, points, bbox, label=None, alert=False):
    """Draws a lightweight AR-style face overlay (landmark dots, eye/mouth
    contours, a bracket frame, and a name tag) directly onto `frame`. This is
    what gets published to shared/preview.jpg, so the dashboard's driver-cam
    feed reads as "the model is looking at this face" instead of a raw,
    unannotated webcam frame."""
    color = _OVERLAY_ALERT if alert else _OVERLAY_OK
    x0, y0, x1, y1 = bbox

    for x, y in points:
        cv2.circle(frame, (int(x), int(y)), 1, color, -1, cv2.LINE_AA)

    for eye in (LEFT_EYE, RIGHT_EYE):
        pts = np.array([points[i] for i in eye], dtype=np.int32)
        cv2.polylines(frame, [pts], True, (255, 255, 255), 1, cv2.LINE_AA)
    mouth_pts = np.array(
        [
            points[MOUTH_CORNERS[0]],
            points[MOUTH_TOP_BOTTOM[0]],
            points[MOUTH_CORNERS[1]],
            points[MOUTH_TOP_BOTTOM[1]],
        ],
        dtype=np.int32,
    )
    cv2.polylines(frame, [mouth_pts], True, (255, 255, 255), 1, cv2.LINE_AA)

    corner = max(10, int(min(x1 - x0, y1 - y0) * 0.12))
    for cx, cy, dx, dy in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        cv2.line(frame, (cx, cy), (cx + dx * corner, cy), color, 2, cv2.LINE_AA)
        cv2.line(frame, (cx, cy), (cx, cy + dy * corner), color, 2, cv2.LINE_AA)

    if label:
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        pad = 6
        tag_y1 = max(0, y0 - th - 2 * pad)
        cv2.rectangle(frame, (x0, tag_y1), (x0 + tw + 2 * pad, tag_y1 + th + 2 * pad), color, -1)
        cv2.putText(
            frame, label, (x0 + pad, tag_y1 + th + pad // 2),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (15, 15, 15), 1, cv2.LINE_AA,
        )

    return frame


def classify_emotion(ear, mar, brow, yawn_active):
    """Rough calm/stressed/tired heuristic from landmark ratios -- explicitly
    a first pass per the team scope ('basic emotion classification from
    landmarks'), not a trained model."""
    if yawn_active or ear < 0.15:
        return "tired"
    if mar > 0.55 or brow < 0.18:
        return "stressed"
    return "calm"


def classify_gesture(points):
    """Hackathon-grade gesture classifier. Detects: open_palm, thumbs_up,
    thumbs_down, peace, fist, wave. Finger-extension is judged by distance
    from the wrist rather than raw up/down position, so it isn't limited to
    a perfectly upright hand -- still a first pass, not production."""
    wrist = points[_WRIST]

    def extended(tip, pip):
        return _dist(points[tip], wrist) > _dist(points[pip], wrist) * 1.15

    fingers = [extended(tip, pip) for tip, pip in _FINGER_TIPS_PIPS]
    num_extended = sum(fingers)

    thumb_tip, thumb_ip = points[_THUMB_TIP], points[_THUMB_IP]
    thumb_out = _dist(thumb_tip, wrist) > _dist(thumb_ip, wrist) * 1.15
    # Margin scaled to hand size (wrist-to-middle-knuckle) so "up" vs "down"
    # isn't decided by a sub-pixel tie when the thumb is roughly level.
    axis_margin = _dist(points[9], wrist) * 0.15
    thumb_up = thumb_tip[1] < wrist[1] - axis_margin
    thumb_down = thumb_tip[1] > wrist[1] + axis_margin

    if num_extended >= 4:
        return "open_palm"
    if num_extended == 0:
        if thumb_out and thumb_up:
            return "thumbs_up"
        if thumb_out and thumb_down:
            return "thumbs_down"
        return "fist"
    if fingers[0] and fingers[1] and not fingers[2] and not fingers[3]:
        return "peace"
    if num_extended >= 2:
        return "wave"

    return None
