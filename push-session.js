/* Zabbadat pushup session helpers: pure logic (no DOM, no camera).
 * - tutToAdd: time-under-tension credited when a set/session is saved.
 * - createPostureGuard: One long set rule check (standing up / knees down), debounced.
 *   Flags only; never affects the timer or rep count. */
(function (root) {
  function tutToAdd(mode, elapsedMs, repTutMs) {
    var v = mode === "long" ? Number(elapsedMs) : Number(repTutMs);
    return isFinite(v) && v > 0 ? v : 0;
  }
  // TUT modes (One long set, 3:00 challenge): a camera-detected failure (knees / stood up / out of frame) ends the set and
  // POSTS the time under tension and reps so far (once, same path as End session) when there is at least 1 rep; with 0 reps nothing is posted.
  function postOnFailure(mode, reps) { return (mode === "long" || mode === "challenge") && Number(reps) >= 1; }
  // Stopping the camera while a set / session / 3:00 challenge CLOCK IS RUNNING with at least 1 rep ends it and posts through the same
  // path as the manual Finish / End session (finishPushSet, once). A paused Sets set (user chose Pause, may resume), a finished set,
  // a set with 0 reps, or no running clock: nothing happens (same as before).
  function postOnCameraStop(mode, reps, ps) { return !!ps && !!ps.running && !ps.finished && Number(reps) >= 1 && (mode === "sets" || mode === "long" || mode === "challenge"); }
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
    // A camera looking along the plank sees the legs running straight down the frame, so an upright-looking
    // line only counts when the shoulders have also moved away from the camera.
    if (upright && (!(w && topWidth > 0) || w < 0.8 * topWidth)) return "standing";
    if (knees) return "knees";
    if (w && topWidth > 0) {
      if (w < o.shrink * topWidth) return "standing"; // left the plank: moved far from the camera
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
  // The camera view of a leaned-up phone (upright or flipped). A push-up moves the shoulders and leaves the hands
  // planted, so the wrists stay put. Picking the phone up moves the whole picture together, or tilts the shoulder
  // line. Standing up raises the shoulders off the plank, or brings the hands up off the floor. A clean hold at the
  // top (press plank, elbows up) is allowed a larger rise and hand-jitter than that, so locking out or a front
  // camera wobbling the wrists is not read as standing up. A clear stand-up or hands leaving the floor still is.
  // Shoulder WIDTH shrinking is not one of these (a front camera does that on a long press) and is not read here.
  var VIEW = { minScore: 0.3, lockMs: 350, liftMs: 450, badMs: 1000, deadFrac: 0.045, moveFrac: 0.18, agreeFrac: 0.11, rotDeg: 34, riseFrac: 0.12, handFrac: 0.16, holdRiseFrac: 0.20, holdHandFrac: 0.24 };
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
  function lineDiff(a, b) { var d = Math.abs(angDiff(a, b)); return d > Math.PI / 2 ? Math.PI - d : d; } // a shoulder line has no direction: left/right swap is not a tilt
  function createViewWatch(opts) {
    var o = Object.assign({}, VIEW, opts || {}), s;
    function reset() { s = { base: null, warm: null, pend: null, riseY: null, seen: null }; }
    reset();
    function shoulders(kps) {
      var ls = pt(kps, "left_shoulder", o.minScore), rs = pt(kps, "right_shoulder", o.minScore);
      if (!ls || !rs) return null;
      var sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      if (!(sw > 1)) return null;
      return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, sw: sw, ang: Math.atan2(rs.y - ls.y, rs.x - ls.x) };
    }
    function wrists(kps) {
      var lw = pt(kps, "left_wrist", o.minScore), rw = pt(kps, "right_wrist", o.minScore), n = (lw ? 1 : 0) + (rw ? 1 : 0);
      if (!n) return null;
      return { x: ((lw ? lw.x : 0) + (rw ? rw.x : 0)) / n, y: ((lw ? lw.y : 0) + (rw ? rw.y : 0)) / n, n: n };
    }
    function update(kps, t, frameW, atTop) {
      var W = frameW > 1 ? frameW : 640, sh = shoulders(kps);
      var riseN = atTop ? o.holdRiseFrac : o.riseFrac, handN = atTop ? o.holdHandFrac : o.handFrac;
      if (!sh) { if (!(s.seen != null && t - s.seen < 200)) s.pend = null; return null; }
      s.seen = t;
      var wr = wrists(kps);
      var sample = { x: sh.x, y: sh.y, ang: sh.ang, sw: sh.sw, wx: wr && wr.x, wy: wr && wr.y, n: wr ? wr.n : 0 };
      if (!s.base) {
        if (!s.warm) { s.warm = { x: sample.x, y: sample.y, ang: sample.ang, wx: sample.wx, wy: sample.wy, n: sample.n, t: t, once: false }; s.riseY = sample.y; return null; }
        if (!s.warm.once && t - s.warm.t < 100 && Math.hypot(sample.x - s.warm.x, sample.y - s.warm.y) > o.deadFrac * W) { s.warm = { x: sample.x, y: sample.y, ang: sample.ang, wx: sample.wx, wy: sample.wy, n: sample.n, t: t, once: true }; s.riseY = sample.y; return null; }
        if (t - s.warm.t < o.lockMs) { if (sample.y < s.riseY) s.riseY = sample.y; return null; }
        s.base = { x: s.warm.x, y: s.warm.y, ang: s.warm.ang, wx: s.warm.wx, wy: s.warm.wy, hasW: s.warm.n > 0 };
        if (s.riseY == null) s.riseY = s.warm.y;
      }
      if (sample.n > 0 && !s.base.hasW) { s.base.wx = sample.wx; s.base.wy = sample.wy; s.base.hasW = true; }
      var dx = sample.x - s.base.x, dy = sample.y - s.base.y, dist = Math.hypot(dx, dy);
      var wdx = 0, wdy = 0, wd = 0;
      if (sample.n > 0 && s.base.hasW) { wdx = sample.wx - s.base.wx; wdy = sample.wy - s.base.wy; wd = Math.hypot(wdx, wdy); }
      // Creep only while the picture is still the rested lean, so a slow settle does not become a false pickup
      // and a real move is not followed away.
      if (dist < o.deadFrac * W && wd < o.deadFrac * W && lineDiff(sample.ang, s.base.ang) < 5 * Math.PI / 180) {
        var a = 0.02;
        s.base.x += a * dx; s.base.y += a * dy; s.base.ang += a * angDiff(sample.ang, s.base.ang);
        if (s.base.hasW && sample.n > 0) { s.base.wx += a * wdx; s.base.wy += a * wdy; }
        dx = sample.x - s.base.x; dy = sample.y - s.base.y; dist = Math.hypot(dx, dy);
        if (sample.n > 0 && s.base.hasW) { wdx = sample.wx - s.base.wx; wdy = sample.wy - s.base.wy; wd = Math.hypot(wdx, wdy); }
      }
      var rose = s.riseY == null ? 0 : s.riseY - sample.y;
      if (rose > 0 && rose < o.deadFrac * W) s.riseY -= Math.min(rose, 0.4);
      var kind = null;
      if (sample.n > 0 && s.base.hasW && dist > o.moveFrac * W && wd > o.moveFrac * W && Math.hypot(dx - wdx, dy - wdy) < o.agreeFrac * W) kind = "lifted";
      if (!kind && lineDiff(sample.ang, s.base.ang) * 180 / Math.PI > o.rotDeg) kind = "lifted";
      if (!kind && rose > riseN * W) kind = "standing";
      if (!kind && sample.n >= 2 && s.base.hasW && s.base.wy - sample.wy > handN * W) kind = "standing";
      if (!kind && sample.n >= 2 && sample.y > sample.wy + 0.12 * sample.sw) kind = "collapse";
      if (!kind) { s.pend = null; return null; }
      if (!s.pend || s.pend.kind !== kind) s.pend = { kind: kind, since: t };
      if (t - s.pend.since >= (kind === "lifted" ? o.liftMs : o.badMs)) return kind;
      return null;
    }
    return { update: update, reset: reset, options: o };
  }
  // Form features for the failure watch. line: shoulder-hip-ankle angle (180 = straight plank), knee: hip-knee-ankle,
  // elbowsDown: an elbow at wrist / floor height (forearm flat), i.e. the arms gave out. Normal bending keeps the
  // elbows clearly above the planted hands. Joints below minScore are ignored.
  function formFeatures(kps, minScore, elbowFrac) {
    var min = minScore == null ? 0.3 : minScore, ef = elbowFrac == null ? 0.12 : elbowFrac, ls = pt(kps, "left_shoulder", min), rs = pt(kps, "right_shoulder", min);
    if (!ls && !rs) return null;
    var sw = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : null, out = { line: null, knee: null, elbowsDown: false }, sides = ["left", "right"];
    for (var i = 0; i < 2; i++) {
      var sd = sides[i], sh = pt(kps, sd + "_shoulder", min), hip = pt(kps, sd + "_hip", min), kn = pt(kps, sd + "_knee", min), an = pt(kps, sd + "_ankle", min), el = pt(kps, sd + "_elbow", min), wr = pt(kps, sd + "_wrist", min);
      if (sh && hip && an) { var l = angle(sh, hip, an); if (l != null && (out.line == null || l < out.line)) out.line = l; }
      if (hip && kn && an) { var k = angle(hip, kn, an); if (k != null && (out.knee == null || k < out.knee)) out.knee = k; }
      if (el && wr && sh) { var scale = sw || Math.abs(wr.y - sh.y) || 1; if (el.y >= wr.y - ef * scale && sh.y > el.y - 0.6 * scale) out.elbowsDown = true; }
    }
    return out;
  }
  function elbowsDown(kps, minScore) { var f = formFeatures(kps, minScore); return !!(f && f.elbowsDown); }
  // Straight legs running down the frame (a real stand-up). Needs the legs in view, and the shoulders narrower
  // than the plank, same rule classify() uses. A long press does not end on this while the counter says atTop.
  function isUpright(kps, topWidth, minScore) {
    var min = minScore == null ? GUARD.minScore : minScore, ls = pt(kps, "left_shoulder", min), rs = pt(kps, "right_shoulder", min), upright = false, sides = ["left", "right"];
    for (var i = 0; i < 2; i++) {
      var s = sides[i], sh = pt(kps, s + "_shoulder", min), hip = pt(kps, s + "_hip", min), kn = pt(kps, s + "_knee", min), an = pt(kps, s + "_ankle", min);
      if (!(sh && hip && kn && an)) continue;
      var a = angle(hip, kn, an), dy = Math.abs(an.y - sh.y), dx = Math.abs(an.x - sh.x);
      if (dy > GUARD.upright * dx && a != null && a >= GUARD.kneeAngle) upright = true;
    }
    var w = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : null;
    return !!(upright && (!(w && topWidth > 0) || w < 0.8 * topWidth));
  }
  // Failure watch (One long set, 3:00 challenge, Sets): the set ends when the camera sees
  //  - "knees": hip-knee-ankle bent like kneeling or a collapse (softer than the on-screen flag, still needs the legs),
  //  - "collapse": shoulders dropped through the hands,
  //  - "standing": stood up or took the hands off the floor (shoulders rose, or the hands came up; a clean top hold uses a wider allowance so lockout / wrist jitter is not a stand-up), or an upright body when not held at the top,
  //  - "elbows": the arms gave out, elbows down at wrist / floor height (not a normal bend, never while atTop),
  //  - "form": a clear break against the first-rep baseline (body line / hips sag or pike, or knees bend well past rep 1),
  //  - "frame": no shoulder confidently visible for frameMs (10 s).
  // A bad pose must last badMs (1 s). Picking the phone up is NOT a fail: a view shift or tilt never ends the set. Any good frame restarts that wait.
  // Holding the top must never end a set. Shoulder-width shrink is only a flag (endOn.standing is off): a leaned-up
  // front camera reads a long press that way. Knees that are out of frame or below minScore never trigger.
  // update(kps, t, topWidth, extra). extra may be a frame width, or { frameW, atTop }.
  var FAIL = { badMs: 1000, frameMs: 10000, minScore: 0.3, kneeAngle: 140, endOn: { knees: true, frame: true, standing: false, lifted: false, left: true, upright: true, elbows: true, form: true }, elbowFrac: 0.12, lineDeg: 30, kneeDeg: 35, baseSamples: 8 };
  function createFailureWatch(opts) {
    var o = Object.assign({}, FAIL, opts || {}), guard, seen, failed, view, upSince, base, acc, badSince;
    o.endOn = Object.assign({}, FAIL.endOn, (opts && opts.endOn) || {});
    function formFeats(kps, min) { return formFeatures(kps, min, o.elbowFrac); }
    function avgFeats(a) { var r = {}; ["line", "knee"].forEach(function (k) { var n = 0, v = 0; a.forEach(function (x) { if (x[k] != null) { n++; v += x[k]; } }); r[k] = n ? v / n : null; }); r.samples = a.length; return r; }
    function reset(t0) {
      guard = createPostureGuard(Object.assign({}, o.guard || {}, { holdMs: o.badMs, minScore: o.minScore, kneeAngle: o.kneeAngle }));
      seen = t0 == null ? null : t0; failed = null; upSince = null; base = null; acc = []; badSince = null; view = createViewWatch({ minScore: o.minScore, badMs: o.badMs }); view.reset();
    }
    reset(null);
    function upper(kps) { for (var i = 0; i < (kps || []).length; i++) { var k = kps[i]; if (k && /shoulder$/.test(k.name) && (k.score == null || k.score >= o.minScore)) return true; } return false; }
    function update(kps, t, topWidth, extra) {
      if (failed) return failed;
      var frameW = 640, atTop = false;
      if (typeof extra === "number" && isFinite(extra)) frameW = extra;
      else if (extra && typeof extra === "object") { if (extra.frameW > 1) frameW = extra.frameW; atTop = extra.atTop === true; }
      if (seen == null) seen = t;
      if (upper(kps)) seen = t; else if (o.endOn.frame && t - seen >= o.frameMs) return (failed = "frame");
      var g = guard.update(kps, t, topWidth);
      if (g.event === "knees" && o.endOn.knees) return (failed = "knees");
      var v = view.update(kps, t, frameW, atTop);
      // v === "lifted" (phone picked up / camera moved) is deliberately ignored: only form breaks end the set.
      var reps = extra && typeof extra === "object" && typeof extra.reps === "number" ? extra.reps : null;
      var f = formFeats(kps, o.minScore);
      // First-rep baseline: average the top frames once rep 1 has counted, lock at rep 2 or baseSamples frames.
      if (!base && reps != null && reps >= 1 && f) {
        if (atTop || reps >= 2) { acc.push(f); }
        if (acc.length >= o.baseSamples || (reps >= 2 && acc.length)) base = avgFeats(acc);
      }
      var bad = null;
      if (!atTop && o.endOn.elbows && f && f.elbowsDown) bad = "elbows";
      else if (base && f && o.endOn.form) {
        if (base.line != null && f.line != null && base.line - f.line > o.lineDeg) bad = "form";
        else if (base.knee != null && f.knee != null && base.knee - f.knee > o.kneeDeg) bad = "form";
      }
      if (bad) { if (!badSince || badSince.kind !== bad) badSince = { kind: bad, t: t }; if (t - badSince.t >= o.badMs) return (failed = bad); }
      else badSince = null;
      if (v === "standing" && o.endOn.left) return (failed = "standing");
      if (v === "collapse" && o.endOn.knees) return (failed = "collapse");
      if (!atTop && o.endOn.upright && isUpright(kps, topWidth, o.minScore)) { if (upSince == null) upSince = t; if (t - upSince >= o.badMs) return (failed = "standing"); }
      else upSince = null;
      return null;
    }
    return { update: update, reset: reset, failed: function () { return failed; }, baseline: function () { return base; } };
  }
  // 30-second top-hold reward: one continuous hold at the top (press / plank) for holdMs earns the bonus ONCE per set.
  // update(atTop, t, kneesDown) -> { holdMs, awarded (true only on the frame it is earned), done }. Leaving the top or knees down
  // restarts the hold; bestMs retains the longest measured continuous hold, including beyond the bonus.
  // reset() at each new set. Holding never ends the set.
  var HOLD_REWARD = { holdMs: 30000, zab: 0.5 };
  function createHoldReward(opts) {
    var o = Object.assign({}, HOLD_REWARD, opts || {}), s;
    function reset() { s = { since: null, done: false, bestMs: 0 }; }
    reset();
    function update(atTop, t, kneesDown) {
      if (!atTop || kneesDown) { s.since = null; return { holdMs: 0, awarded: false, done: s.done }; }
      if (s.since == null) s.since = t;
      var h = t - s.since, aw = !s.done && h >= o.holdMs;
      s.bestMs = Math.max(s.bestMs, h);
      if (aw) s.done = true;
      return { holdMs: h, awarded: aw, done: s.done };
    }
    return { update: update, reset: reset, options: o, state: function () { return s; } };
  }
  var FAIL_TEXT = { knees: "Knees down", collapse: "Collapsed", standing: "Stood up / left plank", frame: "Out of frame", gaveup: "Gave up", elbows: "Elbows down", form: "Form broke" };
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

  var api = { tutHistory: tutHistory, rankTut: rankTut, tutToAdd: tutToAdd, postOnFailure: postOnFailure, postOnCameraStop: postOnCameraStop, setsToAdd: setsToAdd, canSwitchMode: canSwitchMode, classify: classify, createPostureGuard: createPostureGuard, createFailureWatch: createFailureWatch, createViewWatch: createViewWatch, formFeatures: formFeatures, elbowsDown: elbowsDown, createHoldReward: createHoldReward, HOLD_REWARD: HOLD_REWARD, FAIL: FAIL, FAIL_TEXT: FAIL_TEXT, GUARD: GUARD, VIEW: VIEW };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatSession = api;
})(this);
