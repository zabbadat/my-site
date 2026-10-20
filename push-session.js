/* Zabbadat pushup session helpers: pure logic (no DOM, no camera).
 * - tutToAdd: time-under-tension credited when a set/session is saved.
 * - createPostureGuard: One long set rule check (standing up / knees down), debounced.
 *   Flags only; never affects the timer or rep count. */
(function (root) {
  function tutToAdd(mode, elapsedMs, repTutMs) {
    var v = mode === "long" ? Number(elapsedMs) : Number(repTutMs);
    return isFinite(v) && v > 0 ? v : 0;
  }
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
  var api = { tutToAdd: tutToAdd, canSwitchMode: canSwitchMode, classify: classify, createPostureGuard: createPostureGuard, GUARD: GUARD };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatSession = api;
})(this);
