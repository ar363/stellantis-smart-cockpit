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
  const notifList = document.getElementById("notif-list");
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

  let notifications = [];
  let ignitionOff = false;

  // ---------- DriverState ----------

  function applyDriverState(state) {
    renderTiles(state);
    renderAvatar(state);
    renderCameraLabel(state);
    applyAmbient(state.emotion);
    const unsafe = state.present && (state.drowsy || state.distracted);
    setAlarmVisual(unsafe);
    if (!unsafe) {
      hideEscalation(); // backend stops emitting "alarm" once safe again, but never tells us to clear it -- do it here
    }
    // Pull-over is intentionally NOT cleared here: once it starts, it plays
    // to completion on its own timer regardless of the driver's state
    // changing mid-animation (see finishPullover()).
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
    if (!state.present) return "🪑";
    if (state.drowsy) return "😴";
    if (state.distracted) return "👀";
    if (state.emotion === "stressed") return "😣";
    if (state.emotion === "tired") return "🥱";
    return "🙂";
  }

  function renderAvatar(state) {
    avatarEl.textContent = pickAvatar(state);
    avatarNameEl.textContent = !state.present
      ? "No driver"
      : PROFILE_LABEL[state.face_id] || "Unrecognized driver";
    avatarEmotionEl.textContent = state.present ? state.emotion : "—";
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

  // ---------- Alarm (dashboard's own drowsy/distracted reaction) ----------

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
    if (alarmOsc) {
      alarmOsc.stop();
      alarmOsc.disconnect();
    }
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
      case "notification_hold":
        addNotification(evt.id, evt.message, "held");
        break;
      case "notification_release":
        releaseNotification(evt.id, evt.message);
        break;
      case "alarm":
        showEscalation(evt.reason, evt.seconds_remaining);
        break;
      case "pull_over":
        hideEscalation();
        startPullover();
        break;
      case "pull_over_cancelled":
        // Deliberately ignored: once the pull-over takeover starts, it plays
        // through to completion and only then hands back control -- see
        // finishPullover(). A quick recovery shouldn't yank the animation.
        break;
      default:
        console.warn("Unknown logic event", evt);
    }
  }

  function renderProfile(p) {
    themeSwatch.style.background = p.theme || "#666";
    tempEl.textContent = p.temperature != null ? `${p.temperature}°F` : "—";
    playlistEl.textContent = p.playlist || "—";
  }

  function addNotification(id, message, status) {
    notifications.unshift({ id, message, status });
    renderNotifications();
  }

  function releaseNotification(id, message) {
    const existing = notifications.find((n) => n.id === id);
    if (existing) existing.status = "released";
    else notifications.unshift({ id, message, status: "released" });
    renderNotifications();
  }

  function renderNotifications() {
    notifList.innerHTML = "";
    if (!notifications.length) {
      notifList.innerHTML = '<li class="notif-empty">No notifications</li>';
      return;
    }
    notifications.slice(0, 6).forEach((n) => {
      const li = document.createElement("li");
      li.className = n.status;
      li.textContent = `${n.status === "held" ? "⏸ Held — " : "✓ "}${n.message}`;
      notifList.appendChild(li);
    });
  }

  let countdownTimer = null;
  let countdownDeadline = null;

  function showEscalation(reason, secondsRemaining) {
    escalationCard.hidden = false;
    escalationText.textContent = `ALARM — ${reason || "attention required"}. Escalating if unresponsive…`;

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
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function hideEscalation() {
    escalationCard.hidden = true;
    escalationCountdown.hidden = true;
    clearInterval(countdownTimer);
    countdownTimer = null;
    countdownDeadline = null;
  }

  // ---------- Pull-over takeover popup (first-person road cam + top-down, FSD-style) ----------
  // Both views steer the same direction (right) so the road cam and the
  // overhead view read as one consistent maneuver.

  const PULLOVER_DURATION_MS = 3200;
  const PULLOVER_DRIVE_END = 0.25; // fraction of duration spent driving straight before steering
  const PULLOVER_STEER_END = 0.8; // fraction of duration by which the car has reached the shoulder

  let pulloverAnimId = null;
  let pulloverStart = null;

  function startPullover() {
    if (pulloverStart != null) return; // already mid-animation -- let it finish, don't restart
    pulloverModalBackdrop.hidden = false;
    pulloverDismissBtn.hidden = true;
    pulloverStart = performance.now();
    cancelAnimationFrame(pulloverAnimId);
    drawPullover();
  }

  // Only called from the driver clicking "Resume Driving" -- the popup does
  // not auto-close once stopped, it waits for an explicit acknowledgement.
  function finishPullover() {
    pulloverModalBackdrop.hidden = true;
    cancelAnimationFrame(pulloverAnimId);
    pulloverAnimId = null;
    pulloverStart = null;
  }
  pulloverDismissBtn.addEventListener("click", () => {
    finishPullover();
    // Tell whichever backend is active to actually clear its pulled_over
    // latch -- otherwise a still-unsafe driver would never get a second
    // pull_over, even though the popup looks closed.
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
    // Motion-parallax split: the far field (vanishing point, near the
    // horizon) barely moves for a small heading change, while the near
    // field (road right in front of the hood) sweeps left a lot more --
    // that gap in speed is what reads as "the car is translating left"
    // instead of "the road is tilting in place".
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

    // Cockpit A-pillars + dash
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
    ctx.rotate(steerEased * 0.35); // steering right, matches the road cam drift
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
    ctx.fillStyle = "#232a1c"; // shoulder -- matches the road cam's rightward drift
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
      [
        [x + 4, y + 6],
        [x + carW - 4, y + 6],
        [x + 4, y + carH - 6],
        [x + carW - 4, y + carH - 6],
      ].forEach(([cx, cy]) => {
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
      ? "Stopped on shoulder — hazards on. Resume when ready."
      : "Pulling over — taking control…";
    pulloverDismissBtn.hidden = !stopped;

    // Keeps rendering (hazard blink, etc.) indefinitely once stopped --
    // never auto-closes. Only finishPullover() via the dismiss button ends it.
    pulloverAnimId = requestAnimationFrame(drawPullover);
  }

  // ---------- Clock ----------

  function tickClock() {
    clockEl.textContent = new Date().toLocaleTimeString();
  }
  setInterval(tickClock, 1000);
  tickClock();

  // ---------- Demo controls ----------

  document.querySelectorAll("#demo-controls button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      const liveActive = window.Live && window.Live.isActive();
      if (liveActive && btn.hasAttribute("data-mock-only")) return; // disabled + inert in live mode
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
        case "fire-hold": window.Mock.fireHold(); break;
        case "fire-release": window.Mock.fireRelease(); break;
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
  // boot.js decides whether to start window.Live or window.Mock against these.

  window.applyDriverState = applyDriverState;
  window.applyLogicEvent = applyLogicEvent;
})();
