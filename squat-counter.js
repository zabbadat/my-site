/* Gyatt Squats rep counter: FRONT camera view only (phone propped facing you, whole body in frame).
 *
 * Rep = descend to about parallel, then stand all the way back up. Half reps never count.
 * Signals (image y grows downward; all lengths normalised by the calibrated standing body, scaled by shoulder width
 * so a small lean or camera wobble does not read as depth):
 *   drop   = how far the hips have come down from the standing baseline, as a fraction of the standing hip-to-knee
 *            vertical distance (thigh). 0 = standing, 1.0 = hips at knee height ("parallel" seen from the front).
 *   knee2D = hip-knee-ankle angle in the picture. From the front the thigh points at the camera and is foreshortened,
 *            so this angle stays large even in a deep squat: it is only a weak helper (a clearly bent 2D knee <= 120 deg
 *            lowers the drop needed for depth from 0.45 to 0.38) and a standing check (>= 155 deg at the top).
 *   knee3D = iOS app only: Apple Vision body-space knee angle (pose-vision.js knee3D). When present it decides:
 *            depth = knee3D <= 100 deg (with drop >= 0.25 as a sanity check), top = knee3D >= 160 deg (with drop <= 0.15).
 * A rep is the actual movement: descend until thighs are at or below parallel (hips reach knee height from the
 * front, or the knee-angle threshold below), then return to standing. The spoken cadence is pacing only and
 * never adds or withholds a rep. down -> top without reaching depth = a half rep (counted separately, never a
 * rep). Hysteresis around the depth and top lines so jitter does not double-count. Reps are at least 0.8 s
 * apart (debounce). Hips are smoothed with a One Euro filter (fast when moving, steady when still).
 * Form hints (never a fail, never void a rep): stanceNarrow when ankle width is under about 1.45× shoulder
 * width (setup wants about 1.5–2×, toes out); kneesCave when, in the squat, the knees track inside the ankles;
 * chestDown when the torso shortens clearly while the hips are down.
 * Guards (never count, never advance): leaving the frame (hips/knees/ankles/shoulders missing), walking toward or away
 * from the camera (shoulder width off the baseline by > 18 %, or the feet moving more than 12 % of the leg), bending
 * over (shoulders dropping toward the hips: torso shorter than 55 % of standing while the hips stay high). A walk or
 * bend in the middle of a rep voids that rep. After a move the counter re-calibrates itself once the person stands
 * still, upright, for 1.2 s at the new spot.
 * Browser: window.ZabbadatSquat. Node: require("./squat-counter.js").
 */
