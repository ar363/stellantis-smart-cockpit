"""
Gesture -> command policy (stretch goal). Perception (`capture.py --gestures`)
publishes raw hand gestures to shared/gesture.json; this is the only place
allowed to turn that into an action, and only when the driver's eyes are on
the road, per the team contract ("both must check eyes_on_road ... and
ignore input if false").

Deliberately just two static poses -- a bigger vocabulary (swipes, open
palm, fist, wave, ...) kept misfiring in practice. Peace/thumbs_up are
visually distinct enough to tell apart reliably from a single frame.

Gesture mappings:
  peace      -> prev_track
  thumbs_up  -> next_track
"""

GESTURE_COMMANDS = {
    "peace": "prev_track",
    "thumbs_up": "next_track",
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
