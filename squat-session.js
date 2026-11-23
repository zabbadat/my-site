/* Gyatt Squats set (pure logic, no DOM): wraps squat-counter.js and decides when a set ends.
 * The set clock starts at Go. Reps come from the pose counter only (the spoken cadence never adds a rep).
 * A set ends ONLY on:
 *   stall_bottom  15 s down in the squat (hips below the top band) with no counted rep
 *   no_rep        45 s with no counted rep (from Go, then from the last rep)
 *   sat           sat down and stayed down: hips at/under parallel and still for 8 s (a normal cadence bottom is a
 *                 4 s hold, so it never trips), or hips almost to the floor (drop >= 1.6 thighs) for 1.5 s
 *   hands_down    hands below the knees for 1 s while down (fell / hands on the floor)
 *   left_frame    body out of the picture for 3 s
 *   set_done      the tenth counted rep: a set is ten reps (10 squats = 1 ZAB), so a full set pays exactly 1 ZAB
 *   stopped       the End set button
 * Small wobbles, a brief tracking loss (< 3 s), walking to a new spot or bending over never end a set; they only pause
 * counting (and void the rep in progress).
 * Browser: window.ZabbadatSquatSession. Node: require("./squat-session.js").
 */
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports;
  var SC = NODE ? require("./squat-counter.js") : root.ZabbadatSquat;
  var ETD = NODE ? require("./et-day.js") : root.ZabbadatEtDay;
  var L = { stallBottomMs: 15000, noRepMs: 45000, sitStillMs: 8000, sitDrop: 0.8, sitStillTol: 0.06, floorDrop: 1.6, floorMs: 1500,
    handsMs: 1000, missingMs: 3000, maxReps: 1000, setReps: 10 }; // a set is ten counted reps
  var REASON = { stall_bottom: "15 seconds at the bottom with no rep", no_rep: "45 seconds with no rep", sat: "sat down", hands_down: "hands down",
    left_frame: "left the frame", stopped: "End set", set_done: "ten reps, set complete", max_reps: "1000 reps, the most one set can post" };
  function reasonText(r) { return REASON[r] || "set over"; }
  // TUT while the squat is under load (down, bottom, or up). Pauses at the top rest, out of frame, or a form break.
  function createTutClock() {
    var ms = 0, last = null, loaded = false;
    function tick(t, on) {
      t = Number(t);
      if (last != null && on && isFinite(t) && t > last) ms += t - last;
      if (isFinite(t)) last = t;
      loaded = !!on;
      return ms;
    }
    function reset() { ms = 0; last = null; loaded = false; }
    function stop(t) { if (t != null) tick(t, false); last = null; return ms; }
    return { tick: tick, reset: reset, stop: stop, ms: function () { return ms; }, loaded: function () { return loaded; } };
  }
  function squatLoaded(st) {
    return !!(st && st.frame === "ok" && st.guard === "ok" && (st.phase === "down" || st.phase === "bottom" || st.phase === "up"));
  }

  function createSquatSet(opts) {
    opts = opts || {};
    var lim = Object.assign({}, L, opts.limits || {});
    var counter = opts.counter || SC.createCounter(opts.counterOpts);
    var t0 = opts.startT != null ? opts.startT : null, lastRepT = null, downT = null, missT = null, handsT = null, floorT = null;
    var still = null, ended = null, repTimes = [], lastSt = null, tut = createTutClock();
    function finish(t, reason) {
      if (ended) return ended;
      if (lastSt) tut.tick(t, squatLoaded(lastSt)); else tut.stop(t);
      ended = { ended: true, reason: reason, why: reasonText(reason), reps: counter.state().reps, halfReps: counter.state().halfReps, ms: Math.max(0, Math.round(t - t0)), tutMs: Math.round(tut.stop(t)), repTimes: repTimes.slice(), endedAt: t };
      return ended;
    }
    function out(st, extra) { return Object.assign({ ended: false, reps: st.reps, halfReps: st.halfReps, phase: st.phase, frame: st.frame, guard: st.guard, drop: st.drop, ms: Math.max(0, Math.round((extra && extra.t) - t0)), tutMs: Math.round(tut.ms()), event: st.event }, extra || {}); }
    function update(kps, t, extra) {
      if (ended) return ended;
      if (t0 == null) t0 = t;
      if (lastRepT == null) lastRepT = t0;
      var st = counter.update(kps, t, extra); lastSt = st; tut.tick(t, squatLoaded(st));
      if (st.event === "rep") { lastRepT = t; repTimes.push(Math.round(t - t0)); downT = null; still = null; if (lim.setReps && st.reps >= lim.setReps) return finish(t, "set_done"); if (st.reps >= lim.maxReps) return finish(t, "max_reps"); }
      // out of frame
      if (st.frame === "missing") { if (missT == null) missT = t; if (t - missT >= lim.missingMs) return finish(t, "left_frame"); }
      else missT = null;
      var down = st.frame === "ok" && st.guard === "ok" && (st.phase === "down" || st.phase === "bottom" || st.phase === "up") && st.drop > SC.T.downAt;
      if (st.frame !== "missing") {
        if (down) { if (downT == null) downT = t; } else if (st.frame === "ok" && st.guard === "ok") downT = null;
      }
      // sat down and stayed down (held still, deeper than a normal bottom's motion)
      if (down && st.drop >= lim.sitDrop) {
        if (!still || Math.abs(st.drop - still.drop) > lim.sitStillTol) still = { drop: st.drop, t: t };
        else if (t - still.t >= lim.sitStillMs) return finish(t, "sat");
      } else if (st.frame === "ok") still = null;
      if (down && st.drop >= lim.floorDrop) { if (floorT == null) floorT = t; if (t - floorT >= lim.floorMs) return finish(t, "sat"); } else if (st.frame === "ok") floorT = null;
      if (down && st.wristBelowKnee) { if (handsT == null) handsT = t; if (t - handsT >= lim.handsMs) return finish(t, "hands_down"); } else if (st.frame === "ok") handsT = null;
      if (downT != null && t - downT >= lim.stallBottomMs && t - lastRepT >= lim.stallBottomMs) return finish(t, "stall_bottom");
      if (t - lastRepT >= lim.noRepMs) return finish(t, "no_rep");
      return out(st, { t: t, sinceRepMs: Math.round(t - lastRepT), downMs: downT == null ? 0 : Math.round(t - downT) });
    }
    return { update: update, stop: function (t, reason) { return finish(t, reason || "stopped"); }, state: function () { return ended || (lastSt ? out(lastSt, {}) : null); }, counter: counter, limits: lim,
      start: function (t) { t0 = t; lastRepT = t; } };
  }
  // Today's squats on this phone, per Eastern day (et-day.js, resets at Eastern midnight like the push-up keys):
  // localStorage "zabbadat-squats-day-YYYY-MM-DD" = { reps, sets }. A set with 0 reps is not a set.
  var DAY_PREFIX = "zabbadat-squats-day-";
  function dayKey(ms) { return DAY_PREFIX + (ETD ? ETD.key(ms) : new Date(ms == null ? Date.now() : ms).toISOString().slice(0, 10)); }
  function getDay(store, ms) {
    try { var d = JSON.parse(store.getItem(dayKey(ms)) || "null"); if (d && d.reps >= 0 && d.sets >= 0) return { reps: Math.floor(d.reps), sets: Math.floor(d.sets) }; } catch (e) {}
    return { reps: 0, sets: 0 };
  }
  function recordSet(store, reps, ms) {
    var d = getDay(store, ms); reps = Math.max(0, Math.floor(Number(reps) || 0));
    if (reps < 1) return d;
    d = { reps: d.reps + reps, sets: d.sets + 1 };
    try { store.setItem(dayKey(ms), JSON.stringify(d)); } catch (e) {}
    return d;
  }
  // ms until the next Eastern midnight (the page repaints today's totals then, even if left open)
  function msToMidnight(ms) { ms = ms == null ? Date.now() : ms; if (!ETD) return 3600000; var s = ETD.startMs(ms); return Math.max(1000, ETD.startMs(s + 30 * 3600000) - ms); }
  var api = { L: L, REASON: REASON, reasonText: reasonText, createTutClock: createTutClock, squatLoaded: squatLoaded, createSquatSet: createSquatSet, dayKey: dayKey, getDay: getDay, recordSet: recordSet, msToMidnight: msToMidnight };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatSquatSession = api;
})(typeof window !== "undefined" ? window : this);
