/*
 * Driver cam: polls the same /api/preview.jpg the enrollment modal uses.
 * perception/capture.py now always draws its landmark overlay onto that
 * frame, so this is just plumbing -- no drawing logic lives here. Only
 * runs against a live backend; mock mode has no real camera to show.
 */
(function () {
  const POLL_MS = 200;
  const feedImg = document.getElementById("camera-feed");
  const placeholder = document.getElementById("camera-placeholder");
  let poll = null;

  function start() {
    if (poll) return;
    feedImg.hidden = false;
    placeholder.hidden = true;
    poll = setInterval(() => {
      feedImg.src = `/api/preview.jpg?t=${Date.now()}`;
    }, POLL_MS);
  }

  function stop() {
    clearInterval(poll);
    poll = null;
    feedImg.hidden = true;
    placeholder.hidden = false;
  }

  window.Camera = { start, stop };
})();
