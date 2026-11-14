/* Zabbadat profile picture (PFP), phase one.
 * - photoUrl(user): the Google or X sign-in picture (Firebase user.photoURL, or the provider's), X "_normal" upgraded
 *   to "_400x400". initialOf(user): the letter for the fallback circle.
 * - Top bar: a round avatar in the signed-in badge, and the "Enable profile - PFP" switch row (signed in only).
 *   The switch is kept in localStorage on this device only; nothing is written to the account.
 * - Face cover: when the switch is on, frame(video, keypoints) draws the picture, clipped to a circle, over the face in
 *   the live camera (push-ups, TUT sets, TUT Battle). VISUAL ONLY: it reads the same per-frame keypoints the counter
 *   already got, never changes them, never throws, and returns nothing the session uses. No frame is uploaded.
 *   Keypoints are MoveNet order in display (already mirrored, flipHorizontal) pixels, so the overlay is drawn
 *   unmirrored on top of the scaleX(-1) video and the picture itself reads the right way round.
 */
(function (root) {
  "use strict";
  var KEY = "zabPfpOn";
  var P = { minScore: 0.35, headK: 1.0, eyeK: 2.7, shK: 0.62, padK: 1.45, holdMs: 1000, holdGrow: 1.18, alpha: 0.55, clearMs: 1200 };

  function photoUrl(user) {
    if (!user) return "";
    var u = user.photoURL || "";
    if (!u && user.providerData) for (var i = 0; i < user.providerData.length; i++) if (user.providerData[i] && user.providerData[i].photoURL) { u = user.providerData[i].photoURL; break; }
    u = String(u || "").trim();
    if (!/^https:\/\//i.test(u)) return "";
    return u.replace(/_normal(\.(?:jpe?g|png|gif|webp))?(\?|$)/i, "_400x400$1$2"); // X/Twitter small avatar -> 400x400
  }
  function initialOf(user) {
    var s = user ? String(user.displayName || (user.reloadUserInfo && user.reloadUserInfo.screenName) || user.email || "").trim() : "";
    var m = s.match(/[A-Za-z0-9\u00C0-\uFFFF]/);
    return m ? m[0].toUpperCase() : "Z";
  }

  // ---- placement math (pure) ----
  function ok(k) { return k && isFinite(k.x) && isFinite(k.y) && (k.score == null || k.score >= P.minScore); }
  // Face circle from one frame, or null when no real face cluster is visible (head down / hood: nothing to cover).
  // A lone "nose" (e.g. hood fabric) is never enough: needs the nose plus an eye, or both eyes, or eye+ear.
  function faceCircle(kps) {
    if (!kps || !kps.length) return null;
    var by = {}; for (var i = 0; i < kps.length; i++) if (kps[i] && kps[i].name) by[kps[i].name] = kps[i];
    var g = function (n, idx) { return by[n] || (kps[idx] && !kps[idx].name ? kps[idx] : null); }; // by name (TF.js / Vision); bare arrays: MoveNet order
    var nose = g("nose", 0), le = g("left_eye", 1), re = g("right_eye", 2), lear = g("left_ear", 3), rear = g("right_ear", 4), ls = g("left_shoulder", 5), rs = g("right_shoulder", 6);
    var face = [nose, le, re, lear, rear].filter(ok);
    var eyes = [le, re].filter(ok);
    if (!(eyes.length >= 2 || (ok(nose) && eyes.length >= 1) || (eyes.length >= 1 && (ok(lear) || ok(rear))))) return null;
    var d = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };
    var head = 0;
    if (ok(lear) && ok(rear)) head = d(lear, rear) * P.headK;
    if (eyes.length === 2) head = Math.max(head, d(le, re) * P.eyeK);
    if (!head && ok(ls) && ok(rs)) head = d(ls, rs) * P.shK;
    if (!head) { var xs = face.map(function (k) { return k.x; }), ys = face.map(function (k) { return k.y; }); head = Math.max(Math.max.apply(null, xs) - Math.min.apply(null, xs), Math.max.apply(null, ys) - Math.min.apply(null, ys)) * 2.4; }
    if (!(head > 4)) return null;
    var cx, cy;
    if (eyes.length === 2) { cx = (le.x + re.x) / 2; cy = (le.y + re.y) / 2; if (ok(nose)) { cx = (cx + nose.x) / 2; cy = (cy * 2 + nose.y) / 3; } }
    else { cx = face.reduce(function (s, k) { return s + k.x; }, 0) / face.length; cy = face.reduce(function (s, k) { return s + k.y; }, 0) / face.length; }
    return { x: cx, y: cy, r: (head / 2) * P.padK };
  }
  // Smoothed tracker: hold the last spot ~1 s (slightly bigger) when the face drops, then clear (never blocks a hood).
  function createTracker(opts) {
    var o = Object.assign({}, P, opts || {}), last = null, lastT = -1e9;
    return {
      step: function (kps, t) {
        var c = faceCircle(kps);
        if (c) {
          if (last && t - lastT < o.holdMs * 2) { var a = o.alpha; c = { x: last.x + (c.x - last.x) * a, y: last.y + (c.y - last.y) * a, r: Math.max(c.r, last.r + (c.r - last.r) * a) }; }
          last = c; lastT = t; return { x: c.x, y: c.y, r: c.r, held: false };
        }
        if (last && t - lastT <= o.holdMs) return { x: last.x, y: last.y, r: last.r * o.holdGrow, held: true };
        last = null; return null;
      },
      reset: function () { last = null; lastT = -1e9; }
    };
  }
  // Video pixels -> CSS pixels of the element box (object-fit fill/contain/cover).
  function mapToBox(c, vw, vh, bw, bh, fit) {
    if (!c || !(vw > 0) || !(vh > 0)) return null;
    var sx = bw / vw, sy = bh / vh, ox = 0, oy = 0;
    if (fit === "contain" || fit === "cover") { var s = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy); ox = (bw - vw * s) / 2; oy = (bh - vh * s) / 2; sx = sy = s; }
    return { x: ox + c.x * sx, y: oy + c.y * sy, r: c.r * Math.max(sx, sy) };
  }

  var api = { photoUrl: photoUrl, initialOf: initialOf, faceCircle: faceCircle, createTracker: createTracker, mapToBox: mapToBox, KEY: KEY, P: P };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // ---- browser side ----
  var doc = root && root.document;
  var user = null, img = null, imgUrl = "", imgOk = false, overlays = {};
  function store() { try { return root.localStorage; } catch (e) { return null; } }
  function isOn() { try { var s = store(); return !!user && !!s && s.getItem(KEY) === "1"; } catch (e) { return false; } }
  function setOn(v) { try { var s = store(); if (s) s.setItem(KEY, v ? "1" : "0"); } catch (e) {} syncRow(); if (!v) clearAll(); }
  function loadImg(url) {
    if (url === imgUrl) return;
    imgUrl = url; imgOk = false; img = null;
    if (!url || typeof Image === "undefined") return;
    var im = new Image(); im.referrerPolicy = "no-referrer"; im.decoding = "async";
    im.onload = function () { if (imgUrl === url) { img = im; imgOk = true; } };
    im.onerror = function () { if (imgUrl === url) { img = null; imgOk = false; paintBadge(); } };
    im.src = url;
  }
  function avatarNode(cls) {
    var span = doc.createElement("span"); span.className = cls; span.setAttribute("aria-hidden", "true");
    var url = photoUrl(user), ch = initialOf(user);
    var fallback = function () { span.textContent = ch; span.classList.add("pfp-initial"); };
    if (url) {
      var i = doc.createElement("img"); i.alt = ""; i.referrerPolicy = "no-referrer"; i.decoding = "async"; i.width = 22; i.height = 22;
      i.onerror = function () { i.onerror = null; if (i.parentNode) i.parentNode.removeChild(i); fallback(); };
      i.src = url; span.appendChild(i);
    } else fallback();
    return span;
  }
  function paintBadge() {
    if (!doc) return;
    try {
      var g = doc.getElementById("ztBadge"); if (!g) return;
      var old = g.querySelector(".pfp-av"); if (old) old.parentNode.removeChild(old);
      if (!user || !g.querySelector(".zt-name")) return; // only on the signed-in name badge
      g.insertBefore(avatarNode("pfp-av"), g.firstChild);
    } catch (e) {}
  }
  function syncRow() {
    if (!doc) return;
    try {
      var row = doc.getElementById("pfpRow"), t = doc.getElementById("pfpToggle"); if (!row || !t) return;
      var was = row.hidden; row.hidden = !user; t.checked = isOn(); t.setAttribute("aria-checked", t.checked ? "true" : "false");
      if (was !== row.hidden && root.dispatchEvent && typeof Event === "function") root.dispatchEvent(new Event("resize")); // nav height var + swipe fades
    } catch (e) {}
  }
  function setUser(u) {
    user = u && u.uid ? u : null;
    loadImg(user ? photoUrl(user) : "");
    if (!user) clearAll();
    syncRow(); paintBadge();
  }
  function overlayFor(vid) {
    var id = vid.id || "v", o = overlays[id];
    if (o && o.cv.parentNode && o.vid === vid) return o;
    var cv = doc.createElement("canvas"); cv.className = "pfp-cover"; cv.setAttribute("aria-hidden", "true");
    cv.style.cssText = "position:absolute;pointer-events:none;z-index:2;left:0;top:0;width:0;height:0";
    vid.parentNode.insertBefore(cv, vid.nextSibling);
    o = overlays[id] = { cv: cv, vid: vid, tr: createTracker(), timer: null };
    return o;
  }
  function clearOne(o) { try { var x = o.cv.getContext("2d"); x.clearRect(0, 0, o.cv.width, o.cv.height); o.cv.style.display = "none"; o.tr.reset(); } catch (e) {} }
  function clearAll() { for (var k in overlays) clearOne(overlays[k]); }
  function draw(o, c) {
    var vid = o.vid, cv = o.cv, bw = vid.clientWidth, bh = vid.clientHeight;
    if (!(bw > 0 && bh > 0)) { clearOne(o); return; }
    var dpr = Math.min(root.devicePixelRatio || 1, 2), W = Math.round(bw * dpr), H = Math.round(bh * dpr);
    if (cv.width !== W) cv.width = W; if (cv.height !== H) cv.height = H;
    cv.style.left = vid.offsetLeft + "px"; cv.style.top = vid.offsetTop + "px"; cv.style.width = bw + "px"; cv.style.height = bh + "px"; cv.style.display = "block";
    var fit = "fill"; try { fit = root.getComputedStyle(vid).objectFit || "fill"; } catch (e) {}
    var m = mapToBox(c, vid.videoWidth, vid.videoHeight, bw, bh, fit);
    var x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, bw, bh);
    if (!m) return;
    x.save(); x.beginPath(); x.arc(m.x, m.y, m.r, 0, Math.PI * 2); x.closePath(); x.clip();
    if (img && imgOk) {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = (2 * m.r) / Math.min(iw, ih);
      x.drawImage(img, m.x - (iw * s) / 2, m.y - (ih * s) / 2, iw * s, ih * s);
    } else {
      var gr = x.createLinearGradient(m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r); gr.addColorStop(0, "#c6ff00"); gr.addColorStop(1, "#ff2e93");
      x.fillStyle = gr; x.fillRect(m.x - m.r, m.y - m.r, 2 * m.r, 2 * m.r);
      x.fillStyle = "#0e1412"; x.font = "700 " + Math.round(m.r * 1.05) + "px Outfit, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(initialOf(user), m.x, m.y + m.r * 0.04);
    }
    x.restore();
    x.beginPath(); x.arc(m.x, m.y, m.r, 0, Math.PI * 2); x.lineWidth = 2; x.strokeStyle = "rgba(255,255,255,.85)"; x.stroke();
  }
  // Called from the pose loops with the SAME keypoints the counter got. Returns undefined, never throws.
  function frame(vid, kps, t) {
    try {
      if (!doc || !vid || !vid.parentNode) return;
      if (!isOn()) { var o0 = overlays[vid.id || "v"]; if (o0) clearOne(o0); return; }
      var o = overlayFor(vid);
      var c = o.tr.step(kps, typeof t === "number" ? t : Date.now());
      draw(o, c);
      if (o.timer) clearTimeout(o.timer);
      o.timer = setTimeout(function () { clearOne(o); }, P.clearMs); // loop stopped (camera off): no stale picture
    } catch (e) {}
  }
  api.setUser = setUser; api.frame = frame; api.isOn = isOn; api.setOn = setOn; api.paintBadge = paintBadge;
  if (root) root.ZabPfp = api;
  if (doc) {
    var wire = function () {
      try { var t = doc.getElementById("pfpToggle"); if (t && !t._pfp) { t._pfp = 1; t.addEventListener("change", function () { setOn(t.checked); }); } syncRow(); } catch (e) {}
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", wire); else wire();
  }
})(typeof window !== "undefined" ? window : this);
