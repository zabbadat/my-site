/* Mirror-21 test page glue: front camera through the shared ZabPfp pipeline
 * (registerCam + prepare + input + frame), existing push-up counter or manual
 * Zabba Washers points, count-up timer to 21, and a debug overlay drawn on
 * TOP of the shield canvas. Raw <video> stays opacity 0. Test build only.
 */
(function () {
  "use strict";
  var VID = "m21Vid";
  var CAM = { video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false };
  var TF = [
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.22.0/dist/tf-core.min.js",
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.22.0/dist/tf-converter.min.js",
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.22.0/dist/tf-backend-webgl.min.js",
    "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js"
  ];
  var MOVENET_URL = "/models/movenet-lightning-4/model.json";
  var M = window.ZabMirror21;
  var sess = M.createSession();
  var counter = null, stream = null, det = null, detPromise = null, tfPromise = null;
  var loopOn = false, loopId = 0, visionFailed = false;
  var firstDetectT = null, frames = 0, fpsT = 0, fps = 0, lastInfo = { on: false, box: null, scores: {}, yaw: null };
  var uiTimer = null;

  function $(id) { return document.getElementById(id); }
  function isNativeApp() { return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform()); }
  function useVision() {
    var C = isNativeApp() ? window.Capacitor : null;
    return !!(C && typeof C.getPlatform === "function" && C.getPlatform() === "ios" && C.Plugins && C.Plugins.ZabbaPose && !visionFailed);
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = src; el.async = false;
      el.onload = resolve;
      el.onerror = function () { reject(new Error("Failed to load " + src)); };
      document.head.appendChild(el);
    });
  }
  function loadTf() {
    if (!tfPromise) {
      tfPromise = TF.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve())
        .catch(function (e) { tfPromise = null; throw e; });
    }
    return tfPromise;
  }
  function ensurePose() {
    if (det) return Promise.resolve(det);
    if (detPromise) return detPromise;
    detPromise = (useVision()
      ? Promise.resolve().then(function () { return window.ZabbadatVision.createDetector(); })
      : loadTf().then(function () {
        if (!window.poseDetection) throw new Error("Pose library not loaded");
        return window.tf.setBackend("webgl").then(function () { return window.tf.ready(); }).then(function () {
          var opts = function (url) {
            return Object.assign({ modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING, enableSmoothing: false }, url ? { modelUrl: url } : {});
          };
          return window.poseDetection.createDetector(window.poseDetection.SupportedModels.MoveNet, opts(MOVENET_URL))
            .catch(function () { return window.poseDetection.createDetector(window.poseDetection.SupportedModels.MoveNet, opts(null)); });
        });
      }))
      .then(function (d) {
        det = d;
        if (window.ZabPfp && window.ZabPfp.honorFlip) window.ZabPfp.honorFlip(det);
        if (window.ZabPfp && window.ZabPfp.warmDetector) return window.ZabPfp.warmDetector(det).then(function () { return det; });
        return det;
      })
      .catch(function (e) {
        if (useVision()) {
          visionFailed = true; detPromise = null;
          if (typeof console !== "undefined") console.warn("Apple Vision pose unavailable; using MoveNet", e);
          return ensurePose();
        }
        detPromise = null; throw e;
      });
    return detPromise;
  }

  function register() {
    try { if (window.ZabPfp && window.ZabPfp.registerCam) window.ZabPfp.registerCam(VID); } catch (e) {}
  }
  function attachCam(vid, s) {
    if (!vid) return Promise.resolve();
    vid.srcObject = s;
    if (vid.setAttribute) { vid.setAttribute("playsinline", ""); vid.setAttribute("muted", ""); }
    vid.muted = true;
    return vid.play ? Promise.resolve(vid.play()).catch(function () {}) : Promise.resolve();
  }

  function paintOverlay(kps, vw, vh) {
    var cv = $("m21Overlay"), vid = $(VID), wrap = $("m21Wrap");
    if (!cv || !vid || !wrap) return;
    var info = M.detectInfo(kps);
    lastInfo = info;
    if (info.on && firstDetectT == null) firstDetectT = (window.performance && performance.now()) || Date.now();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = wrap.clientWidth || vid.clientWidth || vw, ch = wrap.clientHeight || vid.clientHeight || vh;
    if (!(cw > 0 && ch > 0)) return;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    cv.style.width = cw + "px"; cv.style.height = ch + "px";
    var x = cv.getContext("2d"); if (!x) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, cw, ch);
    var sx = vw > 0 ? cw / vw : 1, sy = vh > 0 ? ch / vh : 1;
    function PX(px) { return px * sx; }
    function PY(py) { return py * sy; }
    if (info.box) {
      var b = info.box;
      x.strokeStyle = "rgba(198,255,0,.95)"; x.lineWidth = 2;
      x.strokeRect(PX(b.x), PY(b.y), b.w * sx, b.h * sy);
      var label = "face  " + (b.conf * 100).toFixed(0) + "%";
      x.font = "600 12px Outfit, sans-serif"; x.textBaseline = "bottom";
      var tw = x.measureText(label).width, lx = PX(b.x), ly = Math.max(14, PY(b.y) - 2);
      x.fillStyle = "rgba(14,20,18,.82)"; x.fillRect(lx, ly - 14, tw + 8, 16);
      x.fillStyle = "#c6ff00"; x.fillText(label, lx + 4, ly);
      var scores = info.scores, names = M.FACE_NAMES, i, kpsBy = M.kpByName(kps), pt, n;
      for (i = 0; i < names.length; i++) {
        n = names[i]; pt = kpsBy[n];
        if (!pt || !isFinite(pt.x)) continue;
        var vis = pt.score == null || pt.score >= 0.35;
        x.fillStyle = vis ? "#c6ff00" : "rgba(255,255,255,.35)";
        x.beginPath(); x.arc(PX(pt.x), PY(pt.y), 3, 0, Math.PI * 2); x.fill();
        x.fillStyle = vis ? "#eef4f1" : "rgba(238,244,241,.45)";
        x.font = "500 10px Outfit, sans-serif"; x.textBaseline = "top";
        x.fillText(n.replace("_", " ") + " " + (pt.score == null ? "—" : pt.score.toFixed(2)), PX(pt.x) + 5, PY(pt.y) + 4);
      }
    }
    paintHud();
  }

  function paintHud() {
    var el = $("m21Hud"); if (!el) return;
    var st = sess.state(), now = (window.performance && performance.now()) || Date.now();
    if (st.running) sess.tick(now);
    st = sess.state();
    var scores = lastInfo.scores || {};
    function sc(n) { var v = scores[n]; return v == null ? "—" : v.toFixed(2); }
    var first = firstDetectT == null ? "—" : M.formatTime(firstDetectT);
    var yaw = lastInfo.yaw == null ? "—" : ((lastInfo.yaw > 0 ? "+" : "") + lastInfo.yaw + "°");
    var vw = ($(VID) && $(VID).videoWidth) || 0, vh = ($(VID) && $(VID).videoHeight) || 0;
    el.innerHTML =
      "<div class='m21-hud-row'><span>Detection</span><b class='" + (lastInfo.on ? "on" : "off") + "'>" + (lastInfo.on ? "ON" : "OFF") + "</b></div>" +
      "<div class='m21-hud-row'><span>Face conf</span><b>" + (lastInfo.box ? (lastInfo.box.conf * 100).toFixed(0) + "%" : "—") + "</b></div>" +
      "<div class='m21-hud-row'><span>Nose / eyes / ears</span><b>" + sc("nose") + " · " + sc("left_eye") + "/" + sc("right_eye") + " · " + sc("left_ear") + "/" + sc("right_ear") + "</b></div>" +
      "<div class='m21-hud-row'><span>Yaw (approx)</span><b>" + yaw + "</b></div>" +
      "<div class='m21-hud-row'><span>First detect</span><b>" + (firstDetectT == null ? "—" : new Date(Date.now() - (((window.performance && performance.now()) || 0) - firstDetectT)).toLocaleTimeString() + " (+" + first + " after start)") + "</b></div>" +
      "<div class='m21-hud-row'><span>Frame</span><b>" + (vw && vh ? vw + "×" + vh : "—") + " · " + fps.toFixed(0) + " fps</b></div>";
    paintScore();
  }

  function paintScore() {
    var st = sess.state();
    var tEl = $("m21Time"), cEl = $("m21Count"), nEl = $("m21Note"), fEl = $("m21Final");
    var now = (window.performance && performance.now()) || Date.now();
    if (st.running) sess.tick(now);
    st = sess.state();
    if (tEl) tEl.textContent = M.formatTime(st.finalTimeMs != null ? st.finalTimeMs : st.elapsedMs);
    if (cEl) cEl.textContent = String(st.count);
    if (fEl) {
      if (st.done && st.finalTimeMs != null) { fEl.hidden = false; fEl.textContent = "Reached " + st.count + " in " + M.formatTime(st.finalTimeMs) + "."; }
      else { fEl.hidden = true; fEl.textContent = ""; }
    }
    if (nEl && !stream) nEl.textContent = "Test build. Front camera, same logo cover as the other cameras. Timer runs until 21.";
    else if (nEl && st.done) nEl.textContent = "Done. Timer stopped at 21.";
    else if (nEl && st.running && st.mode === "push") nEl.textContent = "Push-ups: the existing counter is scoring. Keep going to 21.";
    else if (nEl && st.running && st.mode === "washers") nEl.textContent = "Zabba Washers: tap +1 or +3 (a pack). First to 21 stops the clock.";
    var wash = $("m21Washers"); if (wash) wash.hidden = st.mode !== "washers";
    syncButtons();
  }

  function syncButtons() {
    var st = sess.state();
    var start = $("m21StartBtn"), end = $("m21EndBtn");
    if (start) start.hidden = !!(stream && (st.running || st.done));
    if (end) end.hidden = !stream;
    document.querySelectorAll("[data-m21-mode]").forEach(function (b) {
      b.setAttribute("aria-pressed", st.mode === b.getAttribute("data-m21-mode") ? "true" : "false");
      b.disabled = !!st.running;
    });
  }

  function nextFrame(vid, fn) { if (vid && typeof vid.requestVideoFrameCallback === "function") vid.requestVideoFrameCallback(function () { fn(); }); else requestAnimationFrame(fn); }
  function tick(id) {
    if (id !== loopId || !loopOn) return;
    var vid = $(VID);
    var t = (window.performance && performance.now()) || Date.now();
    var run = (useVision() && det) ? Promise.resolve(det) : ensurePose();
    run.then(function (d) {
      if (id !== loopId || !loopOn || !vid) return null;
      var src = window.ZabPfp && window.ZabPfp.input ? window.ZabPfp.input(vid, d) : vid;
      return d.estimatePoses(src, { flipHorizontal: true });
    }).then(function (poses) {
      if (id !== loopId || !loopOn) return;
      var p = poses && poses[0], kps = p ? p.keypoints : [];
      if (window.ZabPfp) window.ZabPfp.frame(vid, kps, t);
      var vw = vid.videoWidth || 0, vh = vid.videoHeight || 0;
      paintOverlay(kps, vw, vh);
      frames += 1;
      if (!fpsT) fpsT = t;
      if (t - fpsT >= 1000) { fps = frames * 1000 / (t - fpsT); frames = 0; fpsT = t; }
      var st = sess.state();
      if (st.running && st.mode === "push" && counter) {
        counter.update(kps, t, vw || 640);
        sess.setPushReps(counter.state().reps, t);
        if (sess.state().done) paintScore();
      } else if (st.running) sess.tick(t);
      if (loopOn && id === loopId) nextFrame(vid, function () { tick(id); });
    }).catch(function () {
      if (loopOn && id === loopId) setTimeout(function () { tick(id); }, 120);
    });
  }

  function startUiClock() {
    if (uiTimer) return;
    uiTimer = setInterval(function () { if (sess.state().running) paintScore(); }, 100);
  }
  function stopUiClock() { if (uiTimer) { clearInterval(uiTimer); uiTimer = null; } }

  function camOff() {
    loopOn = false; loopId += 1;
    if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} stream = null; }
    var vid = $(VID); if (vid) vid.srcObject = null;
    try { if (window.ZabPfp && window.ZabPfp.clear) window.ZabPfp.clear(VID); } catch (e) {}
    var ov = $("m21Overlay"); if (ov) { var x = ov.getContext("2d"); if (x) { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, ov.width, ov.height); } }
    stopUiClock();
    paintScore();
  }

  function start() {
    var st = sess.state();
    if (stream && (st.running || st.done)) return;
    register();
    var vid = $(VID), wrap = $("m21Wrap"), note = $("m21Note");
    if (wrap) wrap.hidden = false;
    if (note) note.textContent = "Starting camera…";
    try { if (window.ZabPfp && window.ZabPfp.prepare && vid) window.ZabPfp.prepare(vid); } catch (e) {}
    var gum = navigator.mediaDevices.getUserMedia(CAM);
    ensurePose().catch(function () {});
    var my = ++loopId;
    gum.then(function (s) {
      if (my !== loopId) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      return attachCam(vid, s).then(function () {
        if (my !== loopId) return;
        try { if (window.ZabPfp && window.ZabPfp.prepare) window.ZabPfp.prepare(vid); } catch (e) {}
        firstDetectT = null; frames = 0; fpsT = 0; fps = 0; lastInfo = { on: false, box: null, scores: {}, yaw: null };
        if (sess.state().done || !sess.state().running) { sess.reset(); }
        if (st.mode === "push" || sess.state().mode === "push") {
          counter = window.ZabbadatPush ? window.ZabbadatPush.createCounter(isNativeApp() ? { app: true } : {}) : null;
        } else counter = null;
        var now = (window.performance && performance.now()) || Date.now();
        sess.start(now);
        loopOn = true;
        startUiClock();
        tick(my);
        paintScore();
      });
    }).catch(function (e) {
      if (note) note.textContent = camError(e);
      camOff();
    });
  }

  function camError(e) {
    var n = (e && (e.name || e.message)) || "";
    if (/NotAllowed|Permission/i.test(n)) return "Camera permission was blocked.";
    if (/NotFound|DevicesNotFound/i.test(n)) return "No camera found.";
    if (/NotReadable|Abort|TrackStart/i.test(n)) return "The camera is in use by another app.";
    return "Camera or pose blocked.";
  }

  function end() {
    var now = (window.performance && performance.now()) || Date.now();
    if (sess.state().running) sess.stop(now);
    camOff();
    var nEl = $("m21Note");
    if (nEl && sess.state().done) nEl.textContent = "Done. Timer stopped at 21.";
    else if (nEl) nEl.textContent = "Ended. " + sess.state().count + " in " + M.formatTime(sess.state().elapsedMs) + ".";
  }

  function setMode(m) {
    if (!sess.setMode(m)) return;
    var st = sess.state();
    if (!st.running && !st.done) sess.reset();
    paintScore();
  }

  function addWash(pts) {
    sess.addWashers(pts, (window.performance && performance.now()) || Date.now());
    paintScore();
    if (sess.state().done) { /* camera stays on so the overlay can still be read */ }
  }

  function syncPfpToggle() {
    var t = $("m21PfpToggle"); if (!t || !window.ZabPfp) return;
    t.checked = window.ZabPfp.isOn();
  }

  function wire() {
    register();
    var startBtn = $("m21StartBtn"), endBtn = $("m21EndBtn");
    if (startBtn) startBtn.addEventListener("click", start);
    if (endBtn) endBtn.addEventListener("click", end);
    document.querySelectorAll("[data-m21-mode]").forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-m21-mode")); });
    });
    document.querySelectorAll("[data-m21-add]").forEach(function (b) {
      b.addEventListener("click", function () { addWash(Number(b.getAttribute("data-m21-add"))); });
    });
    var t = $("m21PfpToggle");
    if (t) {
      syncPfpToggle();
      t.addEventListener("change", function () { if (window.ZabPfp) window.ZabPfp.setOn(t.checked); });
      if (window.ZabPfp && window.ZabPfp.onChange) window.ZabPfp.onChange(syncPfpToggle);
    }
    paintScore();
  }

  window.ZabMirror21Page = { start: start, end: end, session: function () { return sess; }, vidId: VID };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
