/* Zabbadat step detector + game verifier: pure logic, no DOM.
 * Feed it devicemotion samples; it returns confirmed steps.
 *   const d = ZabbadatSteps.createStepDetector();
 *   d.update({ t, x, y, z, gravity: true|false, rot: {alpha,beta,gamma} })  // -> { added, steps }
 *   const v = ZabbadatSteps.createVerifier(); v.sample(t); v.hidden(); ... v.result({steps, ms, packs})
 */
(function (root) {
  "use strict";
  var STEP = {
    gravityTauMs: 1000,   // slow average = gravity (or sensor bias); removed from the signal
    lowPassTauMs: 55,     // ~3 Hz low-pass
    ampTauMs: 1500,       // how fast the adaptive threshold follows the walking strength
    thrFactor: 0.9,       // threshold = factor x recent mean |signal|
    minThr: 0.35,         // m/s^2 floor so a still phone never counts
    valleyFrac: 0.3,      // signal must dip below -valleyFrac*thr between steps
    minStepMs: 250, maxStepMs: 2000,
    confirmSteps: 3,      // steps needed in rhythm before counting (then back-filled)
    rhythmRatio: 2.2,     // consecutive intervals may differ by at most this factor
    rotSpikeDps: 250,     // rotation speed that marks a throw (deg/s)
    throwBeforeMs: 300, throwAfterMs: 600,   // ignore step candidates in this window around a throw
    pendingMs: 300        // candidates wait this long so a throw just after them can veto
  };

  function createStepDetector(opts) {
    var o = {}, k; for (k in STEP) o[k] = STEP[k]; for (k in (opts || {})) o[k] = opts[k];
    var s;
    function reset() {
      s = { lastT: null, g: null, lp: 0, prevLp: 0, rising: false, amp: 0.5, sawValley: true,
            lastCand: null, lastInterval: null, streak: [], walking: false,
            pending: [], lastSpike: -1e9, steps: 0 };
    }
    reset();
    function ema(prev, x, dt, tau) { return prev + (1 - Math.exp(-dt / tau)) * (x - prev); }

    function acceptCandidate(tc) {
      // rhythm / cadence
      if (s.lastCand != null) {
        var iv = tc - s.lastCand;
        if (iv < o.minStepMs) return 0;
        if (iv > o.maxStepMs) { s.streak = []; s.walking = false; s.lastInterval = null; }
        else if (s.lastInterval != null && (iv > s.lastInterval * o.rhythmRatio || iv * o.rhythmRatio < s.lastInterval) && !s.walking) {
          s.streak = [s.lastCand]; s.lastInterval = null;
        } else s.lastInterval = iv;
      }
      s.lastCand = tc;
      if (s.walking) { s.steps += 1; return 1; }
      s.streak.push(tc);
      if (s.streak.length >= o.confirmSteps) { s.walking = true; var n = s.streak.length; s.streak = []; s.steps += n; return n; }
      return 0;
    }

    function update(e) {
      var t = e.t, added = 0;
      var dt = s.lastT == null ? 16 : Math.max(1, Math.min(200, t - s.lastT));
      s.lastT = t;
      var m;
      if (e.gravity === false) {
        // acceleration without gravity: the magnitude would be rectified (double peaks),
        // so follow the signed axis that moves the most instead
        var ax = [e.x || 0, e.y || 0, e.z || 0], best = 0;
        if (!s.axAmp) s.axAmp = [0, 0, 0];
        for (var i = 0; i < 3; i++) { s.axAmp[i] = ema(s.axAmp[i], Math.abs(ax[i]), dt, o.ampTauMs); if (s.axAmp[i] > s.axAmp[best]) best = i; }
        m = ax[best];
      } else m = Math.sqrt((e.x || 0) * (e.x || 0) + (e.y || 0) * (e.y || 0) + (e.z || 0) * (e.z || 0));
      if (s.g == null) s.g = e.gravity === false ? 0 : m;
      s.g = ema(s.g, m, dt, o.gravityTauMs);
      var lp = ema(s.lp, m - s.g, dt, o.lowPassTauMs);
      s.amp = ema(s.amp, Math.abs(lp), dt, o.ampTauMs);
      var thr = Math.max(o.minThr, o.thrFactor * s.amp);
      // throw detection from gyroscope
      var r = e.rot;
      if (r) { var w = Math.sqrt((r.alpha || 0) * (r.alpha || 0) + (r.beta || 0) * (r.beta || 0) + (r.gamma || 0) * (r.gamma || 0)); if (w > o.rotSpikeDps) s.lastSpike = t; }
      // peak with valley requirement
      if (lp < -o.valleyFrac * thr) s.sawValley = true;
      if (lp > s.lp) s.rising = true;
      else if (s.rising && lp < s.lp) {
        s.rising = false;
        if (s.lp > thr && s.sawValley) { s.pending.push(t); s.sawValley = false; }
      }
      s.lp = lp;
      // resolve pending candidates (throw veto)
      while (s.pending.length && t - s.pending[0] >= o.pendingMs) {
        var tc = s.pending.shift();
        if (s.lastSpike >= tc - o.throwAfterMs && s.lastSpike <= tc + o.throwBeforeMs) continue;
        added += acceptCandidate(tc);
      }
      return { added: added, steps: s.steps, thr: thr };
    }
    return { update: update, reset: reset, state: function () { return s; } };
  }

  // Game verification. Thresholds (documented in CHANGES / PR):
  //  - motion samples must keep arriving: no gap > 1.5 s while the game runs
  //  - the page must never be hidden while running (sensor stops when hidden/locked)
  //  - at least 60 s of play (same as the server rule)
  //  - steps >= max(20, 5 x packs). A pack = a burst of score taps; taps more than
  //    15 s apart start a new pack. A 20 ft walk is ~8 steps, so 5 per pack is lenient.
  var VERIFY = { maxGapMs: 1500, firstSampleMs: 3000, minMs: 60000, minSteps: 20, stepsPerPack: 5, packGapMs: 15000 };

  function createVerifier(opts) {
    var o = {}, k; for (k in VERIFY) o[k] = VERIFY[k]; for (k in (opts || {})) o[k] = opts[k];
    var v;
    function reset() { v = { samples: 0, maxGapMs: 0, lastT: null, segStart: null, runMs: 0, hidden: false,
                             denied: false, noSensor: false, firstGap: false, packs: 0, lastTap: null }; }
    reset();
    return {
      reset: reset,
      resume: function (t) { v.lastT = null; v.segStart = t; },        // start or un-pause
      pause: function (t) { if (v.segStart != null) v.runMs += t - v.segStart; v.segStart = null; v.lastT = null; },
      sample: function (t) {
        v.samples++;
        if (v.lastT != null) { var g = t - v.lastT; if (g > v.maxGapMs) v.maxGapMs = g; }
        else if (v.segStart != null && t - v.segStart > o.firstSampleMs) v.firstGap = true;
        v.lastT = t;
      },
      tick: function (t) {   // call periodically while running so a dead sensor is noticed
        var ref = v.lastT != null ? v.lastT : v.segStart;
        if (ref != null && t - ref > (v.lastT != null ? o.maxGapMs : o.firstSampleMs)) {
          if (v.lastT != null) v.maxGapMs = Math.max(v.maxGapMs, t - ref); else v.firstGap = true;
        }
      },
      hidden: function () { v.hidden = true; },
      denied: function () { v.denied = true; },
      noSensor: function () { v.noSensor = true; },
      scoreTap: function (t) { if (v.lastTap == null || t - v.lastTap > o.packGapMs) v.packs++; v.lastTap = t; },
      result: function (steps, ms) {
        var reasons = [];
        if (v.denied) reasons.push("motion permission denied");
        else if (v.noSensor || v.samples === 0) reasons.push("no motion sensor data");
        else {
          if (v.firstGap) reasons.push("motion sensor did not start");
          if (v.maxGapMs > o.maxGapMs) reasons.push("motion data stopped for " + (v.maxGapMs / 1000).toFixed(1) + " s (screen locked or app switched?)");
        }
        if (v.hidden) reasons.push("page was hidden during play");
        if (ms < o.minMs) reasons.push("game shorter than 60 s");
        var need = Math.max(o.minSteps, o.stepsPerPack * v.packs);
        if (steps < need) reasons.push("only " + steps + " steps for " + v.packs + " pack" + (v.packs === 1 ? "" : "s") + " (need " + need + ")");
        return { verified: reasons.length === 0, reasons: reasons, samples: v.samples, maxGapMs: Math.round(v.maxGapMs),
                 packs: v.packs, minSteps: need };
      },
      state: function () { return v; }
    };
  }

  var api = { createStepDetector: createStepDetector, createVerifier: createVerifier, STEP: STEP, VERIFY: VERIFY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatSteps = api;
})(this);
