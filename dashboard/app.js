/*
 * Dashboard render layer. Two entry points bridge the contract:
 *   applyDriverState(state) <- DriverState (shared/schema.py)
 *   applyLogicEvent(event)  <- events from /logic
 * Everything below only renders; no detection or decision logic lives here.
 */
(function () {
  const EMOTION_HUE = { calm: 170, stressed: 355, tired: 265 };
  const PROFILE_LABEL = { profile_1: "Driver 1", profile_2: "Driver 2" };

  const avatarEl = document.getElementById("avatar");
  const avatarNameEl = document.getElementById("avatar-name");
  const avatarEmotionEl = document.getElementById("avatar-emotion");
  const cameraLabelEl = document.getElementById("camera-label");
  const alarmOverlay = document.getElementById("alarm-overlay");
  const themeSwatch = document.getElementById("profile-theme-swatch");
  const tempEl = document.getElementById("profile-temp");
  const playlistEl = document.getElementById("profile-playlist");
  const escalationCard = document.getElementById("escalation-card");
  const escalationText = document.getElementById("escalation-text");
  const escalationCountdown = document.getElementById("escalation-countdown");
  const escalationCountdownValue = document.getElementById("escalation-countdown-value");
  const pulloverModalBackdrop = document.getElementById("pullover-modal-backdrop");
  const pulloverCanvasFp = document.getElementById("pullover-canvas-fp");
  const pulloverCanvasTop = document.getElementById("pullover-canvas-top");
  const pulloverBanner = document.getElementById("pullover-banner");
  const pulloverDismissBtn = document.getElementById("pullover-dismiss-btn");
  const clockEl = document.getElementById("clock");
  const autoToggleBtn = document.getElementById("auto-toggle-btn");
  const toastContainer = document.getElementById("toast-container");

  let ignitionOff = false;

  // ---------- Song Player ----------

  const playerArt = document.getElementById("player-art");
  const playerTrack = document.getElementById("player-track");
  const playerArtist = document.getElementById("player-artist");
  const playerProgressFill = document.getElementById("player-progress-fill");
  const playerElapsed = document.getElementById("player-elapsed");
  const playerDuration = document.getElementById("player-duration");
  const playerPlayBtn = document.getElementById("player-play");
  const playerPrevBtn = document.getElementById("player-prev");
  const playerNextBtn = document.getElementById("player-next");
  const playerPlaylistLabel = document.getElementById("player-playlist-label");

  let songState = { playing: false, elapsed: 0, duration: 0 };
  let progressTimer = null;

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function renderSongPlayer(s) {
    songState = s;
    playerTrack.textContent = s.title || "\u2014";
    playerArtist.textContent = s.artist || "\u2014";
    playerDuration.textContent = fmtTime(s.duration || 0);
    playerElapsed.textContent = fmtTime(s.elapsed || 0);
    playerProgressFill.style.width = s.duration ? ((s.elapsed / s.duration) * 100) + "%" : "0%";
    playerPlayBtn.textContent = s.playing ? "\u23F8" : "\u25B6";
    playerPlayBtn.classList.toggle("playing", s.playing);
    if (s.playlist) playerPlaylistLabel.textContent = s.playlist;
  }

  function tickPlayerProgress() {
    if (!songState.playing) return;
    songState.elapsed = Math.min(songState.elapsed + 0.5, songState.duration);
    playerElapsed.textContent = fmtTime(songState.elapsed);
    playerProgressFill.style.width = songState.duration
      ? ((songState.elapsed / songState.duration) * 100) + "%" : "0%";
  }

  function sendControl(patch) {
    if (window.Live && window.Live.isActive()) {
      window.Live.setControl(patch);
    }
  }

  playerPlayBtn.addEventListener("click", () => sendControl({ song_action: "toggle_playback" }));
  playerNextBtn.addEventListener("click", () => sendControl({ song_action: "next_track" }));
  playerPrevBtn.addEventListener("click", () => sendControl({ song_action: "prev_track" }));

  // ---------- Toast ----------

  const GESTURE_ICONS = {
    open_palm: "\u270B",
    thumbs_up: "\uD83D\uDC4D",
    fist: "\u270A",
    peace: "\u270C",
    swipe_left: "\u2B05",
    swipe_right: "\u27A1",
    swipe_up: "\u2B06",
  };

  function showToast(text, variant) {
    const el = document.createElement("div");
    el.className = "toast" + (variant ? " " + variant : "");
    el.textContent = text;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ---------- DriverState ----------

  function applyDriverState(state) {
    renderTiles(state);
    renderAvatar(state);
    renderCameraLabel(state);
    applyAmbient(state.emotion);
    const unsafe = state.present && (state.drowsy || state.distracted);
    setAlarmVisual(unsafe);
    if (!unsafe) {
      hideEscalation();
    }
  }

  function setTile(id, text, okCond, alertCond) {
    const el = document.getElementById(id);
    el.querySelector(".tile-value").textContent = text;
    el.classList.toggle("ok", !!okCond && !alertCond);
    el.classList.toggle("alert", !!alertCond);
  }

  function renderTiles(state) {
    setTile("tile-present", state.present ? "Yes" : "No", state.present, false);
    setTile("tile-drowsy", state.drowsy ? "Yes" : "No", !state.drowsy, state.drowsy);
    setTile("tile-distracted", state.distracted ? "Yes" : "No", !state.distracted, state.distracted);
    setTile("tile-eyes", state.eyes_on_road ? "On Road" : "Off Road", state.eyes_on_road, !state.eyes_on_road);
  }

  function pickAvatar(state) {
    if (!state.present) return "\uD83E\uDE91";
    if (state.drowsy) return "\uD83D\uDE34";
    if (state.distracted) return "\uD83D\uDC40";
    if (state.emotion === "stressed") return "\uD83D\uDE23";
    if (state.emotion === "tired") return "\uD83E\uDD71";
    return "\uD83D\uDE42";
  }

  function renderAvatar(state) {
    avatarEl.textContent = pickAvatar(state);
    avatarNameEl.textContent = !state.present
      ? "No driver"
      : PROFILE_LABEL[state.face_id] || "Unrecognized driver";
    avatarEmotionEl.textContent = state.present ? state.emotion : "\u2014";
  }

  function renderCameraLabel(state) {
    const live = window.Live && window.Live.isActive();
    if (!live || !state.present) {
      cameraLabelEl.hidden = true;
      return;
    }
    cameraLabelEl.hidden = false;
    cameraLabelEl.textContent = PROFILE_LABEL[state.face_id] || "Unrecognized driver";
    cameraLabelEl.classList.toggle("alert", state.drowsy || state.distracted);
  }

  function applyAmbient(emotion) {
    const hue = EMOTION_HUE[emotion] ?? 210;
    document.documentElement.style.setProperty("--ambient-hue", hue);
  }

  // ---------- Alarm ----------

  let audioCtx = null;
  let alarmOsc = null;
  let alarmGain = null;
  let alarmSoundOn = false;
  let alarmPulseTimer = null;

  function unlockAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    document.removeEventListener("pointerdown", unlockAudio);
  }
  document.addEventListener("pointerdown", unlockAudio);

  function pulseAlarmGain() {
    if (!alarmSoundOn || !audioCtx) return;
    const now = audioCtx.currentTime;
    alarmGain.gain.cancelScheduledValues(now);
    alarmGain.gain.setValueAtTime(0.06, now);
    alarmGain.gain.linearRampToValueAtTime(0.0001, now + 0.3);
    alarmPulseTimer = setTimeout(pulseAlarmGain, 600);
  }

  function startAlarmSound() {
    if (alarmSoundOn || !audioCtx) return;
    alarmOsc = audioCtx.createOscillator();
    alarmGain = audioCtx.createGain();
    alarmOsc.type = "square";
    alarmOsc.frequency.value = 880;
    alarmGain.gain.value = 0.0001;
    alarmOsc.connect(alarmGain).connect(audioCtx.destination);
    alarmOsc.start();
    alarmSoundOn = true;
    pulseAlarmGain();
  }

  function stopAlarmSound() {
    if (!alarmSoundOn) return;
    alarmSoundOn = false;
    clearTimeout(alarmPulseTimer);
    if (alarmOsc) { alarmOsc.stop(); alarmOsc.disconnect(); }
    if (alarmGain) alarmGain.disconnect();
    alarmOsc = null;
    alarmGain = null;
  }

  function setAlarmVisual(on) {
    alarmOverlay.classList.toggle("active", on);
    if (on) startAlarmSound();
    else stopAlarmSound();
  }

  // ---------- Logic events ----------

  function applyLogicEvent(evt) {
    switch (evt.type) {
      case "profile_settings":
        renderProfile(evt);
        break;
      case "alarm":
        showEscalation(evt.reason, evt.seconds_remaining);
        break;
      case "pull_over":
        hideEscalation();
        startPullover();
        break;
      case "pull_over_cancelled":
        break;
      case "song_state":
        renderSongPlayer(evt);
        break;
      case "phone_call_initiated":
        showToast("\uD83D\uDCDE Calling\u2026", "warn");
        break;
      case "command_confirmed":
        showToast("\u2714 Confirmed", "ok");
        break;
      case "gesture_detected": {
        const icon = GESTURE_ICONS[evt.gesture] || "\uD83D\uDD90";
        const label = evt.gesture.replace(/_/g, " ");
        showToast(icon + " " + label, "ok");
        break;
      }
      default:
        console.warn("Unknown logic event", evt);
    }
  }

  function renderProfile(p) {
    themeSwatch.style.background = p.theme || "#666";
    tempEl.textContent = p.temperature != null ? p.temperature + "\u00B0F" : "\u2014";
    playlistEl.textContent = p.playlist || "\u2014";
  }

  let countdownTimer = null;
  let countdownDeadline = null;

  function showEscalation(reason, secondsRemaining) {
    escalationCard.hidden = false;
    const isOccupant = reason === "occupant_left_behind";
    escalationCard.classList.toggle("warn-alarm", isOccupant);
    escalationCard.classList.toggle("danger-alarm", !isOccupant);
    escalationText.textContent = isOccupant
      ? "\u26A0\uFE0F Occupant may still be in vehicle"
      : "ALARM \u2014 " + (reason || "attention required") + ". Escalating if unresponsive\u2026";

    clearInterval(countdownTimer);
    countdownTimer = null;
    if (typeof secondsRemaining === "number") {
      countdownDeadline = performance.now() + secondsRemaining * 1000;
      escalationCountdown.hidden = false;
      tickCountdown();
      countdownTimer = setInterval(tickCountdown, 100);
    } else {
      countdownDeadline = null;
      escalationCountdown.hidden = true;
    }
  }

  function tickCountdown() {
    const remaining = Math.max(0, (countdownDeadline - performance.now()) / 1000);
    escalationCountdownValue.textContent = remaining.toFixed(1);
    if (remaining <= 0) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function hideEscalation() {
    escalationCard.hidden = true;
    escalationCard.classList.remove("warn-alarm", "danger-alarm");
    escalationCountdown.hidden = true;
    clearInterval(countdownTimer);
    countdownTimer = null;
    countdownDeadline = null;
  }

  // ---------- Pull-over takeover popup ----------

  const PULLOVER_DURATION_MS = 3200;
  const PULLOVER_DRIVE_END = 0.25;
  const PULLOVER_STEER_END = 0.8;

  let pulloverAnimId = null;
  let pulloverStart = null;

  function startPullover() {
    if (pulloverStart != null) return;
    pulloverModalBackdrop.hidden = false;
    pulloverDismissBtn.hidden = true;
    pulloverStart = performance.now();
    cancelAnimationFrame(pulloverAnimId);
    drawPullover();
  }

  function finishPullover() {
    pulloverModalBackdrop.hidden = true;
    cancelAnimationFrame(pulloverAnimId);
    pulloverAnimId = null;
    pulloverStart = null;
  }
  pulloverDismissBtn.addEventListener("click", () => {
    finishPullover();
    if (window.Live && window.Live.isActive()) {
      window.Live.setControl({ dismiss_alarm_at: Date.now() / 1000 });
    } else if (window.Mock) {
      window.Mock.acknowledgePullover();
    }
  });

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPulloverFirstPerson(ctx, w, h, elapsed, steerEased, stopped) {
    const horizonY = h * 0.38;
    const vx = w / 2 - steerEased * (w * 0.1);
    const laneCenterBottom = w / 2 - steerEased * (w * 0.42);

    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, "#1a2333");
    skyGrad.addColorStop(1, "#2c3446");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    ctx.fillStyle = "#1b2016";
    ctx.fillRect(0, horizonY, w, h - horizonY);

    const roadHalfBottom = w * 0.46;
    const roadHalfTop = 4;
    ctx.fillStyle = "#2a2f3a";
    ctx.beginPath();
    ctx.moveTo(vx - roadHalfTop, horizonY);
    ctx.lineTo(vx + roadHalfTop, horizonY);
    ctx.lineTo(laneCenterBottom + roadHalfBottom, h);
    ctx.lineTo(laneCenterBottom - roadHalfBottom, h);
    ctx.closePath();
    ctx.fill();

    const shoulderWidthBottom = w * 0.28 * steerEased;
    if (shoulderWidthBottom > 0) {
      ctx.fillStyle = "#3a3226";
      ctx.beginPath();
      ctx.moveTo(vx - roadHalfTop, horizonY);
      ctx.lineTo(vx - roadHalfTop - 6, horizonY);
      ctx.lineTo(laneCenterBottom - roadHalfBottom - shoulderWidthBottom, h);
      ctx.lineTo(laneCenterBottom - roadHalfBottom, h);
      ctx.closePath();
      ctx.fill();
    }

    const scrollSpeed = stopped ? 0 : 1 - steerEased * 0.85;
    ctx.strokeStyle = "#e7c86a";
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 14]);
    ctx.lineDashOffset = -((elapsed * 0.35 * scrollSpeed) % 40);
    ctx.beginPath();
    ctx.moveTo(vx, horizonY);
    ctx.lineTo(laneCenterBottom, h);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "#c7cede";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(vx - roadHalfTop, horizonY);
    ctx.lineTo(laneCenterBottom - roadHalfBottom, h);
    ctx.stroke();

    ctx.fillStyle = "#05070b";
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.55);
    ctx.lineTo(w * 0.12, h);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w, h);
    ctx.lineTo(w, h * 0.55);
    ctx.lineTo(w * 0.88, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, h * 0.9, w, h * 0.1);

    ctx.save();
    ctx.translate(w / 2, h * 0.97);
    ctx.rotate(steerEased * 0.35);
    ctx.strokeStyle = "#3a4256";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 34, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    drawHazardBlink(ctx, w * 0.09, h * 0.62, elapsed);
    drawHazardBlink(ctx, w * 0.91, h * 0.62, elapsed);
  }

  function drawPulloverTopDown(ctx, w, h, elapsed, steerEased, stopped) {
    ctx.fillStyle = "#12161f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1c2230";
    ctx.fillRect(40, 0, w - 80, h);
    ctx.fillStyle = "#232a1c";
    ctx.fillRect(w - 40, 0, 40, h);

    const scrollSpeed = stopped ? 0 : 1 - steerEased * 0.85;
    ctx.strokeStyle = "#4a5468";
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 16]);
    ctx.lineDashOffset = -((elapsed / 8) * scrollSpeed) % 34;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.setLineDash([]);

    const carW = 34;
    const carH = 60;
    const startX = w / 2 - carW / 2;
    const endX = w - 40 - carW - 6;
    const x = startX + (endX - startX) * steerEased;
    const y = h / 2 - carH / 2;
    ctx.fillStyle = "#dfe6f5";
    roundRect(ctx, x, y, carW, carH, 6);
    ctx.fill();

    const blinkOn = Math.floor(elapsed / 300) % 2 === 0;
    if (blinkOn) {
      ctx.fillStyle = "#ffb020";
      [[x + 4, y + 6], [x + carW - 4, y + 6], [x + 4, y + carH - 6], [x + carW - 4, y + carH - 6]].forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function drawHazardBlink(ctx, cx, cy, elapsed) {
    if (Math.floor(elapsed / 300) % 2 !== 0) return;
    ctx.fillStyle = "#ffb020";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPullover(ts) {
    if (pulloverStart == null) return;
    const now = ts || performance.now();
    const elapsed = now - pulloverStart;
    const t = Math.min(1, elapsed / PULLOVER_DURATION_MS);

    let steerT = 0;
    if (t > PULLOVER_DRIVE_END) {
      steerT = Math.min(1, (t - PULLOVER_DRIVE_END) / (PULLOVER_STEER_END - PULLOVER_DRIVE_END));
    }
    const steerEased = 1 - Math.pow(1 - steerT, 3);
    const stopped = t >= PULLOVER_STEER_END;

    const fpCtx = pulloverCanvasFp.getContext("2d");
    drawPulloverFirstPerson(fpCtx, pulloverCanvasFp.width, pulloverCanvasFp.height, elapsed, steerEased, stopped);

    const topCtx = pulloverCanvasTop.getContext("2d");
    drawPulloverTopDown(topCtx, pulloverCanvasTop.width, pulloverCanvasTop.height, elapsed, steerEased, stopped);

    pulloverBanner.textContent = stopped
      ? "Stopped on shoulder \u2014 hazards on. Resume when ready."
      : "Pulling over \u2014 taking control\u2026";
    pulloverDismissBtn.hidden = !stopped;

    pulloverAnimId = requestAnimationFrame(drawPullover);
  }

  // ---------- Clock ----------

  function tickClock() {
    clockEl.textContent = new Date().toLocaleTimeString();
  }
  setInterval(tickClock, 1000);
  tickClock();

  // Player progress ticker
  setInterval(tickPlayerProgress, 500);

  // ---------- Demo controls ----------

  document.querySelectorAll("#demo-controls button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      const liveActive = window.Live && window.Live.isActive();
      if (liveActive && btn.hasAttribute("data-mock-only")) return;
      if (!liveActive && action !== "toggle-auto" && window.Mock.isAutoRunning()) {
        window.Mock.toggleAutoDemo();
        autoToggleBtn.textContent = "Resume Auto-Demo";
        autoToggleBtn.classList.add("active");
      }
      switch (action) {
        case "toggle-present": window.Mock.togglePresent(); break;
        case "toggle-drowsy": window.Mock.toggleDrowsy(); break;
        case "toggle-distracted": window.Mock.toggleDistracted(); break;
        case "cycle-emotion": window.Mock.cycleEmotion(); break;
        case "switch-profile": window.Mock.switchProfile(); break;
        case "fire-alarm": window.Mock.fireAlarm(); break;
        case "fire-pullover": window.Mock.firePullOver(); break;
        case "toggle-ignition": {
          ignitionOff = !ignitionOff;
          btn.classList.toggle("active", ignitionOff);
          btn.textContent = ignitionOff ? "Toggle Ignition On" : "Toggle Ignition Off";
          if (window.Live && window.Live.isActive()) {
            window.Live.setControl({ ignition_off: ignitionOff });
          } else {
            window.Mock.setIgnitionOff(ignitionOff);
          }
          break;
        }
        case "toggle-auto": {
          const running = window.Mock.toggleAutoDemo();
          autoToggleBtn.textContent = running ? "Pause Auto-Demo" : "Resume Auto-Demo";
          autoToggleBtn.classList.toggle("active", !running);
          break;
        }
      }
    });
  });

  // ---------- Exports ----------

  window.applyDriverState = applyDriverState;
  window.applyLogicEvent = applyLogicEvent;
})();
