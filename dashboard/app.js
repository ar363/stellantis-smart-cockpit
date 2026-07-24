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
  const alarmOverlay = document.getElementById("alarm-overlay");
  const themeSwatch = document.getElementById("profile-theme-swatch");
  const tempEl = document.getElementById("profile-temp");
  const playlistEl = document.getElementById("profile-playlist");
  const notifList = document.getElementById("notif-list");
  const escalationCard = document.getElementById("escalation-card");
  const escalationText = document.getElementById("escalation-text");
  const pulloverCard = document.getElementById("pullover-card");
  const pulloverCanvas = document.getElementById("pullover-canvas");
  const clockEl = document.getElementById("clock");
  const autoToggleBtn = document.getElementById("auto-toggle-btn");

  let notifications = [];
  let ignitionOff = false;

  // ---------- DriverState ----------

  function applyDriverState(state) {
    renderTiles(state);
    renderAvatar(state);
    applyAmbient(state.emotion);
    setAlarmVisual(state.present && (state.drowsy || state.distracted));
    if (!state.present) {
      hideEscalation();
      hidePullover();
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
        showEscalation(`ALARM — ${evt.reason || "attention required"}. Escalating if unresponsive…`);
        break;
      case "pull_over":
        hideEscalation();
        startPullover();
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

  function showEscalation(text) {
    escalationCard.hidden = false;
    escalationText.textContent = text;
  }
  function hideEscalation() {
    escalationCard.hidden = true;
  }

  // ---------- Pull-over animation ----------

  let pulloverAnimId = null;
  let pulloverStart = null;

  function startPullover() {
    pulloverCard.hidden = false;
    pulloverStart = performance.now();
    cancelAnimationFrame(pulloverAnimId);
    drawPullover();
  }

  function hidePullover() {
    pulloverCard.hidden = true;
    cancelAnimationFrame(pulloverAnimId);
    pulloverStart = null;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPullover(ts) {
    if (pulloverStart == null) return;
    const ctx = pulloverCanvas.getContext("2d");
    const w = pulloverCanvas.width;
    const h = pulloverCanvas.height;
    const elapsed = (ts || performance.now()) - pulloverStart;
    const driftDuration = 2600;
    const driftT = Math.min(1, elapsed / driftDuration);
    const eased = 1 - Math.pow(1 - driftT, 3);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#12161f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1c2230";
    ctx.fillRect(40, 0, w - 80, h);
    ctx.fillStyle = "#232a1c";
    ctx.fillRect(w - 80, 0, 40, h);

    ctx.strokeStyle = "#4a5468";
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 16]);
    ctx.lineDashOffset = -(elapsed / 8) % 34;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.setLineDash([]);

    const carW = 34;
    const carH = 60;
    const startX = w / 2 - carW / 2;
    const endX = w - 80 - carW - 6;
    const x = startX + (endX - startX) * eased;
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
