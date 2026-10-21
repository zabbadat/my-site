// Live walk mirror: pure logic for showing a signed-in user's active walk on their other devices.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZabbadatLiveWalk = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var STALE_MS = 120000, PUSH_MS = 3000, KEEPALIVE_MS = 60000, MAX_MS = 14400000, MAX_STEPS = 40000;
  function clampInt(n, lo, hi) { n = Math.round(Number(n) || 0); return Math.max(lo, Math.min(hi, n)); }
  // Build the doc written by the walking device.
  function record(uid, startedAt, activeMs, steps, paused, active) {
    return { uid: uid, active: !!active, startedAt: clampInt(startedAt, 0, 9e15), activeMs: clampInt(activeMs, 0, MAX_MS), steps: clampInt(steps, 0, MAX_STEPS), paused: !!paused };
  }
  // Writer throttle: push when something changed and PUSH_MS passed, or keepalive due.
  function shouldPush(last, next, now) {
    if (!last) return true;
    if (last.paused !== next.paused || last.active !== next.active) return true;
    if (now - last.at >= KEEPALIVE_MS) return true;
    return last.steps !== next.steps && now - last.at >= PUSH_MS;
  }
  // Viewer: d = doc data, updatedMs = server update time, receivedAt = local time snapshot arrived, now = local time.
  function view(d, updatedMs, receivedAt, now) {
    if (!d || !d.active) return null;
    if (updatedMs && now - updatedMs > STALE_MS) return null;
    if (now - receivedAt > STALE_MS) return null;
    var ms = Number(d.activeMs) || 0;
    if (!d.paused) ms += Math.max(0, now - receivedAt);
    return { ms: Math.min(MAX_MS, ms), steps: clampInt(d.steps, 0, MAX_STEPS), paused: !!d.paused };
  }
  return { record: record, shouldPush: shouldPush, view: view, STALE_MS: STALE_MS, PUSH_MS: PUSH_MS, KEEPALIVE_MS: KEEPALIVE_MS };
});
