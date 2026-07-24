"""
Alarm escalation state machine: drowsy/distracted -> repeated "alarm" events
-> if it's still unsafe past a threshold (the driver hasn't responded) ->
one "pull_over" event, per the team contract.
"""

import time

ALARM_REPEAT_S = 1.5
PULLOVER_THRESHOLD_S = 3.0


class EscalationEngine:
    def __init__(self):
        self._unsafe_since = None
        self._last_alarm_emit = 0.0
        self._pulled_over = False

    def acknowledge(self, emit=None):
        """Driver responded (voice/gesture dismiss) -- restart the countdown
        instead of immediately pulling over again."""
        if self._unsafe_since is not None:
            self._unsafe_since = time.monotonic()
        was_pulled_over = self._pulled_over
        self._pulled_over = False
        if was_pulled_over and emit is not None:
            emit({"type": "pull_over_cancelled"})

    def tick(self, state, emit):
        now = time.monotonic()
        unsafe = bool(state.get("present")) and (state.get("drowsy") or state.get("distracted"))

        if not unsafe:
            was_pulled_over = self._pulled_over
            self._unsafe_since = None
            self._pulled_over = False
            if was_pulled_over:
                emit({"type": "pull_over_cancelled"})
            return

        if self._unsafe_since is None:
            self._unsafe_since = now

        remaining = max(0.0, PULLOVER_THRESHOLD_S - (now - self._unsafe_since))

        # Once pulled over, stop re-emitting "alarm" -- pull_over supersedes it
        # until the driver is safe again or acknowledges (see acknowledge()).
        if not self._pulled_over and now - self._last_alarm_emit >= ALARM_REPEAT_S:
            reason = "drowsy" if state.get("drowsy") else "distracted"
            emit({"type": "alarm", "reason": reason, "seconds_remaining": round(remaining, 1)})
            self._last_alarm_emit = now

        if not self._pulled_over and remaining <= 0:
            emit({"type": "pull_over"})
            self._pulled_over = True
