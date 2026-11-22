/* Push-up challenge helpers (#push) + the TUT Battle clock.
 * createHoldChallenge: the solo Two-minute challenge (Nov 16, owner): a 2:00 clock that counts down; hold a push-up plank
 *   (high plank, arms straight) the whole time. Reaching 0:00 = complete; a camera-detected form break (the same failure
 *   watch as the TUT set: knees down, sag / pike against the start pose, collapse, stood up) or End set = failed, time held shown.
 * createChallenge: the old reps + top-hold TUT clock. Still used by TUT Battle (its own durationMs); the solo challenge no longer uses it.
 * Pure logic, no DOM. createChallenge({ durationMs: 180000, topCapMs: 10000 })
 * - start(t): fixed clock from t; no pause.
 * - update(t, { atTop, counted, repMs }): call every pose frame.
 *   counted/repMs: a rep the camera counted; credits tutForRep(repMs) (cycle, capped 10 s).
 *   atTop: arms straight at the top. Each continuous top hold credits at most topCapMs;
 *   past that, nothing more is credited and capped=true (show "Top hold capped at 10 seconds")
 *   until the player starts lowering (atTop false), which clears it.
 *   Anything after durationMs is ignored (no extra time, reps or TUT after the end).
 * - result(): { reps, tutMs, repTutMs, topTutMs, score } where score = reps + whole TUT seconds. */
(function (root) {
  function repTut(ms, cap) { var v = Number(ms); return isFinite(v) && v > 0 ? Math.min(v, cap) : 0; }
  function createChallenge(opts) {
    var o = { durationMs: 180000, topCapMs: 10000, repCapMs: 10000 };
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
  // ---- Two-minute challenge (solo hold) ----
  var HOLD_CHALLENGE = { durationMs: 120000 };
  // Form-break watch for the hold (owner spec: sag, pike, knees down, collapse / arms giving out, stood up all end it). Push-up
  // sets end only on a definitive break (push-session.js FAIL.endOn: form / elbows off); the plank hold opts back in to both.
  var HOLD_FAIL_OPTS = { endOn: { form: true, elbows: true } };
  // Start-button intro: the card and the spoken line go up together, before the One, two, three, Hold count.
  var INTRO = {
    spoken: "Hold a push-up plank, arms straight, for two minutes.",
    title: "Two-minute challenge",
    lines: ["The clock runs from 2:00 down to 0:00.", "Hold a push-up plank, arms straight, the whole two minutes.", "Bad form fails the plank."]
  };
  // start(t) at Hold; update(t) -> snapshot; fail(t, reason) ends it early (credit up to t); stop(t, reason) = ended by hand.
  // Snapshot: { started, ended, success, reason, heldMs, remainingMs }. Nothing after durationMs is ever credited.
  function createHoldChallenge(opts) {
    var o = {}; for (var k in HOLD_CHALLENGE) o[k] = HOLD_CHALLENGE[k];
    for (var k2 in opts || {}) o[k2] = opts[k2];
    var s;
    function reset() { s = { started: false, startT: 0, ended: false, success: false, reason: null, heldMs: 0 }; }
    reset();
    function held(t) { return s.started ? Math.max(0, Math.min(o.durationMs, t - s.startT)) : 0; }
    function snap(t) {
      var h = s.ended ? s.heldMs : held(t);
      return { started: s.started, ended: s.ended, success: s.success, reason: s.reason, heldMs: h, remainingMs: Math.max(0, o.durationMs - h) };
    }
    function start(t) { reset(); s.started = true; s.startT = t; return snap(t); }
    function update(t) {
      if (s.started && !s.ended && t - s.startT >= o.durationMs) { s.ended = true; s.success = true; s.reason = "done"; s.heldMs = o.durationMs; }
      return snap(t);
    }
    function endEarly(t, reason) {
      if (!s.started || s.ended) return snap(t);
      update(t); if (s.ended) return snap(t); // already reached 2:00: that is a complete hold
      s.ended = true; s.success = false; s.reason = reason || "stopped"; s.heldMs = held(t);
      return snap(t);
    }
    return { start: start, update: update, fail: endEarly, stop: endEarly, reset: reset, snapshot: snap, state: function () { return s; }, options: o };
  }
  // Result line for the card / status: "Two-minute challenge complete: held 2:00." or "... failed: held 1:12 (Knees down)."
  function clock(ms) { var sec = Math.floor(Math.max(0, Number(ms) || 0) / 1000); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
  function holdResultText(r, why) {
    if (r && r.success) return "Two-minute challenge complete: held " + clock(r.heldMs) + ".";
    return "Two-minute challenge failed: held " + clock(r ? r.heldMs : 0) + (why ? " (" + why + ")" : "") + ".";
  }
  // Today's challenge totals (this phone), keyed by the Eastern day so they start over at Eastern midnight on their own.
  function dayStatsKey(who, dayKey) { return "zabbadat-twomin-" + (who || "guest") + "-" + dayKey; }
  function addDayStats(prev, r) {
    var p = prev || { tries: 0, done: 0, bestMs: 0 };
    return { tries: (p.tries || 0) + 1, done: (p.done || 0) + (r && r.success ? 1 : 0), bestMs: Math.max(p.bestMs || 0, Math.round((r && r.heldMs) || 0)) };
  }
  function dayStatsText(st) {
    if (!st || !st.tries) return "Today: no tries yet.";
    return "Today: " + st.tries + " tr" + (st.tries === 1 ? "y" : "ies") + ", " + st.done + " complete, best hold " + clock(st.bestMs) + ".";
  }
  var api = { createChallenge: createChallenge, atTopFrom: atTopFrom, flagSummary: flagSummary,
    HOLD_CHALLENGE: HOLD_CHALLENGE, HOLD_FAIL_OPTS: HOLD_FAIL_OPTS, INTRO: INTRO, createHoldChallenge: createHoldChallenge, holdResultText: holdResultText, clock: clock,
    dayStatsKey: dayStatsKey, addDayStats: addDayStats, dayStatsText: dayStatsText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatChallenge = api;
})(this);
