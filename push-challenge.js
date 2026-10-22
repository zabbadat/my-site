/* Three-minute challenge (TUT set-push-up, #push).
 * Pure logic, no DOM. createChallenge({ durationMs: 180000, topCapMs: 3000 })
 * - start(t): fixed clock from t; no pause.
 * - update(t, { atTop, counted, repMs }): call every pose frame.
 *   counted/repMs: a rep the camera counted; credits tutForRep(repMs) (cycle, capped 10 s).
 *   atTop: arms straight at the top. Each continuous top hold credits at most topCapMs;
 *   past that, nothing more is credited and capped=true (show "Top hold capped at 3 seconds")
 *   until the player starts lowering (atTop false), which clears it.
 *   Anything after durationMs is ignored (no extra time, reps or TUT after the end).
 * - result(): { reps, tutMs, repTutMs, topTutMs, score } where score = reps + whole TUT seconds. */
(function (root) {
  function repTut(ms, cap) { var v = Number(ms); return isFinite(v) && v > 0 ? Math.min(v, cap) : 0; }
  function createChallenge(opts) {
    var o = { durationMs: 180000, topCapMs: 3000, repCapMs: 10000 };
    for (var k in opts || {}) o[k] = opts[k];
    var s;
    function reset() { s = { started: false, startT: 0, lastT: 0, ended: false, reps: 0, repTutMs: 0, topTutMs: 0, holdMs: 0, atTop: false, capped: false }; }
    reset();
    function start(t) { reset(); s.started = true; s.startT = s.lastT = t; }
    function remaining(t) { return s.started ? Math.max(0, o.durationMs - (Math.min(t, s.startT + o.durationMs) - s.startT)) : o.durationMs; }
    function elapsed(t) { return s.started ? Math.min(o.durationMs, Math.max(0, t - s.startT)) : 0; }
    function update(t, f) {
      f = f || {};
      if (!s.started || s.ended) return snap(t);
      var end = s.startT + o.durationMs, tc = Math.min(t, end);
      if (s.atTop && tc > s.lastT) {             // credit the top hold since last frame, up to the cap
        var add = Math.min(tc - s.lastT, Math.max(0, o.topCapMs - s.holdMs));
        s.topTutMs += add; s.holdMs += tc - s.lastT;
        if (s.holdMs > o.topCapMs) s.capped = true;
      }
      s.lastT = Math.max(s.lastT, tc);
      if (t >= end) { s.ended = true; s.capped = false; return snap(t); }
      if (f.counted) { s.reps += 1; s.repTutMs += repTut(f.repMs, o.repCapMs); }
      if (f.atTop) { if (!s.atTop) { s.holdMs = 0; s.capped = false; } s.atTop = true; }
      else { s.atTop = false; s.holdMs = 0; s.capped = false; }
      return snap(t);
    }
    function result() {
      var tut = s.repTutMs + s.topTutMs;
      return { reps: s.reps, tutMs: tut, repTutMs: s.repTutMs, topTutMs: s.topTutMs, score: s.reps + Math.floor(tut / 1000) };
    }
    function snap(t) { var r = result(); r.ended = s.ended; r.capped = s.capped; r.remainingMs = remaining(t); r.elapsedMs = elapsed(t); return r; }
    return { start: start, update: update, result: result, reset: reset, remaining: remaining, elapsed: elapsed, snapshot: snap,
             state: function () { return s; }, options: o };
  }
  // "At top" from push-counter state: calibrated (phase "ready"), stage "up", not mid-rep,
  // and range of motion below half the counter's own upRom (the same line where the counter
  // restarts rep timing, so top-hold time and rep-cycle time never overlap).
  function atTopFrom(st, upRom) {
    if (!st || st.phase !== "ready" || st.stage !== "up" || st.repStart != null) return false;
    if (st.top == null || st.bottom == null || st.smooth == null || !(st.bottom - st.top)) return false;
    return (st.smooth - st.top) / (st.bottom - st.top) < (upRom == null ? 0.3 : upRom) * 0.5;
  }
  function flagSummary(kinds) {
    var k = kinds || {}, n = (k.standing || 0) + (k.knees || 0);
    if (!n) return "No flags";
    var p = [];
    if (k.standing) p.push("Stood up / left plank × " + k.standing);
    if (k.knees) p.push("Knees down × " + k.knees);
    return n + " flag" + (n === 1 ? "" : "s") + ": " + p.join(", ");
  }
  var api = { createChallenge: createChallenge, atTopFrom: atTopFrom, flagSummary: flagSummary };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatChallenge = api;
})(this);
