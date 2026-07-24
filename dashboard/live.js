/*
 * Live data source: polls the bridge server's HTTP API (served by
 * logic/server.py via main.py) instead of the mock generator. Calls the
 * exact same applyDriverState()/applyLogicEvent() entry points app.js
 * exposes, so nothing downstream of those two functions knows or cares
 * whether the data is real or mocked.
 */
(function () {
  const POLL_STATE_MS = 200;
  const POLL_EVENTS_MS = 400;

  let sinceSeq = 0;
  let statePoll = null;
  let eventsPoll = null;
  let active = false;

  async function pollState() {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) window.applyDriverState(await res.json());
    } catch (err) {
      // transient network hiccup -- just try again next tick
    }
  }

  async function pollEvents() {
    try {
      const res = await fetch(`/api/events?since=${sinceSeq}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      sinceSeq = typeof data.latest_seq === "number" ? data.latest_seq : sinceSeq;
      (data.events || []).forEach((evt) => window.applyLogicEvent(evt));
    } catch (err) {
      // transient network hiccup -- just try again next tick
    }
  }

  function start() {
    if (active) return;
    active = true;
    pollState();
    pollEvents();
    statePoll = setInterval(pollState, POLL_STATE_MS);
    eventsPoll = setInterval(pollEvents, POLL_EVENTS_MS);
  }

  function stop() {
    active = false;
    clearInterval(statePoll);
    clearInterval(eventsPoll);
  }

  async function setControl(patch) {
    try {
      await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (err) {
      console.warn("[live] control POST failed", err);
    }
  }

  async function checkHealth(timeoutMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  window.Live = {
    start,
    stop,
    setControl,
    checkHealth,
    isActive: () => active,
  };
})();
