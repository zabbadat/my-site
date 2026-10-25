/* Zabbadat pushup counter: pure rep-counting logic (no DOM, no camera).
 * Camera only. Setup: the phone leans up against something in front of the user at about chest or face height,
 * camera facing them, shoulders and hands in frame. Nothing is drawn on screen from these points.
 * Signals (all from MoveNet keypoints, every distance divided by the user's own shoulder width so the phone's
 * distance does not matter):
 *   - main: shoulder and head height in the frame (shoulders sink and the head drops going down), with a rolling top.
 *   - second: wrist-to-shoulder distance (the planted hands get closer to the shoulders going down).
 *   A rep counts only when BOTH signals reach depth and return, credited on the way up. If no wrist is visible
 *   the second signal is skipped and the main signal decides alone.
 * Smoothing: speed-adaptive One Euro filter (opts.filter = "ema" gives a fixed EMA with tauMs, for comparison).
 * Zero calibration: the first real dip sets the top and counts as rep 1.
 * Usage: const c = ZabbadatPush.createCounter();
 *        const r = c.update(keypoints, timeMs, frameWidth);  // r.counted, r.status, r.phase
 */
(function (root) {
  "use strict";
  var DEFAULTS = {
    minScore: 0.3,        // per-keypoint confidence gate
    holdMs: 300,          // reuse last good value this long when a point drops out
    poorMs: 1000,         // after this long without a usable signal, show a framing message
    minCutoff: 3.0,       // One Euro: resting cutoff (Hz). Lower = smoother at rest, more lag
    beta: 6,              // One Euro: cutoff grows with speed (per shoulder-width/s). Higher = less lag while moving
    dCutoff: 1.0,         // One Euro: cutoff for the speed estimate (Hz)
    tauMs: 70,            // only for opts.filter = "ema"
    glitchRatio: 0.45,    // single-frame jumps in shoulder width bigger than this (relative) are ignored
    glitchMaxMs: 250,     // ...unless they persist this long (then they are real)
    calibMs: 1000,        // a level held this long counts as "parked" (setup), not a rep
    steadyTol: 0.05,      // steady = within +/-0.05 shoulder widths
    minDepth: 0.2,        // the first rep must drop shoulders/head >= 0.2 shoulder widths
    downRom: 0.7,         // % range of motion to be "down"
    upRom: 0.3,           // % range of motion to be back "up"
    minBottomMs: 120,
    minRepMs: 400,
    maxRepMs: 6000,
    adapt: 0.15,          // how fast top/bottom follow the user after each good rep
    reachFrac: 0.4,       // rep must close at least 40% of the user's own wrist-to-shoulder range
    reachReturn: 0.35,    // ...and open back up at least 35% of it before the rep is credited
    topFollowMs: 400,     // the top follows upward movement of the body this fast
    topWinMs: 7000        // window (longer than maxRepMs) with no return to the top = the body moved, re-base
  };

  // One Euro filter (Casiez et al.): low cutoff at rest (kills jitter), cutoff rises with speed (kills lag).
  function oneEuro(o) {
    var x = null, dx = 0, t = null;
    function alpha(fc, dt) { var tau = 1 / (2 * Math.PI * fc); return 1 / (1 + tau / dt); }
    return {
      f: function (v, time) {
        if (x == null) { x = v; t = time; return v; }
        var dt = Math.max(0.001, (time - t) / 1000); t = time;
        dx += alpha(o.dCutoff, dt) * ((v - x) / dt - dx);
        x += alpha(o.minCutoff + o.beta * Math.abs(dx), dt) * (v - x);
        return x;
      },
      reset: function (v, time) { x = v; dx = 0; t = time; }
    };
  }
  function emaFilter(tauMs) {
    var x = null, t = null;
    return {
      f: function (v, time) { if (x == null) x = v; else x += (1 - Math.exp(-(time - t) / tauMs)) * (v - x); t = time; return x; },
      reset: function (v, time) { x = v; t = time; }
    };
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }

  function createCounter(opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (opts || {})) o[k] = opts[k];
    var s, fY, fQ;

    function mkFilter() { return o.filter === "ema" ? emaFilter(o.tauMs) : oneEuro(o); }

    function reset() {
      fY = mkFilter(); fQ = mkFilter();
      s = {
        held: {},             // name -> {x,y,t}
        smooth: null, lastT: null, glitchSince: null, gref: null,
        lastGoodT: null, firstT: null,
        phase: "calibrate",   // calibrate (waiting for the first real dip) -> ready
        base: null, parkLv: null, win: [],
        top: null, bottom: null,
        topQ: null, bottomQ: null, qTopSamples: [], qs: null, minQ: null,
        stage: "up", needTop: false, repStart: null, lastTopT: null, bottomT: null, bottomMs: 0,
        peak: null, repTopMin: null, noseOff: null, roll: [], rollT: null, swS: null, topSize: null,
        reps: 0, status: "Start your push-ups"
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

    // One frame -> { y, reach, sw }.
    //  y     = shoulder (and head) height in the frame / shoulder width in pixels; y grows downward ("sw" units)
    //  reach = mean wrist-to-shoulder distance / shoulder width in pixels (null when no wrist is visible)
    //  sw    = shoulder width / frame width (only for glitch rejection and the posture guard's reference)
    function measure(kps, t, w) {
      var ls = point(kps, "left_shoulder", t), rs = point(kps, "right_shoulder", t);
      if (!ls || !rs) return null;
      var swPx = dist(ls, rs);
      if (!(swPx > 1)) return null;
      var n = point(kps, "nose", t), midY = (ls.y + rs.y) / 2, y = midY / swPx;
      if (n) {
        var off = (n.y - midY) / swPx;
        s.noseOff = s.noseOff == null ? off : s.noseOff + 0.2 * (off - s.noseOff);
        y = (midY + n.y) / 2 / swPx;
      } else if (s.noseOff != null) y = midY / swPx + s.noseOff / 2; // keep the head share steady when the nose drops out
      var rr = [];
      [ls, rs].forEach(function (sh, i) {
        var wr = point(kps, (i ? "right" : "left") + "_wrist", t);
        if (wr) rr.push(dist(wr, sh) / swPx);
      });
      return { y: y, reach: avg(rr), sw: swPx / w };
    }

    function result(counted, repMs) {
      return { counted: counted, repMs: counted ? repMs : 0, reps: s.reps, phase: s.phase, status: s.status, stage: s.stage,
               rom: s.top != null && s.bottom != null && s.smooth != null ? (s.smooth - s.top) / (s.bottom - s.top) : null };
    }

    // Wrist-to-shoulder gate for the rep in progress. 'ok' = closed enough and opened again, 'wait' = closed enough
    // but not yet open again, 'bad' = never closed enough, 'skip' = second signal unavailable.
    function reachGate() {
      if (s.topQ == null || s.bottomQ == null || s.minQ == null) return "skip";
      var span = s.topQ - s.bottomQ;
      if (!(span > 0.08)) return "skip";
      if (s.minQ > s.topQ - o.reachFrac * span) return "bad";
      if (s.qs != null && s.qs < s.bottomQ + o.reachReturn * span) return "wait";
      return "ok";
    }

    function update(kps, t, frameW) {
      if (s.firstT == null) s.firstT = t;
      var m = kps && frameW ? measure(kps, t, frameW) : null;
      if (!m) {
        var since = s.lastGoodT == null ? t - s.firstT : t - s.lastGoodT;
        if (since > o.poorMs) s.status = "Move so shoulders are in view";
        return result(false);
      }
      // glitch rejection: ignore a sudden jump in shoulder width unless it persists
      var accepted = false;
      if (s.gref != null && Math.abs(m.sw - s.gref) / s.gref > o.glitchRatio) {
        if (s.glitchSince == null) s.glitchSince = t;
        if (t - s.glitchSince < o.glitchMaxMs) return result(false);
        accepted = true; // persisted: accept as the new reality (filters restart from here)
      }
      s.glitchSince = null;
      s.gref = m.sw;
      s.lastGoodT = t;
      if (accepted || s.smooth == null) { fY.reset(m.y, t); fQ.reset(m.reach == null ? 0 : m.reach, t); s.qs = m.reach; s.swS = m.sw; }
      var v = s.smooth = fY.f(m.y, t);
      s.swS += 0.3 * (m.sw - s.swS);
      if (m.reach != null) s.qs = s.qs == null ? m.reach : fQ.f(m.reach, t);
      s.lastT = t;
      var counted = false;

      // Zero calibration. Never lock the top from opening / setup frames: wait for one genuine dip (down >= minDepth,
      // then back up), lock top = the level the dip started from and bottom = its peak, and count it as rep 1.
      // A "dip" that parks at a new level (user stepped closer / got into plank) only moves the start level;
      // upward drift follows at once.
      if (s.phase === "calibrate") {
        if (s.qs != null && (s.base == null || v - s.base <= o.steadyTol)) { s.qTopSamples.push(s.qs); if (s.qTopSamples.length > 60) s.qTopSamples.shift(); }
        if (s.base == null) s.base = v;
        if (s.repStart == null) {
          if (v < s.base) s.base = v;
          else if (v - s.base > o.minDepth * 0.5) { s.repStart = t; s.peak = v; s.minQ = s.qs; s.win = []; }
          s.status = "Start your push-ups";
          return result(false);
        }
        if (v > s.peak) s.peak = v;
        if (s.qs != null && (s.minQ == null || s.qs < s.minQ)) s.minQ = s.qs;
        s.win.push([t, v]); while (s.win.length && t - s.win[0][0] > o.calibMs) s.win.shift();
        var dv = s.win.map(function (x) { return x[1]; }), dlo = Math.min.apply(null, dv), dhi = Math.max.apply(null, dv), dmean = (dlo + dhi) / 2;
        // Parked at a new level (steady calibMs, >= 2 x calibMs into the "dip"): only a CANDIDATE start level. A slow
        // rep's bottom is steady for ~1 s too, so re-base only if the user then dips further from it (it was a setup
        // level) or stays parked >= maxRepMs; coming back up completes the rep as usual.
        var parked = t - s.win[0][0] >= o.calibMs * 0.9 && dhi - dlo <= o.steadyTol * 2 && t - s.repStart >= o.calibMs * 2;
        if (parked && s.parkLv == null) s.parkLv = dmean;
        if (s.parkLv != null && v - s.parkLv > o.minDepth * 0.5) {
          s.base = s.parkLv; s.parkLv = null; s.repStart = t; s.peak = v; s.minQ = s.qs; s.qTopSamples = []; s.win = [[t, v]];
          return result(false);
        }
        if (parked && t - s.repStart >= o.maxRepMs) {
          s.base = dmean; s.parkLv = null; s.repStart = null; s.peak = null; s.minQ = null; s.qTopSamples = []; s.win = [];
          return result(false);
        }
        if (v < s.base + o.upRom * (s.peak - s.base)) {
          var dd = s.peak - s.base, ddur = t - s.repStart;
          if (dd >= o.minDepth && ddur >= o.minRepMs && ddur <= o.maxRepMs * 2) {
            s.top = s.base; s.bottom = s.peak; s.topQ = avg(s.qTopSamples.slice(-30)); s.bottomQ = s.minQ;
            s.phase = "ready"; s.stage = "up"; s.reps += 1; counted = true; s.lastRepMs = ddur; s.lastTopT = t; s.needTop = false; s.roll = []; s.topSize = s.swS;
            s.status = "Counted " + s.reps;
          } else s.status = dd < o.minDepth ? "Go a little lower" : "Start your push-ups";
          s.repStart = null; s.peak = null; s.minQ = null; s.win = []; s.parkLv = null;
        }
        return result(counted, s.lastRepMs);
      }

      // ready: count by % range of motion with hysteresis
      var range = s.bottom - s.top, rom = (v - s.top) / range;
      // Rolling top: the whole top/bottom pair translates with the body. It follows upward movement at once (never
      // while a rep is in progress), and re-bases when the last topWinMs (longer than any legal rep) never came back
      // near the top: the user shifted or the phone was nudged.
      var dtT = Math.max(0, t - (s.rollT == null ? t : s.rollT)); s.rollT = t;
      if (s.stage === "up" && s.repStart == null && rom < o.upRom) s.topSize += 0.1 * (s.swS - s.topSize);
      if (rom < 0 && s.stage === "up" && s.repStart == null) { var mv = (1 - Math.exp(-dtT / o.topFollowMs)) * (v - s.top); s.top += mv; s.bottom += mv; }
      s.roll.push([t, v]); while (s.roll.length && t - s.roll[0][0] > o.topWinMs) s.roll.shift();
      if (s.roll.length > 4 && t - s.roll[0][0] >= o.topWinMs * 0.95) {
        var rs2 = s.roll.map(function (x) { return x[1]; }), q10 = function (a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length * 0.1)]; };
        var rmin = q10(rs2); // 10th percentile: ignores a few transition frames
        if ((rmin - s.top) / range > 0.35) {
          rmin = q10(rs2.slice(Math.floor(rs2.length / 2))); // new top from the latter half only (the first part may still hold the move itself)
          s.bottom = rmin + range; s.top = rmin; s.roll = []; s.rebased = (s.rebased || 0) + 1;
          s.stage = "up"; s.repStart = null; s.peak = null; s.needTop = false; s.repTopMin = null;
        }
      }
      range = s.bottom - s.top; rom = (v - s.top) / range;
      if (s.stage === "up") {
        if (rom < o.upRom * 0.5) s.lastTopT = t;   // rep timing starts when the user leaves the top
        if (rom < o.upRom) s.needTop = false;
        if (s.needTop) return result(false);
        if (rom < o.upRom) { s.repTopMin = s.repTopMin == null ? v : Math.min(s.repTopMin, v); s.repStart = null; }
        else if (s.repStart == null) { s.repStart = s.lastTopT != null ? s.lastTopT : t; s.peak = v; s.minQ = s.qs; }
        if (s.repStart != null) {
          if (v > s.peak) s.peak = v;
          if (s.qs != null && (s.minQ == null || s.qs < s.minQ)) s.minQ = s.qs;
        }
        if (rom > o.downRom && s.repStart != null) { s.stage = "down"; s.bottomT = t; s.bottomMs = 0; }
        else if (s.repStart != null && t - s.repStart > o.maxRepMs) { s.repStart = null; s.needTop = true; }
      } else {
        if (v > s.peak) s.peak = v;
        if (s.qs != null && (s.minQ == null || s.qs < s.minQ)) s.minQ = s.qs;
        if (rom > o.downRom) { s.bottomMs += t - s.bottomT; } s.bottomT = t;
        var gate = rom < o.upRom ? reachGate() : null;
        if (rom < o.upRom && gate !== "wait") {
          var d = t - s.repStart, ok = d >= o.minRepMs && d <= o.maxRepMs && s.bottomMs >= o.minBottomMs && gate !== "bad";
          if (ok) {
            s.reps += 1; counted = true; s.status = "Counted " + s.reps; s.lastRepMs = d;
            // slow adaptation with outlier rejection (no ever-growing range)
            var pr = (s.peak - s.top) / range;
            if (pr > 0.7 && pr < 1.6) s.bottom += o.adapt * (s.peak - s.bottom);
            if (s.repTopMin != null) { var tr = (s.repTopMin - s.top) / range; if (tr > -0.4 && tr < 0.3) s.top += o.adapt * (s.repTopMin - s.top); }
            if (s.minQ != null && s.bottomQ != null) s.bottomQ += o.adapt * (s.minQ - s.bottomQ);
          } else s.status = d > o.maxRepMs ? "Too slow, not counted" : gate === "bad" ? "Not counted: bring your hands closer to your shoulders" : "Not counted: go all the way down";
          s.stage = "up"; s.repStart = null; s.repTopMin = null; s.lastTopT = t;
        } else if (t - s.repStart > o.maxRepMs) { s.stage = "up"; s.repStart = null; s.needTop = true; s.status = "Too slow, not counted"; }
      }
      if (!counted && /view|Start your/i.test(s.status)) s.status = "Ready";
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

  var api = { createCounter: createCounter, oneEuro: oneEuro, DEFAULTS: DEFAULTS, tutForRep: tutForRep, formatTut: formatTut };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatPush = api;
})(this);
