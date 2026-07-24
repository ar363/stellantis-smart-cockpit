"""
Notification hold/release engine.

There's no real phone/notification source wired up for this demo, so this
simulates one (a message/call arrives every 15-25s, occasionally tagged
safety-critical) purely so the *gating* logic has something real to gate.
That gating logic is the actual deliverable: hold non-urgent notifications
while the driver is distracted or eyes off road, always let safety-critical
ones through immediately, and release anything held once it's safe again.
"""

import random
import time

SAFETY_MESSAGES = [
    "Low tire pressure warning",
    "Forward collision risk detected",
    "Engine temperature high",
]
ROUTINE_MESSAGES = [
    "Text from Mom: call me later",
    "New playlist recommendation ready",
    "Calendar: meeting in 30 min",
    "App update available",
    "Text: running 10 min late",
]
SAFETY_PROBABILITY = 0.15
SPAWN_INTERVAL_RANGE_S = (15, 25)


class NotificationEngine:
    def __init__(self, rng=None):
        self._rng = rng or random.Random()
        self._next_spawn = time.monotonic() + self._rng.uniform(*SPAWN_INTERVAL_RANGE_S)
        self._held = {}  # id -> message
        self._counter = 0

    def _is_safe(self, state):
        return not state.get("distracted") and state.get("eyes_on_road", True)

    def tick(self, state, emit):
        now = time.monotonic()
        if state.get("present") and now >= self._next_spawn:
            self._next_spawn = now + self._rng.uniform(*SPAWN_INTERVAL_RANGE_S)
            self._counter += 1
            notif_id = f"notif-{self._counter}"
            safety = self._rng.random() < SAFETY_PROBABILITY
            message = self._rng.choice(SAFETY_MESSAGES if safety else ROUTINE_MESSAGES)

            if safety or self._is_safe(state):
                emit({"type": "notification_release", "id": notif_id, "message": message})
            else:
                self._held[notif_id] = message
                emit({"type": "notification_hold", "id": notif_id, "message": message})

        if self._held and self._is_safe(state):
            for notif_id, message in list(self._held.items()):
                emit({"type": "notification_release", "id": notif_id, "message": message})
                del self._held[notif_id]
