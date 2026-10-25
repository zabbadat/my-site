/* Zabbadat plank contest: pure logic (no DOM, no camera).
 * Phone propped on the floor off to the side, body seen side-on.
 * - frameGuide: is the whole body (shoulder, hip, knee, ankle) in frame, side-on and roughly level? -> short message.
 *     Framing only delays the READY start; it never ends a running hold.
 * - classifyPlank: one frame -> "ok" | "sag" | "pike" | "knees" | "standing" | "missing". Sag and pike are the hip's
 *     perpendicular offset from the shoulder-ankle line divided by that line's length (body length), each with a tight
 *     "start" limit and a looser "keep" limit (hysteresis: easier to keep good form than to regain it).
 * - createPlankFilter: One Euro filter (the one in push-counter.js) on the keypoints, scaled by body length.
 *     MoveNet's own smoothing is off for plank; form classification and framing read the FILTERED points.
 * - createLiveness: flags frozen (photo-like) or exactly repeating keypoints. Always reads the RAW points.
 * - createPlankHold: ready check -> holding -> ended (with reason)
 * - rankPlanks / bestOf: board ranking and personal best */
(function (root) {
  "use strict";
  var PLANK = {
    minScore: 0.3,      // keypoint confidence gate
    sagStart: 0.05,     // hip below the shoulder-ankle line by more than this x body length = sag (when not already good)
    sagKeep: 0.07,      // ...but an already-good frame only turns sag beyond this (hysteresis)
    pikeStart: 0.06,    // hip above the line by more than this x body length = pike (when not already good)
    pikeKeep: 0.085,    // ...already-good frames only turn pike beyond this
    kneeAngle: 150,     // hip-knee-ankle below this = resting on the knees
    flat: 1.0,          // shoulder->ankle rise must be <= flat * run (else standing/upright)
    readyMs: 1500,      // good plank (and good framing) before the clock starts
    readyGraceMs: 250,  // a bad stretch shorter than this does not reset the ready countdown
    cue: false,         // true: when ready is satisfied the hold goes ready -> "cue" (the page speaks "Hold plank.") -> begin(t) starts the clock
    cueMaxMs: 8000,     // safety: the clock starts by itself this long after the cue phase began (speech stuck / never ended)
    badMs: 1000,        // bad form longer than this ends the hold
    missMs: 1000,       // body missing longer than this ends the hold
    liveWindowMs: 8000, // liveness window
    frozenTol: 0.0003,  // max per-frame motion (fraction of body length) that counts as "frozen"
    repeatFrac: 0.9,    // share of frames in the window that exactly repeat an earlier frame
    frameScore: 0.35,   // framing guide: every one of shoulder, hip, knee, ankle needs at least this confidence
    edgeFrac: 0.02,     // framing: a joint this close to the frame edge (fraction of the frame) counts as cut off
    minSpan: 0.35,      // framing: shoulder-to-ankle span must be at least this fraction of the frame width (landscape)
    minSpanPortrait: 0.7, // ...in a portrait frame the body is small: this much or "prop the phone sideways"
    sideSep: 0.3,       // framing: left/right shoulder or hip farther apart than this x body length = seen from the front
    maxTilt: 35,        // framing: shoulder-ankle line steeper than this many degrees from horizontal = not level
    frameShowMs: 500,   // framing message shows after the issue lasts this long ...
    frameClearMs: 250,  // ... and clears after it has been gone this long
    filter: true,       // One Euro on the keypoints for form classification (liveness stays on raw points)
    minCutoff: 1.5,     // One Euro resting cutoff (Hz): a plank is a still pose, so smooth hard at rest
    beta: 4,            // One Euro: cutoff grows with speed (body lengths/s), so a real sag is not delayed
    dCutoff: 1.0,       // One Euro: cutoff for the speed estimate (Hz)
    filterGapMs: 600    // a joint missing this long restarts its filter
  };
  var MSG = {
    whole: "Step back until your whole body fits",
    turn: "Turn so the camera sees your side",
    sideways: "Prop the phone sideways",
    level: "Get level, head to heels",
    closer: "Move a little closer"
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
  function pickSide(kps) { return conf(kps, "left") >= conf(kps, "right") ? "left" : "right"; }
  // Signed hip offset from the shoulder-ankle line, as a fraction of that line's length (body length).
  // Positive = hip below the line (sag), negative = above (pike). Perpendicular distance, so it does not depend on
  // where along the body the hip sits or on how big the person is in the frame.
  function hipOffset(sh, hip, an) {
    var ux = an.x - sh.x, uy = an.y - sh.y, L = Math.hypot(ux, uy);
    if (!(L > 0)) return null;
    var cross = (ux * (hip.y - sh.y) - uy * (hip.x - sh.x)) / L; // + = right of the shoulder->ankle direction (image coords)
    return (ux >= 0 ? cross : -cross) / L;
  }
  // Use the side facing the camera (higher confidence).
  // opts.keep = true when the previous frame was already "ok": the looser sagKeep / pikeKeep limits apply.
  function classifyPlank(kps, opts) {
    var o = merge(opts);
    var side = pickSide(kps);
    var sh = pt(kps, side + "_shoulder", o.minScore), hip = pt(kps, side + "_hip", o.minScore),
        an = pt(kps, side + "_ankle", o.minScore), kn = pt(kps, side + "_knee", o.minScore);
    if (!sh || !hip || !an) return { frame: "missing" };
    var run = Math.abs(an.x - sh.x), rise = Math.abs(an.y - sh.y);
    if (rise > o.flat * run) return { frame: "standing", side: side };
    var knee = kn ? angle(hip, kn, an) : null, dev = hipOffset(sh, hip, an);
    if (knee != null && knee < o.kneeAngle) return { frame: "knees", dev: dev, knee: knee, side: side };
    var sagAt = o.keep ? o.sagKeep : o.sagStart, pikeAt = o.keep ? o.pikeKeep : o.pikeStart;
    if (dev != null && dev > sagAt) return { frame: "sag", dev: dev, knee: knee, side: side };
    if (dev != null && -dev > pikeAt) return { frame: "pike", dev: dev, knee: knee, side: side };
    return { frame: "ok", dev: dev, knee: knee, side: side };
  }

  // Live framing guide (side view). dims = { w, h } of the video frame (optional). Returns
  // { ok, issue, msg, span } with issue one of whole | turn | sideways | level | closer | null. Pure; never judges form.
  function frameGuide(kps, dims, opts) {
    var o = merge(opts), side = pickSide(kps), n = o.frameScore, J = {};
    ["shoulder", "hip", "knee", "ankle"].forEach(function (j) { J[j] = pt(kps, side + "_" + j, n); });
    var W = dims && dims.w > 0 ? dims.w : 0, H = dims && dims.h > 0 ? dims.h : 0;
    if (!J.shoulder || !J.hip || !J.knee || !J.ankle) return { ok: false, issue: "whole", msg: MSG.whole, span: null };
    if (W && H) {
      var ex = o.edgeFrac * W, ey = o.edgeFrac * H;
      for (var k in J) if (J[k].x < ex || J[k].x > W - ex || J[k].y < ey || J[k].y > H - ey) return { ok: false, issue: "whole", msg: MSG.whole, span: null };
    }
    var L = Math.hypot(J.ankle.x - J.shoulder.x, J.ankle.y - J.shoulder.y);
    var other = side === "left" ? "right" : "left", sep = 0;
    ["shoulder", "hip"].forEach(function (j) { var q = pt(kps, other + "_" + j, n); if (q && L > 0) sep = Math.max(sep, Math.abs(q.x - J[j].x) / L); });
    if (sep > o.sideSep) return { ok: false, issue: "turn", msg: MSG.turn, span: null };
    var run = Math.abs(J.ankle.x - J.shoulder.x), rise = Math.abs(J.ankle.y - J.shoulder.y);
    var tilt = Math.atan2(rise, run) * 180 / Math.PI, span = W ? run / W : null, portrait = H > W && W > 0;
    if (tilt > o.maxTilt) return portrait || !W ? { ok: false, issue: "sideways", msg: MSG.sideways, span: span } : { ok: false, issue: "level", msg: MSG.level, span: span };
    if (span != null && span < (portrait ? o.minSpanPortrait : o.minSpan))
      return portrait ? { ok: false, issue: "sideways", msg: MSG.sideways, span: span } : { ok: false, issue: "closer", msg: MSG.closer, span: span };
    return { ok: true, issue: null, msg: "", span: span };
  }

  // One Euro filter (push-counter.js) on every confident keypoint, in body-length units so the same settings work at
  // any distance. Used for form classification and framing only. filter(kps, t) -> new keypoint array (inputs untouched).
  function euroFactory() {
    try { if (typeof module !== "undefined" && module.exports && typeof require === "function") return require("./push-counter.js").oneEuro; } catch (e) {}
    return root.ZabbadatPush && root.ZabbadatPush.oneEuro ? root.ZabbadatPush.oneEuro : null;
  }
  function createPlankFilter(opts) {
    var o = merge(opts), mk = o.filter === false ? null : euroFactory(), st = {}, L = null;
    function reset() { st = {}; L = null; }
    function filter(kps, t) {
      if (!mk) return (kps || []).slice();
      var raw = 0;
      ["left", "right"].forEach(function (sd) { var a = pt(kps, sd + "_shoulder", o.minScore), b = pt(kps, sd + "_ankle", o.minScore); if (a && b) raw = Math.max(raw, Math.hypot(a.x - b.x, a.y - b.y)); });
      if (raw > 0) L = L == null ? raw : L + 0.05 * (raw - L);
      if (!(L > 0)) return (kps || []).slice();
      return (kps || []).map(function (p) {
        if (!p || !isFinite(p.x) || !isFinite(p.y) || (p.score != null && p.score < o.minScore)) return p;
        var e = st[p.name];
        if (!e || t - e.t > o.filterGapMs) e = st[p.name] = { x: mk(o), y: mk(o), t: t, fresh: true };
        var fx, fy;
        if (e.fresh) { e.x.reset(p.x / L, t); e.y.reset(p.y / L, t); fx = p.x / L; fy = p.y / L; e.fresh = false; }
        else { fx = e.x.f(p.x / L, t); fy = e.y.f(p.y / L, t); }
        e.t = t;
        var q = {}; for (var k in p) q[k] = p[k];
        q.x = fx * L; q.y = fy * L;
        return q;
      });
    }
    return { filter: filter, reset: reset };
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

  // Hold state machine. update(kps, t, dims) -> { phase, ms, frame, countdownMs, reason, ended, framing }
  //   kps  = RAW keypoints from the model (MoveNet enableSmoothing:false). They are filtered here for form + framing;
  //          the liveness check gets the raw ones.
  //   dims = { w, h } of the video frame (optional; enables the edge / portrait framing checks).
  //   framing = { ok, issue, msg } (message debounced for display). Framing only gates the READY start; once the clock
  //   runs it is information only and can never end the hold.
  function createPlankHold(opts) {
    var o = merge(opts), live = createLiveness(o), pf = createPlankFilter(o), h;
    function reset() {
      live.reset(); pf.reset();
      h = { phase: "ready", goodSince: null, readyBadSince: null, startT: null, badSince: null, badType: null, missSince: null, ms: 0, reason: null, lastT: null,
            cueAt: null, cueSeq: 0, cueBadSince: null, wasOk: false, fr: { ok: false, issue: null, msg: "" }, frIssue: null, frIssueSince: null, frClearSince: null };
    }
    reset();
    function end(t, reason, creditT) { h.phase = "ended"; h.reason = reason; h.ms = Math.max(0, Math.round((creditT != null ? creditT : t) - h.startT)); }
    function bodyLen(kps) {
      var best = 0; ["left", "right"].forEach(function (s) { var a = pt(kps, s + "_shoulder", o.minScore), b = pt(kps, s + "_ankle", o.minScore); if (a && b) best = Math.max(best, Math.hypot(a.x - b.x, a.y - b.y)); });
      return best;
    }
    // Debounced framing message: shows after frameShowMs of the same issue, clears after frameClearMs of none.
    function framing(g, t) {
      if (g.ok) {
        h.frIssue = null; h.frIssueSince = null;
        if (h.frClearSince == null) h.frClearSince = t;
        if (t - h.frClearSince >= o.frameClearMs) h.fr = { ok: true, issue: null, msg: "" };
      } else {
        h.frClearSince = null;
        if (h.frIssue !== g.issue) { h.frIssue = g.issue; h.frIssueSince = t; }
        if (t - h.frIssueSince >= o.frameShowMs) h.fr = { ok: false, issue: g.issue, msg: g.msg };
      }
    }
    // The clock starts here (cue mode): called by the page right after "Hold plank." has been spoken.
    function begin(t) {
      if (h.phase !== "cue") return false;
      h.phase = "holding"; h.startT = t; h.ms = 0; h.badSince = null; h.missSince = null; live.reset();
      return true;
    }
    function update(kps, t, dims) {
      var raw = kps || [], fk = pf.filter(raw, t);
      var c = classifyPlank(fk, { keep: h.wasOk, sagStart: o.sagStart, sagKeep: o.sagKeep, pikeStart: o.pikeStart, pikeKeep: o.pikeKeep, minScore: o.minScore, kneeAngle: o.kneeAngle, flat: o.flat }), f = c.frame;
      if (f !== "missing") h.wasOk = f === "ok";
      var g = frameGuide(fk, dims, o);
      framing(g, t);
      h.lastT = t;
      if (h.phase === "ended") return out(f);
      if (h.phase === "cue") {
        // Waiting for the cue to be spoken. Still in alignment -> stay; a bad stretch longer than readyGraceMs drops back to ready.
        if (f === "ok" && g.ok) h.cueBadSince = null;
        else {
          if (h.cueBadSince == null) h.cueBadSince = t;
          if (t - h.cueBadSince > o.readyGraceMs) { h.phase = "ready"; h.goodSince = null; h.readyBadSince = null; return out(f); }
        }
        if (t - h.cueAt >= o.cueMaxMs) begin(t);
        return out(f);
      }
      if (h.phase === "ready") {
        if (f === "ok" && g.ok) {
          h.readyBadSince = null;
          if (h.goodSince == null) h.goodSince = t;
          if (t - h.goodSince >= o.readyMs) {
            if (o.cue) { h.phase = "cue"; h.cueAt = t; h.cueSeq += 1; h.cueBadSince = null; } // lock-in: cue first, count after begin()
            else { h.phase = "holding"; h.startT = t; live.reset(); }
          }
        } else if (h.goodSince != null) {
          // one noisy frame must not throw away the countdown: only a bad stretch longer than readyGraceMs does
          if (h.readyBadSince == null) h.readyBadSince = t;
          if (t - h.readyBadSince > o.readyGraceMs) { h.goodSince = null; h.readyBadSince = null; }
        }
        return out(f);
      }
      // holding (framing is never consulted here)
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
        var lv = live.update(raw, t, bodyLen(raw)); // RAW points: smoothing must not make a live person look frozen
        if (lv) { end(t, lv); return out(f); }
      }
      h.ms = Math.round(t - h.startT);
      return out(f);
    }
    function out(f) {
      return { phase: h.phase, ms: h.ms, frame: f, ended: h.phase === "ended", reason: h.reason, cue: h.phase === "cue", cueSeq: h.cueSeq, framing: { ok: h.fr.ok, issue: h.fr.issue, msg: h.fr.msg },
        countdownMs: h.phase === "ready" && h.goodSince != null && h.lastT != null ? Math.max(0, o.readyMs - (h.lastT - h.goodSince)) : null };
    }
    // Manual stop (button) ends the hold with credit up to now.
    function stop(t) { if (h.phase === "holding") end(t, "stopped"); else if (h.phase === "ready" || h.phase === "cue") { h.phase = "ended"; h.reason = "stopped"; } return out(null); }
    return { update: update, begin: begin, stop: stop, reset: reset, state: function () { return h; } };
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

  var api = { PLANK: PLANK, MSG: MSG, classifyPlank: classifyPlank, frameGuide: frameGuide, createPlankFilter: createPlankFilter, hipOffset: hipOffset, createLiveness: createLiveness, createPlankHold: createPlankHold, rankPlanks: rankPlanks, bestOf: bestOf, reasonText: reasonText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatPlank = api;
})(typeof self !== "undefined" ? self : this);
