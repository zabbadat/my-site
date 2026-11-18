/* Mirror-21 test helpers (timer, score, face-debug math).
 * Test build only: not wired into the live homepage. First to 21 (push-ups or
 * Zabba Washers points, packs of 3). Visual debug math is display-space only.
 */
(function (root) {
  "use strict";
  var TARGET = 21;
  var FACE_NAMES = ["nose", "left_eye", "right_eye", "left_ear", "right_ear"];

  function formatTime(ms) {
    var t = Math.max(0, Number(ms) || 0), sec = t / 1000;
    var m = Math.floor(sec / 60), s = sec - m * 60;
    var whole = Math.floor(s), tenth = Math.floor((s - whole) * 10 + 1e-6);
    if (tenth > 9) { whole += 1; tenth = 0; if (whole >= 60) { m += 1; whole = 0; } }
    return m + ":" + (whole < 10 ? "0" : "") + whole + "." + tenth;
  }

  function createSession(opts) {
    opts = opts || {};
    var target = opts.target == null ? TARGET : opts.target;
    var s = { mode: opts.mode === "washers" ? "washers" : "push", target: target, running: false, done: false, startT: null, endT: null, elapsedMs: 0, count: 0, finalTimeMs: null };

    function setMode(m) {
      if (s.running) return false;
      s.mode = m === "washers" ? "washers" : "push";
      return true;
    }
    function start(now) {
      now = Number(now);
      if (!isFinite(now)) return s;
      if (s.running) return s;
      s.running = true; s.done = false; s.startT = now; s.endT = null; s.elapsedMs = 0; s.count = 0; s.finalTimeMs = null;
      return s;
    }
    function tick(now) {
      now = Number(now);
      if (!s.running || s.startT == null || !isFinite(now)) return s;
      s.elapsedMs = Math.max(0, now - s.startT);
      if (s.count >= s.target) {
        s.done = true; s.running = false; s.endT = now; s.finalTimeMs = s.elapsedMs;
      }
      return s;
    }
    function addWashers(pts, now) {
      if (!s.running || s.done || s.mode !== "washers") return s;
      pts = Number(pts);
      if (!isFinite(pts) || pts <= 0) return s;
      s.count += pts;
      return tick(now);
    }
    function setPushReps(n, now) {
      if (!s.running || s.done || s.mode !== "push") return s;
      n = Math.max(0, Math.floor(Number(n) || 0));
      s.count = n;
      return tick(now);
    }
    function stop(now) {
      now = Number(now);
      if (!s.running) return s;
      s.elapsedMs = s.startT != null && isFinite(now) ? Math.max(0, now - s.startT) : s.elapsedMs;
      s.running = false; s.endT = isFinite(now) ? now : s.endT;
      return s;
    }
    function reset() {
      s.running = false; s.done = false; s.startT = null; s.endT = null; s.elapsedMs = 0; s.count = 0; s.finalTimeMs = null;
      return s;
    }
    return { start: start, tick: tick, addWashers: addWashers, setPushReps: setPushReps, setMode: setMode, stop: stop, reset: reset, state: function () { return s; }, formatTime: formatTime, TARGET: target };
  }

  function kpByName(kps) {
    var m = {}, i, k;
    for (i = 0; i < (kps || []).length; i++) { k = kps[i]; if (k && k.name) m[k.name] = k; }
    return m;
  }
  function okPt(k, minScore) {
    return !!(k && isFinite(k.x) && isFinite(k.y) && (k.score == null || k.score >= minScore));
  }
  function facePoints(kps, minScore) {
    minScore = minScore == null ? 0.35 : minScore;
    var by = kpByName(kps), out = [], i, n, k;
    for (i = 0; i < FACE_NAMES.length; i++) { n = FACE_NAMES[i]; k = by[n]; if (okPt(k, minScore)) out.push(k); }
    return out;
  }
  function faceScores(kps) {
    var by = kpByName(kps), out = {}, i, n, k;
    for (i = 0; i < FACE_NAMES.length; i++) {
      n = FACE_NAMES[i]; k = by[n];
      out[n] = k && isFinite(k.score) ? k.score : (k && (k.score == null) ? 1 : null);
    }
    return out;
  }
  // Axis-aligned box around visible face keypoints, padded toward a head outline. null when none are visible.
  function faceBox(kps, minScore) {
    var pts = facePoints(kps, minScore), i, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, conf = 0;
    if (!pts.length) return null;
    for (i = 0; i < pts.length; i++) {
      minX = Math.min(minX, pts[i].x); minY = Math.min(minY, pts[i].y);
      maxX = Math.max(maxX, pts[i].x); maxY = Math.max(maxY, pts[i].y);
      conf += pts[i].score == null ? 1 : pts[i].score;
    }
    var w = Math.max(8, maxX - minX), h = Math.max(8, maxY - minY), padX = w * 0.35, padYTop = h * 0.7, padYBot = h * 0.9;
    return { x: minX - padX, y: minY - padYTop, w: w + padX * 2, h: h + padYTop + padYBot, conf: conf / pts.length, points: pts.length };
  }
  // Rough yaw in degrees from 2D keypoints. Positive = nose sits toward the subject's left
  // (right side of a mirrored front-camera frame). Approximate only: not a 3D head pose.
  function approxYaw(kps, minScore) {
    minScore = minScore == null ? 0.35 : minScore;
    var by = kpByName(kps);
    function ok(n) { var k = by[n]; return okPt(k, minScore) ? k : null; }
    var le = ok("left_eye"), re = ok("right_eye"), nose = ok("nose");
    var lear = ok("left_ear"), rear = ok("right_ear");
    if (le && re && nose) {
      var mid = (le.x + re.x) / 2, eyeW = Math.abs(re.x - le.x) || 1;
      return Math.max(-90, Math.min(90, Math.round((nose.x - mid) / eyeW * 90)));
    }
    if (lear && !rear) return -50;
    if (rear && !lear) return 50;
    return null;
  }
  function detectInfo(kps, minScore) {
    var box = faceBox(kps, minScore);
    return { on: !!box, box: box, scores: faceScores(kps), yaw: approxYaw(kps, minScore) };
  }

  var api = { TARGET: TARGET, FACE_NAMES: FACE_NAMES, createSession: createSession, formatTime: formatTime, faceBox: faceBox, faceScores: faceScores, facePoints: facePoints, approxYaw: approxYaw, detectInfo: detectInfo, kpByName: kpByName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabMirror21 = api;
})(typeof window !== "undefined" ? window : this);
