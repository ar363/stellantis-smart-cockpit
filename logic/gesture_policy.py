"""
Gesture -> command policy (stretch goal). Perception (`capture.py --gestures`)
publishes raw hand gestures to shared/gesture.json; this is the only place
allowed to turn that into an action, and only when the driver's eyes are on
the road, per the team contract ("both must check eyes_on_road ... and
ignore input if false").

Movement-only: perception reports a raw directional swipe (or None), never
a static hand pose -- pose classification from a single frame proved too
ambiguous and fired on gestures it shouldn't have.

Gesture mappings:
  swipe_left  -> prev_track
  swipe_right -> next_track
  swipe_up    -> toggle_playback
"""

GESTURE_COMMANDS = {
    "swipe_left": "prev_track",
    "swipe_right": "next_track",
    "swipe_up": "toggle_playback",
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
