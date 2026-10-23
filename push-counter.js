/* Zabbadat pushup counter: pure rep-counting logic (no DOM, no camera).
 * Phone lies face-up under the chest. Going down brings the chest toward the
 * camera, so the shoulders look wider. We track that apparent size, not
 * vertical screen position.
 * Usage: const c = ZabbadatPush.createCounter();
 *        const r = c.update(keypoints, timeMs, frameWidth);  // r.counted, r.status, r.phase
 */
(function (root) {
  "use strict";
  var DEFAULTS = {
    minScore: 0.3,        // per-keypoint confidence gate
    holdMs: 300,          // reuse last good value this long when a point drops out
    poorMs: 1000,         // after this long without a usable signal, show a framing message
    tauMs: 70,            // time constant of the EMA smoothing
    glitchRatio: 0.45,    // single-frame jumps bigger than this (relative) are ignored
    glitchMaxMs: 250,     // ...unless they persist this long (then they are real)
    calibMs: 1000,        // how long the top must be steady
    steadyTol: 0.05,      // steady = size within +/-5% over calibMs
    minDepth: 0.12,       // first rep must make the shoulders >= 12% wider than the top
    downRom: 0.7,         // % range of motion to be "down"
    upRom: 0.3,           // % range of motion to be back "up"
    minBottomMs: 120,
    minRepMs: 400,
    maxRepMs: 6000,
    adapt: 0.15,          // how fast top/bottom follow the user after each good rep
    elbowFrac: 0.4        // rep must bend at least 40% of the user's own elbow range
  };

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function angleDeg(a, b, c) {
    var ang = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)) * 180 / Math.PI;
    return ang > 180 ? 360 - ang : ang;
  }

  function createCounter(opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (opts || {})) o[k] = opts[k];
    var s;

    function reset() {
      s = {
        held: {},             // name -> {x,y,t}
        smooth: null, lastT: null, glitchSince: null,
        lastGoodT: null, firstT: null,
        phase: "calibrate",   // calibrate -> first -> ready
        win: [],              // [t, size] for steadiness check
        top: null, bottom: null,
        topElbow: null, bottomElbow: null, elbowTopSamples: [],
        stage: "up", needTop: false, repStart: null, lastTopT: null, bottomT: null, bottomMs: 0,
        peak: null, minElbow: null, repTopMin: null,
        reps: 0, status: o.lockOnDip ? "Do one full, slow pushup to set the top" : "Hold the top to calibrate"
      };
    }
    reset();

    function point(kps, name, t) {
      var p = null;
      for (var i = 0; i < kps.length; i++) if (kps[i].name === name) { p = kps[i]; break; }
      if (p && (p.score == null || p.score >= o.minScore)) { s.held[name] = { x: p.x, y: p.y, t: t }; return s.held[name]; }
      var h = s.held[name];
      return h && t - h.t <= o.holdMs ? h : null;
    }

    // Apparent size relative to frame width. Shoulder width is primary; when the
    // nose is visible we blend in the nose-shoulder triangle (sqrt of area).
    function measure(kps, t, w) {
      var ls = point(kps, "left_shoulder", t), rs = point(kps, "right_shoulder", t);
      if (!ls || !rs) return null;
      var sw = dist(ls, rs) / w;
      var n = point(kps, "nose", t), size = sw;
      if (n) {
        var area = Math.abs((rs.x - ls.x) * (n.y - ls.y) - (n.x - ls.x) * (rs.y - ls.y)) / 2;
        var tri = Math.sqrt(area) / w * 1.6; // ~same scale as shoulder width for a typical body
        if (tri > sw * 0.4 && tri < sw * 2.5) size = 0.7 * sw + 0.3 * tri;
      }
      var angs = [];
      ["left", "right"].forEach(function (side) {
        var a = point(kps, side + "_shoulder", t), e = point(kps, side + "_elbow", t), wr = point(kps, side + "_wrist", t);
        if (a && e && wr) angs.push(angleDeg(a, e, wr));
      });
      var elbow = angs.length ? angs.reduce(function (x, y) { return x + y; }, 0) / angs.length : null;
      return { size: size, elbow: elbow };
    }

    function result(counted, repMs) {
      return { counted: counted, repMs: counted ? repMs : 0, reps: s.reps, phase: s.phase, status: s.status, stage: s.stage,
               rom: s.top != null && s.bottom != null && s.smooth != null ? (s.smooth - s.top) / (s.bottom - s.top) : null };
    }

    function update(kps, t, frameW) {
      if (s.firstT == null) s.firstT = t;
      var m = kps && frameW ? measure(kps, t, frameW) : null;
      if (!m) {
        var since = s.lastGoodT == null ? t - s.firstT : t - s.lastGoodT;
        if (since > o.poorMs) s.status = "Move so shoulders are in view";
        return result(false);
      }
      // glitch rejection: ignore a sudden jump unless it persists
      if (s.smooth != null && Math.abs(m.size - s.smooth) / s.smooth > o.glitchRatio) {
        if (s.glitchSince == null) s.glitchSince = t;
        if (t - s.glitchSince < o.glitchMaxMs) return result(false);
        s.smooth = m.size; // persisted: accept as the new reality
      } else s.glitchSince = null;
      s.lastGoodT = t;
      // time-based EMA
      if (s.smooth == null) s.smooth = m.size;
      else { var a = 1 - Math.exp(-(t - s.lastT) / o.tauMs); s.smooth += a * (m.size - s.smooth); }
      s.lastT = t;
      var v = s.smooth, counted = false;

      // lockOnDip (solo push-ups): never lock the top from opening / setup frames. Wait for one genuine dip
      // (down >= minDepth, then back up), lock top = the level the dip started from and bottom = its peak, and
      // count it like the old first rep. A "dip" that parks at a new level (see parkLv below)
      // (user moved closer / got into plank) only moves the start level; downward drift follows at once.
      if (s.phase === "calibrate" && o.lockOnDip) {
        if (m.elbow != null && (s.base == null || v <= s.base * (1 + o.steadyTol))) { s.elbowTopSamples.push(m.elbow); if (s.elbowTopSamples.length > 60) s.elbowTopSamples.shift(); }
        if (s.base == null) s.base = v;
        if (s.repStart == null) {
          if (v < s.base) s.base = v;
          else if (v > s.base * (1 + o.minDepth * 0.5)) { s.repStart = t; s.peak = v; s.minElbow = m.elbow; s.win = []; }
          s.status = "Do one full, slow pushup to set the top";
          return result(false);
        }
        if (v > s.peak) s.peak = v;
        if (m.elbow != null && (s.minElbow == null || m.elbow < s.minElbow)) s.minElbow = m.elbow;
        s.win.push([t, v]); while (s.win.length && t - s.win[0][0] > o.calibMs) s.win.shift();
        var dv = s.win.map(function (x) { return x[1]; }), dlo = Math.min.apply(null, dv), dhi = Math.max.apply(null, dv), dmean = (dlo + dhi) / 2;
        // Parked at a new level (steady calibMs, >= 2 x calibMs into the "dip"): only a CANDIDATE start level. A slow
        // rep's bottom is steady for ~1 s too, so re-base only if the user then dips further from it (it was a setup
        // level: moved closer / got into plank) or stays parked >= maxRepMs; coming back up completes the rep as usual.
        var parked = t - s.win[0][0] >= o.calibMs * 0.9 && (dhi - dlo) / dmean <= o.steadyTol * 2 && t - s.repStart >= o.calibMs * 2;
        if (parked && s.parkLv == null) s.parkLv = dmean;
        if (s.parkLv != null && v > s.parkLv * (1 + o.minDepth * 0.5)) {
          s.base = s.parkLv; s.parkLv = null; s.repStart = t; s.peak = v; s.minElbow = m.elbow; s.elbowTopSamples = []; s.win = [[t, v]];
          return result(false);
        }
        if (parked && t - s.repStart >= o.maxRepMs) {
          s.base = dmean; s.parkLv = null; s.repStart = null; s.peak = null; s.minElbow = null; s.elbowTopSamples = []; s.win = [];
          return result(false);
        }
        if (v < s.base + o.upRom * (s.peak - s.base)) {
          var dd = (s.peak - s.base) / s.base, ddur = t - s.repStart;
          if (dd >= o.minDepth && ddur >= o.minRepMs && ddur <= o.maxRepMs * 2) {
            var tes = s.elbowTopSamples.slice(-30);
            s.top = s.base; s.bottom = s.peak; s.topElbow = tes.length ? tes.reduce(function (x, y) { return x + y; }, 0) / tes.length : null; s.bottomElbow = s.minElbow;
            s.phase = "ready"; s.stage = "up"; s.reps += 1; counted = true; s.lastRepMs = ddur; s.lastTopT = t; s.needTop = false;
            s.status = "Top set. Counted " + s.reps;
          } else s.status = dd < o.minDepth ? "Go lower to set the top" : "Do one full, slow pushup to set the top";
          s.repStart = null; s.peak = null; s.minElbow = null; s.win = []; s.parkLv = null;
        }
        return result(counted, s.lastRepMs);
      }
      if (s.phase === "calibrate") {
        s.win.push([t, v]); if (m.elbow != null) s.elbowTopSamples.push(m.elbow);
        while (s.win.length && t - s.win[0][0] > o.calibMs) s.win.shift();
        var vals = s.win.map(function (x) { return x[1]; });
        var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), mean = (lo + hi) / 2;
        var span = s.win.length ? t - s.win[0][0] : 0;
        if (span >= o.calibMs * 0.9 && (hi - lo) / mean <= o.steadyTol * 2) {
          s.top = mean;
          var es = s.elbowTopSamples.slice(-30);
          s.topElbow = es.length ? es.reduce(function (x, y) { return x + y; }, 0) / es.length : null;
          s.phase = "first"; s.stage = "up"; s.peak = null; s.minElbow = null;
          s.status = "Calibrated. Do one full, slow pushup";
        } else {
          if (hi - lo > mean * o.steadyTol * 2) { s.win = s.win.slice(-1); s.elbowTopSamples = []; }
          s.status = "Hold the top to calibrate";
        }
        return result(false);
      }

      if (s.phase === "first") {
        // Re-calibrate if the top was locked while the user was still getting into position (single Start opens
        // the camera and calibrates on the first steady second, often while placing the phone). Uses the same
        // steadiness test as calibration. Triggers only when steady for calibMs AND either below the locked top
        // (the real top is narrower) or parked at one level >= calibMs inside a "first rep" that began >= 2 x calibMs
        // ago (the real top is wider). A rare 1 s+ pause at the bottom of the first rep re-centres there, then the
        // next steady second at the real top re-centres back (below case); at most that one rep is not counted.
        s.win.push([t, v]); if (m.elbow != null) { s.elbowTopSamples.push(m.elbow); if (s.elbowTopSamples.length > 60) s.elbowTopSamples.shift(); }
        while (s.win.length && t - s.win[0][0] > o.calibMs) s.win.shift();
        var fv = s.win.map(function (x) { return x[1]; }), flo = Math.min.apply(null, fv), fhi = Math.max.apply(null, fv), fmean = (flo + fhi) / 2;
        var fsteady = t - s.win[0][0] >= o.calibMs * 0.9 && (fhi - flo) / fmean <= o.steadyTol * 2;
        if (!fsteady && fhi - flo > fmean * o.steadyTol * 2) s.win = s.win.slice(-1);
        if (fsteady && (fmean < s.top * (1 - o.steadyTol * 2) || (s.repStart != null && t - s.repStart >= o.calibMs * 2))) {
          s.top = fmean;
          var fes = s.elbowTopSamples.slice(-30);
          s.topElbow = fes.length ? fes.reduce(function (x, y) { return x + y; }, 0) / fes.length : s.topElbow;
          s.repStart = null; s.peak = null; s.minElbow = null; s.win = s.win.slice(-1); s.recalibrated = (s.recalibrated || 0) + 1;
          s.status = "Calibrated. Do one full, slow pushup";
          return result(false);
        }
        // learn bottom from the first rep's peak
        var returned = s.repStart != null && v < s.top + o.upRom * (s.peak - s.top);
        if (!returned && v > s.top * (1 + o.minDepth * 0.5)) {
          if (s.repStart == null) s.repStart = t;
          if (s.peak == null || v > s.peak) s.peak = v;
          if (m.elbow != null && (s.minElbow == null || m.elbow < s.minElbow)) s.minElbow = m.elbow;
        } else if (returned) {
          var depth = (s.peak - s.top) / s.top, dur = t - s.repStart;
          if (depth >= o.minDepth && dur >= o.minRepMs && dur <= o.maxRepMs * 2) {
            s.bottom = s.peak; s.bottomElbow = s.minElbow;
            s.phase = "ready"; s.reps += 1; counted = true;
            s.status = "Ready. Counted " + s.reps;
            s.lastRepMs = dur;
          } else s.status = depth < o.minDepth ? "Go lower on the first rep to calibrate" : "Calibrated. Do one full, slow pushup";
          s.repStart = null; s.peak = null; s.minElbow = null;
        }
        return result(counted, s.lastRepMs);
      }

      // ready: count by % range of motion with hysteresis
      var range = s.bottom - s.top, rom = (v - s.top) / range;
      if (s.stage === "up") {
        if (rom < o.upRom * 0.5) s.lastTopT = t;   // rep timing starts when the user leaves the top
        if (rom < o.upRom) s.needTop = false;
        if (s.needTop) return result(false);
        if (rom < o.upRom) { s.repTopMin = s.repTopMin == null ? v : Math.min(s.repTopMin, v); s.repStart = null; }
        else if (s.repStart == null) { s.repStart = s.lastTopT != null ? s.lastTopT : t; s.peak = v; s.minElbow = m.elbow; }
        if (s.repStart != null) {
          if (v > s.peak) s.peak = v;
          if (m.elbow != null && (s.minElbow == null || m.elbow < s.minElbow)) s.minElbow = m.elbow;
        }
        if (rom > o.downRom && s.repStart != null) { s.stage = "down"; s.bottomT = t; s.bottomMs = 0; }
        else if (s.repStart != null && t - s.repStart > o.maxRepMs) { s.repStart = null; s.needTop = true; }
      } else {
        if (v > s.peak) s.peak = v;
        if (m.elbow != null && (s.minElbow == null || m.elbow < s.minElbow)) s.minElbow = m.elbow;
        if (rom > o.downRom) { s.bottomMs += t - s.bottomT; } s.bottomT = t;
        if (rom < o.upRom) {
          var d = t - s.repStart, ok = d >= o.minRepMs && d <= o.maxRepMs && s.bottomMs >= o.minBottomMs;
          if (ok && s.topElbow != null && s.bottomElbow != null && s.minElbow != null) {
            var need = s.topElbow - o.elbowFrac * (s.topElbow - s.bottomElbow);
            if (s.minElbow > need) ok = false;
          }
          if (ok) {
            s.reps += 1; counted = true; s.status = "Counted " + s.reps; s.lastRepMs = d;
            // slow adaptation with outlier rejection (no ever-growing range)
            var pr = (s.peak - s.top) / range;
            if (pr > 0.7 && pr < 1.6) s.bottom += o.adapt * (s.peak - s.bottom);
            if (s.repTopMin != null) { var tr = (s.repTopMin - s.top) / range; if (tr > -0.4 && tr < 0.3) s.top += o.adapt * (s.repTopMin - s.top); }
            if (s.minElbow != null && s.bottomElbow != null) s.bottomElbow += o.adapt * (s.minElbow - s.bottomElbow);
          } else s.status = d > o.maxRepMs ? "Too slow, not counted" : "Not counted: go all the way down";
          s.stage = "up"; s.repStart = null; s.repTopMin = null; s.lastTopT = t;
        } else if (t - s.repStart > o.maxRepMs) { s.stage = "up"; s.repStart = null; s.needTop = true; s.status = "Too slow, not counted"; }
      }
      if (!counted && /view|calibrat/i.test(s.status)) s.status = "Ready";
      return result(counted, s.lastRepMs);
    }

    return { update: update, reset: reset, state: function () { return s; } };
  }

  // Time under tension credited for one counted rep: its measured cycle, capped to ignore stalls.
  function tutForRep(repMs, capMs) {
    var cap = capMs == null ? 10000 : capMs, v = Number(repMs);
    if (!isFinite(v) || v <= 0) return 0;
    return Math.min(v, cap);
  }
  // m:ss, or h:mm:ss from one hour.
  function formatTut(ms) {
    var t = Math.max(0, Math.floor((Number(ms) || 0) / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
    var ss = (sec < 10 ? "0" : "") + sec;
    return h ? h + ":" + (m < 10 ? "0" : "") + m + ":" + ss : m + ":" + ss;
  }

  var api = { createCounter: createCounter, DEFAULTS: DEFAULTS, tutForRep: tutForRep, formatTut: formatTut };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatPush = api;
})(this);
