"""
Standalone CLI face enrollment -- a debug/dev fallback.

The normal way to enroll a profile is the dashboard's "Manage Profiles"
panel while `main.py` is running (no terminal commands needed). Use this
script only if you want to enroll without the web stack running, e.g. while
developing perception in isolation.

Usage:
    python enroll.py profile_1
    python enroll.py profile_2

Captures ~40 face crops from the webcam (move your head slightly for
variety), saves them under perception/enrollment/<face_id>/, then retrains
the LBPH model so perception/capture.py can recognize this face.
"""

import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).parent))
from face_source import FaceSource  # noqa: E402
from vision import face_bbox  # noqa: E402
from recognizer import ENROLL_DIR, train_from_enrollment  # noqa: E402

TARGET_SAMPLES = 40
CAPTURE_INTERVAL_S = 0.15  # don't save near-duplicate consecutive frames


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    face_id = sys.argv[1]

    out_dir = ENROLL_DIR / face_id
    out_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("[enroll] could not open webcam (index 0)")
        sys.exit(1)

    face_source = FaceSource()
    print(f"[enroll] capturing {TARGET_SAMPLES} samples for '{face_id}'. Look at the camera, "
          f"turn your head slightly every few seconds. Press 'q' to stop early.")

    saved = 0
    last_capture = 0.0
    try:
        while saved < TARGET_SAMPLES:
            ok, frame = cap.read()
            if not ok:
                continue
            h, w = frame.shape[:2]
            points = face_source.process(frame)

            if points is not None:
                x0, y0, x1, y1 = face_bbox(points, w, h)
                cv2.rectangle(frame, (x0, y0), (x1, y1), (0, 255, 0), 2)
                now = time.monotonic()
                if now - last_capture >= CAPTURE_INTERVAL_S:
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    crop = gray[y0:y1, x0:x1]
                    if crop.size > 0:
                        cv2.imwrite(str(out_dir / f"{saved:03d}.png"), crop)
                        saved += 1
                        last_capture = now

            cv2.putText(frame, f"{face_id}: {saved}/{TARGET_SAMPLES}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            cv2.imshow("Enroll (press q to stop)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        cap.release()
        face_source.close()
        cv2.destroyAllWindows()

    print(f"[enroll] saved {saved} samples to {out_dir}")
    if saved == 0:
        print("[enroll] no samples captured, skipping training")
        sys.exit(1)
    train_from_enrollment()


if __name__ == "__main__":
    main()