(function (root) {
  "use strict";
  var T = {
    minScore: 0.3,
    downAt: 0.15,         // leave the top
    depth: 0.45,          // hips >= 45 % of the thigh below standing (about parallel from the front)
    depthBent2D: 0.38,    // ... or 38 % when the 2D knee is clearly bent (<= 120 deg)
    bent2D: 120,
    riseAt: 0.40,         // hysteresis: bottom -> up once the hips are back above 40 %
    topAt: 0.12,          // back to the standing baseline (within 12 % of the thigh)
    top2D: 155,           // standing 2D knee, typical stance
    top2DWide: 140,       // standing 2D knee allowed when the stance is wide (toes-out shin angle from the front)
    depth3D: 100, top3D: 160, depth3DDrop: 0.25, top3DDrop: 0.15,
    depthHoldMs: 100, topHoldMs: 150, minRepMs: 800,
    scaleTol: 0.18,       // shoulder width vs baseline
    feetTol: 0.12,        // ankle drift as a fraction of the standing hip-to-ankle height
    bendTorso: 0.55,      // torso (shoulder->hip) shorter than this fraction of standing = bending over
    bendMaxDrop: 0.30,    // ... while the hips have not really dropped
    recalMs: 1200, calibMinMs: 500,
    stanceMin: 1.45,       // ankle width / shoulder width: setup hint, not a fail (wanted 1.5–2×)
    caveRatio: 0.85,       // knees caving: knee width under 85 % of ankle width while descending
    chestTorso: 0.70       // chest-down hint: torso shorter than this fraction of standing while in the squat
  };
  var NEED = ["left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"];

  function byName(kps) { var o = {}; (kps || []).forEach(function (k) { if (k && k.name) o[k.name] = k; }); return o; }
  function good(k) { return !!(k && isFinite(k.x) && isFinite(k.y) && (k.score == null || k.score >= T.minScore)); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function angle(a, b, c) { // angle at b, degrees
    var v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    var n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y); if (!(n > 0)) return null;
    return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * 180 / Math.PI;
  }
  // Pose -> front-view measures, or null when a needed joint is missing.
  function measure(kps) {
    var b = byName(kps);
    for (var i = 0; i < NEED.length; i++) if (!good(b[NEED[i]])) return null;
    var sh = mid(b.left_shoulder, b.right_shoulder), hip = mid(b.left_hip, b.right_hip), knee = mid(b.left_knee, b.right_knee), ank = mid(b.left_ankle, b.right_ankle);
    var kl = angle(b.left_hip, b.left_knee, b.left_ankle), kr = angle(b.right_hip, b.right_knee, b.right_ankle);
    var k2 = kl != null && kr != null ? (kl + kr) / 2 : kl != null ? kl : kr;
    var wr = [b.left_wrist, b.right_wrist].filter(good);
    var shW = Math.abs(b.left_shoulder.x - b.right_shoulder.x), ankW = Math.abs(b.left_ankle.x - b.right_ankle.x), kneeW = Math.abs(b.left_knee.x - b.right_knee.x);
    return { shY: sh.y, hipY: hip.y, kneeY: knee.y, ankY: ank.y, ankX: ank.x, shW: shW, ankW: ankW, kneeW: kneeW,
      leftKneeX: b.left_knee.x, rightKneeX: b.right_knee.x, leftAnkX: b.left_ankle.x, rightAnkX: b.right_ankle.x,
      knee2D: k2, wristY: wr.length ? Math.max.apply(null, wr.map(function (w) { return w.y; })) : null };
  }
  function knee3DOf(extra) {
    var v = extra && (extra.knee3D != null ? extra.knee3D : extra.pose3d && extra.pose3d.kneeAngleDeg);
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    var xs = [v.left, v.right, v.l, v.r].filter(function (x) { return typeof x === "number" && isFinite(x); });
    return xs.length ? Math.min.apply(null, xs) : null;
  }
  // One Euro filter (Casiez et al.): smooth when still, quick when moving.
  function oneEuro(minCut, beta) {
    var x = null, dx = 0, lt = null;
    function a(cut, dt) { var tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
    return { f: function (v, t) {
      if (x == null || lt == null || !(t > lt)) { x = v; lt = t; return v; }
      var dt = (t - lt) / 1000; lt = t;
      var d = (v - x) / dt, ad = a(1, dt); dx = ad * d + (1 - ad) * dx;
      var al = a(minCut + beta * Math.abs(dx), dt); x = al * v + (1 - al) * x; return x;
    }, reset: function () { x = null; lt = null; dx = 0; } };
  }

  function createCounter(opts) {
    opts = opts || {};
    var th = Object.assign({}, T, opts.thresholds || {});
    function standKneeOk(m) {
      if (m.knee2D == null) return true;
      var wide = m.shW > 0 && m.ankW / m.shW >= th.stanceMin;
      return m.knee2D >= (wide ? th.top2DWide : th.top2D);
    }
    var base = null, calib = [], calibT0 = null;
    var fHip = oneEuro(1.2, 0.02), fSh = oneEuro(1.2, 0.02), fW = oneEuro(0.8, 0.01), fAnk = oneEuro(1.0, 0.01);
    var phase = "top", reps = 0, halfReps = 0, lastRepT = -1e9, enterT = null, topT = null, bottomT = null, voided = false;
    var guard = "ok", stillT = null, stillRef = null, last = null;

    function setBase(m) { base = { hipY: m.hipY, kneeY: m.kneeY, ankY: m.ankY, ankX: m.ankX, shY: m.shY, shW: m.shW, ankW: m.ankW,
      thigh: Math.max(1, m.kneeY - m.hipY), leg: Math.max(1, m.ankY - m.hipY), torso: Math.max(1, m.hipY - m.shY) }; }
    // Standing baseline: median of frames given during the 1-2-3-Go setup (call calibrate() each frame), or the first
    // upright frames of the set if it never got any.
    function calibrate(kps, t) {
      var m = measure(kps); if (!m) return { ok: false, frame: "missing" };
      if (!standKneeOk(m)) return { ok: false, frame: "stand_tall" };
      if (calibT0 == null) calibT0 = t;
      calib.push(m); if (calib.length > 60) calib.shift();
      var med = function (k) { var a = calib.map(function (c) { return c[k]; }).sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
      setBase({ hipY: med("hipY"), kneeY: med("kneeY"), ankY: med("ankY"), ankX: med("ankX"), shY: med("shY"), shW: med("shW"), ankW: med("ankW") });
      return { ok: t - calibT0 >= th.calibMinMs, frame: "ok", baseline: Object.assign({}, base) };
    }
    function snapshot(extra) {
      return Object.assign({ phase: phase, reps: reps, halfReps: halfReps, calibrated: !!base, guard: guard, baseline: base ? Object.assign({}, base) : null }, last || {}, extra || {});
    }
    function update(kps, t, extra) {
      var m = measure(kps), k3 = knee3DOf(extra);
      if (!m) { last = { frame: "missing", drop: last && last.drop, knee2D: null, knee3D: k3 }; return snapshot({ event: null }); }
      if (!base) { calibrate(kps, t); if (!base) { last = { frame: "stand_tall", drop: 0 }; return snapshot({ event: null }); } }
      var hipY = fHip.f(m.hipY, t), shY = fSh.f(m.shY, t), shW = fW.f(m.shW, t), ankY = fAnk.f(m.ankY, t);
      var s = shW / base.shW; // distance proxy: shoulder width does not change in a squat
      var feet = Math.abs(ankY - base.ankY * 1) / base.leg, feetX = Math.abs(m.ankX - base.ankX) / base.leg;
      var drop = ((hipY - base.hipY) / s) / base.thigh;
      var torso = ((hipY - shY) / s) / base.torso;
      var moved = Math.abs(s - 1) > th.scaleTol || feet > th.feetTol || feetX > th.feetTol * 2.5;
      var bent = !moved && torso < th.bendTorso && drop < th.bendMaxDrop;
      var event = null;
      guard = moved ? "moved" : bent ? "bent" : "ok";
      var stance = m.shW > 0 ? m.ankW / m.shW : 0;
      var inSquat = drop > th.downAt;
      var kneesCave = inSquat && m.ankW > 0 && m.kneeW < m.ankW * th.caveRatio;
      var chestDown = inSquat && torso < th.chestTorso;
      last = { frame: "ok", drop: drop, torso: torso, scale: s, knee2D: m.knee2D, knee3D: k3, hipBelowKnee: m.hipY >= m.kneeY,
        wristBelowKnee: m.wristY != null && m.wristY >= m.kneeY + 0.6 * Math.max(1, m.ankY - m.kneeY), hipY: m.hipY, kneeY: m.kneeY,
        stance: stance, stanceNarrow: stance < th.stanceMin, kneesCave: kneesCave, chestDown: chestDown, ankW: m.ankW, kneeW: m.kneeW };
      if (moved) {
        if (phase !== "top") { voided = true; }
        // re-calibrate once standing still and upright at the new spot
        var up = standKneeOk(m);
        if (up && stillRef && Math.abs(m.hipY - stillRef.hipY) < 0.04 * base.leg * s && Math.abs(m.shW - stillRef.shW) < 0.05 * m.shW) {
          if (t - stillT >= th.recalMs) { setBase(m); fHip.reset(); fSh.reset(); fW.reset(); fAnk.reset(); phase = "top"; voided = false; stillRef = null; guard = "ok"; event = "recalibrated"; }
        } else { stillRef = m; stillT = t; }
        return snapshot({ event: event });
      }
      stillRef = null;
      if (bent) { if (phase !== "top") voided = true; return snapshot({ event: null }); }
      var deep = k3 != null ? (k3 <= th.depth3D && drop >= th.depth3DDrop) : (drop >= th.depth || (m.knee2D != null && m.knee2D <= th.bent2D && drop >= th.depthBent2D));
      var atTop = k3 != null ? (k3 >= th.top3D && drop <= th.top3DDrop) : (drop <= th.topAt && standKneeOk(m));
      if (phase === "top") {
        if (drop > th.downAt) { phase = "down"; enterT = null; voided = false; event = "down"; }
      } else if (phase === "down") {
        if (deep) { if (enterT == null) enterT = t; if (t - enterT >= th.depthHoldMs) { phase = "bottom"; bottomT = t; event = "depth"; } }
        else enterT = null;
        if (phase === "down" && atTop) { phase = "top"; if (!voided) { halfReps++; event = "half"; } voided = false; topT = null; }
      } else if (phase === "bottom") {
        if (drop < th.riseAt && !deep) { phase = "up"; topT = null; event = "rising"; }
      } else if (phase === "up") {
        if (deep) { phase = "bottom"; event = "depth"; topT = null; }
        else if (atTop) {
          if (topT == null) topT = t;
          if (t - topT >= th.topHoldMs) {
            phase = "top"; topT = null;
            if (!voided && t - lastRepT >= th.minRepMs) { reps++; lastRepT = t; event = "rep"; } else if (voided) event = "voided";
            voided = false;
          }
        } else topT = null;
      }
      return snapshot({ event: event, deep: deep, atTop: atTop, bottomSince: phase === "bottom" ? bottomT : null });
    }
    function reset(keepBase) { phase = "top"; reps = 0; halfReps = 0; lastRepT = -1e9; enterT = topT = bottomT = null; voided = false; guard = "ok"; last = null; stillRef = null;
      fHip.reset(); fSh.reset(); fW.reset(); fAnk.reset(); if (!keepBase) { base = null; calib = []; calibT0 = null; } }
    return { calibrate: calibrate, update: update, reset: reset, state: function () { return snapshot(); }, baseline: function () { return base ? Object.assign({}, base) : null; }, T: th };
  }
  var api = { T: T, NEED: NEED, createCounter: createCounter, measure: measure, angle: angle, knee3DOf: knee3DOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatSquat = api;
})(typeof window !== "undefined" ? window : this);
