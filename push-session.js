/* Zabbadat pushup session helpers: pure logic (no DOM, no camera).
 * - tutToAdd: time-under-tension credited when a set/session is saved.
 * - createPostureGuard: One long set rule check (standing up / knees down), debounced.
 *   Flags only; never affects the timer or rep count. */
(function (root) {
  function tutToAdd(mode, elapsedMs, repTutMs) {
    var v = mode === "long" ? Number(elapsedMs) : Number(repTutMs);
    return isFinite(v) && v > 0 ? v : 0;
  }
  // A finished set / ended session counts toward Total sets only if it had reps.
  function setsToAdd(reps) { return Number(reps) > 0 ? 1 : 0; }
  function canSwitchMode(ps) { return !ps.running && !(ps.elapsed > 0 || ps.reps > 0) || !!ps.finished; }

  var GUARD = { minScore: 0.4, holdMs: 500, rearmMs: 300, kneeAngle: 130, upright: 2, shrink: 0.55 };
  function pt(kps, name, min) {
    for (var i = 0; i < (kps || []).length; i++) {
      var k = kps[i];
      if (k && k.name === name) return k.score == null || k.score >= min ? k : null;
    }
    return null;
  }
  function angle(a, b, c) {
    var v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    var d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    return d ? Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180 / Math.PI : null;
  }
  // Classify one frame: "standing", "knees", "ok" (plank, confident) or null (uncertain).
  function classify(kps, topWidth, o) {
    o = o || GUARD;
    var ls = pt(kps, "left_shoulder", o.minScore), rs = pt(kps, "right_shoulder", o.minScore);
    var known = false;
    var sides = ["left", "right"], knees = false, upright = false;
    for (var i = 0; i < 2; i++) {
      var s = sides[i], sh = pt(kps, s + "_shoulder", o.minScore), hip = pt(kps, s + "_hip", o.minScore),
          kn = pt(kps, s + "_knee", o.minScore), an = pt(kps, s + "_ankle", o.minScore);
      if (hip && kn && an) {
        known = true;
        var a = angle(hip, kn, an);
        if (a != null && a < o.kneeAngle) knees = true;
        if (sh) { var dy = Math.abs(an.y - sh.y), dx = Math.abs(an.x - sh.x); if (dy > o.upright * dx && a != null && a >= o.kneeAngle) upright = true; }
      }
    }
    var w = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : null;
    // A floor camera sees a plank's legs running straight down the frame, so an upright-looking
    // line only counts when the shoulders have also moved away from the camera.
    if (upright && (!(w && topWidth > 0) || w < 0.8 * topWidth)) return "standing";
    if (knees) return "knees";
    if (w && topWidth > 0) {
      if (w < o.shrink * topWidth) return "standing"; // left the plank: moved far from the floor camera
      return "ok";
    }
    return known ? "ok" : null;
  }
  function createPostureGuard(opts) {
    var o = Object.assign({}, GUARD, opts || {});
    var g;
    function reset() { g = { count: 0, armed: true, pending: null, since: null, okSince: null, active: null, events: [] }; }
    reset();
    function update(kps, t, topWidth) {
      var c = classify(kps, topWidth, o), ev = null;
      if (c === "standing" || c === "knees") {
        g.okSince = null;
        if (g.pending !== c) { g.pending = c; g.since = t; }
        if (g.armed && t - g.since >= o.holdMs) {
          g.armed = false; g.count += 1; g.active = c; ev = c; g.events.push({ type: c, t: t });
        }
      } else if (c === "ok") {
        g.pending = null; g.since = null;
        if (g.okSince == null) g.okSince = t;
        if (!g.armed && t - g.okSince >= o.rearmMs) { g.armed = true; g.active = null; }
      } else { g.pending = null; g.since = null; g.okSince = null; } // uncertain: no flag, no re-arm
      return { frame: c, event: ev, active: g.active, count: g.count };
    }
    return { update: update, reset: reset, state: function () { return g; } };
  }
  // Personal history from localStorage entries [[key, value], ...]: per-day time under tension
  // (tutPrefix, e.g. "zabbadat-push-tut-guest-") and reps (repsPrefix, "zabbadat-push-total-guest-").
  // Returns today, best day (by time), all-time totals and days (newest first).
  function tutHistory(entries, tutPrefix, today, repsPrefix) {
    var map = {};
    function day(k, prefix) {
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(k.slice(prefix.length));
      if (!m) return null;
      var key = m[1] + "-" + m[2] + "-" + m[3];
      return map[key] || (map[key] = { y: +m[1], m: +m[2], d: +m[3], key: key, ms: 0, reps: 0 });
    }
    (entries || []).forEach(function (kv) {
      var k = kv[0], v = Number(kv[1]);
      if (typeof k !== "string" || !(v > 0)) return;
      var x;
      if (k.indexOf(tutPrefix) === 0 && (x = day(k, tutPrefix))) x.ms = v;
      else if (repsPrefix && k.indexOf(repsPrefix) === 0 && (x = day(k, repsPrefix))) x.reps = v;
    });
    var days = Object.keys(map).map(function (k) { return map[k]; });
    days.sort(function (a, b) { return (b.y - a.y) || (b.m - a.m) || (b.d - a.d); });
    var best = null, total = 0, reps = 0, t = { ms: 0, reps: 0 };
    days.forEach(function (x) {
      total += x.ms; reps += x.reps;
      if (x.ms > 0 && (!best || x.ms > best.ms)) best = x;
      if (x.key === today) t = x;
    });
    return { today: t.ms, todayReps: t.reps, best: best, total: total, totalReps: reps, days: days };
  }
  // Public TUT ranking from push board rows: longest ms first, 0-rep entries dropped.
  function rankTut(rows, n) {
    return (rows || []).filter(function (r) { return Number(r.reps) > 0 && Number(r.ms) > 0; })
      .sort(function (a, b) { return Number(b.ms) - Number(a.ms); }).slice(0, n || 50);
  }

  var api = { tutHistory: tutHistory, rankTut: rankTut, tutToAdd: tutToAdd, setsToAdd: setsToAdd, canSwitchMode: canSwitchMode, classify: classify, createPostureGuard: createPostureGuard, GUARD: GUARD };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatSession = api;
})(this);
