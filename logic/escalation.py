"""
Alarm escalation state machine: drowsy/distracted -> repeated "alarm" events
-> if it's still unsafe past a threshold (the driver hasn't responded) ->
one "pull_over" event, per the team contract.
"""

import time

ALARM_REPEAT_S = 2.5
PULLOVER_THRESHOLD_S = 6.0


class EscalationEngine:
    def __init__(self):
        self._unsafe_since = None
        self._last_alarm_emit = 0.0
        self._pulled_over = False

    def acknowledge(self):
        """Driver responded (voice/gesture dismiss) -- restart the countdown
        instead of immediately pulling over again."""
        if self._unsafe_since is not None:
            self._unsafe_since = time.monotonic()
        self._pulled_over = False

    def tick(self, state, emit):
        now = time.monotonic()
        unsafe = bool(state.get("present")) and (state.get("drowsy") or state.get("distracted"))

        if not unsafe:
            self._unsafe_since = None
            self._pulled_over = False
            return

        if self._unsafe_since is None:
            self._unsafe_since = now

        if now - self._last_alarm_emit >= ALARM_REPEAT_S:
            reason = "drowsy" if state.get("drowsy") else "distracted"
            emit({"type": "alarm", "reason": reason})
            self._last_alarm_emit = now

        if not self._pulled_over and now - self._unsafe_since >= PULLOVER_THRESHOLD_S:
            emit({"type": "pull_over"})
            self._pulled_over = True
