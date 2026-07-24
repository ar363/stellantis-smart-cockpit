"""
Gesture -> command policy (stretch goal). Perception (`capture.py --gestures`)
publishes raw hand gestures to shared/gesture.json; this is the only place
allowed to turn that into an action, and only when the driver's eyes are on
the road, per the team contract ("both must check eyes_on_road ... and
ignore input if false").
"""

GESTURE_COMMANDS = {
    "open_palm": "dismiss_alarm",
    "thumbs_up": "confirm",
}


class GesturePolicy:
    def __init__(self):
        self._last_gesture = None

    def tick(self, state, gesture_doc, on_command):
        gesture = (gesture_doc or {}).get("gesture")
        if gesture == self._last_gesture:
            return
        self._last_gesture = gesture
        if gesture is None or not state.get("eyes_on_road", True):
            return
        command = GESTURE_COMMANDS.get(gesture)
        if command:
            on_command(command, f"gesture:{gesture}")
