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
  var P = { minScore: 0.35, headK: 1.0, eyeK: 2.7, shK: 0.62, padK: 1.65, holdMs: 1000, holdGrow: 1.18, clearMs: 1200,
    minCut: 0.8, beta: 6, dCut: 2.5, leadMax: 180, leadCap: 0.45, leadV0: 0.75, leadV1: 2.5, vCut: 12, snapMs: 350, rafDraw: true, fitMs: 1000,
    shUp: 0.55, shR: 0.483, sideK: 0.35, sideUp: 0.35, minR: 10, maxRFrac: 0.40, plankR: 0.28, miniFps: 15, miniSize: 44, coverS: 128, logo: "/zd-square.png" };
  // Sizes: face r = (ear-to-ear or eye spread x2.7)/2 x padK 1.65; when shoulders are also visible the cover is recentred
  // on the midpoint of the face (ears, else eyes) and the shoulder midpoint, vertically from the top of the face circle
  // down toward the shoulders, r = max(face r, shoulder width x shR, half the face-top-to-shoulder span). Shoulders-only:
  // centre shUp 0.55 shoulder widths above the shoulder midpoint, r = sw x shR. Side-on: just past the shoulder on the
  // hip->shoulder line (sideUp 0.35 of the torso), r = torso x plankR 0.28. r capped to [minR px, maxRFrac 0.40 x the shorter frame side].
  // Follow speed (Nov 15): One Euro filter on the centre, speed measured in head radii per second: minCut Hz when still (steady,
  // no shimmer), + beta x speed when moving (near-raw, little lag). Lead: the drawn spot is pushed ahead along the filtered
  // velocity by the time the pose took to come back (frame stamp -> draw, max leadMax ms), only once the head is really
  // moving (leadV0..leadV1 r/s ramp) and never more than leadCap x r. Visual only: the counter's keypoints are never touched.
  // Quicker (Nov 16): the logo is moved on every screen refresh (rafDraw) from the tracker's prediction for that moment,
  // not only when a pose frame lands (10-15 per second on phones), so it no longer freezes between frames. Prediction uses
  // its own quick velocity (vCut Hz); the steadiness at rest still comes from the slower speed estimate (dCut Hz) and the
  // leadV0 r/s dead zone. Lead stops the moment the head itself stops; up to leadMax ms / leadCap x r ahead. After the face
  // was gone snapMs+, it snaps straight onto the head when it comes back (no slide in from the old spot).
  // Sharper (Nov 16 later): the cover is a small canvas placed with a CSS transform (GPU) instead of a full-frame redraw;
  // One Euro is a bit quicker (beta / vCut / lead) while the rest dead zone is unchanged.

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
    // Horizontal + vertical: midpoint of the ears when both show (head centre), else the eyes, else the face cluster.
    // The nose is never mixed in: it sits low and off-centre on a turned face and pulled the logo down / sideways.
    if (ok(lear) && ok(rear)) { cx = (lear.x + rear.x) / 2; cy = (lear.y + rear.y) / 2; }
    else if (eyes.length === 2) { cx = (le.x + re.x) / 2; cy = (le.y + re.y) / 2; }
    else { cx = face.reduce(function (s, k) { return s + k.x; }, 0) / face.length; cy = face.reduce(function (s, k) { return s + k.y; }, 0) / face.length; }
    return { x: cx, y: cy, r: (head / 2) * P.padK };
  }
  // Head circle for the logo: the face cluster when it is there, else estimated from the shoulders (head down / hooded:
  // the logo still sits on the head). frameW/frameH (video px) only cap the size.
  function capCircle(c, src, frameW, frameH) {
    if (!c) return null;
    var maxR = frameW > 0 && frameH > 0 ? P.maxRFrac * Math.min(frameW, frameH) : Infinity;
    return { x: c.x, y: c.y, r: Math.max(P.minR, Math.min(maxR, c.r)), src: src };
  }
  // Cover over face + shoulders: centred horizontally on the midpoint of the face (ears/eyes) and the shoulders;
  // vertically the circle starts at the top of the face and reaches toward the shoulder line; size from head and shoulder width.
  function coverCircle(face, ls, rs) {
    var shx = (ls.x + rs.x) / 2, shy = (ls.y + rs.y) / 2, sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    var cx = (face.x + shx) / 2, top = face.y - face.r, r = Math.max(face.r, sw * P.shR, (shy - top) / 2);
    if (!(r > 0)) r = face.r;
    var cy = top + r, need = Math.hypot(face.x - cx, face.y - cy) + face.r * 0.5;
    if (need > r) { r = need; cy = top + r; }
    return { x: cx, y: cy, r: r };
  }
  function shoulderCircle(ls, rs) {
    var sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    return sw > 8 ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 - sw * P.shUp, r: sw * P.shR } : null;
  }
  function headCircle(kps, frameW, frameH) {
    var face = faceCircle(kps), by = kps && kps.length ? byName(kps) : {}, ls, rs, so, c, src;
    ls = by.left_shoulder || (kps && kps[5] && !kps[5].name ? kps[5] : null);
    rs = by.right_shoulder || (kps && kps[6] && !kps[6].name ? kps[6] : null);
    so = sideOn(by);
    if (face && ok(ls) && ok(rs)) {
      var sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      if (sw > 8 && !(so && sw < so.L * P.sideK)) return capCircle(coverCircle(face, ls, rs), "face", frameW, frameH);
    }
    if (face) return capCircle(face, "face", frameW, frameH);
    if (ok(ls) && ok(rs)) { c = shoulderCircle(ls, rs); if (c && !(so && Math.hypot(ls.x - rs.x, ls.y - rs.y) < so.L * P.sideK)) return capCircle(c, "shoulders", frameW, frameH); }
    if (so) return capCircle(so, "side", frameW, frameH);
    return null;
  }
  function byName(kps) { var by = {}; for (var i = 0; i < kps.length; i++) if (kps[i] && kps[i].name) by[kps[i].name] = kps[i]; return by; }
  // Side-on head estimate: just past the shoulder on the hip->shoulder line, r from the torso length. null without a
  // shoulder+hip pair on one side (or a torso under 20 px).
  function sideOn(by) {
    var pick = function (a, b) { return ok(by[a]) && ok(by[b]) ? [by[a], by[b]] : null; }, pr = pick("left_shoulder", "left_hip") || pick("right_shoulder", "right_hip");
    if (!pr) return null;
    var sh = pr[0], hp = pr[1], L = Math.hypot(sh.x - hp.x, sh.y - hp.y);
    return L > 20 ? { x: sh.x + (sh.x - hp.x) * P.sideUp, y: sh.y + (sh.y - hp.y) * P.sideUp, r: L * P.plankR, L: L } : null;
  }
  // Plank (side-on): the face cluster if it shows; else the head sits on the hip->shoulder line just past the shoulder
  // (side-on shoulders overlap, so the shoulder-width estimate is useless there); else the usual shoulder estimate.
  function plankHead(kps, frameW, frameH) {
    var face = faceCircle(kps), by = kps && kps.length ? byName(kps) : {}, so = sideOn(by);
    var ls = by.left_shoulder || (kps && kps[5] && !kps[5].name ? kps[5] : null);
    var rs = by.right_shoulder || (kps && kps[6] && !kps[6].name ? kps[6] : null);
    var sw = ok(ls) && ok(rs) ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : 0;
    if (face && sw > 8 && !(so && sw < so.L * P.sideK)) return capCircle(coverCircle(face, ls, rs), "face", frameW, frameH);
    if (face) return capCircle(face, "plank", frameW, frameH);
    if (so) return capCircle(so, "plank", frameW, frameH);
    return headCircle(kps, frameW, frameH);
  }
  // One Euro low-pass (Casiez et al. 2012): alpha from a cutoff that rises with speed. Pure.
  function lpA(cut, dtS) { var tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dtS); }
  // Head tracker: adaptive smoothing + latency lead; hold the last spot ~1 s (slightly bigger) when the face drops, then clear
  // (never blocks a hood). step(kps, t, fw, fh, drawT): t = frame stamp (before inference), drawT = now (optional, same clock).
  // at(now) (Nov 16): the same spot predicted for ANY moment, so the logo can be redrawn every screen refresh between pose
  // frames instead of freezing until the next one (the main lag at 10-15 pose fps). Same clock as t.
  function createTracker(opts) {
    var o = Object.assign({}, P, opts || {}), last = null, lastT = -1e9, f = null, held = null; // f: filter state {x, y, dx, dy} (px, px/s)
    function predict(now) {
      var x = f.x, y = f.y, lead = typeof now === "number" && isFinite(now) ? Math.max(0, Math.min(o.leadMax, now - f.t)) / 1000 : 0;
      if (lead > 0) {
        var v = Math.hypot(f.vx, f.vy), vr = v / Math.max(o.minR, f.r), g = Math.max(0, Math.min(1, (vr - o.leadV0) / (o.leadV1 - o.leadV0)));
        g *= f.k;
        var lx = f.vx * lead * g, ly = f.vy * lead * g, ll = Math.hypot(lx, ly), cap = o.leadCap * f.r;
        if (ll > cap) { lx *= cap / ll; ly *= cap / ll; }
        x += lx; y += ly;
      }
      return { x: x, y: y, r: f.r, held: false, src: f.src };
    }
    function place(head, src, t, drawT) {
      var dtS = f ? (t - f.t) / 1000 : 0;
      // Fresh start, or the face is back after a gap (held / lost): snap straight onto it with no velocity (no slide, no fling).
      if (!f || !(dtS > 0) || dtS > o.snapMs / 1000) f = { x: head.x, y: head.y, dx: 0, dy: 0, vx: 0, vy: 0, k: 0, t: t, r: head.r, mx: head.x, my: head.y };
      else {
        var rx = (head.x - f.x) / dtS, ry = (head.y - f.y) / dtS, ad = lpA(o.dCut, dtS), al = lpA(o.vCut, dtS);
        f.dx += (rx - f.dx) * ad; f.dy += (ry - f.dy) * ad; // slow speed estimate: sets the smoothing (steady when still)
        f.vx += (rx - f.vx) * al; f.vy += (ry - f.vy) * al; // quick velocity: drives the prediction (follows a fast head)
        var mx = (head.x - f.mx) / dtS, my = (head.y - f.my) / dtS; f.mx = head.x; f.my = head.y; // this frame's own move (measured, not filtered)
        var vv = f.vx * f.vx + f.vy * f.vy; f.k = vv > 0 ? Math.max(0, Math.min(1, (mx * f.vx + my * f.vy) / vv)) : 0; // lead only while the head itself still moves that way (stops -> lead drops at once, no overshoot)
        var rr = Math.max(o.minR, head.r), sp = Math.hypot(f.dx, f.dy) / rr, a = lpA(o.minCut + o.beta * sp, dtS);
        f.x += (head.x - f.x) * a; f.y += (head.y - f.y) * a;
        f.r = Math.max(head.r, f.r + (head.r - f.r) * a); f.t = t; // grows at once (always covers), shrinks smoothly
      }
      f.src = src;
      return predict(drawT);
    }
    function holdOf(fw, fh) { return { x: last.x, y: last.y, r: Math.min(last.r * o.holdGrow, fw > 0 && fh > 0 ? o.maxRFrac * Math.min(fw, fh) * o.holdGrow : Infinity), held: true }; }
    return {
      step: function (kps, t, fw, fh, drawT, where) {
        var c = (where || headCircle)(kps, fw, fh);
        if (c) { var out = place(c, c.src, t, drawT); last = out; lastT = t; held = null; return out; }
        if (last && t - lastT <= o.holdMs) { held = holdOf(fw, fh); return held; }
        last = null; f = null; held = null; return null;
      },
      // Spot to draw at `now` (between pose frames): predicted ahead while the head moves, the held spot while the face is
      // missing, null when there is nothing to draw. Never extrapolates more than leadMax ms past the last pose frame.
      at: function (now) {
        if (held) return held;
        if (!last || !f) return null;
        return predict(now);
      },
      reset: function () { last = null; lastT = -1e9; f = null; held = null; }
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
  var api = { photoUrl: photoUrl, initialOf: initialOf, faceCircle: faceCircle, headCircle: headCircle, plankHead: plankHead, coverCircle: coverCircle, miniCrop: miniCrop, createTracker: createTracker, mapToBox: mapToBox, KEY: KEY, P: P };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // ---- browser side ----
  var doc = root && root.document;
  var user = null, img = null, imgUrl = "", imgOk = false, overlays = {}, logo = null, logoOk = false, mini = { cv: null, lastT: -1e9, timer: null };
  function ensureLogo() {
    if (logo || typeof Image === "undefined") return;
    logo = new Image(); logo.decoding = "async"; logo.onload = function () { logoOk = true; for (var k in overlays) overlays[k].painted = false; }; logo.onerror = function () { logoOk = false; }; logo.src = P.logo;
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
  // ONE shared PFP setting (KEY, this device only): the top-bar "Enable profile - PFP" switch and the Live Match camera's
  // "Show my PFP" switch both read and write it. It drives, together: the avatar on camera, the head tracking that moves it,
  // and the avatar in recordings. Listeners (onChange) hear every flip so an open camera updates live.
  var changeFns = [];
  function onChange(fn) { if (typeof fn === "function") changeFns.push(fn); return function () { changeFns = changeFns.filter(function (f) { return f !== fn; }); }; }
  function emit() { var on = isOn(); for (var i = 0; i < changeFns.length; i++) { try { changeFns[i](on); } catch (e) {} } }
  function setOn(v) { try { var s = store(); if (s) s.setItem(KEY, v ? "1" : "0"); } catch (e) {} syncRow(); if (!v) clearAll(); emit(); }
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
    cv.style.cssText = "position:absolute;pointer-events:none;z-index:2;left:0;top:0;width:" + P.coverS + "px;height:" + P.coverS + "px;transform-origin:0 0;will-change:transform;display:none";
    vid.parentNode.insertBefore(cv, vid.nextSibling);
    o = overlays[id] = { cv: cv, vid: vid, tr: createTracker(), timer: null, painted: false };
    return o;
  }
  function clearOne(o) { try { if (o.timer) clearTimeout(o.timer); o.timer = null; o.box = null; o.cv.style.display = "none"; o.cv.style.transform = "none"; o.tr.reset(); } catch (e) {} }
  // Switch off: no overlay, no pending clear timers, no mini-feed, no head spot left for recordings.
  function clearAll() { for (var k in overlays) clearOne(overlays[k]); miniStop(); for (var h in heads) heads[h] = null; }
  // Camera left / End set / fail exit: drop this video's cover at once (do not wait for clearMs).
  function clear(id) {
    try {
      if (id) { if (overlays[id]) clearOne(overlays[id]); heads[id] = null; }
      else clearAll();
      var any = false; for (var h in heads) if (heads[h]) { any = true; break; }
      if (!any) miniStop();
    } catch (e) {}
  }
  // Paint the logo once onto the small cover canvas (S x S CSS). Moving it later is a CSS transform only.
  function paintCover(o) {
    var S = P.coverS, dpr = Math.min(root.devicePixelRatio || 1, 2), W = Math.round(S * dpr);
    if (o.cv.width !== W || o.cv.height !== W) { o.cv.width = W; o.cv.height = W; o.painted = false; }
    if (o.painted && o.paintedOk === logoOk) return;
    var x = o.cv.getContext("2d");
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, S, S);
    drawLogo(x, { x: S / 2, y: S / 2, r: S / 2 });
    o.painted = true; o.paintedOk = logoOk;
    o.cv.style.width = S + "px"; o.cv.style.height = S + "px";
  }
  // Place the small cover over the mapped circle with a GPU transform (no full-frame redraw).
  function placeCover(o, m) {
    if (!m) { o.cv.style.display = "none"; return false; }
    paintCover(o);
    var S = P.coverS, b = o.box;
    o.cv.style.left = (b && b.left != null ? b.left : 0) + "px";
    o.cv.style.top = (b && b.top != null ? b.top : 0) + "px";
    o.cv.style.transform = "translate(" + (m.x - S / 2) + "px," + (m.y - S / 2) + "px) scale(" + ((2 * m.r) / S) + ")";
    o.cv.style.display = "block";
    return true;
  }
  // Between pose frames (screen refresh): same box as the last full draw, no layout or style reads, just a new transform.
  function redraw(o, c) {
    if (!o.box || o.cv.style.display === "none") return false;
    var b = o.box, m = mapToBox(c, b.vw, b.vh, b.bw, b.bh, b.fit);
    return placeCover(o, m);
  }
  function draw(o, c) {
    var vid = o.vid, bw = vid.clientWidth, bh = vid.clientHeight; o.box = null;
    if (!(bw > 0 && bh > 0)) { clearOne(o); return; }
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    // Re-read object-fit when the box size changes (entering full screen flips fill -> contain) and at most once per fitMs otherwise.
    var now = Date.now(), fit = o.fit, sizeKey = bw + "x" + bh + "x" + (vid.videoWidth || 0) + "x" + (vid.videoHeight || 0);
    if (!fit || o.sizeKey !== sizeKey || !(now - o.fitT < P.fitMs)) { fit = "fill"; try { fit = root.getComputedStyle(vid).objectFit || "fill"; } catch (e) {} o.fit = fit; o.fitT = now; o.sizeKey = sizeKey; }
    var m = mapToBox(c, vid.videoWidth, vid.videoHeight, bw, bh, fit);
    o.box = { vw: vid.videoWidth, vh: vid.videoHeight, bw: bw, bh: bh, fit: fit, dpr: dpr, left: vid.offsetLeft, top: vid.offsetTop };
    if (!m) { o.cv.style.display = "none"; return; }
    placeCover(o, m);
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
  // t = the loop's frame stamp (performance.now() before inference); the gap to now is the lead the tracker makes up.
  function frame(vid, kps, t, where) {
    try {
      if (!doc || !vid || !vid.parentNode) return;
      var id = vid.id || "v", given = typeof t === "number" && isFinite(t), tt = given ? t : Date.now();
      // Switch off: avatar, its head tracking and the recording avatar all stop (rep counting never depends on this).
      if (!isOn()) { heads[id] = null; var o0 = overlays[id]; if (o0) clearOne(o0); miniStop(); return; }
      var drawT = given && root.performance && typeof root.performance.now === "function" ? root.performance.now() : tt;
      var hc = heads[id] || (heads[id] = { tr: createTracker(), c: null, t: 0 }); hc.c = hc.tr.step(kps, tt, vid.videoWidth, vid.videoHeight, drawT, where); hc.t = tt; hc.timed = given && drawT !== tt; // head spot for the avatar, the recording and the watermark hop
      ensureLogo();
      var o = overlayFor(vid), c = hc.c;
      draw(o, c);
      try { miniFrame(vid, c, tt); } catch (e) { miniStop(); }
      if (o.timer) clearTimeout(o.timer);
      o.timer = setTimeout(function () { clearOne(o); }, P.clearMs); // loop stopped (camera off): no stale picture
      if (hc.timed) refreshLoop(id, hc);
    } catch (e) {}
  }
  function perfNow() { return root.performance && typeof root.performance.now === "function" ? root.performance.now() : Date.now(); }
  // One rAF loop per camera while pose frames keep coming: redraw the logo at the predicted spot every screen refresh.
  // Stops by itself when the switch goes off, the head entry is replaced/cleared, the overlay is hidden, or frames stop.
  function refreshLoop(id, hc) {
    var raf = root && typeof root.requestAnimationFrame === "function" ? root.requestAnimationFrame : null;
    if (!P.rafDraw || !raf || hc.loop) return;
    hc.loop = true;
    var tick = function () {
      try {
        var o = overlays[id], n = perfNow();
        if (heads[id] !== hc || !o || !o.cv.parentNode || !isOn() || n - hc.t > P.clearMs) { hc.loop = false; return; }
        var c = hc.tr.at(n), p = hc.c; // skip the redraw when the spot has not visibly moved (head still: no extra work)
        if (c && !(p && Math.abs(c.x - p.x) < 0.25 && Math.abs(c.y - p.y) < 0.25 && Math.abs(c.r - p.r) < 0.25)) { hc.c = c; if (!redraw(o, c)) { hc.loop = false; return; } }
        raf.call(root, tick);
      } catch (e) { hc.loop = false; }
    };
    raf.call(root, tick);
  }
  // Web plank (Nov 15): the logo follows the head through the whole plank - getting set, the hold, and after - like push-ups
  // and TUT. Placement is plankHead (face cluster, else the side-on body line, else shoulders), same tracker as frame().
  // phase is accepted for the existing call but no longer changes anything. Same visual-only, never-throws contract.
  var heads = {};
  // Last head circle (video px, display/mirrored space) for a video, and whether the logo is showing - read by rec.js.
  function lastHead(id, now) { if (!isOn()) return null; var h = heads[id]; if (!(h && h.c && (now == null || now - h.t < P.clearMs))) return null; if (h.timed && now != null) { try { return h.tr.at(now) || h.c; } catch (e) {} } return h.c; } // predicted for `now` (same clock as the pose loops)
  api.lastHead = lastHead; api.clear = clear; api.drawLogo = function (x, m) { try { ensureLogo(); drawLogo(x, m); } catch (e) {} };
  function plankFrame(vid, kps, phase, t) { frame(vid, kps, t, plankHead); }
  api.plankFrame = plankFrame;
  api.setUser = setUser; api.frame = frame; api.isOn = isOn; api.setOn = setOn; api.onChange = onChange; api.paintBadge = paintBadge;
  if (root) root.ZabPfp = api;
  if (doc) {
    var wire = function () {
      try { var t = doc.getElementById("pfpToggle"); if (t && !t._pfp) { t._pfp = 1; t.addEventListener("change", function () { setOn(t.checked); }); } syncRow(); } catch (e) {}
      // Same setting flipped in another tab of this site: follow it here too.
      try { if (root.addEventListener && !root._zabPfpStore) { root._zabPfpStore = 1; root.addEventListener("storage", function (e) { if (e && e.key === KEY) { syncRow(); if (!isOn()) clearAll(); emit(); } }); } } catch (e) {}
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", wire); else wire();
  }
})(typeof window !== "undefined" ? window : this);
