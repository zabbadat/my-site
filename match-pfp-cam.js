/* Zabba Washers Live Match: local camera preview + a floating profile-picture overlay.
 * Optional Camera button in the match panel (waiting / active). The video never leaves the phone: no upload, no
 * WebRTC, no Live-tab stream (leave #zmLiveSlot for that later; this overlay can be drawn on a future stream the
 * same way). Pose uses the site's existing engine (ensurePushPose / ensurePose: Apple Vision on iOS, otherwise
 * MoveNet Lightning). Overlay math is pure and reuses pfp.js faceCircle / shoulder scoring; the avatar sits just
 * ABOVE the head (or the shoulder midpoint when the back is turned), lerps, and hides ~1 s after detection drops.
 * Single-person only: the most confident pose is used. Does not touch scoring, turns, or the push-up / TUT / plank
 * cameras (own stream, own <video>, own rAF loop). Browser: window.ZabbaMatchPfpCam. Node: require("./match-pfp-cam.js").
 */
(function (root) {
  "use strict";
  var PF = (typeof module !== "undefined" && module.exports && typeof require === "function") ? require("./pfp.js") : (root && root.ZabPfp);
  var P = { minScore: 0.35, floatK: 0.9, floatR: 0.72, shUp: 0.95, shR: 0.38, minR: 14, maxRFrac: 0.28, alpha: 0.45, hideMs: 1000, logo: "/zd-square.png" };
  function pfp() { return PF || (root && root.ZabPfp) || null; }
  function ok(k) { return k && isFinite(k.x) && isFinite(k.y) && (k.score == null || k.score >= P.minScore); }
  function capR(r, fw, fh) { var maxR = fw > 0 && fh > 0 ? P.maxRFrac * Math.min(fw, fh) : Infinity; return Math.max(P.minR, Math.min(maxR, r)); }
  // Avatar circle just above the head. Face cluster (same rules as pfp.js) wins; else shoulders (back turned / far).
  function floatAnchor(kps, fw, fh) {
    var lib = pfp(), face = lib && lib.faceCircle ? lib.faceCircle(kps) : null, c = null, src = "";
    if (face && face.r > 0) { c = { x: face.x, y: face.y - face.r * P.floatK, r: face.r * P.floatR }; src = "face"; }
    else if (kps && kps.length) {
      var by = {}; for (var i = 0; i < kps.length; i++) if (kps[i] && kps[i].name) by[kps[i].name] = kps[i];
      var ls = by.left_shoulder || (kps[5] && !kps[5].name ? kps[5] : null);
      var rs = by.right_shoulder || (kps[6] && !kps[6].name ? kps[6] : null);
      if (ok(ls) && ok(rs)) {
        var sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
        if (sw > 8) { c = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 - sw * P.shUp, r: sw * P.shR }; src = "shoulders"; }
      }
    }
    if (!c) return null;
    return { x: c.x, y: c.y, r: capR(c.r, fw, fh), src: src };
  }
  // Smooth lerp toward a new anchor; keep the last spot for hideMs, then hide.
  function createFloater(opts) {
    var o = Object.assign({}, P, opts || {}), last = null, lastT = -1e9;
    return {
      step: function (kps, t, fw, fh) {
        var c = floatAnchor(kps, fw, fh);
        if (c) {
          var src = c.src;
          if (last && t - lastT < o.hideMs * 2) {
            var a = o.alpha;
            c = { x: last.x + (c.x - last.x) * a, y: last.y + (c.y - last.y) * a, r: last.r + (c.r - last.r) * a, src: src };
          }
          last = c; lastT = t; return { x: c.x, y: c.y, r: c.r, held: false, src: src };
        }
        if (last && t - lastT <= o.hideMs) return { x: last.x, y: last.y, r: last.r, held: true, src: last.src };
        last = null; return null;
      },
      reset: function () { last = null; lastT = -1e9; }
    };
  }
  function poseScore(p) {
    if (!p) return 0;
    if (isFinite(p.score)) return p.score;
    var k = p.keypoints || [], n = 0, s = 0;
    for (var i = 0; i < k.length; i++) if (k[i] && isFinite(k[i].score)) { s += k[i].score; n++; }
    return n ? s / n : 0;
  }
  // Single-person detector: most confident pose only (MoveNet Lightning already returns one).
  function pickPerson(poses) {
    if (!poses || !poses.length) return null;
    var best = poses[0], bestS = poseScore(best);
    for (var i = 1; i < poses.length; i++) { var s = poseScore(poses[i]); if (s > bestS) { best = poses[i]; bestS = s; } }
    return best && best.keypoints && best.keypoints.length ? best : null;
  }
  function httpsPhoto(s) { s = String(s || "").trim(); return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : ""; }
  function initialOf(player) {
    var lib = pfp();
    if (lib && lib.initialOf && player) {
      var u = { displayName: player.name || player.displayName, email: player.email, photoURL: player.photo || player.photoURL };
      return lib.initialOf(u);
    }
    var n = String((player && (player.name || player.displayName)) || "").trim(), m = n.match(/[A-Za-z0-9\u00C0-\uFFFF]/);
    return m ? m[0].toUpperCase() : "Z";
  }
  // Photo from the match seat (players[i].photo) or sign-in picture; else the Zabbadat logo, else an initial.
  function overlaySrc(player) {
    var photo = "";
    if (player) {
      photo = httpsPhoto(player.photo || player.photoURL);
      if (!photo && root && root.ZabbaMatch && root.ZabbaMatch.hooks && root.ZabbaMatch.hooks.photoFor) photo = httpsPhoto(root.ZabbaMatch.hooks.photoFor(player));
      if (!photo && pfp() && pfp().photoUrl) photo = httpsPhoto(pfp().photoUrl(player));
    }
    if (photo) return { kind: "photo", src: photo };
    return { kind: "logo", src: P.logo, text: initialOf(player) };
  }

  // "Show my PFP" (#zmShowPfp) is NOT a separate setting: it is the site-wide "Enable profile - PFP" switch (pfp.js KEY,
  // localStorage on this device, "1" = on). Same key, same default as the top-bar switch (off until turned on), and flipping
  // either one updates the other and this camera live.
  var SHOW_KEY = "zabPfpOn";
  function readShow(store) { try { return !!store && store.getItem(SHOW_KEY) === "1"; } catch (e) { return false; } }
  function saveShow(store, v) { try { if (store) store.setItem(SHOW_KEY, v ? "1" : "0"); } catch (e) {} return !!v; }

  var api = { P: P, SHOW_KEY: SHOW_KEY, readShow: readShow, saveShow: saveShow, floatAnchor: floatAnchor, createFloater: createFloater, pickPerson: pickPerson, overlaySrc: overlaySrc, initialOf: initialOf };

  // ---- browser side (own camera, never the push-up / TUT / plank stream or pose loop) ----
  var doc = root && root.document, stream = null, facing = "environment", on = false, loopId = 0, floater = null;
  var photo = null, logoImg = null, player = null, live = false, noteDefault = "", looping = false;
  function lsStore() { try { return root.localStorage || null; } catch (e) { return null; } }
  function isShow() { return readShow(lsStore()); } // read every time: one source of truth, never a stale copy
  // Off = plain preview: avatar loop stopped (no pose tracking for it), floater reset, overlay cleared. On = loop restarts.
  function applyShow() {
    if (!isShow()) { loopId += 1; looping = false; if (floater) floater.reset(); clearOverlay(); }
    else if (on && !looping) { looping = true; tick(++loopId); }
    paintButtons();
  }
  function setShow(v) {
    var lib = pfp();
    if (lib && typeof lib.setOn === "function") lib.setOn(!!v); else saveShow(lsStore(), v); // pfp.js syncs the top-bar switch and notifies us
    applyShow();
    return isShow();
  }

  function $(id) { return doc && doc.getElementById(id); }
  function setNote(t) { var n = $("zmCamNote"); if (n) n.textContent = t || noteDefault; }
  function paintButtons() {
    var b = $("zmCamBtn"), f = $("zmCamFacing"), box = $("zmCamBox"), wrap = $("zmCamWrap");
    if (box) box.hidden = !live;
    if (wrap) wrap.hidden = !on;
    if (b) { b.setAttribute("aria-pressed", on ? "true" : "false"); b.textContent = on ? "Turn off camera" : "Camera"; }
    if (f) { f.hidden = !live; f.textContent = facing === "user" ? "Rear camera" : "Front camera"; }
    var sw = $("zmShowPfp"); if (sw) { sw.checked = isShow(); sw.setAttribute("aria-checked", sw.checked ? "true" : "false"); }
    var vid = $("zmCamVid");
    if (vid) vid.style.transform = facing === "user" ? "scaleX(-1)" : "none";
  }
  function loadImg(src, noCors) {
    return new Promise(function (resolve) {
      if (!src || typeof Image === "undefined") return resolve(null);
      var im = new Image(); im.decoding = "async"; if (!noCors) im.crossOrigin = "anonymous";
      try { im.referrerPolicy = "no-referrer"; } catch (e) {}
      im.onload = function () { resolve(im); }; im.onerror = function () { resolve(noCors ? null : loadImg(src, true)); };
      im.src = src;
    });
  }
  function ensureLogo() { if (logoImg || typeof Image === "undefined") return; loadImg(P.logo).then(function (im) { logoImg = im; }); }
  function setPlayer(p) {
    player = p || null;
    var src = overlaySrc(player);
    if (src.kind === "photo") {
      if (photo && photo._src === src.src && photo.ok) return;
      photo = { _src: src.src, ok: false, el: null };
      loadImg(src.src).then(function (im) { if (photo && photo._src === src.src) { photo.el = im; photo.ok = !!im; } });
    } else { photo = null; }
    ensureLogo();
  }
  function drawAvatar(x, m) {
    var src = overlaySrc(player), im = (src.kind === "photo" && photo && photo.ok && photo.el) ? photo.el : (logoImg || null);
    x.save(); x.beginPath(); x.arc(m.x, m.y, m.r, 0, Math.PI * 2); x.closePath(); x.clip();
    if (im && (im.naturalWidth || im.width)) {
      var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height, s = (2 * m.r) / Math.min(iw, ih);
      x.drawImage(im, m.x - (iw * s) / 2, m.y - (ih * s) / 2, iw * s, ih * s);
    } else {
      var g = x.createLinearGradient(m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r);
      g.addColorStop(0, "#b8ff3b"); g.addColorStop(1, "#3cffc6");
      x.fillStyle = g; x.fillRect(m.x - m.r, m.y - m.r, 2 * m.r, 2 * m.r);
      x.fillStyle = "#0e1412"; x.font = "bold " + Math.max(12, m.r * 0.9) + "px ui-sans-serif,system-ui,sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle"; x.fillText((src.text || "Z").charAt(0), m.x, m.y + m.r * 0.05);
    }
    x.restore();
    x.beginPath(); x.arc(m.x, m.y, m.r, 0, Math.PI * 2); x.strokeStyle = "rgba(184,255,59,.9)"; x.lineWidth = Math.max(2, m.r * 0.08); x.stroke();
  }
  function clearOverlay() {
    var cv = $("zmCamOverlay"); if (!cv) return;
    var x = cv.getContext && cv.getContext("2d"); if (x) { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); }
  }
  async function getDetector() {
    if (typeof root.ensurePushPose === "function") return root.ensurePushPose();
    if (typeof root.ensurePose === "function") return root.ensurePose();
    if (root.poseDetection) {
      return root.poseDetection.createDetector(root.poseDetection.SupportedModels.MoveNet, {
        modelType: root.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING, enableSmoothing: false
      });
    }
    throw new Error("Pose engine not available");
  }
  async function tick(id) {
    if (id !== loopId || !on || !isShow()) { if (id === loopId) looping = false; return; }
    var vid = $("zmCamVid"), cv = $("zmCamOverlay");
    try {
      if (vid && vid.readyState >= 2 && vid._zmDet) {
        var flip = facing === "user";
        var poses = await vid._zmDet.estimatePoses(vid, { flipHorizontal: flip });
        if (id !== loopId || !on || !isShow()) { if (id === loopId) looping = false; clearOverlay(); return; } // switched off mid-frame: draw nothing
        var person = pickPerson(poses), kps = person ? person.keypoints : [];
        var t = Date.now(), fw = vid.videoWidth || 0, fh = vid.videoHeight || 0;
        if (!floater) floater = createFloater();
        var c = floater.step(kps, t, fw, fh);
        if (cv && vid.parentNode) {
          var bw = vid.clientWidth, bh = vid.clientHeight, dpr = Math.min((root.devicePixelRatio || 1), 2);
          var W = Math.round(bw * dpr), H = Math.round(bh * dpr);
          if (cv.width !== W) cv.width = W; if (cv.height !== H) cv.height = H;
          cv.style.left = vid.offsetLeft + "px"; cv.style.top = vid.offsetTop + "px";
          cv.style.width = bw + "px"; cv.style.height = bh + "px";
          var x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, bw, bh);
          var lib = pfp(), fit = "fill"; try { fit = root.getComputedStyle(vid).objectFit || "fill"; } catch (e) {}
          var m = c && lib && lib.mapToBox ? lib.mapToBox(c, fw, fh, bw, bh, fit) : (c && fw > 0 ? { x: c.x * bw / fw, y: c.y * bh / fh, r: c.r * bw / fw } : null);
          if (m) drawAvatar(x, m);
        }
      }
    } catch (e) {}
    if (id === loopId && on && isShow()) root.requestAnimationFrame(function () { tick(id); }); else if (id === loopId) looping = false;
  }
  function stopTracks() {
    if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} stream = null; }
    var vid = $("zmCamVid"); if (vid) { vid.srcObject = null; vid._zmDet = null; }
  }
  async function start() {
    if (on) return true;
    if (!doc || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setNote("Camera is not available in this browser."); return false; }
    var vid = $("zmCamVid"); if (!vid) { setNote("Camera preview is missing from the page."); return false; }
    setNote("Starting camera…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (e) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch (e2) { setNote((e2 && e2.message) || "Couldn't open the camera."); paintButtons(); return false; }
    }
    vid.srcObject = stream;
    try { await vid.play(); } catch (e) {}
    on = true; floater = createFloater(); paintButtons();
    try { vid._zmDet = await getDetector(); setNote(noteDefault); } catch (e) { setNote("Preview on. Pose model couldn't load, so the picture won't follow your head yet."); }
    applyShow(); // starts the avatar loop only when the PFP setting is on
    return true;
  }
  function stop() {
    loopId += 1; looping = false; on = false; stopTracks(); if (floater) floater.reset(); clearOverlay(); paintButtons();
    if (live) setNote(noteDefault);
  }
  async function setFacing(next) {
    facing = next === "user" ? "user" : "environment";
    paintButtons();
    if (!on) return;
    stopTracks(); on = false; loopId += 1; looping = false;
    await start();
  }
  function sync(opts) {
    opts = opts || {};
    if (opts.player !== undefined) setPlayer(opts.player);
    if (opts.live != null) live = !!opts.live;
    if (!live && on) stop();
    paintButtons();
  }
  function wire() {
    var n = $("zmCamNote"); if (n && !noteDefault) noteDefault = n.textContent || "";
    var b = $("zmCamBtn"); if (b && !b._zm) { b._zm = 1; b.addEventListener("click", function () { if (on) stop(); else start(); }); }
    var f = $("zmCamFacing"); if (f && !f._zm) { f._zm = 1; f.addEventListener("click", function () { setFacing(facing === "user" ? "environment" : "user"); }); }
    var sw = $("zmShowPfp"); if (sw && !sw._zm) { sw._zm = 1; sw.addEventListener("change", function () { setShow(sw.checked); }); }
    var lib = pfp(); if (lib && lib.onChange && !wire._sub) { wire._sub = 1; lib.onChange(function () { applyShow(); }); } // top-bar switch flipped
    if (root.addEventListener && !wire._st) { wire._st = 1; root.addEventListener("storage", function (e) { if (e && e.key === SHOW_KEY) applyShow(); }); }
    paintButtons();
  }

  api.isShow = isShow; api.setShow = setShow;
  api.start = start; api.stop = stop; api.isOn = function () { return on; }; api.facing = function () { return facing; };
  api.setFacing = setFacing; api.sync = sync; api.wire = wire; api.setPlayer = setPlayer;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaMatchPfpCam = api;
  if (doc) { if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", wire); else wire(); }
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
