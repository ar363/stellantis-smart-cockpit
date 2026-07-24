/*
 * "Manage Profiles" modal: web-based face enrollment, talking to the bridge
 * server's /api/enroll/* endpoints (which perception's capture.py drives --
 * see perception/README.md). No terminal commands needed.
 */
(function () {
  const backdrop = document.getElementById("enroll-modal-backdrop");
  const openBtn = document.getElementById("manage-profiles-btn");
  const closeBtn = document.getElementById("enroll-modal-close");
  const liveRequiredEl = document.getElementById("enroll-live-required");
  const bodyEl = document.getElementById("enroll-body");
  const tabs = document.querySelectorAll(".enroll-tab");
  const previewImg = document.getElementById("enroll-preview");
  const previewPlaceholder = document.getElementById("enroll-preview-placeholder");
  const progressFill = document.getElementById("enroll-progress-fill");
  const progressText = document.getElementById("enroll-progress-text");
  const startBtn = document.getElementById("enroll-start-btn");
  const stopBtn = document.getElementById("enroll-stop-btn");

  let selectedFaceId = "profile_1";
  let statusPoll = null;
  let previewPoll = null;
  let enrolling = false;

  function setTabsEnabled(enabled) {
    tabs.forEach((t) => { t.disabled = !enabled; });
  }

  function resetProgressUI() {
    progressFill.style.width = "0%";
    progressText.textContent = "Not started";
    startBtn.hidden = false;
    startBtn.textContent = "Start Enrollment";
    stopBtn.hidden = true;
    previewImg.hidden = true;
    previewPlaceholder.hidden = false;
  }

  function stopPolling() {
    clearInterval(statusPoll);
    clearInterval(previewPoll);
    statusPoll = null;
    previewPoll = null;
  }

  async function pollStatus() {
    try {
      const res = await fetch("/api/enroll/status", { cache: "no-store" });
      if (!res.ok) return;
      const status = await res.json();
      if (status.face_id !== selectedFaceId) return; // stale response for a tab we've left

      const pct = status.target ? Math.round((status.saved / status.target) * 100) : 0;
      progressFill.style.width = `${pct}%`;

      if (status.error) {
        progressText.textContent = `Error: ${status.error}`;
        stopEnrollingUI();
      } else if (status.training) {
        progressText.textContent = "Training model...";
      } else if (status.done) {
        progressText.textContent = `Enrolled (${status.target}/${status.target} samples).`;
        stopEnrollingUI();
      } else {
        progressText.textContent = `Capturing... ${status.saved}/${status.target}`;
      }
    } catch (err) {
      // transient -- try again next tick
    }
  }

  function stopEnrollingUI() {
    enrolling = false;
    setTabsEnabled(true);
    startBtn.hidden = false;
    startBtn.textContent = "Re-enroll";
    stopBtn.hidden = true;
    clearInterval(previewPoll);
    previewPoll = null;
  }

  async function startEnrollment() {
    const res = await fetch("/api/enroll/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ face_id: selectedFaceId }),
    });
    if (!res.ok) {
      progressText.textContent = "Failed to start enrollment.";
      return;
    }
    enrolling = true;
    setTabsEnabled(false);
    startBtn.hidden = true;
    stopBtn.hidden = false;
    previewImg.hidden = false;
    previewPlaceholder.hidden = true;
    progressText.textContent = "Starting...";

    statusPoll = setInterval(pollStatus, 400);
    previewPoll = setInterval(() => {
      previewImg.src = `/api/preview.jpg?t=${Date.now()}`;
    }, 200);
  }

  async function stopEnrollment() {
    await fetch("/api/enroll/stop", { method: "POST" });
    stopPolling();
    resetProgressUI();
    setTabsEnabled(true);
    enrolling = false;
  }

  async function openModal() {
    backdrop.hidden = false;
    const live = window.Live && (await window.Live.checkHealth(1200));
    liveRequiredEl.hidden = !!live;
    bodyEl.hidden = !live;
  }

  function closeModal() {
    if (enrolling) stopEnrollment();
    backdrop.hidden = true;
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (enrolling) return;
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      selectedFaceId = tab.dataset.faceId;
      resetProgressUI();
    });
  });

  startBtn.addEventListener("click", startEnrollment);
  stopBtn.addEventListener("click", stopEnrollment);
})();
