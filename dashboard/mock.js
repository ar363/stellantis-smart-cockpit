/*
 * Stand-in for Ashwin's perception feed and Shahaan's logic events.
 * Produces DriverState (shared/schema.py contract) + logic events
 * (notification_hold/notification_release/alarm/pull_over/profile_settings)
 * so the dashboard is fully demoable before those modules exist.
 *
 * Swap point for integration: replace the call to Mock.startMock() in
 * app.js with real data sources that call the same applyDriverState()
 * and applyLogicEvent() functions. See dashboard/README.md.
 */
(function () {
  const PROFILES = {
    profile_1: { face_id: "profile_1", theme: "#3ddc97", temperature: 71, playlist: "Focus Flow" },
    profile_2: { face_id: "profile_2", theme: "#7c5cff", temperature: 68, playlist: "Late Night Drive" },
  };

  const EMOTIONS = ["calm", "stressed", "tired"];

  let driverState = {
    face_id: null,
    present: false,
    drowsy: false,
    distracted: false,
    eyes_on_road: true,
    emotion: "calm",
    timestamp: Date.now() / 1000,
  };

  let onStateCb = null;
  let onEventCb = null;
  let notifCounter = 0;
  let autoRunning = true;

  const ALARM_REPEAT_MS = 1500; // mirrors logic/escalation.py's ALARM_REPEAT_S
  const PULLOVER_THRESHOLD_MS = 3000; // mirrors logic/escalation.py's PULLOVER_THRESHOLD_S
  let unsafeSince = null;
  let pulledOver = false;
  let alarmRepeatTimer = null;
  let pulloverTimer = null;

  function emitState() {
    driverState.timestamp = Date.now() / 1000;
    if (onStateCb) onStateCb({ ...driverState });
  }

  function emitEvent(evt) {
    evt.timestamp = Date.now() / 1000;
    if (onEventCb) onEventCb(evt);
  }

  function setPresent(v) {
    driverState.present = v;
    if (!v) {
      driverState.face_id = null;
      driverState.drowsy = false;
      driverState.distracted = false;
      driverState.eyes_on_road = true;
    }
    emitState();
    handleAlarmCondition(); // presence factors into "unsafe" too -- clears the pulledOver latch when the driver leaves
  }

  function setProfile(id) {
    if (!driverState.present) driverState.present = true;
    driverState.face_id = id;
    emitState();
    const p = PROFILES[id];
    if (p) {
      emitEvent({
        type: "profile_settings",
        face_id: id,
        theme: p.theme,
        temperature: p.temperature,
        playlist: p.playlist,
      });
    }
  }

  function setDrowsy(v) {
    driverState.drowsy = v;
    emitState();
    handleAlarmCondition();
  }

  function setDistracted(v) {
    driverState.distracted = v;
    driverState.eyes_on_road = !v;
    emitState();
    handleAlarmCondition();
    if (v) {
      notifCounter += 1;
      emitEvent({ type: "notification_hold", id: `notif-${notifCounter}`, message: "Incoming message held — eyes off road" });
    } else if (notifCounter > 0) {
      emitEvent({ type: "notification_release", id: `notif-${notifCounter}`, message: "Incoming message" });
    }
  }

  function cycleEmotion() {
    const i = EMOTIONS.indexOf(driverState.emotion);
    driverState.emotion = EMOTIONS[(i + 1) % EMOTIONS.length];
    emitState();
  }

  function clearAlarmTimers() {
    clearTimeout(alarmRepeatTimer);
    clearTimeout(pulloverTimer);
    alarmRepeatTimer = null;
    pulloverTimer = null;
  }

  function emitAlarmTick() {
    const remaining = Math.max(0, (PULLOVER_THRESHOLD_MS - (Date.now() - unsafeSince)) / 1000);
    emitEvent({
      type: "alarm",
      reason: driverState.drowsy ? "drowsy" : "distracted",
      seconds_remaining: Math.round(remaining * 10) / 10,
    });
    alarmRepeatTimer = setTimeout(emitAlarmTick, ALARM_REPEAT_MS);
  }

  function handleAlarmCondition() {
    const unsafe = driverState.drowsy || driverState.distracted;
    if (unsafe) {
      if (unsafeSince == null) unsafeSince = Date.now();
      if (!pulledOver && !alarmRepeatTimer) emitAlarmTick();
      if (!pulledOver && !pulloverTimer) {
        pulloverTimer = setTimeout(() => {
          pulledOver = true;
          clearAlarmTimers();
          emitEvent({ type: "pull_over" });
        }, PULLOVER_THRESHOLD_MS);
      }
    } else {
      unsafeSince = null;
      clearAlarmTimers();
      if (pulledOver) {
        pulledOver = false;
        emitEvent({ type: "pull_over_cancelled" });
      }
    }
  }

  function acknowledgePullover() {
    // Mirrors logic/escalation.py's acknowledge(): clears the pulled_over
    // latch and restarts the countdown from now, instead of leaving it
    // stuck so a still-unsafe driver never gets a second pull_over.
    const wasPulledOver = pulledOver;
    clearAlarmTimers();
    pulledOver = false;
    if (unsafeSince != null) unsafeSince = Date.now();
    if (wasPulledOver) emitEvent({ type: "pull_over_cancelled" });
    handleAlarmCondition(); // reschedules alarm/pullover timers if still unsafe
  }

  function togglePresent() { setPresent(!driverState.present); }
  function toggleDrowsy() { setDrowsy(!driverState.drowsy); }
  function toggleDistracted() { setDistracted(!driverState.distracted); }
  function switchProfile() {
    const next = driverState.face_id === "profile_1" ? "profile_2" : "profile_1";
    setProfile(next);
  }

  let ignitionOffAt = null;
  let ignitionOffTimer = null;
  const IGNITION_OFF_TIMER_MS = 8000; // mirrors logic/occupant_watch.py's TIMER_S

  function setIgnitionOff(v) {
    clearTimeout(ignitionOffTimer);
    if (!v) {
      ignitionOffAt = null;
      return;
    }
    ignitionOffAt = Date.now();
    ignitionOffTimer = setTimeout(() => {
      if (driverState.present) {
        emitEvent({ type: "alarm", reason: "occupant_left_behind" });
      }
    }, IGNITION_OFF_TIMER_MS);
  }

  function fireAlarm() {
    emitEvent({ type: "alarm", reason: driverState.drowsy ? "drowsy" : driverState.distracted ? "distracted" : "manual" });
  }
  function firePullOver() { emitEvent({ type: "pull_over" }); }
  function fireHold() {
    notifCounter += 1;
    emitEvent({ type: "notification_hold", id: `notif-${notifCounter}`, message: "Text message held" });
  }
  function fireRelease() {
    emitEvent({ type: "notification_release", id: `notif-${notifCounter}`, message: "Text message" });
  }

  // Scripted unattended demo sequence (loops every 40s) so the dashboard
  // demos itself end-to-end without anyone touching the controls.
  const SCRIPT = [
    { t: 0, run: () => setPresent(false) },
    { t: 2000, run: () => setProfile("profile_1") },
    { t: 4000, run: () => cycleEmotion() },
    { t: 9000, run: () => setDistracted(true) },
    { t: 13000, run: () => setDistracted(false) },
    { t: 16000, run: () => setDrowsy(true) },
    // pull_over fires ~3s later automatically via handleAlarmCondition
    { t: 24000, run: () => setDrowsy(false) },
    { t: 27000, run: () => setProfile("profile_2") },
    { t: 29000, run: () => cycleEmotion() },
    { t: 34000, run: () => cycleEmotion() },
  ];
  const SCRIPT_LOOP_MS = 40000;

  function startAutoDemo() {
    let elapsed = 0;
    const fired = new Set();
    setInterval(() => {
      if (!autoRunning) return;
      elapsed += 250;
      SCRIPT.forEach((s, idx) => {
        if (!fired.has(idx) && elapsed >= s.t) {
          fired.add(idx);
          s.run();
        }
      });
      if (elapsed >= SCRIPT_LOOP_MS) {
        elapsed = 0;
        fired.clear();
      }
    }, 250);
  }

  function toggleAutoDemo() {
    autoRunning = !autoRunning;
    return autoRunning;
  }

  function startMock(onState, onEvent) {
    onStateCb = onState;
    onEventCb = onEvent;
    emitState();
    setInterval(emitState, 200); // ~5fps publish, matches "every frame" contract
    startAutoDemo();
  }

  window.Mock = {
    startMock,
    acknowledgePullover,
    togglePresent,
    toggleDrowsy,
    toggleDistracted,
    switchProfile,
    cycleEmotion,
    fireAlarm,
    firePullOver,
    fireHold,
    fireRelease,
    setIgnitionOff,
    toggleAutoDemo,
    isAutoRunning: () => autoRunning,
    profiles: PROFILES,
    getState: () => ({ ...driverState }),
  };
})();
