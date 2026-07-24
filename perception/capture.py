"""
Perception main loop: webcam -> DriverState, published to shared/state.json
every frame per the team contract (shared/schema.py). This is the only file
Ashwin's part needs to run in production; everything else in /perception is
a helper this file uses.

Also serves the web-based enrollment flow: the dashboard's "Manage Profiles"
panel starts/stops enrollment by writing shared/enroll_control.json (via the
bridge server), and this loop captures face samples, trains the LBPH model,
and reports progress through shared/enroll_status.json + a live JPEG preview
at shared/preview.jpg -- no separate CLI command needed.

Usage:
    python capture.py                  # face-only pipeline (MVP)
    python capture.py --gestures       # also publish shared/gesture.json (stretch goal)
    python capture.py --no-recognition # skip LBPH, face_id always None
    python capture.py --camera 1 --fps 15 --show
"""

import argparse
import sys
import time
from collections import Counter, deque
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shared.io_utils import (  # noqa: E402
    ENROLL_CONTROL_PATH,
    ENROLL_STATUS_PATH,
    GESTURE_PATH,
    PREVIEW_PATH,
    STATE_PATH,
    atomic_write_bytes,
    atomic_write_json,
    read_json,
)
from shared.schema import make_default_driver_state  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
from face_source import FaceSource  # noqa: E402
from recognizer import ENROLL_DIR, FaceRecognizer, train_from_enrollment  # noqa: E402
from vision import (  # noqa: E402
    average_ear,
    brow_raise,
    classify_emotion,
    classify_gesture,
    draw_face_overlay,
    face_bbox,
    head_pose,
    mouth_aspect_ratio,
)

FRIENDLY_NAME = {"profile_1": "Driver 1", "profile_2": "Driver 2"}

# ---- Tunables (first-pass; recalibrate against your own webcam/lighting) ----
EAR_DROWSY_THRESHOLD = 0.19
EAR_CLEAR_THRESHOLD = 0.23  # hysteresis: needs to recover past this to clear "drowsy"
DROWSY_CONSEC_FRAMES = 10  # ~0.7-1s at 12fps
YAWN_MAR_THRESHOLD = 0.55
YAWN_CONSEC_FRAMES = 8
DISTRACTION_YAW_DEG = 28.0
DISTRACTION_PITCH_DEG = 22.0
DISTRACTION_CONSEC_FRAMES = 15  # ~1.2s at 12fps: a held look-away, not a quick glance
BASELINE_CALIBRATION_FRAMES = 20
BASELINE_ADAPT_RATE = 0.02  # EMA pull per frame; ~a few seconds to absorb sustained drift, too slow to mask a real quick look-away
PRESENCE_GRACE_S = 0.6  # survive brief missed detections without flickering "present"
EMOTION_SMOOTHING_FRAMES = 15
FACE_ID_SMOOTHING_FRAMES = 15
FACE_ID_AGREEMENT = 0.6

ENROLL_TARGET_SAMPLES = 40
ENROLL_CAPTURE_INTERVAL_S = 0.15


class RollingFlag:
    """True only once `on_condition` has held for `consec` frames in a row;
    clears once it's been false for `consec` frames. Basic hysteresis so a
    single noisy frame doesn't flip a DriverState boolean."""

    def __init__(self, consec):
        self.consec = consec
        self._count = 0
        self.value = False

    def update(self, condition):
        if condition:
            self._count = min(self._count + 1, self.consec)
        else:
            self._count = max(self._count - 1, 0)
        if self._count >= self.consec:
            self.value = True
        elif self._count == 0:
            self.value = False
        return self.value


