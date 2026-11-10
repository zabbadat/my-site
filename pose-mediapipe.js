/* Zabbadat app-only pose engine: MediaPipe Pose Landmarker (tasks-vision web build, bundled locally).
 * Loaded only inside the native app (window.Capacitor.isNativePlatform()); browsers never load this file.
 * Front-facing push-up tracking like Golden Push-Ups / Pushup RPG: the phone sits in front of the hands,
 * shoulders and arms are tracked on-device, and push-counter.js counts each rep on the way UP.
 * The detector exposes the same estimatePoses(video, { flipHorizontal }) shape as TF.js pose-detection, and maps
 * MediaPipe's 33 landmarks to the 17 MoveNet keypoints (pixel x/y, score, name) push-counter.js already consumes.
 * Video never leaves the phone.
 */
(function (root) {
  "use strict";
  // MoveNet keypoint order -> MediaPipe Pose landmark index.
  var MAP = [
    ["nose", 0], ["left_eye", 2], ["right_eye", 5], ["left_ear", 7], ["right_ear", 8],
    ["left_shoulder", 11], ["right_shoulder", 12], ["left_elbow", 13], ["right_elbow", 14],
    ["left_wrist", 15], ["right_wrist", 16], ["left_hip", 23], ["right_hip", 24],
    ["left_knee", 25], ["right_knee", 26], ["left_ankle", 27], ["right_ankle", 28]
  ];
  var EDGE = 0.02; // a landmark this far outside the frame is a guess, not a sighting

  // Normalized MediaPipe landmarks -> MoveNet-style keypoints in pixels. flip mirrors x like TF.js flipHorizontal.
  function toMoveNet(lms, width, height, flip) {
    var out = [];
    if (!lms || !lms.length) return out;
    for (var i = 0; i < MAP.length; i++) {
      var l = lms[MAP[i][1]];
      if (!l) continue;
      var nx = flip ? 1 - l.x : l.x, ny = l.y;
      var score = typeof l.visibility === "number" ? l.visibility : 1;
      if (typeof l.presence === "number") score = Math.min(score, l.presence);
      if (nx < -EDGE || nx > 1 + EDGE || ny < -EDGE || ny > 1 + EDGE) score = Math.min(score, 0.1);
      out.push({ x: nx * width, y: ny * height, score: score, name: MAP[i][0] });
    }
    return out;
  }

  // Coaching like the reference apps: too dark, nobody in view, hands out of frame, phone too far / too close.
  // Returns "" when the frame is fine. Pure apart from the optional brightness value.
  function coachText(kps, width, height, luma) {
    if (typeof luma === "number" && luma < 38) return "Too dark: turn on a light or face a window.";
    var by = {};
    for (var i = 0; i < (kps || []).length; i++) by[kps[i].name] = kps[i];
    var ok = function (n) { var p = by[n]; return p && p.score >= 0.3 && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height; };
    if (!ok("left_shoulder") && !ok("right_shoulder")) return "Move into view: head, shoulders and both hands on screen.";
    if (!ok("left_wrist") && !ok("right_wrist")) return "Get your hands in frame: tilt the phone down or set it a little farther away.";
    if (ok("left_shoulder") && ok("right_shoulder")) {
      var sw = Math.abs(by.left_shoulder.x - by.right_shoulder.x) / (width || 1);
      if (sw < 0.12) return "Too far: set the phone about 2 feet in front of your hands.";
      if (sw > 0.75) return "Too close: move the phone back a little.";
    }
    return "";
  }

  // A condition must hold this long before its coaching line shows, so a single bad frame never flickers text.
  function createCoach(opts) {
    var holdMs = (opts && opts.holdMs) || 700, cur = "", since = 0, shown = "", lumaT = -1e9, luma = null, cv = null;
    function sampleLuma(video, t) {
      if (t - lumaT < 1000 || !video || !video.videoWidth || typeof document === "undefined") return luma;
      lumaT = t;
      try {
        if (!cv) { cv = document.createElement("canvas"); cv.width = 32; cv.height = 24; }
        var ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, 32, 24);
        var d = ctx.getImageData(0, 0, 32, 24).data, sum = 0;
        for (var i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        luma = sum / (d.length / 4);
      } catch (e) { luma = null; }
      return luma;
    }
    return {
      update: function (kps, t, width, height, video, lumaOverride) {
        var l = typeof lumaOverride === "number" ? lumaOverride : sampleLuma(video, t);
        var c = coachText(kps, width, height, l);
        if (c !== cur) { cur = c; since = t; }
        shown = cur && t - since >= holdMs ? cur : cur ? shown : "";
        return shown;
      },
      reset: function () { cur = ""; shown = ""; since = 0; }
    };
  }

  var PLACEMENT = "Set the phone on the floor about 2 feet in front of your hands, screen facing you, so your head, shoulders and both arms are in view.";

  // Builds the detector. base: folder with vision_bundle.mjs, wasm/ and pose_landmarker_lite.task.
  function createDetector(opts) {
    var base = (opts && opts.base) || "/vendor/mediapipe";
    var modelPath = (opts && opts.model) || base + "/pose_landmarker_lite.task";
    return import(base + "/vision_bundle.mjs").then(function (mp) {
      return mp.FilesetResolver.forVisionTasks(base + "/wasm").then(function (fileset) {
        var make = function (delegate) {
          return mp.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelPath, delegate: delegate },
            runningMode: "VIDEO", numPoses: 1,
            minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
          });
        };
        return make("GPU").then(function (lm) { return { lm: lm, delegate: "GPU" }; }, function () {
          return make("CPU").then(function (lm) { return { lm: lm, delegate: "CPU" }; });
        });
      });
    }).then(function (h) {
      var lastTs = 0;
      return {
        engine: "mediapipe", delegate: h.delegate,
        estimatePoses: function (video, o) {
          var w = video.videoWidth || 640, hgt = video.videoHeight || 480;
          var ts = Math.max(lastTs + 1, Math.round(performance.now()));
          lastTs = ts;
          var res = h.lm.detectForVideo(video, ts);
          var lms = res && res.landmarks && res.landmarks[0];
          if (!lms) return Promise.resolve([]);
          return Promise.resolve([{ keypoints: toMoveNet(lms, w, hgt, !!(o && o.flipHorizontal)) }]);
        },
        dispose: function () { try { h.lm.close(); } catch (e) {} }
      };
    });
  }

  var api = { MAP: MAP, toMoveNet: toMoveNet, coachText: coachText, createCoach: createCoach, createDetector: createDetector, PLACEMENT: PLACEMENT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatMediaPipe = api;
})(typeof window !== "undefined" ? window : this);
