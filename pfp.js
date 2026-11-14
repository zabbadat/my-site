/* Zabbadat profile picture (PFP), phase one.
 * - photoUrl(user): the Google or X sign-in picture (Firebase user.photoURL, or the provider's), X "_normal" upgraded
 *   to "_400x400". initialOf(user): the letter for the fallback circle.
 * - Top bar: a round avatar in the signed-in badge, and the "Enable profile - PFP" switch row (signed in only).
 *   The switch is kept in localStorage on this device only; nothing is written to the account.
 * - Head cover: when the switch is on, frame(video, keypoints) draws the Zabbadat logo, clipped to a circle, over the head in
 *   the live camera (push-ups, TUT sets, TUT Battle). VISUAL ONLY: it reads the same per-frame keypoints the counter
 *   already got, never changes them, never throws, and returns nothing the session uses. No frame is uploaded.
 *   Keypoints are MoveNet order in display (already mirrored, flipHorizontal) pixels, so the overlay is drawn
 *   unmirrored on top of the scaleX(-1) video and the picture itself reads the right way round.
 */
(function (root) {
  "use strict";
  var KEY = "zabPfpOn";
  var P = { minScore: 0.35, headK: 1.0, eyeK: 2.7, shK: 0.62, padK: 1.65, holdMs: 1000, holdGrow: 1.18, alpha: 0.55, clearMs: 1200,
    shUp: 0.55, shR: 0.483, minR: 10, maxRFrac: 0.40, plankR: 0.25, miniFps: 15, miniSize: 44, logo: "/zd-square.png" };
  // Sizes: face r = (ear-to-ear or eye spread x2.7)/2 x padK 1.65; shoulders r = shoulder width x shR 0.483 (0.42 x1.15),
  // centre shUp 0.55 shoulder widths above the shoulder midpoint; r capped to [minR px, maxRFrac 0.40 (0.35 x1.15) x the shorter frame side].

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
  // Head circle for the logo: the face cluster when it is there, else estimated from the shoulders (head down / hooded:
  // the logo still sits on the head). frameW/frameH (video px) only cap the size.
  function headCircle(kps, frameW, frameH) {
    var c = faceCircle(kps), src = "face";
    if (!c && kps && kps.length) {
      var by = {}; for (var i = 0; i < kps.length; i++) if (kps[i] && kps[i].name) by[kps[i].name] = kps[i];
      var ls = by.left_shoulder || (kps[5] && !kps[5].name ? kps[5] : null), rs = by.right_shoulder || (kps[6] && !kps[6].name ? kps[6] : null);
      if (ok(ls) && ok(rs)) { var sw = Math.hypot(ls.x - rs.x, ls.y - rs.y); if (sw > 8) { c = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 - sw * P.shUp, r: sw * P.shR }; src = "shoulders"; } }
    }
    if (!c) return null;
    var maxR = frameW > 0 && frameH > 0 ? P.maxRFrac * Math.min(frameW, frameH) : Infinity;
    return { x: c.x, y: c.y, r: Math.max(P.minR, Math.min(maxR, c.r)), src: src };
  }
  // Plank (side-on): the face cluster if it shows; else the head sits on the hip->shoulder line just past the shoulder
  // (side-on shoulders overlap, so the shoulder-width estimate is useless there); else the usual shoulder estimate.
  function plankHead(kps, frameW, frameH) {
    var c = faceCircle(kps);
    if (!c && kps && kps.length) {
      var by = {}; for (var i = 0; i < kps.length; i++) if (kps[i] && kps[i].name) by[kps[i].name] = kps[i];
      var pick = function (a, b) { return ok(by[a]) && ok(by[b]) ? [by[a], by[b]] : null; }, pr = pick("left_shoulder", "left_hip") || pick("right_shoulder", "right_hip");
      if (pr) { var sh = pr[0], hp = pr[1], L = Math.hypot(sh.x - hp.x, sh.y - hp.y); if (L > 20) c = { x: sh.x + (sh.x - hp.x) * 0.45, y: sh.y + (sh.y - hp.y) * 0.45, r: L * P.plankR }; }
    }
    if (!c) return headCircle(kps, frameW, frameH);
    var maxR = frameW > 0 && frameH > 0 ? P.maxRFrac * Math.min(frameW, frameH) : Infinity;
    return { x: c.x, y: c.y, r: Math.max(P.minR, Math.min(maxR, c.r)), src: c.src || "plank" };
  }
  // Smoothed tracker: hold the last spot ~1 s (slightly bigger) when the face drops, then clear (never blocks a hood).
  function createTracker(opts) {
    var o = Object.assign({}, P, opts || {}), last = null, lastT = -1e9;
    return {
      step: function (kps, t, fw, fh) {
        var c = headCircle(kps, fw, fh);
        if (c) { var src = c.src;
          if (last && t - lastT < o.holdMs * 2) { var a = o.alpha; c = { x: last.x + (c.x - last.x) * a, y: last.y + (c.y - last.y) * a, r: Math.max(c.r, last.r + (c.r - last.r) * a) }; }
          last = c; lastT = t; return { x: c.x, y: c.y, r: c.r, held: false, src: src };
        }
        if (last && t - lastT <= o.holdMs) return { x: last.x, y: last.y, r: Math.min(last.r * o.holdGrow, fw > 0 && fh > 0 ? o.maxRFrac * Math.min(fw, fh) * o.holdGrow : Infinity), held: true };
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

  // Mini-feed crop (video px, raw = unmirrored) around a head circle given in display (mirrored) px: a square ~3.2 r wide,
  // nudged down so head + shoulders show, kept inside the frame. Returns the logo circle inside an S x S canvas too.
  function miniCrop(c, vw, vh, S) {
    if (!c || !(vw > 0) || !(vh > 0)) return null;
    var side = Math.min(vw, vh, Math.max(40, c.r * 3.2)), rawX = vw - c.x;
    var sx = Math.max(0, Math.min(vw - side, rawX - side / 2)), sy = Math.max(0, Math.min(vh - side, c.y - side * 0.42));
    var k = S / side, lx = S - (rawX - sx) * k; // back to display (mirrored) coords inside the mini canvas
    return { sx: sx, sy: sy, side: side, logo: { x: lx, y: (c.y - sy) * k, r: c.r * k } };
  }
  var api = { photoUrl: photoUrl, initialOf: initialOf, faceCircle: faceCircle, headCircle: headCircle, plankHead: plankHead, miniCrop: miniCrop, createTracker: createTracker, mapToBox: mapToBox, KEY: KEY, P: P };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // ---- browser side ----
  var doc = root && root.document;
  var user = null, img = null, imgUrl = "", imgOk = false, overlays = {}, logo = null, logoOk = false, mini = { cv: null, lastT: -1e9, timer: null };
  function ensureLogo() {
    if (logo || typeof Image === "undefined") return;
    logo = new Image(); logo.decoding = "async"; logo.onload = function () { logoOk = true; }; logo.onerror = function () { logoOk = false; }; logo.src = P.logo;
  }
  function drawLogo(x, m) { // round-clipped Zabbadat mark (or a gradient Z if the file failed) + thin ring
    x.save(); x.beginPath(); x.arc(m.x, m.y, m.r, 0, Math.PI * 2); x.closePath(); x.clip();
    if (logo && logoOk) { var iw = logo.naturalWidth || logo.width, ih = logo.naturalHeight || logo.height, s = (2 * m.r) / Math.min(iw, ih); x.drawImage(logo, m.x - (iw * s) / 2, m.y - (ih * s) / 2, iw * s, ih * s); }
    else { var gr = x.createLinearGradient(m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r); gr.addColorStop(0, "#c6ff00"); gr.addColorStop(1, "#ff2e93"); x.fillStyle = gr; x.fillRect(m.x - m.r, m.y - m.r, 2 * m.r, 2 * m.r);
      x.fillStyle = "#0e1412"; x.font = "700 " + Math.round(m.r * 1.05) + "px Outfit, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("Z", m.x, m.y + m.r * 0.04); }
    x.restore(); x.beginPath(); x.arc(m.x, m.y, m.r, 0, Math.PI * 2); x.lineWidth = Math.max(1, m.r * 0.04); x.strokeStyle = "rgba(255,255,255,.85)"; x.stroke();
  }
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
  function clearAll() { for (var k in overlays) clearOne(overlays[k]); miniStop(); }
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
    drawLogo(x, m);
  }
  // Top-bar mini-feed: only while a pose loop is feeding frames (never opens a camera), ~15 fps, round crop around the head
  // with the logo on it. Reverts to the static photo / initial when frames stop or the switch goes off.
  function miniStop() {
    try { if (mini.timer) clearTimeout(mini.timer); mini.timer = null; if (mini.cv && mini.cv.parentNode) { var sp = mini.cv.parentNode; sp.removeChild(mini.cv); sp.classList.remove("pfp-live"); } mini.cv = null; mini.lastT = -1e9; } catch (e) {}
  }
  function miniFrame(vid, c, t) {
    var g = doc.getElementById("ztBadge"), sp = g && g.querySelector(".pfp-av"); if (!sp) { miniStop(); return; }
    if (mini.cv && mini.cv.parentNode !== sp) miniStop(); // badge was repainted
    if (t - mini.lastT < 1000 / P.miniFps) return; mini.lastT = t;
    var S = Math.round(P.miniSize * Math.min(root.devicePixelRatio || 1, 2));
    if (!mini.cv) { mini.cv = doc.createElement("canvas"); mini.cv.className = "pfp-mini"; mini.cv.width = S; mini.cv.height = S; sp.appendChild(mini.cv); sp.classList.add("pfp-live"); }
    var x = mini.cv.getContext("2d"), vw = vid.videoWidth, vh = vid.videoHeight;
    var cr = miniCrop(c, vw, vh, S) || (vw > 0 && vh > 0 ? miniCrop({ x: vw / 2, y: vh * 0.4, r: Math.min(vw, vh) * 0.25 }, vw, vh, S) : null);
    if (!cr) return;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, S, S);
    x.save(); x.translate(S, 0); x.scale(-1, 1); x.drawImage(vid, cr.sx, cr.sy, cr.side, cr.side, 0, 0, S, S); x.restore(); // mirrored like the main view
    if (c) drawLogo(x, cr.logo);
    if (mini.timer) clearTimeout(mini.timer); mini.timer = setTimeout(miniStop, P.clearMs);
  }
  // Called from the pose loops with the SAME keypoints the counter got. Returns undefined, never throws.
  function frame(vid, kps, t) {
    try {
      if (!doc || !vid || !vid.parentNode) return;
      var id = vid.id || "v", tt = typeof t === "number" && isFinite(t) ? t : Date.now();
      var hc = heads[id] || (heads[id] = { tr: createTracker(), c: null, t: 0 }); hc.c = hc.tr.step(kps, tt, vid.videoWidth, vid.videoHeight); hc.t = tt; // head spot for the recording watermark (pure maths)
      if (!isOn()) { var o0 = overlays[id]; if (o0) clearOne(o0); miniStop(); return; }
      ensureLogo();
      var o = overlayFor(vid), c = hc.c;
      draw(o, c);
      try { miniFrame(vid, c, tt); } catch (e) { miniStop(); }
      if (o.timer) clearTimeout(o.timer);
      o.timer = setTimeout(function () { clearOne(o); }, P.clearMs); // loop stopped (camera off): no stale picture
    } catch (e) {}
  }
  // Web plank: track the head while getting set; when the hold starts ("holding") pin the logo where the head was and keep it
  // fixed for the whole hold; release when the hold ends. Same visual-only, never-throws contract as frame().
  var pins = {}, heads = {};
  // Last head circle (video px, display/mirrored space) for a video, and whether the logo is showing - read by rec.js.
  function lastHead(id, now) { var h = heads[id]; if (pins[id] && isOn()) return pins[id]; return h && h.c && (now == null || now - h.t < P.clearMs) ? h.c : null; }
  api.lastHead = lastHead; api.drawLogo = function (x, m) { try { ensureLogo(); drawLogo(x, m); } catch (e) {} };
  function plankFrame(vid, kps, phase, t) {
    try {
      if (!doc || !vid || !vid.parentNode) return;
      var id = vid.id || "v";
      if (!isOn()) { pins[id] = null; var o0 = overlays[id]; if (o0) clearOne(o0); miniStop(); return; }
      if (phase !== "holding") { pins[id] = null; frame(vid, kps, t); return; }
      ensureLogo();
      var o = overlayFor(vid), tt = typeof t === "number" && isFinite(t) ? t : Date.now();
      if (!pins[id]) { var c = plankHead(kps, vid.videoWidth, vid.videoHeight) || o.tr.step(kps, tt, vid.videoWidth, vid.videoHeight); if (c) pins[id] = { x: c.x, y: c.y, r: c.r }; }
      draw(o, pins[id] || null);
      try { miniFrame(vid, pins[id] || null, tt); } catch (e) { miniStop(); }
      if (o.timer) clearTimeout(o.timer);
      o.timer = setTimeout(function () { pins[id] = null; clearOne(o); }, P.clearMs);
    } catch (e) {}
  }
  api.plankFrame = plankFrame; api._pin = function (id) { return pins[id || "plankVid"] || null; };
  api.setUser = setUser; api.frame = frame; api.isOn = isOn; api.setOn = setOn; api.paintBadge = paintBadge;
  if (root) root.ZabPfp = api;
  if (doc) {
    var wire = function () {
      try { var t = doc.getElementById("pfpToggle"); if (t && !t._pfp) { t._pfp = 1; t.addEventListener("change", function () { setOn(t.checked); }); } syncRow(); } catch (e) {}
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", wire); else wire();
  }
})(typeof window !== "undefined" ? window : this);
