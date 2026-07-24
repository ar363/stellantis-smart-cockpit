"""
Logic main loop: reads DriverState from perception, emits decision events for
the dashboard to render. This is the only file that needs to run in
production for Shahaan's part; everything else in /logic is a helper this
file uses.

Usage:
    python engine.py              # notifications + escalation + occupant-left-behind + gestures
    python engine.py --voice      # also start the voice-command listener (stretch goal)
"""

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from shared.io_utils import (  # noqa: E402
    CONTROL_PATH,
    EVENTS_PATH,
    GESTURE_PATH,
    STATE_PATH,
    append_jsonl,
    next_seq,
    read_json,
)

sys.path.insert(0, str(Path(__file__).parent))
from escalation import EscalationEngine  # noqa: E402
from gesture_policy import GesturePolicy  # noqa: E402
from notifications import NotificationEngine  # noqa: E402
from occupant_watch import OccupantWatch  # noqa: E402
from voice import VoiceListener  # noqa: E402

PROFILES_PATH = Path(__file__).parent / "profiles.json"
POLL_INTERVAL_S = 0.2


def make_emitter():
    counter = {"seq": next_seq(EVENTS_PATH)}

    def emit(record):
        record = dict(record)
        record["seq"] = counter["seq"]
        record["timestamp"] = time.time()
        counter["seq"] += 1
        append_jsonl(EVENTS_PATH, record)
        print(f"[logic] event: {record}")

    return emit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice", action="store_true", help="start the voice-command listener")
    parser.add_argument("--interval", type=float, default=POLL_INTERVAL_S)
    args = parser.parse_args()

    profiles = json.loads(PROFILES_PATH.read_text())
    emit = make_emitter()

    notifications = NotificationEngine()
    escalation = EscalationEngine()
    occupant_watch = OccupantWatch()
    gestures = GesturePolicy()

    last_face_id = "__unset__"
    current_state = {"eyes_on_road": True}

    def on_command(command, source_text):
        print(f"[logic] command '{command}' from {source_text!r}")
        if command == "dismiss_alarm":
            escalation.acknowledge()

    voice_listener = VoiceListener(on_command)
    if args.voice:
        voice_listener.start(lambda: current_state)

    print(f"[logic] decision engine running, polling {STATE_PATH} every {args.interval}s. Ctrl+C to stop.")
    try:
        while True:
            state = read_json(STATE_PATH, default=None)
            if state is not None:
                current_state = state

                face_id = state.get("face_id")
                if state.get("present") and face_id and face_id != last_face_id:
                    profile = profiles.get(face_id)
                    if profile:
                        emit({"type": "profile_settings", "face_id": face_id, **profile})
                    last_face_id = face_id
                elif not state.get("present"):
                    last_face_id = "__unset__"

                notifications.tick(state, emit)
                escalation.tick(state, emit)

                gesture_doc = read_json(GESTURE_PATH, default=None)
                gestures.tick(state, gesture_doc, on_command)

            control = read_json(CONTROL_PATH, default={})
            occupant_watch.tick(current_state, control, emit)

            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass
    finally:
        voice_listener.stop()


if __name__ == "__main__":
    main()
