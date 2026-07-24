"""
Occupant-left-behind: after a simulated "ignition off" (toggled from the
dashboard's demo controls, since there's no real ignition signal on a
laptop), if presence is still detected once a timer elapses, fire an alarm.

Reported as an `alarm` event with reason="occupant_left_behind" rather than
a new event type, so it renders on the existing dashboard escalation card
without needing a contract change.
"""

import time

TIMER_S = 8.0  # demo-scale; a real car would use minutes


class OccupantWatch:
    def __init__(self):
        self._ignition_off_at = None
        self._fired = False

    def tick(self, state, control, emit):
        ignition_off = bool(control.get("ignition_off"))

        if not ignition_off:
            self._ignition_off_at = None
            self._fired = False
            return

        if self._ignition_off_at is None:
            self._ignition_off_at = time.monotonic()

        if not self._fired and time.monotonic() - self._ignition_off_at >= TIMER_S and state.get("present"):
            emit({"type": "alarm", "reason": "occupant_left_behind"})
            self._fired = True
