/*
 * Entry point: decide once at load whether a live backend (main.py's bridge
 * server) is reachable, and start the matching data source. Everything else
 * (mock.js, live.js, app.js, enroll.js) stays agnostic to that decision.
 */
(async function boot() {
  const badge = document.getElementById("conn-badge");
  const note = document.getElementById("demo-controls-note");
  const mockOnlyButtons = document.querySelectorAll("#demo-controls [data-mock-only]");

  const live = await window.Live.checkHealth(1200);

  if (live) {
    badge.textContent = "LIVE";
    badge.classList.remove("mock");
    badge.classList.add("live");

    mockOnlyButtons.forEach((btn) => {
      btn.disabled = true;
      btn.title = "Mock-only: live DriverState comes from your webcam, not button clicks";
    });
    note.hidden = false;
    note.textContent = "Live backend detected -- DriverState/events come from perception + logic. "
      + "Sensor-injection buttons above are disabled; Manage Profiles and Toggle Ignition Off still work.";

    window.Live.start();
    window.Camera.start();
  } else {
    window.Mock.startMock(window.applyDriverState, window.applyLogicEvent);
  }
})();
