/* ZabbaDat live walk sessions: pure logic (no DOM). Used by the web live walk in #steps.
 * Anti-cheat (mirrored in firestore.rules /walkSessions):
 *   - a session only posts if it lasted >= 60 s (MIN_MS)
 *   - average pace >= 30 steps/min (MIN_SPM) and >= 30 steps total (MIN_STEPS), so idle clocks don't count
 *   - capped at 4 h (MAX_MS): the session auto-ends there
 *   - steps capped at 40,000 per session
 *   - hidden page (tab switched / screen off) PAUSES the clock; hidden time never counts.
 *     Hidden for more than 2 min (MAX_HIDDEN_MS) ends the session.
 * Steps are the daily-steps total at stop minus the total at start (same detector, same pocket lock). */
(function (root) {
  "use strict";
  var MIN_MS = 60000, MAX_MS = 14400000, MIN_SPM = 30, MIN_STEPS = 30, MAX_STEPS = 40000, MAX_HIDDEN_MS = 120000, NAME_MAX = 40, HANDLE_MAX = 21;

  function formatClock(ms) {
    var s = Math.max(0, Math.floor((Number(ms) || 0) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return h ? h + ":" + p(m) + ":" + p(x) : p(m) + ":" + p(x);
  }
  // Session clock. All times are monotonic ms (performance.now()).
  function createSession(t0, steps0) {
    var active = 0, runFrom = t0, paused = false, hiddenAt = 0, ended = null, base = Number(steps0) || 0, last = base;
    function elapsed(t) { return Math.min(MAX_MS, active + (paused || ended ? 0 : Math.max(0, t - runFrom))); }
    function finish(t, steps, reason) {
      if (ended) return ended;
      if (steps != null) last = Number(steps) || last;
      var ms = Math.round(elapsed(t)); paused = true;
      ended = { ms: ms, steps: Math.max(0, Math.min(MAX_STEPS, Math.floor(last - base))), reason: reason || "stopped" };
      return ended;
    }
    return {
      elapsed: elapsed,
      steps: function (steps) { if (steps != null) last = Number(steps) || last; return Math.max(0, Math.floor(last - base)); },
      hide: function (t) { if (ended || paused) return; active += Math.max(0, t - runFrom); paused = true; hiddenAt = t; },
      show: function (t) {
        if (ended || !paused) return null;
        if (t - hiddenAt > MAX_HIDDEN_MS) return finish(hiddenAt, null, "hidden");
        paused = false; runFrom = t; return null;
      },
      // Call on each tick; returns the end result once the 4 h cap is hit.
      tick: function (t, steps) { if (!ended && elapsed(t) >= MAX_MS) return finish(t, steps, "cap"); return null; },
      stop: function (t, steps) { return finish(t, steps, "stopped"); },
      isPaused: function () { return paused && !ended; },
      result: function () { return ended; }
    };
  }
  function qualifies(r) {
    if (!r) return { ok: false, why: "no session" };
    if (!(r.ms >= MIN_MS)) return { ok: false, why: "Sessions under 1 minute don't count." };
    if (r.ms > MAX_MS) return { ok: false, why: "Over the 4 hour cap." };
    if (r.steps < MIN_STEPS || r.steps / (r.ms / 60000) < MIN_SPM) return { ok: false, why: "Not enough steps (need 30+ steps a minute on average)." };
    if (r.steps > MAX_STEPS) return { ok: false, why: "Too many steps." };
    return { ok: true, why: "" };
  }
  function buildRecord(o) {
    var r = { name: String(o.name || "Player").trim().slice(0, NAME_MAX) || "Player", uid: o.uid,
              ms: Math.min(MAX_MS, Math.round(Number(o.ms) || 0)), steps: Math.max(0, Math.min(MAX_STEPS, Math.floor(Number(o.steps) || 0))) };
    var h = String(o.xHandle || "").trim().replace(/^@/, "").slice(0, HANDLE_MAX - 1);
    if (h) r.xHandle = "@" + h;
    return r;
  }
  // Mirrors firestore.rules.
  function validateRecord(r) {
    var e = [];
    if (!r || !r.uid) e.push("not signed in");
    else {
      if (typeof r.name !== "string" || !r.name.length || r.name.length > NAME_MAX) e.push("bad name");
      if (r.xHandle != null && (typeof r.xHandle !== "string" || r.xHandle.length > HANDLE_MAX)) e.push("bad handle");
      if (r.ms !== Math.floor(r.ms) || r.ms < MIN_MS || r.ms > MAX_MS) e.push("ms out of range");
      if (r.steps !== Math.floor(r.steps) || r.steps < 0 || r.steps > MAX_STEPS) e.push("steps out of range");
      var q = qualifies(r); if (!q.ok) e.push(q.why);
    }
    return { ok: e.length === 0, errors: e };
  }
  function rankSessions(rows, n, sinceMs) {
    return (rows || []).filter(function (r) { return r && Number(r.ms) >= MIN_MS && (!sinceMs || (r.at || 0) >= sinceMs); })
      .sort(function (a, b) { return Number(b.ms) - Number(a.ms) || Number(b.steps) - Number(a.steps) || String(a.name).localeCompare(String(b.name)); })
      .slice(0, n || 20);
  }
  var api = { MIN_MS: MIN_MS, MAX_MS: MAX_MS, MIN_SPM: MIN_SPM, MIN_STEPS: MIN_STEPS, MAX_STEPS: MAX_STEPS, MAX_HIDDEN_MS: MAX_HIDDEN_MS,
              formatClock: formatClock, createSession: createSession, qualifies: qualifies, buildRecord: buildRecord,
              validateRecord: validateRecord, rankSessions: rankSessions };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatWalk = api;
})(this);
