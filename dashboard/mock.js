/*
 * Stand-in for Ashwin's perception feed and Shahaan's logic events.
 * Produces DriverState (shared/schema.py contract) + logic events
 * (alarm/pull_over/profile_settings/song_state/gesture_detected)
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

  const EMOTION_PLAYLISTS = {
    calm: "Focus Flow",
    stressed: "Ambient Calm",
    tired: "Upbeat Energy",
  };

  const PLAYLISTS = {
    "Focus Flow": [
      { title: "Midnight Focus", artist: "Lo-Fi Collective", duration: 234 },
      { title: "Deep Work", artist: "Chill Beats", duration: 198 },
      { title: "Flow State", artist: "Ambient Waves", duration: 267 },
      { title: "Concentration", artist: "Study Sessions", duration: 212 },
      { title: "Brain Waves", artist: "Synth Dreams", duration: 245 },
    ],
    "Ambient Calm": [
      { title: "Gentle Rain", artist: "Nature Sounds", duration: 312 },
      { title: "Ocean Drift", artist: "Ambient Waves", duration: 287 },
      { title: "Soft Light", artist: "Calm Collective", duration: 195 },
      { title: "Floating", artist: "Chill Beats", duration: 241 },
      { title: "Stillness", artist: "Meditation FM", duration: 328 },
    ],
    "Upbeat Energy": [
      { title: "Neon Rush", artist: "Synthwave FM", duration: 203 },
      { title: "Electric Feel", artist: "Retro Drive", duration: 189 },
      { title: "Turbo Boost", artist: "High Octane", duration: 221 },
      { title: "Solar Flare", artist: "Cosmic Beats", duration: 176 },
      { title: "Adrenaline", artist: "Pulse Radio", duration: 198 },
    ],
    "Late Night Drive": [
      { title: "Midnight City", artist: "Night Owl", duration: 256 },
      { title: "Street Lights", artist: "Urban Chill", duration: 232 },
      { title: "After Hours", artist: "Lo-Fi Collective", duration: 278 },
      { title: "Cruisin'", artist: "Retro Drive", duration: 211 },
      { title: "Moonlit Road", artist: "Synth Dreams", duration: 245 },
    ],
  };

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
  let autoRunning = true;

  const ALARM_REPEAT_MS = 1500;
  const PULLOVER_THRESHOLD_MS = 3000;
  let unsafeSince = null;
  let pulledOver = false;
  let alarmRepeatTimer = null;
  let pulloverTimer = null;

  // --- Song player state ---
  let songPlayer = {
    playlist_name: "Focus Flow",
    track_index: 0,
    playing: true,
    elapsed: 0,
    last_tick: Date.now(),
  };

  function currentTrack() {
    const tracks = PLAYLISTS[songPlayer.playlist_name] || PLAYLISTS["Focus Flow"];
    return tracks[songPlayer.track_index % tracks.length];
  }

  function emitSongState() {
    const track = currentTrack();
    emitEvent({
      type: "song_state",
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      elapsed: Math.floor(songPlayer.elapsed),
      playing: songPlayer.playing,
      playlist: songPlayer.playlist_name,
    });
  }

  function skipTrack() {
    const tracks = PLAYLISTS[songPlayer.playlist_name] || PLAYLISTS["Focus Flow"];
    songPlayer.track_index = (songPlayer.track_index + 1) % tracks.length;
    songPlayer.elapsed = 0;
    songPlayer.last_tick = Date.now();
    emitSongState();
  }

  function prevTrack() {
    const tracks = PLAYLISTS[songPlayer.playlist_name] || PLAYLISTS["Focus Flow"];
    songPlayer.track_index = (songPlayer.track_index - 1 + tracks.length) % tracks.length;
    songPlayer.elapsed = 0;
    songPlayer.last_tick = Date.now();
    emitSongState();
  }

  function togglePlayback() {
    songPlayer.playing = !songPlayer.playing;
    songPlayer.last_tick = Date.now();
    emitSongState();
  }

  function switchPlaylist(name) {
    songPlayer.playlist_name = name;
    songPlayer.track_index = 0;
    songPlayer.elapsed = 0;
    songPlayer.last_tick = Date.now();
    emitSongState();
  }

  function tickSongPlayer() {
    if (!songPlayer.playing) return;
    const now = Date.now();
    songPlayer.elapsed += (now - songPlayer.last_tick) / 1000;
    songPlayer.last_tick = now;
    const track = currentTrack();
    if (songPlayer.elapsed >= track.duration) {
      skipTrack();
    }
  }

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
    handleAlarmCondition();
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
  }

  function cycleEmotion() {
    const i = EMOTIONS.indexOf(driverState.emotion);
    driverState.emotion = EMOTIONS[(i + 1) % EMOTIONS.length];
    emitState();
    const playlist = EMOTION_PLAYLISTS[driverState.emotion] || "Focus Flow";
    switchPlaylist(playlist);
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
    const wasPulledOver = pulledOver;
    clearAlarmTimers();
    pulledOver = false;
    if (unsafeSince != null) unsafeSince = Date.now();
    if (wasPulledOver) emitEvent({ type: "pull_over_cancelled" });
    handleAlarmCondition();
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
  const IGNITION_OFF_TIMER_MS = 8000;

  function setIgnitionOff(v) {
    clearTimeout(ignitionOffTimer);
    if (!v) { ignitionOffAt = null; return; }
    ignitionOffAt = Date.now();
    ignitionOffTimer = setTimeout(() => {
      if (driverState.present) emitEvent({ type: "alarm", reason: "occupant_left_behind" });
    }, IGNITION_OFF_TIMER_MS);
  }

  function fireAlarm() {
    emitEvent({ type: "alarm", reason: driverState.drowsy ? "drowsy" : driverState.distracted ? "distracted" : "manual" });
  }
  function firePullOver() { emitEvent({ type: "pull_over" }); }

  // --- Gesture detection helper for demo ---
  function fireGesture(gesture) {
    emitEvent({ type: "gesture_detected", gesture: gesture });
  }

  // Scripted unattended demo sequence
  const SCRIPT = [
    { t: 0, run: () => setPresent(false) },
    { t: 2000, run: () => setProfile("profile_1") },
    { t: 3500, run: () => fireGesture("thumbs_up") },
    { t: 4000, run: () => cycleEmotion() },
    { t: 5500, run: () => fireGesture("swipe_right") },
    { t: 6000, run: () => fireGesture("peace") },
    { t: 9000, run: () => setDistracted(true) },
    { t: 10500, run: () => fireGesture("swipe_left") },
    { t: 13000, run: () => setDistracted(false) },
    { t: 16000, run: () => setDrowsy(true) },
    { t: 24000, run: () => setDrowsy(false) },
    { t: 27000, run: () => setProfile("profile_2") },
    { t: 29000, run: () => cycleEmotion() },
    { t: 32000, run: () => fireGesture("swipe_up") },
    { t: 34000, run: () => cycleEmotion() },
  ];
  const SCRIPT_LOOP_MS = 40000;

  function startAutoDemo() {
    let elapsed = 0;
    const fired = new Set();
    setInterval(() => {
      if (!autoRunning) return;
      tickSongPlayer();
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
    emitSongState();
    setInterval(emitState, 200);
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
    setIgnitionOff,
    toggleAutoDemo,
    isAutoRunning: () => autoRunning,
    profiles: PROFILES,
    getState: () => ({ ...driverState }),
  };
})();
