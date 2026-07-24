"""
Occupant-left-behind: after a simulated "ignition off" (toggled from the
dashboard's demo controls, since there's no real ignition signal on a
laptop), if presence is still detected once a timer elapses, fire an alarm
and repeat it every 1.5s while the conditions persist.

Reported as an `alarm` event with reason="occupant_left_behind" rather than
a new event type, so it renders on the existing dashboard escalation card
without needing a contract change.
"""

import time

try:
    from win10toast import ToastNotifier
    NOTIFY_AVAILABLE = True
except ImportError:
    NOTIFY_AVAILABLE = False

TIMER_S = 8.0  # demo-scale; a real car would use minutes
REPEAT_S = 1.5  # repeat alarm every 1.5s while occupant is still present


class OccupantWatch:
    def __init__(self):
        self._ignition_off_at = None
        self._last_alarm_emit = 0.0
        self._notifier = None
        if NOTIFY_AVAILABLE:
            try:
                self._notifier = ToastNotifier()
            except Exception:
                pass

    def tick(self, state, control, emit):
        ignition_off = bool(control.get("ignition_off"))

        if not ignition_off:
            self._ignition_off_at = None
            self._last_alarm_emit = 0.0
            return

        if self._ignition_off_at is None:
            self._ignition_off_at = time.monotonic()

        now = time.monotonic()
        if (now - self._ignition_off_at >= TIMER_S and state.get("present") and
                now - self._last_alarm_emit >= REPEAT_S):
            emit({"type": "alarm", "reason": "occupant_left_behind"})
            self._last_alarm_emit = now
            if self._notifier and now - self._ignition_off_at < 10:
                try:
                    self._notifier.show_toast(
                        "Occupant Alert",
                        "Occupant may still be in vehicle",
                        duration=5,
                        threaded=True
                    )
                except Exception:
                    pass