class EnrollmentSession:
    """Drives the web-triggered enrollment flow. Polls shared/enroll_control.json
    (written by the bridge server on Start/Stop) and does the capture + train,
    reporting progress via shared/enroll_status.json."""

    def __init__(self, face_source, recognizer_holder):
        self.face_source = face_source
        self.recognizer_holder = recognizer_holder  # 1-item list so we can swap in a retrained model
        self.active_face_id = None
        self.saved = 0
        self.session_files = []
        self.last_capture = 0.0
        atomic_write_json(ENROLL_STATUS_PATH, self._status())

    def _status(self, training=False, done=False, error=None):
        return {
            "face_id": self.active_face_id,
            "saved": self.saved,
            "target": ENROLL_TARGET_SAMPLES,
            "training": training,
            "done": done,
            "error": error,
        }

    def _start(self, face_id):
        out_dir = ENROLL_DIR / face_id
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob("*.png"):
            old.unlink(missing_ok=True)
        self.active_face_id = face_id
        self.saved = 0
        self.session_files = []
        self.last_capture = 0.0
        print(f"[perception] enrollment started for '{face_id}'")
        atomic_write_json(ENROLL_STATUS_PATH, self._status())

    def _cancel(self):
        for f in self.session_files:
            Path(f).unlink(missing_ok=True)
        print(f"[perception] enrollment cancelled for '{self.active_face_id}'")
        self.active_face_id = None
        self.saved = 0
        self.session_files = []
        atomic_write_json(ENROLL_STATUS_PATH, self._status())

    def _finish(self):
        atomic_write_json(ENROLL_STATUS_PATH, self._status(training=True))
        try:
            train_from_enrollment()
            self.recognizer_holder[0] = FaceRecognizer()
            atomic_write_json(ENROLL_STATUS_PATH, self._status(done=True))
        except Exception as exc:  # noqa: BLE001 -- surface any training failure to the UI
            atomic_write_json(ENROLL_STATUS_PATH, self._status(error=str(exc)))
        finally:
            atomic_write_json(ENROLL_CONTROL_PATH, {"mode": "idle", "face_id": None})
            self.active_face_id = None
            self.saved = 0
            self.session_files = []

    def tick(self, frame, points):
        control = read_json(ENROLL_CONTROL_PATH, default={"mode": "idle", "face_id": None})
        mode = control.get("mode", "idle")
        requested_face_id = control.get("face_id")

        if mode == "enrolling":
            if requested_face_id != self.active_face_id:
                self._start(requested_face_id)

            if points is not None and time.monotonic() - self.last_capture >= ENROLL_CAPTURE_INTERVAL_S:
                h, w = frame.shape[:2]
                x0, y0, x1, y1 = face_bbox(points, w, h)
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                crop = gray[y0:y1, x0:x1]
                if crop.size > 0:
                    out_path = ENROLL_DIR / self.active_face_id / f"{self.saved:03d}.png"
                    cv2.imwrite(str(out_path), crop)
                    self.session_files.append(out_path)
                    self.saved += 1
                    self.last_capture = time.monotonic()
                    atomic_write_json(ENROLL_STATUS_PATH, self._status())

            if self.saved >= ENROLL_TARGET_SAMPLES:
                self._finish()
            return True  # enrollment owns this frame; skip normal DriverState publish

        if self.active_face_id is not None:
            self._cancel()
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--fps", type=float, default=12.0)
    parser.add_argument("--mirror", action="store_true", default=True)
    parser.add_argument("--no-recognition", action="store_true")
    parser.add_argument("--gestures", action="store_true", help="also publish shared/gesture.json")
    parser.add_argument("--show", action="store_true", help="show a debug preview window")
    args = parser.parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print(f"[perception] could not open webcam (index {args.camera})")
        sys.exit(1)

    face_source = FaceSource()
    recognizer_holder = [None if args.no_recognition else FaceRecognizer()]
    if recognizer_holder[0] is not None and not recognizer_holder[0].loaded:
        print("[perception] no trained face model yet -- face_id will stay None until you "
              "enroll a profile from the dashboard's Manage Profiles panel.")
    enrollment = EnrollmentSession(face_source, recognizer_holder)

    hand_source = None
    if args.gestures:
        from hand_source import HandSource  # imported lazily: optional stretch dep
        hand_source = HandSource()

    drowsy_flag = RollingFlag(DROWSY_CONSEC_FRAMES)
    distracted_flag = RollingFlag(DISTRACTION_CONSEC_FRAMES)
    yawn_flag = RollingFlag(YAWN_CONSEC_FRAMES)
    emotion_history = deque(maxlen=EMOTION_SMOOTHING_FRAMES)
    face_id_history = deque(maxlen=FACE_ID_SMOOTHING_FRAMES)

    baseline_yaw_samples, baseline_pitch_samples = [], []
    baseline_yaw = baseline_pitch = 0.0
    baseline_locked = False

    last_seen_ts = 0.0
    frame_interval = 1.0 / args.fps
    smoothed_face_id = None

    print(f"[perception] publishing DriverState to {STATE_PATH} at ~{args.fps}fps. Ctrl+C to stop.")

    try:
        while True:
            loop_start = time.monotonic()
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.05)
                continue
            if args.mirror:
                frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]

            points = face_source.process(frame)
            now = time.monotonic()

            enrolling = enrollment.tick(frame, points)

            if not enrolling:
                state = make_default_driver_state()
                state["timestamp"] = time.time()

                if points is not None:
                    last_seen_ts = now

                    ear = average_ear(points)
                    mar = mouth_aspect_ratio(points)
                    yaw, pitch, _roll = head_pose(points, w, h)
                    brow = brow_raise(points)

                    if not baseline_locked:
                        baseline_yaw_samples.append(yaw)
                        baseline_pitch_samples.append(pitch)
                        if len(baseline_yaw_samples) >= BASELINE_CALIBRATION_FRAMES:
                            baseline_yaw = sum(baseline_yaw_samples) / len(baseline_yaw_samples)
                            baseline_pitch = sum(baseline_pitch_samples) / len(baseline_pitch_samples)
                            baseline_locked = True
                            print(f"[perception] head-pose baseline locked: yaw={baseline_yaw:.1f} pitch={baseline_pitch:.1f}")

                    yawning = yawn_flag.update(mar > YAWN_MAR_THRESHOLD)
                    ear_threshold = EAR_CLEAR_THRESHOLD if drowsy_flag.value else EAR_DROWSY_THRESHOLD
                    drowsy = drowsy_flag.update(ear < ear_threshold) or yawning

                    off_axis = baseline_locked and (
                        abs(yaw - baseline_yaw) > DISTRACTION_YAW_DEG
                        or abs(pitch - baseline_pitch) > DISTRACTION_PITCH_DEG
                    )
                    distracted = distracted_flag.update(off_axis)

                    if baseline_locked:
                        # Slow drift toward wherever the head actually rests, so a one-time
                        # miscalibration (or the driver settling into a new posture) doesn't
                        # leave "distracted" latched forever -- it self-corrects in a few
                        # seconds instead of only resetting when the face fully drops out.
                        baseline_yaw += (yaw - baseline_yaw) * BASELINE_ADAPT_RATE
                        baseline_pitch += (pitch - baseline_pitch) * BASELINE_ADAPT_RATE

                    emotion_history.append(classify_emotion(ear, mar, brow, yawning))
                    emotion = Counter(emotion_history).most_common(1)[0][0]

                    bbox = face_bbox(points, w, h)
                    face_id = None
                    if recognizer_holder[0] is not None:
                        x0, y0, x1, y1 = bbox
                        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                        face_id = recognizer_holder[0].predict(gray[y0:y1, x0:x1])
                    face_id_history.append(face_id)
                    votes = Counter(v for v in face_id_history if v is not None)
                    if votes:
                        top_id, top_count = votes.most_common(1)[0]
                        if top_count / len(face_id_history) >= FACE_ID_AGREEMENT:
                            smoothed_face_id = top_id

                    state.update(
                        face_id=smoothed_face_id,
                        present=True,
                        drowsy=bool(drowsy),
                        distracted=bool(distracted),
                        eyes_on_road=not bool(distracted),
                        emotion=emotion,
                    )

                    tag = FRIENDLY_NAME.get(smoothed_face_id, "Unrecognized driver")
                    draw_face_overlay(frame, points, bbox, label=tag, alert=bool(drowsy or distracted))

                    if args.show:
                        debug_line = f"EAR={ear:.2f} yaw={yaw:.0f} pitch={pitch:.0f} {emotion}"
                        cv2.putText(frame, debug_line, (10, h - 14), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
                else:
                    if now - last_seen_ts > PRESENCE_GRACE_S:
                        state.update(present=False, face_id=None, drowsy=False, distracted=False, eyes_on_road=True)
                        smoothed_face_id = None
                        face_id_history.clear()
                        baseline_locked = False
                        baseline_yaw_samples.clear()
                        baseline_pitch_samples.clear()
                        drowsy_flag = RollingFlag(DROWSY_CONSEC_FRAMES)
                        distracted_flag = RollingFlag(DISTRACTION_CONSEC_FRAMES)
                    else:
                        state["present"] = True  # still within grace period, hold last known state

                try:
                    atomic_write_json(STATE_PATH, state)
                except OSError as exc:
                    print(f"[perception] skipped a state publish (transient write failure): {exc}")

                if hand_source is not None:
                    hand_points = hand_source.process(frame)
                    gesture = classify_gesture(hand_points) if hand_points is not None else None
                    try:
                        atomic_write_json(GESTURE_PATH, {"gesture": gesture, "timestamp": time.time()})
                    except OSError as exc:
                        print(f"[perception] skipped a gesture publish (transient write failure): {exc}")

            ok_jpg, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if ok_jpg:
                try:
                    atomic_write_bytes(PREVIEW_PATH, buf.tobytes())
                except OSError as exc:
                    print(f"[perception] skipped a preview publish (transient write failure): {exc}")

            if args.show:
                cv2.imshow("Perception (debug)", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            elapsed = time.monotonic() - loop_start
            if elapsed < frame_interval:
                time.sleep(frame_interval - elapsed)
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        face_source.close()
        if hand_source is not None:
            hand_source.close()
        if args.show:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
