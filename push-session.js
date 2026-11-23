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

  // kneeMin: a hip / knee / ankle only counts toward a knees-down or upright call when it is CONFIDENTLY seen (Apple Vision
// and MoveNet both report half-guessed legs at low scores when the legs are hidden behind the body on a front camera).
// minFrames: a knees / standing call needs this many consecutive frames as well as holdMs, so one or two odd frames
// (a landmark flicker, a missed frame) never add up to a fail.
var GUARD = { hiddenKneeFold: true, minScore: 0.4, kneeMin: 0.5, minFrames: 5, holdMs: 500, rearmMs: 300, kneeAngle: 130, foldFrac: 0.45, upright: 2, shrink: 0.55, weakKneeMin: 0.28, floorFrac: 0.12, hipUpFrac: 0.18, frontHipFrac: 0.22, frontSwFrac: 0.4 };
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
  // Front-facing kneel / sit-back: hips have dropped to roughly knee height. Used when the side-view
  // hip-knee-ankle angle is missing or stays near 180° because the bend is into the camera (depth).
  // scale is shoulder width or topWidth. Tight on purpose so a foreshortened plank (knees farther and
  // lower than the hips) does not trip it.
  function foldedLegs(hip, kn, an, o, scale) {
    if (!hip || !kn) return false;
    var s = scale > 1 ? scale : 80;
    var gap = Math.abs((kn.y || 0) - (hip.y || 0));
    return gap < (o.foldFrac || 0.45) * s;
  }

  function rawPt(kps, name) {
    for (var i = 0; i < (kps || []).length; i++) { var k = kps[i]; if (k && k.name === name) return k; }
    return null;
  }
  function scored(k, min) { return k && (k.score == null || k.score >= min) ? k : null; }
  // Planted-hand height (the floor line in a push-up or plank). Missing wrists: no floor line, never guess from the ankle.
  function floorY(kps, min) {
    var lw = pt(kps, "left_wrist", min), rw = pt(kps, "right_wrist", min);
    if (lw && rw) return Math.max(lw.y, rw.y);
    return lw ? lw.y : rw ? rw.y : null;
  }
  function bodyScale(sh, hip, an, sw) {
    var s = 0;
    if (sh && an) s = Math.max(s, Math.hypot(an.x - sh.x, an.y - sh.y));
    if (sh && hip) s = Math.max(s, Math.hypot(hip.x - sh.x, hip.y - sh.y) * 2);
    if (sw > 1) s = Math.max(s, sw * 2);
    return s > 1 ? s : 80;
  }
  function nearFloor(p, fy, scale, frac) {
    return !!(p && fy != null && scale > 0 && p.y >= fy - (frac == null ? 0.12 : frac) * scale);
  }
  // Knees (or another joint) close to the planted-hand floor line, above or slightly below. One-sided
  // nearFloor is also true once the hands leave the floor and rise (a stand-up): wrists come up, every
  // joint below them would look "on the floor". This two-sided check is the drop-to-knees cue.
  function atFloor(p, fy, scale, frac) {
    return !!(p && fy != null && scale > 0 && Math.abs(p.y - fy) <= (frac == null ? 0.12 : frac) * scale);
  }
  function isFrontView(sw, sh, hip, o) {
    if (!(sw > 40 && sh && hip)) return false;
    var torso = Math.hypot(hip.x - sh.x, hip.y - sh.y);
    return torso > 0 && sw > (o.frontSwFrac == null ? 0.4 : o.frontSwFrac) * torso;
  }
  // Knees-down when the knee landmark is missing or below kneeMin. A weak knee is only trusted with a
  // confident hip and the knee or ankle on the floor line (wrist height). Hidden-leg guesses at very
  // low scores (hip and knee both ~0.2) never qualify. Front-facing: hips dropped to the hands, or the
  // knees themselves on the floor line (a drop-to-knees can leave the hips high).
  function kneesFallback(hip, knRaw, anRaw, sh, fy, sw, o) {
    o = o || GUARD;
    var weakMin = o.weakKneeMin == null ? 0.28 : o.weakKneeMin;
    var legMin = Math.max(o.minScore || 0, o.kneeMin == null ? 0 : o.kneeMin);
    var kn = scored(knRaw, legMin), knWeak = scored(knRaw, weakMin);
    // Apple Vision often reports a real ankle / knee in the 0.3-0.49 band (below kneeMin 0.5). Trust those at weakMin;
    // a caller may pass either a raw joint or an already-thresholded one.
    var an = scored(anRaw, weakMin) || scored(anRaw, o.minScore == null ? 0.3 : o.minScore);
    var sc = bodyScale(sh, hip, an || knWeak, sw);
    var floorF = o.floorFrac == null ? 0.12 : o.floorFrac;
    if (hip && knWeak && an) {
      var a = angle(hip, knWeak, an);
      // Knee on the planted-hand floor line = a real kneel (drop-to-knees can leave the hips high). Knee at the
      // same height as the ankle is only a floor cue in a side view, or with the hips already dropped: from the
      // front, that same-height pair is the foreshortened plank (legs running away from the lens).
      var knAtHands = atFloor(knWeak, fy, sc, floorF);
      var knAtAnkle = an && Math.abs((knWeak.y || 0) - an.y) < floorF * sc;
      var fbHipLow = fy != null && sw > 1 && fy - hip.y < (o.foldFloorFrac == null ? 0.5 : o.foldFloorFrac) * sw;
      if (a != null && a < (o.kneeAngle || 140) && (knAtHands || (knAtAnkle && (o.hiddenKneeFold !== true || fbHipLow || !isFrontView(sw, sh, hip, o))))) return true;
    }
    // Hidden knee, side view (fix Nov 16, owner report: a clean set ended "Knees down" mid-set). Hips above the hands with
    // the feet on the floor is ALSO a normal plank / push-up top, so that alone is not a kneel: the legs must read FOLDED,
    // i.e. the shoulder-hip-ankle line bent at the hip AND the hip-to-ankle span short against the torso (thigh dropped to
    // the floor). A straight body line with a weak / missing knee is never knees-down.
    if (hip && an && !kn && fy != null && (o.hiddenKneeFold !== true || sh)) {
      var hipUp = (fy - hip.y) > (o.hipUpFrac == null ? 0.18 : o.hipUpFrac) * sc;
      var bodyLine = sh ? angle(sh, hip, an) : null, torso = sh ? Math.hypot(hip.x - sh.x, hip.y - sh.y) : 0, legSpan = Math.hypot(an.x - hip.x, an.y - hip.y);
      var folded = bodyLine != null && bodyLine < (o.foldLineDeg == null ? 160 : o.foldLineDeg) && torso > 1 && legSpan < (o.foldLegFrac == null ? 1.2 : o.foldLegFrac) * torso;
      if (hipUp && (o.hiddenKneeFold !== true || folded) && nearFloor(an, fy, sc, floorF)) return true;
    }
    // Front view: hips dropped to the hands while the shoulders are still up at plank height. The bottom of a normal
    // push-up (shoulders down by the hands, hips low and far away) is not a kneel.
    if (isFrontView(sw, sh, hip, o) && hip && fy != null) {
      var gap = Math.abs(fy - hip.y), fs = sw > 1 ? sw : sc;
      var shUp = (fy - sh.y) > (o.frontShUpFrac == null ? 0.8 : o.frontShUpFrac) * fs;
      if (shUp && gap < (o.frontHipFrac == null ? 0.22 : o.frontHipFrac) * fs) return true;
    }
    return false;
  }
  function minKnee3D(k3) {
    if (!k3) return null;
    var vals = [k3.left, k3.right, k3.L, k3.R].map(Number).filter(function (n) { return isFinite(n); });
    return vals.length ? Math.min.apply(null, vals) : null;
  }
    // Classify one frame: "standing", "knees", "ok" (plank, confident) or null (uncertain).
  function classify(kps, topWidth, o) {
    o = o || GUARD;
    var ls = pt(kps, "left_shoulder", o.minScore), rs = pt(kps, "right_shoulder", o.minScore);
    var w = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : null;
    var foldScale = w || (topWidth > 0 ? topWidth : null);
    var known = false;
    var sides = ["left", "right"], knees = false, upright = false;
    var fy = floorY(kps, o.minScore);
    for (var i = 0; i < 2; i++) {
      var legMin = Math.max(o.minScore, o.kneeMin == null ? 0 : o.kneeMin);
      var s = sides[i], sh = pt(kps, s + "_shoulder", o.minScore), hip = pt(kps, s + "_hip", legMin),
          kn = pt(kps, s + "_knee", legMin), an = pt(kps, s + "_ankle", legMin), knRaw = rawPt(kps, s + "_knee");
      var hipLow = !!(hip && fy != null && foldScale > 1 && fy - hip.y < (o.foldFloorFrac == null ? 0.5 : o.foldFloorFrac) * foldScale);
      var knWeak = scored(knRaw, o.weakKneeMin == null ? 0.28 : o.weakKneeMin);
      var knOnFloor = atFloor(kn || knWeak, fy, bodyScale(sh, hip, an || knWeak, foldScale), o.floorFrac);
      if (hip && kn && an) {
        known = true;
        var a = angle(hip, kn, an);
        // Nov 17 (owner): from the front camera, straight legs running away from the lens read bent in 2D while the
        // knees stay well above the hands. With hiddenKneeFold, a front-view knee angle counts only when this is a
        // real kneel: the hips have dropped to the floor line (hand height), OR the knees themselves are on that
        // floor line (drop-to-knees with the thighs still up). A foreshortened plank has neither.
        if (a != null && a < o.kneeAngle && (o.hiddenKneeFold !== true || hipLow || knOnFloor || !isFrontView(w, sh, hip, o))) knees = true;
        if (sh) { var dy = Math.abs(an.y - sh.y), dx = Math.abs(an.x - sh.x); if (dy > o.upright * dx && a != null && a >= o.kneeAngle) upright = true; }
      } else if (hip && kn) {
        // Front camera: ankles are often missing or below kneeMin. A kneel still shows the hips dropped to about
        // knee height, or the knees on the floor line with a bent leg (when a weak ankle is seen).
        known = true;
        // Nov 17 (owner, real iPhone): a front / three-quarter camera sees straight plank legs running AWAY from the lens, so
        // the knee projects at about hip height ("folded") while the hips stay high above the planted hands. With no ankle,
        // that is only a kneel when the hips have dropped to the floor line or the knees are on it. A visible ankle on a
        // straight leg (even a weak one) is not a kneel. Missing wrists = no floor line = never a fail from knOnFloor.
        // Opt-in with hiddenKneeFold (push-up sets / TUT); plank keeps its own classifyPlank rule.
        var anWeak = scored(rawPt(kps, s + "_ankle"), o.weakKneeMin == null ? 0.28 : o.weakKneeMin);
        var floorBent = knOnFloor && (!anWeak || (function (a) { return a != null && a < o.kneeAngle; })(angle(hip, kn, anWeak)));
        if (floorBent || (foldedLegs(hip, kn, null, o, foldScale) && (o.hiddenKneeFold !== true || hipLow))) knees = true;
      } else if (hip && knWeak && knOnFloor) {
        // iOS Vision: the knee is often 0.3-0.49 (below kneeMin) on a real drop-to-knees. Knees on the floor
        // line count; if an ankle is also seen, the leg must actually be bent (a straight front/top-down
        // plank can place the knees near the hands in 2D).
        var anW = scored(rawPt(kps, s + "_ankle"), o.weakKneeMin == null ? 0.28 : o.weakKneeMin);
        if (!anW || (function (a) { return a != null && a < o.kneeAngle; })(angle(hip, knWeak, anW))) { known = true; knees = true; }
      }
      // Occluded or low-visibility knees: hip-to-ankle / floor line / front hip-drop, never a low-score full-leg guess.
      // Pass the raw ankle so Vision scores in the weak band still reach kneesFallback (kneeMin would drop them).
      if (!knees && hip && kneesFallback(hip, knRaw, rawPt(kps, s + "_ankle") || an, sh, fy, foldScale, o)) { known = true; knees = true; }
    }
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
    function reset() { g = { count: 0, armed: true, pending: null, since: null, frames: 0, okSince: null, active: null, events: [] }; }
    reset();
    function update(kps, t, topWidth) {
      var c = classify(kps, topWidth, o), ev = null;
      if (c === "standing" || c === "knees") {
        g.okSince = null;
        if (g.pending !== c) { g.pending = c; g.since = t; g.frames = 0; }
        g.frames += 1;
        if (g.armed && t - g.since >= o.holdMs && g.frames >= (o.minFrames || 1)) {
          g.armed = false; g.count += 1; g.active = c; ev = c; g.events.push({ type: c, t: t });
        }
      } else if (c === "ok") {
        g.pending = null; g.since = null; g.frames = 0;
        if (g.okSince == null) g.okSince = t;
        if (!g.armed && t - g.okSince >= o.rearmMs) { g.armed = true; g.active = null; }
      } else { g.pending = null; g.since = null; g.frames = 0; g.okSince = null; } // uncertain (legs missing / low confidence): no flag, no re-arm
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
  var VIEW = { minScore: 0.3, lockMs: 350, liftMs: 450, badMs: 1000, deadFrac: 0.045, moveFrac: 0.18, agreeFrac: 0.11, rotDeg: 34, riseFrac: 0.12, handFrac: 0.16, holdRiseFrac: 0.20, holdHandFrac: 0.24, chestMs: 4000, chestFloorFrac: 0.02, chestUpFrac: 0.015 };
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
  function lineDiff(a, b) { var d = Math.abs(angDiff(a, b)); return d > Math.PI / 2 ? Math.PI - d : d; } // a shoulder line has no direction: left/right swap is not a tilt
  function createViewWatch(opts) {
    var o = Object.assign({}, VIEW, opts || {}), s;
    function reset() { s = { base: null, warm: null, pend: null, riseY: null, seen: null, chest: null, liftT: null }; }
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
      // Chest on the floor (owner, Nov 16): a proper rep brings the chest near the floor, so being there never ends a set by
      // itself. It is a collapse only when the shoulders stay at floor level (within chestFloorFrac x frame width of the hand
      // line, or below it) with NO upward progress for chestMs (4 s) continuous. Any rise of chestUpFrac x frame width above
      // the lowest point in that stretch (pressing back up), or leaving floor level, restarts the 4 s.
      // Checked on its own, before the pickup / standing reads: a noisy side-on shoulder line (the two shoulders a few px apart)
      // can read as a tilt, and that must not restart the clock.
      if (sample.n >= 1 && sample.wy != null && sample.y >= sample.wy - o.chestFloorFrac * W) {
        if (!s.chest || s.chest.lowY - sample.y > o.chestUpFrac * W) s.chest = { since: t, lowY: sample.y };
        else if (sample.y > s.chest.lowY) s.chest.lowY = sample.y;
        if (t - s.chest.since >= o.chestMs) return "collapse";
      } else s.chest = null;
      var kind = null;
      if (sample.n > 0 && s.base.hasW && dist > o.moveFrac * W && wd > o.moveFrac * W && Math.hypot(dx - wdx, dy - wdy) < o.agreeFrac * W) kind = "lifted";
      if (!kind && lineDiff(sample.ang, s.base.ang) * 180 / Math.PI > o.rotDeg) kind = "lifted";
      if (!kind && rose > riseN * W) kind = "standing";
      if (!kind && sample.n >= 2 && s.base.hasW && s.base.wy - sample.wy > handN * W) kind = "standing";
      // Nov 20: remembered for the set-end watch (a pickup is never "stuck" / "left the frame"). Only a real camera move: the
      // shoulders AND hands shifting together, or a tilt of a shoulder line wide enough to measure (>= 8% of the frame); a
      // side-on view (shoulders a few px apart) reads a noisy "tilt" every frame and must not suppress the set end.
      if (kind === "lifted" && (dist > o.moveFrac * W && wd > o.moveFrac * W || sample.sw >= 0.08 * W)) s.liftT = t;
      if (!kind) { s.pend = null; return null; }
      if (!s.pend || s.pend.kind !== kind) s.pend = { kind: kind, since: t };
      if (t - s.pend.since >= (kind === "lifted" ? o.liftMs : o.badMs)) return kind;
      return null;
    }
    return { update: update, reset: reset, options: o, liftedAt: function () { return s.liftT; } };
  }
  // Form features for the failure watch. line: shoulder-hip-ankle angle (180 = straight plank), knee: hip-knee-ankle,
  // elbowsDown: an elbow at wrist / floor height (forearm flat), i.e. the arms gave out. Normal bending keeps the
  // elbows clearly above the planted hands. Joints below minScore are ignored.
  function formFeatures(kps, minScore, elbowFrac, kneeMin) {
    var min = minScore == null ? 0.3 : minScore, legMin = Math.max(min, kneeMin == null ? 0 : kneeMin), ef = elbowFrac == null ? 0.12 : elbowFrac, ls = pt(kps, "left_shoulder", min), rs = pt(kps, "right_shoulder", min);
    if (!ls && !rs) return null;
    var sw = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : null, out = { line: null, knee: null, elbowsDown: false, sag: false }, sides = ["left", "right"];
    for (var i = 0; i < 2; i++) {
      var sd = sides[i], sh = pt(kps, sd + "_shoulder", min), hip = pt(kps, sd + "_hip", legMin), kn = pt(kps, sd + "_knee", legMin), an = pt(kps, sd + "_ankle", legMin), el = pt(kps, sd + "_elbow", min), wr = pt(kps, sd + "_wrist", min);
      if (sh && hip && an) { var l = angle(sh, hip, an); if (l != null && (out.line == null || l < out.line)) { out.line = l; var dxl = an.x - sh.x; out.sag = Math.abs(dxl) > 1 ? hip.y > sh.y + (an.y - sh.y) * (hip.x - sh.x) / dxl : false; } }
      if (hip && kn && an) { var k = angle(hip, kn, an); if (k != null && (out.knee == null || k < out.knee)) out.knee = k; }
      if (el && wr && sh) { var scale = sw || Math.abs(wr.y - sh.y) || 1; if (el.y >= wr.y - ef * scale && sh.y > el.y - 0.6 * scale) out.elbowsDown = true; }
    }
    return out;
  }
  function elbowsDown(kps, minScore) { var f = formFeatures(kps, minScore); return !!(f && f.elbowsDown); }
  // Straight legs running down the frame (a real stand-up). Needs the legs in view, and the shoulders narrower
  // than the plank, same rule classify() uses. A long press does not end on this while the counter says atTop.
  function isUpright(kps, topWidth, minScore, kneeMin) {
    var min = minScore == null ? GUARD.minScore : minScore, legMin = Math.max(min, kneeMin == null ? 0 : kneeMin), ls = pt(kps, "left_shoulder", min), rs = pt(kps, "right_shoulder", min), upright = false, sides = ["left", "right"];
    for (var i = 0; i < 2; i++) {
      var s = sides[i], sh = pt(kps, s + "_shoulder", min), hip = pt(kps, s + "_hip", legMin), kn = pt(kps, s + "_knee", legMin), an = pt(kps, s + "_ankle", legMin);
      if (!(sh && hip && kn && an)) continue;
      var a = angle(hip, kn, an), dy = Math.abs(an.y - sh.y), dx = Math.abs(an.x - sh.x);
      if (dy > GUARD.upright * dx && a != null && a >= GUARD.kneeAngle) upright = true;
    }
    var w = ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : null;
    return !!(upright && (!(w && topWidth > 0) || w < 0.8 * topWidth));
  }
  // Failure watch (One long set, 3:00 challenge, Sets). Owner rule (Nov 16): a push-up set ends ONLY on a definitive break:
  //  - "knees": hip-knee-ankle bent like kneeling, or, when the knee is occluded or below kneeMin, a confident hip plus folded legs
  //    (body line bent at the hip, short hip-to-ankle span) with the ankle on the floor line, or a front-view hip drop to the hands
  //    with the shoulders still up, or a front-view drop-to-knees with the knees on the floor line even if the hips stay up.
  //    A weak / missing knee on a straight body never counts.
  //  - "collapse": hard hip sag (hips below the shoulder-ankle line, line >= sagDeg 35 deg worse than the first-rep baseline, held
  //    sagMs 1.5 s), or the chest staying at floor level with no upward progress for 4 s (createViewWatch chestMs).
  //  - "standing": stood all the way up (straight legs running down the frame, off the top), or shoulders rose / hands came up.
  // NOT ends: elbows, pike, knee-bend drift, minor wobbles, out of frame (losing tracking pauses counting), phone pickup, rep target.
  // (endOn.elbows / form / frame stay available as options, all off.) A bad pose must last badMs (1 s) unless noted.
  // Holding the top must never end a set. Shoulder-width shrink is only a flag (endOn.standing is off).
  // update(kps, t, topWidth, extra). extra may be a frame width, or { frameW, atTop }.
  // gapMs (Nov 16): a dropout shorter than this (no shoulder seen: a missed frame, a brief occlusion) neither counts toward nor
  // restarts any fail window, so noisy tracking cannot hide a real break and a dropout can never cause one. formKeep: hysteresis,
  // once a form-break window is open it stays open while the break is at least formKeep x the threshold (noise near the line).
  // okGraceMs / badRatio: a form-break window survives good-looking frames shorter than okGraceMs (one noisy "good" frame
  // inside a real break), but only ends the set when at least badRatio of its frames were bad.
  var FAIL = { hiddenKneeFold: true, sagDeg: 35, sagMs: 1500, gapMs: 300, formKeep: 0.8, okGraceMs: 150, badRatio: 0.75, badMs: 1000, frameMs: 10000, minScore: 0.3, kneeMin: 0.5, minFrames: 5, kneeAngle: 140, foldFrac: 0.45, endOn: { knees: true, frame: false, standing: false, lifted: false, left: true, upright: true, elbows: false, form: false, sag: true }, elbowFrac: 0.12, lineDeg: 30, kneeDeg: 35, baseSamples: 8, weakKneeMin: 0.28, floorFrac: 0.12, hipUpFrac: 0.18, frontHipFrac: 0.22, frontSwFrac: 0.4 };
  function createFailureWatch(opts) {
    var o = Object.assign({}, FAIL, opts || {}), guard, seen, failed, failAt, view, upSince, upN, base, acc, badSince, foldSince, k3Since, k3N;
    o.endOn = Object.assign({}, FAIL.endOn, (opts && opts.endOn) || {});
    o.guard = Object.assign({}, o.guard || {}, { foldFrac: o.foldFrac });
    function formFeats(kps, min) { return formFeatures(kps, min, o.elbowFrac, o.kneeMin); }
    // A leg (hip + knee on the same side) confidently in the 2D picture. Apple Vision's 3D request always returns a
    // full skeleton, GUESSING the legs when they are hidden (front camera, legs behind the body): those guessed knees
    // read bent, so the 3D knee angle is trusted only on frames where a real knee is seen.
    function legSeen(kps) {
      var m = Math.max(o.minScore, o.kneeMin == null ? 0 : o.kneeMin);
      return (!!pt(kps, "left_hip", m) && !!pt(kps, "left_knee", m)) || (!!pt(kps, "right_hip", m) && !!pt(kps, "right_knee", m));
    }
    function avgFeats(a) { var r = {}; ["line", "knee"].forEach(function (k) { var n = 0, v = 0; a.forEach(function (x) { if (x[k] != null) { n++; v += x[k]; } }); r[k] = n ? v / n : null; }); r.samples = a.length; return r; }
    function mark(reason, at) { failed = reason; failAt = at != null ? at : null; return failed; }
    function reset(t0) {
      guard = createPostureGuard(Object.assign({}, o.guard || {}, { holdMs: o.badMs, minScore: o.minScore, kneeMin: o.kneeMin, minFrames: o.minFrames, kneeAngle: o.kneeAngle, foldFrac: o.foldFrac, weakKneeMin: o.weakKneeMin, floorFrac: o.floorFrac, hipUpFrac: o.hipUpFrac, frontHipFrac: o.frontHipFrac, frontSwFrac: o.frontSwFrac, hiddenKneeFold: o.hiddenKneeFold }));
      seen = t0 == null ? null : t0; failed = null; failAt = null; upSince = null; upN = 0; base = null; acc = []; badSince = null; foldSince = null; k3Since = null; k3N = 0; view = createViewWatch({ minScore: o.minScore, badMs: o.badMs }); view.reset();
    }
    reset(null);
    function upper(kps) { for (var i = 0; i < (kps || []).length; i++) { var k = kps[i]; if (k && /shoulder$/.test(k.name) && (k.score == null || k.score >= o.minScore)) return true; } return false; }
    function update(kps, t, topWidth, extra) {
      if (failed) return failed;
      var frameW = 640, atTop = false;
      var skipFrame = false;
      if (typeof extra === "number" && isFinite(extra)) frameW = extra;
      else if (extra && typeof extra === "object") { if (extra.frameW > 1) frameW = extra.frameW; atTop = extra.atTop === true; skipFrame = extra.skipFrame === true; }
      if (seen == null) seen = t;
      if (upper(kps)) seen = t; else if (o.endOn.frame && !skipFrame && t - seen >= o.frameMs) return mark("frame", seen);
      else if (t - seen < o.gapMs) return null; // brief dropout: hold every window as it is
      var g = guard.update(kps, t, topWidth);
      // 3D knee angle from Apple Vision (app, iOS 17+): a real kneel is visible even when 2D looks straight.
      var k3 = extra && typeof extra === "object" ? minKnee3D(extra.knee3D || extra.pose3d && extra.pose3d.kneeAngleDeg) : null;
      // When Vision's depth-aware 3D knees say STRAIGHT, a 2D "knees" call (hips near knee height in a foreshortened
      // front-camera plank) is not a kneel.
      if (g.event === "knees" && o.endOn.knees && !(k3 != null && k3 >= o.kneeAngle)) return mark("knees", g.since != null ? g.since : t - o.badMs);
      // Only a sustained, confident kneel ends the set: every frame in the window must show a real knee AND a bent 3D
      // knee; a frame with the legs missing / low confidence restarts the window (never counts toward a fail).
      if (o.endOn.knees && k3 != null && k3 < o.kneeAngle && legSeen(kps)) {
        if (k3Since == null) { k3Since = t; k3N = 0; }
        k3N += 1;
        if (t - k3Since >= o.badMs && k3N >= (o.minFrames || 1)) return mark("knees", k3Since);
      } else { k3Since = null; k3N = 0; }
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
        var hk = badSince && badSince.kind === "form" ? o.formKeep : 1;
        if (base.line != null && f.line != null && base.line - f.line > o.lineDeg * hk) bad = "form";
        else if (base.knee != null && f.knee != null && base.knee - f.knee > o.kneeDeg * hk) bad = "form";
      }
      // Hard hip-sag collapse (owner, Nov 16): the hips dropped BELOW the shoulder-ankle line with the body line bent at least
      // sagDeg (35 deg) more than the first-rep baseline, held sagMs (1.5 s, >= 75% of frames). A pike (hips up), a brief dip
      // or a normal rep never qualifies. Reported as "collapse".
      if (!bad && base && f && o.endOn.sag && base.line != null && f.line != null && f.sag) {
        var sk = badSince && badSince.kind === "collapse" ? o.formKeep : 1;
        if (base.line - f.line > o.sagDeg * sk) bad = "collapse";
      }
      var needMs = bad === "collapse" ? o.sagMs : o.badMs;
      if (bad) { if (!badSince || badSince.kind !== bad) badSince = { kind: bad, t: t, n: 0, tot: 0, okT: null }; badSince.n += 1; badSince.tot += 1; badSince.okT = null; if (t - badSince.t >= needMs && badSince.n >= (o.minFrames || 1) && badSince.n >= o.badRatio * badSince.tot) return mark(bad, badSince.t); }
      else if (badSince) { badSince.tot += 1; if (badSince.okT == null) badSince.okT = t; if (t - badSince.okT > o.okGraceMs) badSince = null; }
      if (v === "standing" && o.endOn.left) return mark("standing", t - o.badMs);
      if (v === "collapse" && o.endOn.knees) return mark("collapse", t - (view.options.chestMs || o.badMs)); // chest stayed on the floor 4 s with no press
      if (!atTop && o.endOn.upright && isUpright(kps, topWidth, o.minScore, o.kneeMin)) { if (upSince == null) { upSince = t; upN = 0; } upN += 1; if (t - upSince >= o.badMs && upN >= (o.minFrames || 1)) return mark("standing", upSince); }
      else { upSince = null; upN = 0; }
      return null;
    }
    return { update: update, reset: reset, failed: function () { return failed; }, failedAt: function () { return failAt; }, baseline: function () { return base; }, liftedAt: function () { return view && view.liftedAt ? view.liftedAt() : null; } };
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
  var FAIL_TEXT = { knees: "Knees down", collapse: "Collapsed", standing: "Stood up / left plank", frame: "Out of frame", gaveup: "Gave up", elbows: "Elbows down", form: "Form broke", stalled: "No push-up for a while", failed: "Failed: could not push back up", ended: "Ended by you" };
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

  // TUT set completion (owner rule, Nov 13): the clock reaches 1:20 (80 s) AND at least 10 push-ups were done. These are
  // MINIMUMS, not a cap: the set keeps going past 1:20 and the full final time and full rep count are what get saved.
  // Sets ending before 1:20 or with fewer than 10 push-ups are not completed TUT sets (they still save as an ordinary "long" set).
  var TUT_DONE = { minMs: 80000, minReps: 10 };
  function tutCompleted(mode, ms, reps) { return mode === "long" && Number(ms) >= TUT_DONE.minMs && Number(reps) >= TUT_DONE.minReps; }
  // A saved row (Firestore pushups doc or local record) is a completed TUT set. Firestore docs carry no category field
  // (the pushups create rule does not allow it); One long set docs are the ones with tutMs > 0 (tutMs = full set time).
  function isTutSetDoc(r) {
    if (!r) return false;
    var longSet = r.category === "tut-set" || r.category === "long" || Number(r.tutMs) > 0;
    return longSet && Number(r.ms) >= TUT_DONE.minMs && Number(r.reps) >= TUT_DONE.minReps;
  }
  // Lifetime completed TUT sets for one uid.
  function tutLifetime(rows, uid) { var n = 0; (rows || []).forEach(function (r) { if (r && (!uid || r.uid === uid) && isTutSetDoc(r)) n++; }); return n; }
  // Regular plank TUT: one continuous hold of 80 s or more (holdSec or ms). kind "plank" marks query rows.
  function isPlankTutDoc(r) {
    if (!r) return false;
    if (r.kind && r.kind !== "plank") return false;
    if (r.kind === "plank") return (Number(r.holdSec) >= 80) || (Number(r.ms) >= 80000);
    if (r.holdSec != null && r.tutMs == null && (r.reps == null || r.reps === 0) && !isTutSetDoc(r)) {
      return Number(r.holdSec) >= 80 || Number(r.ms) >= 80000;
    }
    return false;
  }
  function plankTutLifetime(rows, uid) { var n = 0; (rows || []).forEach(function (r) { if (r && (!uid || r.uid === uid) && isPlankTutDoc(r)) n++; }); return n; }
  function plankMark(n) { n = Number(n) || 0; return n > 0 ? " \u00b7 " + n + " plank" : ""; }
  // All-time TUT sets board (owner, Nov 14): completed TUT sets per person across ALL pushups docs (the page reads every
  // One long set doc with tutMs >= 80000, no limit; this filters with isTutSetDoc so 1:20 + 10 push-ups is the one rule).
  // One row per uid (rows without a uid are skipped: every posted set is signed in). Name = that person's latest name.
  // Ranked by sets, most first; ties share a rank (1, 1, 3) and sort by name. -> [{ rank, uid, name, sets }]
  function tutAllTime(rows, n) {
    var by = {}, list = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.uid) return;
      var plank = isPlankTutDoc(r), push = isTutSetDoc(r);
      if (!plank && !push) return;
      var p = by[r.uid];
      if (!p) { p = by[r.uid] = { uid: r.uid, name: r.name || "Player", sets: 0, plank: 0, at: -1 }; list.push(p); }
      p.sets++;
      if (plank) p.plank++;
      var at = Number(r.at) || 0;
      if (at >= p.at) { p.at = at; if (r.name) p.name = r.name; }
    });
    list.sort(function (a, b) { return b.sets - a.sets || String(a.name).localeCompare(String(b.name)) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0); });
    var out = list.slice(0, n || 50);
    out.forEach(function (p, i) { p.rank = i > 0 && p.sets === out[i - 1].sets ? out[i - 1].rank : i + 1; delete p.at; });
    return out;
  }
  // Today's completed TUT sets per person. dayOf(row) -> day key (ET), today = today's key. Keeps row order (newest first
  // when rows come newest first); people in order of their latest set. -> [{ key, uid, name, sets: [{ ms, reps }] }]
  function tutDaily(rows, dayOf, today) {
    var out = [], by = {};
    (rows || []).forEach(function (r) {
      if (!isTutSetDoc(r) || dayOf(r) !== today) return;
      var k = r.uid ? "u:" + r.uid : "n:" + (r.name || "Player");
      if (!by[k]) { by[k] = { key: k, uid: r.uid || "", name: r.name || "Player", sets: [] }; out.push(by[k]); }
      by[k].sets.push({ ms: Number(r.ms), reps: Number(r.reps) });
    });
    return out;
  }
  // Public drop-your-tuts scoreboard stats: per person, reps from completed TUT sets grouped by ET day.
  // today = reps on the given day key; bestDay = highest single-day total ever; allTime = sum of all days.
  // People appear in order of their latest set (newest-first rows). today is 0 after an ET midnight if they have no sets that day.
  function tutBoardStats(rows, dayOf, today) {
    var out = [], by = {};
    (rows || []).forEach(function (r) {
      var plank = isPlankTutDoc(r), push = isTutSetDoc(r);
      if (!plank && !push) return;
      var k = r.uid ? "u:" + r.uid : "n:" + (r.name || "Player");
      var day = dayOf(r);
      var reps = push ? (Number(r.reps) || 0) : 0;
      if (!by[k]) { by[k] = { key: k, uid: r.uid || "", name: r.name || "Player", today: 0, bestDay: 0, allTime: 0, plankToday: 0, plankAll: 0, days: {} }; out.push(by[k]); }
      var p = by[k];
      p.allTime += reps;
      if (plank) p.plankAll++;
      if (day) {
        p.days[day] = (p.days[day] || 0) + reps;
        if (p.days[day] > p.bestDay) p.bestDay = p.days[day];
      }
      if (day === today) { p.today += reps; if (plank) p.plankToday++; }
    });
    return out.map(function (p) { return { key: p.key, uid: p.uid, name: p.name, today: p.today, bestDay: p.bestDay, allTime: p.allTime, plankToday: p.plankToday, plankAll: p.plankAll }; });
  }

  // End-of-set watch (Nov 16, owner): the one shared no-rep rule every push-up camera view (Sets, One long set / TUT, 3:00 challenge,
  // TUT Battle) runs each frame next to its form-failure watch. The rep target is NOT an end (owner, Nov 16).
  //  - "stalled" (15 s): at least 1 rep, then no new rep for stallMs while the body is SEEN (a shoulder confidently in view)
  //    and NOT at the top. Restarts on every counted rep and on every return to the top. Lying at the bottom / sitting back ends it.
  //    Holding the top (plank push press) never stalls this clock, and frames with no body in view never count (losing tracking
  //    pauses, never ends), so a hood or head down (shoulders still seen) is fine.
  //    "Off the top" is the counter's own top call, OR (when s.counter is passed) the body sitting in the lower part (> lowFrac) of the
  //    rep range frozen at the last counted rep: the counter re-bases its top after ~6 s parked at a new level, so a body parked
  //    at the bottom would otherwise read as a top hold forever. Both clocks also need 15 s / 45 s since the last counted rep,
  //    so neither can fire while reps keep counting.
  //    TUT / TUT Battle (Nov 17): atTopFrom uses a tight lockout line (~15% of the last-rep range). A real plank-push-press
  //    hold often settles a little below that peak, which used to start the 15 s stall and cancel the set mid-hold
  //    ("No push-up for a while") even though the body was still in the upper part of that frozen range. For mode "long"
  //    and "battle", the 15 s clock only runs when the frozen range reads low (lying at the bottom / sitting back). Sets
  //    keep the tighter atTop rule, and the 45 s idle (Sets only) already covers a true top hold.
  //  - "stalled" (45 s, Sets only): no new rep for setsIdleMs, top hold included, counted from the last rep or the last return to
  //    the top, whichever is later; paused while no body is in view. 45 s leaves the 30 s top-hold bonus reachable.
  //  - "failed" (Nov 20, owner: "the camera did not catch my failed push-up, I had to end the set"): the set is OVER by failure
  //    when the body is stuck down in the rep and can't push back up (no single-rep judging: a fail means the set has ended).
  //    Sets and One long set (TUT) only, needs >= 1 rep and the counter state.
  //    Position = the counter's smoothed shoulder level as a fraction of the rep range frozen at the last counted rep
  //    (0 = lockout, 1 = bottom). When that fraction is >= stuckFrac (0.35, i.e. the lower 65% of the rep: stuck mid-rep, at
  //    the bottom, lying flat, sat back on the knees) and it has not moved more than moveFrac (0.15 of the range, on the 400 ms
  //    low-passed position) in either direction for stuckMs (3.5 s), the set ends and the reps so far are the result. Any
  //    movement of 15% restarts the 3.5 s, so a slow rep (a 3 s lowering, a 1-2 s pause at the bottom, a slow grind up) never
  //    trips it. The top part of the range (lockout and a relaxed breather up to 35% down) is never "stuck": a rest at the top
  //    only ends on the 45 s Sets idle (which keeps the 30 s top-hold bonus reachable). Frames with no body in view pause the
  //    3.5 s (they neither count nor reset). A phone pickup / camera move (s.liftedAt within liftGraceMs, 3 s) restarts the
  //    3.5 s and the 15 s clock: picking the phone up never ends a set.
  //  - "frame" (Nov 20, Sets only): at least 1 rep, then no body (no confident shoulder) in view for frameMs (10 s): the user
  //    got up and walked out of the picture. NOT when a phone pickup / camera move (failure watch "lifted", passed as
  //    s.liftedAt) was seen within liftGraceMs (3 s) of the last frame the body was in view: picking the phone up never ends a set.
  // Never fires before the first rep (a 0-rep set keeps going until End set), and never on the start frame.
  var SET_END = { stallMs: 15000, setsIdleMs: 45000, minScore: 0.3, lowFrac: 0.6, stuckMs: 3500, stuckFrac: 0.35, moveFrac: 0.15, emaMs: 400, frameMs: 10000, liftGraceMs: 3000, stuckModes: { sets: true, long: true }, frameModes: { sets: true } };
  function createSetEnd(opts) {
    var o = Object.assign({}, SET_END, opts || {}), lastRepT, lastReps, offSince, ended, endedAt, rom, idleFrom, wasTop, prevT, still, lastSeenT, ema;
    function reset(t0) { lastRepT = t0 == null ? null : t0; lastReps = 0; offSince = null; ended = null; endedAt = null; rom = null; idleFrom = lastRepT; wasTop = false; prevT = null; still = null; lastSeenT = lastRepT; ema = null; }
    reset(null);
    function bodySeen(kps) { for (var i = 0; i < (kps || []).length; i++) { var k = kps[i]; if (k && /shoulder$/.test(k.name) && (k.score == null || k.score >= o.minScore)) return true; } return false; }
    function end(kind, at) { ended = kind; endedAt = at; return ended; }
    // s: { mode, reps, t, atTop, counter, kps (or seen), liftedAt } -> null | "stalled" | "failed" | "frame". Sticky once it fires (until reset).
    function update(s) {
      if (ended) return ended;
      var t = Number(s.t), reps = Number(s.reps) || 0, seen = s.seen != null ? !!s.seen : bodySeen(s.kps);
      if (lastRepT == null) lastRepT = t;
      if (idleFrom == null) idleFrom = t;
      if (lastSeenT == null) lastSeenT = t;
      var dt = prevT != null && t > prevT ? t - prevT : 0;
      if (!seen && dt) { idleFrom += dt; if (still) still.since += dt; } // out of view: the 45 s and 3.5 s clocks pause (never count, never reset)
      prevT = t;
      var c = s.counter;
      if (reps !== lastReps) { lastReps = reps; lastRepT = t; idleFrom = t; offSince = null; still = null; if (c && isFinite(c.top) && isFinite(c.bottom) && c.bottom !== c.top) rom = { top: c.top, bottom: c.bottom }; }
      var frac = rom && c && isFinite(c.smooth) ? (c.smooth - rom.top) / (rom.bottom - rom.top) : null;
      var low = frac != null && frac > o.lowFrac;
      // Position for the stuck rule: frac through a short low-pass (emaMs 400 ms) so landmark jitter (app counters jump
      // +-0.1 of the range frame to frame) never reads as movement; a real rep moves the range in 1-3 s and passes through.
      if (frac != null && seen) ema = ema == null || !dt ? frac : ema + (frac - ema) * (1 - Math.exp(-dt / o.emaMs));
      var topNow = !!(seen && s.atTop && !low);
      // Sets (Nov 20): a breather in the top part of the range (above stuckFrac, 35% down) counts as the top for the 15 s clock
      // too, so a rest at the top only ends on the 45 s idle.
      if (s.mode === "sets" && seen && ema != null && ema < o.stuckFrac) topNow = true;
      // TUT set / TUT Battle: a hold settled slightly below the lockout line is still a top hold, not a 15 s stall.
      if ((s.mode === "long" || s.mode === "battle") && seen && rom && !low) topNow = true;
      if (topNow && !wasTop) idleFrom = t; // 45 s clock: restarts on every counted rep AND on every return to the top
      wasTop = topNow;
      if (seen) lastSeenT = t;
      if (reps < 1) return null;
      var lift = s.liftedAt != null && isFinite(s.liftedAt) ? Number(s.liftedAt) : null;
      var lifting = lift != null && lift >= t - o.liftGraceMs; // a phone pickup / camera move is never "stuck" and never stalls
      // Failed: stuck in the lower part of the rep with no movement (can't push back up).
      if (o.stuckModes[s.mode] && seen && ema != null) {
        if (ema < o.stuckFrac || lifting) still = null;
        else if (!still || Math.abs(ema - still.frac) > o.moveFrac) still = { since: t, frac: ema };
        if (still && t - still.since >= o.stuckMs && t - lastRepT >= o.stuckMs) return end("failed", still.since);
      }
      // Left the frame (Sets): body gone 10 s, and the last thing seen was not a phone pickup.
      if (o.frameModes[s.mode] && !seen && t - lastSeenT >= o.frameMs) {
        if (!(lift != null && lift >= lastSeenT - o.liftGraceMs)) return end("frame", lastSeenT);
      }
      if (!seen || topNow || lifting) offSince = null; else if (offSince == null) offSince = t;
      if (offSince != null && t - offSince >= o.stallMs && t - lastRepT >= o.stallMs) return end("stalled", t);
      if (s.mode === "sets" && t - idleFrom >= o.setsIdleMs) return end("stalled", t);
      return null;
    }
    return { update: update, reset: reset, ended: function () { return ended; }, endedAt: function () { return endedAt; }, options: o };
  }

  // Running TUT clock: accumulates while the body is under load / in position, pauses on rest or a form break.
  // Display / local summary only. Does not change tutToAdd, posted tutMs, or ZAB.
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
  var api = { createTutClock: createTutClock, SET_END: SET_END, createSetEnd: createSetEnd, TUT_DONE: TUT_DONE, tutCompleted: tutCompleted, isTutSetDoc: isTutSetDoc, isPlankTutDoc: isPlankTutDoc, tutLifetime: tutLifetime, plankTutLifetime: plankTutLifetime, plankMark: plankMark, tutAllTime: tutAllTime, tutDaily: tutDaily, tutBoardStats: tutBoardStats, tutHistory: tutHistory, rankTut: rankTut, tutToAdd: tutToAdd, postOnFailure: postOnFailure, postOnCameraStop: postOnCameraStop, setsToAdd: setsToAdd, canSwitchMode: canSwitchMode, classify: classify, foldedLegs: foldedLegs, rawPt: rawPt, floorY: floorY, kneesFallback: kneesFallback, minKnee3D: minKnee3D, createPostureGuard: createPostureGuard, createFailureWatch: createFailureWatch, createViewWatch: createViewWatch, isUpright: isUpright, formFeatures: formFeatures, elbowsDown: elbowsDown, createHoldReward: createHoldReward, HOLD_REWARD: HOLD_REWARD, FAIL: FAIL, FAIL_TEXT: FAIL_TEXT, GUARD: GUARD, VIEW: VIEW };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatSession = api;
})(this);
