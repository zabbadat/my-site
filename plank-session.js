/* Zabbadat plank contest: pure logic (no DOM, no camera).
 * Phone propped on the floor off to the side, body seen side-on.
 * - classifyPlank: one frame -> "ok" | "sag" | "pike" | "knees" | "standing" | "missing"
 * - createLiveness: flags frozen (photo-like) or exactly repeating keypoints
 * - createPlankHold: ready check -> holding -> ended (with reason)
 * - rankPlanks / bestOf: board ranking and personal best */
(function (root) {
  "use strict";
  var PLANK = {
    minScore: 0.3,      // keypoint confidence gate
    bodyAngle: 160,     // shoulder-hip-ankle must be >= this (straight line)
    kneeAngle: 150,     // hip-knee-ankle below this = resting on the knees
    flat: 1.0,          // shoulder->ankle rise must be <= flat * run (else standing/upright)
    readyMs: 1500,      // continuous good plank before the clock starts
    badMs: 1000,        // bad form longer than this ends the hold
    missMs: 1000,       // body missing longer than this ends the hold
    liveWindowMs: 8000, // liveness window
    frozenTol: 0.0003,  // max per-frame motion (fraction of body length) that counts as "frozen"
    repeatFrac: 0.9     // share of frames in the window that exactly repeat an earlier frame
  };
  function merge(o) { var r = {}, k; for (k in PLANK) r[k] = PLANK[k]; for (k in (o || {})) r[k] = o[k]; return r; }
  function pt(kps, name, min) {
    for (var i = 0; i < (kps || []).length; i++) {
      var k = kps[i];
      if (k && k.name === name) return (k.score == null || k.score >= min) && isFinite(k.x) && isFinite(k.y) ? k : null;
    }
    return null;
  }
  function angle(a, b, c) {
    var v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    var d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    return d ? Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180 / Math.PI : null;
  }
  function conf(kps, side) {
    var s = 0; ["shoulder", "hip", "knee", "ankle"].forEach(function (j) { var p = pt(kps, side + "_" + j, 0); s += p && p.score != null ? p.score : (p ? 1 : 0); });
    return s;
  }
  // Use the side facing the camera (higher confidence).
  function classifyPlank(kps, opts) {
    var o = merge(opts);
    var side = conf(kps, "left") >= conf(kps, "right") ? "left" : "right";
    var sh = pt(kps, side + "_shoulder", o.minScore), hip = pt(kps, side + "_hip", o.minScore),
        an = pt(kps, side + "_ankle", o.minScore), kn = pt(kps, side + "_knee", o.minScore);
    if (!sh || !hip || !an) return { frame: "missing" };
    var run = Math.abs(an.x - sh.x), rise = Math.abs(an.y - sh.y);
    if (rise > o.flat * run) return { frame: "standing", side: side };
    var body = angle(sh, hip, an), knee = kn ? angle(hip, kn, an) : null;
    if (knee != null && knee < o.kneeAngle) return { frame: "knees", body: body, knee: knee, side: side };
    if (body != null && body < o.bodyAngle) {
      // Image y grows downward: hip below the shoulder-ankle line = sag, above = pike.
      var lineY = sh.y + (an.y - sh.y) * ((hip.x - sh.x) / ((an.x - sh.x) || 1e-9));
      return { frame: hip.y > lineY ? "sag" : "pike", body: body, knee: knee, side: side };
    }
    return { frame: "ok", body: body, knee: knee, side: side };
  }

  var JOINTS = ["shoulder", "hip", "knee", "ankle", "elbow", "wrist"];
  function createLiveness(opts) {
    var o = merge(opts), buf = [];
    function reset() { buf = []; }
    function sig(kps) {
      var pts = [];
      ["left", "right"].forEach(function (s) { JOINTS.forEach(function (j) { var p = pt(kps, s + "_" + j, o.minScore); if (p) pts.push(p); }); });
      return pts;
    }
    // Returns null (fine / not enough data) or "frozen" | "repeat".
    function update(kps, t, bodyLen) {
      var pts = sig(kps);
      if (pts.length < 3 || !(bodyLen > 0)) return null;
      var key = pts.map(function (p) { return p.name + ":" + p.x.toFixed(2) + "," + p.y.toFixed(2); }).join("|");
      var prev = buf.length ? buf[buf.length - 1] : null, motion = null;
      if (prev) {
        var sum = 0, n = 0;
        pts.forEach(function (p) { var q = prev.map[p.name]; if (q) { sum += Math.hypot(p.x - q.x, p.y - q.y); n++; } });
        motion = n ? sum / n / bodyLen : null;
      }
      var map = {}; pts.forEach(function (p) { map[p.name] = { x: p.x, y: p.y }; });
      var seenBefore = false;
      for (var i = 0; i < buf.length - 1; i++) if (buf[i].key === key && t - buf[i].t >= 200) { seenBefore = true; break; }
      buf.push({ t: t, key: key, map: map, motion: motion, repeat: seenBefore });
      while (buf.length && t - buf[0].t > o.liveWindowMs) buf.shift();
      if (t - buf[0].t < o.liveWindowMs * 0.95 || buf.length < 10) return null;
      var frozen = true, reps = 0, m = 0;
      for (var j = 1; j < buf.length; j++) { if (buf[j].motion == null || buf[j].motion > o.frozenTol) frozen = false; m++; if (buf[j].repeat) reps++; }
      if (frozen) return "frozen";
      if (m && reps / m >= o.repeatFrac) return "repeat";
      return null;
    }
    return { update: update, reset: reset };
  }

  // Hold state machine. update(kps, t) -> { phase, ms, frame, countdownMs, reason, ended }
  function createPlankHold(opts) {
    var o = merge(opts), live = createLiveness(o), h;
    function reset() { live.reset(); h = { phase: "ready", goodSince: null, startT: null, badSince: null, badType: null, missSince: null, ms: 0, reason: null, lastT: null }; }
    reset();
    function end(t, reason, creditT) { h.phase = "ended"; h.reason = reason; h.ms = Math.max(0, Math.round((creditT != null ? creditT : t) - h.startT)); }
    function bodyLen(kps) {
      var best = 0; ["left", "right"].forEach(function (s) { var a = pt(kps, s + "_shoulder", o.minScore), b = pt(kps, s + "_ankle", o.minScore); if (a && b) best = Math.max(best, Math.hypot(a.x - b.x, a.y - b.y)); });
      return best;
    }
    function update(kps, t) {
      var c = classifyPlank(kps, o), f = c.frame;
      h.lastT = t;
      if (h.phase === "ended") return out(f);
      if (h.phase === "ready") {
        if (f === "ok") { if (h.goodSince == null) h.goodSince = t; if (t - h.goodSince >= o.readyMs) { h.phase = "holding"; h.startT = t; live.reset(); } }
        else h.goodSince = null;
        return out(f);
      }
      // holding
      if (f === "missing") {
        h.badSince = null;
        if (h.missSince == null) h.missSince = t;
        if (t - h.missSince >= o.missMs) { end(t, "left_frame", h.missSince); return out(f); }
      } else {
        h.missSince = null;
        if (f === "ok") { h.badSince = null; h.badType = null; }
        else {
          if (h.badSince == null) h.badSince = t;
          h.badType = f;
          if (t - h.badSince >= o.badMs) { end(t, f, h.badSince); return out(f); }
        }
        var lv = live.update(kps, t, bodyLen(kps));
        if (lv) { end(t, lv); return out(f); }
      }
      h.ms = Math.round(t - h.startT);
      return out(f);
    }
    function out(f) {
      return { phase: h.phase, ms: h.ms, frame: f, ended: h.phase === "ended", reason: h.reason,
        countdownMs: h.phase === "ready" && h.goodSince != null && h.lastT != null ? Math.max(0, o.readyMs - (h.lastT - h.goodSince)) : null };
    }
    // Manual stop (button) ends the hold with credit up to now.
    function stop(t) { if (h.phase === "holding") end(t, "stopped"); else if (h.phase === "ready") { h.phase = "ended"; h.reason = "stopped"; } return out(null); }
    return { update: update, stop: stop, reset: reset, state: function () { return h; } };
  }

  var REASONS = { sag: "Hips sagged", pike: "Hips piked up", knees: "Knees down", standing: "Left the plank (stood up)",
    left_frame: "Body left the frame", frozen: "No movement detected (photo?)", repeat: "Repeating motion detected (video?)", stopped: "Stopped" };
  function reasonText(r) { return REASONS[r] || "Ended"; }
  function rankPlanks(rows, n) {
    return (rows || []).filter(function (r) { var m = Number(r && r.ms); return isFinite(m) && m > 0; })
      .map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return Number(b.r.ms) - Number(a.r.ms) || a.i - b.i; })
      .slice(0, n || 50).map(function (x) { return x.r; });
  }
  function bestOf(prevMs, ms) { var p = Number(prevMs) || 0, m = Number(ms) || 0; return m > p ? m : p; }

  var api = { PLANK: PLANK, classifyPlank: classifyPlank, createLiveness: createLiveness, createPlankHold: createPlankHold, rankPlanks: rankPlanks, bestOf: bestOf, reasonText: reasonText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatPlank = api;
})(typeof self !== "undefined" ? self : this);
