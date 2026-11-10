/* Zabbadat push-up pose engine for the iOS app: Apple Vision (VNDetectHumanBodyPoseRequest) through the app's
 * native ZabbaPose Capacitor plugin. Loaded only inside the iOS app when that plugin is present; browsers and
 * Android never load it, and an older iOS app build without the plugin keeps MoveNet.
 * Each frame: the current camera picture is copied off-screen to a small JPEG (nothing is drawn on the page), the
 * plugin runs Vision on the phone and returns the 17 MoveNet-named joints normalized to the image (top-left origin),
 * and this maps them to pixel keypoints in the video's size - the same { keypoints } shape TF.js estimatePoses gives,
 * so push-counter.js, the coaching and the failure checks are unchanged. Video never leaves the phone.
 */
(function (root) {
  "use strict";
  var NAMES = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"];
  var EDGE = 0.02; // a joint this far outside the picture is a guess, not a sighting

  function plugin(win) {
    var C = win && win.Capacitor;
    if (!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform())) return null;
    var plat = typeof C.getPlatform === "function" ? C.getPlatform() : "";
    if (plat !== "ios") return null;
    var p = C.Plugins && C.Plugins.ZabbaPose;
    return p && typeof p.detect === "function" ? p : null;
  }
  // Plugin result -> MoveNet-style keypoints in video pixels, MoveNet order. flip mirrors x like TF.js flipHorizontal.
  function toKeypoints(res, width, height, flip) {
    var by = {}, out = [], list = (res && res.keypoints) || [];
    for (var i = 0; i < list.length; i++) { var k = list[i]; if (k && typeof k.name === "string") by[k.name] = k; }
    for (var j = 0; j < NAMES.length; j++) {
      var p = by[NAMES[j]]; if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      var nx = flip ? 1 - p.x : p.x, ny = p.y, score = isFinite(p.score) ? Number(p.score) : 0;
      if (nx < -EDGE || nx > 1 + EDGE || ny < -EDGE || ny > 1 + EDGE) score = Math.min(score, 0.1);
      out.push({ x: nx * width, y: ny * height, score: score, name: NAMES[j] });
    }
    return out;
  }
  // Small frame size sent to Vision: longest side maxSide px, aspect kept.
  function frameSize(w, h, maxSide) { var m = maxSide || 320, k = Math.min(1, m / Math.max(w || 1, h || 1)); return { w: Math.max(1, Math.round((w || 1) * k)), h: Math.max(1, Math.round((h || 1) * k)) }; }

  function createDetector(opts) {
    opts = opts || {};
    var win = opts.win || root, p = opts.plugin || plugin(win), doc = opts.doc || (typeof document !== "undefined" ? document : null), cv = null;
    if (!p) return Promise.reject(new Error("ZabbaPose plugin not available"));
    var grab = opts.grab || function (video) { // off-screen JPEG of the current camera frame (base64, no prefix)
      var vw = video.videoWidth || 640, vh = video.videoHeight || 480, s = frameSize(vw, vh, opts.maxSide);
      cv = cv || doc.createElement("canvas"); cv.width = s.w; cv.height = s.h;
      cv.getContext("2d").drawImage(video, 0, 0, s.w, s.h);
      return cv.toDataURL("image/jpeg", opts.quality || 0.7).split(",")[1];
    };
    var det = {
      engine: "vision",
      estimatePoses: function (video, o) {
        var vw = (video && video.videoWidth) || 640, vh = (video && video.videoHeight) || 480;
        if (!video || !(video.readyState == null || video.readyState >= 2)) return Promise.resolve([]);
        var img; try { img = grab(video); } catch (e) { return Promise.reject(e); }
        // include3D: iOS 17+ knee/elbow angles in body space, so a kneel toward the camera still fails the set.
        // Older iOS no-ops this flag in the plugin.
        return Promise.resolve(p.detect({ image: img, include3D: true })).then(function (res) {
          var kps = toKeypoints(res, vw, vh, !!(o && o.flipHorizontal));
          if (!kps.length) return [];
          var pose = { keypoints: kps };
          if (res && res.pose3d) pose.pose3d = res.pose3d;
          if (res && res.pose3d && res.pose3d.kneeAngleDeg) pose.knee3D = res.pose3d.kneeAngleDeg;
          return [pose];
        });
      },
      dispose: function () { cv = null; }
    };
    return Promise.resolve(typeof p.isAvailable === "function" ? p.isAvailable() : { available: true }).then(function (a) {
      if (a && a.available === false) throw new Error("Vision body pose not available");
      return det;
    });
  }
  var api = { NAMES: NAMES, plugin: plugin, toKeypoints: toKeypoints, frameSize: frameSize, createDetector: createDetector };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatVision = api;
})(this);
