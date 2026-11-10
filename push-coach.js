/* Zabbadat push-up coaching lines (APP ONLY: loaded and used only inside the Capacitor app; browsers never load it).
 * Front-facing phone, like the counter. One short line at a time, most important first:
 *   1. "Too dark"        mean frame luminance (sampled once a second from a tiny 32x24 copy of the video) is low.
 *   2. "Too close/far"   shoulder width as a share of the frame width is outside the range the counter works in.
 *   3. "Arms out of frame" shoulders are visible but no elbow or wrist has been seen for poorMs.
 * Nothing is drawn on screen; the pixel sample is read off-screen and thrown away. Video never leaves the phone.
 * Starting values (to tune on-device, not copied from any other app):
 *   darkLuma 0.16 (about 40/255) to show, 0.22 to clear (hysteresis); swClose 0.5, swFar 0.1 of the frame width
 *   (the counter's synthetic test framing is 0.2; its close/far recalibration tests use 0.34 and 0.12).
 * Usage: const c = ZabbadatPushCoach.createCoach(); const line = c.update(keypoints, timeMs, frameW, frameH, video);
 */
(function (root) {
  "use strict";
  var LINES = {
    dark: "Too dark: add light in front of you",
    close: "Too close: move the phone back",
    far: "Too far: move the phone closer",
    arms: "Arms out of frame: move back or tilt the phone so your hands show"
  };
  var DEF = { minScore: 0.3, poorMs: 1000, darkLuma: 0.16, darkClear: 0.22, lumaEveryMs: 1000, swClose: 0.5, swFar: 0.1 };
  function find(kps, name, min) {
    for (var i = 0; i < (kps || []).length; i++) { var p = kps[i]; if (p && p.name === name) return p.score == null || p.score >= min ? p : null; }
    return null;
  }
  // Mean luminance 0..1 of a video frame, or null when it cannot be read.
  function frameLuma(video, doc) {
    try {
      var d = doc || (typeof document !== "undefined" ? document : null); if (!video || !d || !d.createElement) return null;
      var cv = frameLuma.cv || (frameLuma.cv = d.createElement("canvas")); cv.width = 32; cv.height = 24;
      var cx = cv.getContext("2d", { willReadFrequently: true }); if (!cx) return null;
      cx.drawImage(video, 0, 0, 32, 24);
      var px = cx.getImageData(0, 0, 32, 24).data, sum = 0;
      for (var i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return sum / (px.length / 4) / 255;
    } catch (e) { return null; }
  }
  function createCoach(opts) {
    var o = {}, k; for (k in DEF) o[k] = DEF[k]; for (k in (opts || {})) o[k] = opts[k];
    var lumaFn = o.luma || frameLuma, s;
    function reset() { s = { dark: false, lastLumaT: null, luma: null, armsSeenT: null, firstT: null }; }
    reset();
    function update(kps, t, frameW, frameH, video) {
      if (s.firstT == null) s.firstT = t;
      if (s.lastLumaT == null || t - s.lastLumaT >= o.lumaEveryMs) {
        s.lastLumaT = t; var l = lumaFn(video); s.luma = l;
        if (l != null) s.dark = s.dark ? l < o.darkClear : l < o.darkLuma;
      }
      if (s.dark) return LINES.dark;
      var ls = find(kps, "left_shoulder", o.minScore), rs = find(kps, "right_shoulder", o.minScore);
      if (!ls || !rs || !(frameW > 0)) return ""; // the counter already says "Move so shoulders are in view"
      var sw = Math.hypot(ls.x - rs.x, ls.y - rs.y) / frameW;
      if (sw > o.swClose) return LINES.close;
      if (sw < o.swFar) return LINES.far;
      var arms = ["left_elbow", "right_elbow", "left_wrist", "right_wrist"].some(function (n) { return !!find(kps, n, o.minScore); });
      if (arms) s.armsSeenT = t;
      var since = t - (s.armsSeenT == null ? s.firstT : s.armsSeenT);
      if (!arms && since > o.poorMs) return LINES.arms;
      return "";
    }
    return { update: update, reset: reset, state: function () { return s; } };
  }
  var api = { createCoach: createCoach, frameLuma: frameLuma, LINES: LINES, DEFAULTS: DEF };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatPushCoach = api;
})(this);
