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
  var P = { plausK: 3, plausBody: 0.75, plausSpread: 2.2, staleMs: 450, lockFrames: 2, shrinkMs: 280, growMs: 160, coverBack: "#0b0d1a", minScore: 0.35, headK: 1.0, eyeK: 2.7, shK: 0.62, padK: 1.65, holdMs: Infinity, holdGrow: 1, clearMs: 1200,
    minCut: 0.7, beta: 6, dCut: 2.5, leadMax: 180, leadCap: 0.35, leadV0: 0.55, leadV1: 1.8, vCut: 12, snapMs: 350, rafDraw: true, fitMs: 1000,
    spDead: 1.0, rGrowCut: 4, rShrinkCut: 0.8, dispK: 0.35, dispMinMs: 16, dispMaxMs: 32, dispRK: 2, dispSpK: 0, dispLead: true, reacqSnapR: 1, reacqMs: 150,
    shUp: 0.55, shR: 0.30, sideK: 0.35, sideUp: 0.35, minR: 10, maxRFrac: 0.5, plankR: 0.38, miniFps: 15, miniSize: 44, coverS: 128, logo: "/zd-square.png",
    headUp: 0.1, headRW: 0.6, coverPad: 0.45, topUp: 0.85, chinDn: 0.65, openR: 0.36, openY: 0.36, lockMs: 250, openMs: 8000 };
  // Centre + size (Nov 16, owner): horizontally dead-centre on the shoulder midpoint (the anchor; zero offset), vertically on
  // the head (ear line, else eye line, headUp x head width above it). Size covers the whole head with margin: r = max(headRW x
  // head width, shR x shoulder width, and far enough to reach every face point, the estimated top of the head (topUp x head
  // width above the ear line) and the chin (chinDn below) plus coverPad x head width). Later the same night the owner asked
  // for a slightly bigger logo: coverPad 0.25 -> 0.45, headRW 0.5 -> 0.6, shR 0.25 -> 0.30, so the whole cover (logo + edge)
  // scales up ~20% from the smallest passing size (about 0.8x shoulder width / 36.6 px on a 390-wide 4:3 view) to about 0.96x
  // / 44 px. Centering stays at 0 px; the plausibility guard and fallback are unchanged.
  // Open (Nov 16): when a camera opens the logo shows LARGE at once (openR x the short side, openY down the view, centred)
  // before any detection; the first lock moves + shrinks it onto the head over ~lockMs; a lost head holds its last spot.
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
    // ew: head width for the cover (ear to ear; else 2x the eye spread; else the face estimate)
    var ew = ok(lear) && ok(rear) ? d(lear, rear) : eyes.length === 2 ? d(le, re) * 2 : head / 1.35;
    return { x: cx, y: cy, r: (head / 2) * P.padK, w: ew, pts: face };
  }
  // Smallest r (around x, y) that covers the whole head: every face point, the head top and the chin, plus margin.
  function coverR(x, y, face) {
    var w = face.w || (face.r * 2 / P.padK), r = w * P.headRW, pad = w * P.coverPad, pts = (face.pts || []).slice();
    pts.push({ x: face.x, y: face.y - w * P.topUp }, { x: face.x, y: face.y + w * P.chinDn });
    for (var i = 0; i < pts.length; i++) r = Math.max(r, Math.hypot(pts[i].x - x, pts[i].y - y) + pad);
    return r;
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
    var shx = (ls.x + rs.x) / 2, shy = (ls.y + rs.y) / 2, sw = Math.hypot(ls.x - rs.x, ls.y - rs.y), w = face.w || (face.r * 2 / P.padK);
    var cx = shx, cy = Math.min(face.y - w * P.headUp, shy - sw * 0.2); // x: shoulder midpoint exactly; y: the head (never below the shoulder line)
    return { x: cx, y: cy, r: Math.max(sw * P.shR, coverR(cx, cy, face)) };
  }
  // Face only (no shoulder pair): centred on the head, same coverage rule.
  function faceOnly(face) { var w = face.w || (face.r * 2 / P.padK), cy = face.y - w * P.headUp; return { x: face.x, y: cy, r: coverR(face.x, cy, face) }; }
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
    if (face) return capCircle(faceOnly(face), "face", frameW, frameH);
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
    if (face) return capCircle(faceOnly(face), "plank", frameW, frameH);
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
    // Display stage (Nov 16, smoother): the drawn spot glides toward the tracker's target at screen-refresh rate instead of
    // stepping on each pose frame (10-15 per second on phones). disp = what is on screen; pi = measured pose-frame interval.
    var disp = null, pi = 66, lastStepT = null, reacq = false, dflt = null, locked = false;
    function predict(now, extra) {
      var x = f.x, y = f.y, lead = typeof now === "number" && isFinite(now) ? Math.max(0, Math.min(o.leadMax, now - f.t + (extra || 0))) / 1000 : 0;
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
      if (!f || !(dtS > 0) || dtS > o.snapMs / 1000) { reacq = !!f || !!held || !!disp; f = { x: head.x, y: head.y, dx: 0, dy: 0, vx: 0, vy: 0, k: 0, t: t, r: head.r, mx: head.x, my: head.y }; }
      else {
        var rx = (head.x - f.x) / dtS, ry = (head.y - f.y) / dtS, ad = lpA(o.dCut, dtS), al = lpA(o.vCut, dtS);
        f.dx += (rx - f.dx) * ad; f.dy += (ry - f.dy) * ad; // slow speed estimate: sets the smoothing (steady when still)
        f.vx += (rx - f.vx) * al; f.vy += (ry - f.vy) * al; // quick velocity: drives the prediction (follows a fast head)
        var mx = (head.x - f.mx) / dtS, my = (head.y - f.my) / dtS; f.mx = head.x; f.my = head.y; // this frame's own move (measured, not filtered)
        var vv = f.vx * f.vx + f.vy * f.vy; f.k = vv > 0 ? Math.max(0, Math.min(1, (mx * f.vx + my * f.vy) / vv)) : 0; // lead only while the head itself still moves that way (stops -> lead drops at once, no overshoot)
        var rr = Math.max(o.minR, head.r), sp = Math.max(0, Math.hypot(f.dx, f.dy) / rr - o.spDead), a = lpA(o.minCut + o.beta * sp, dtS); // spDead: landmark noise alone never opens the filter
        f.x += (head.x - f.x) * a; f.y += (head.y - f.y) * a;
        // Size on its own, heavier filter (Nov 16): grows quickly but smoothly (still covers), shrinks slowly; a flickering ear
        // or a one-frame source change no longer pops the size.
        var ar = lpA(head.r > f.r ? o.rGrowCut : o.rShrinkCut, dtS);
        f.r += (head.r - f.r) * ar; f.t = t;
      }
      f.src = src;
      return predict(drawT);
    }
    function holdOf(fw, fh) { return { x: last.x, y: last.y, r: Math.min(last.r * o.holdGrow, fw > 0 && fh > 0 ? o.maxRFrac * Math.min(fw, fh) * o.holdGrow : Infinity), held: true }; }
    function tauOf() { var t0 = Math.max(o.dispMinMs, Math.min(o.dispMaxMs, o.dispK * pi)), sp = f ? Math.hypot(f.dx, f.dy) / Math.max(o.minR, f.r) : 0; return Math.max(o.dispMinMs, t0 / (1 + o.dispSpK * sp)); } // quicker glide while the head moves fast (less lag)
    // What to draw at `now`: the target (prediction, or the held spot) passed through the display glide.
    // First lock: on the target at once (no ease-in, no slide from anywhere). Reacquire after a loss: a far jump snaps at
    // once; a small one (< reacqSnapR x r) eases over ~reacqMs instead of popping.
    function show(now) {
      var tau = tauOf(), tg = held ? held : (last && f ? predict(now, o.dispLead ? tau : 0) : null);
      if (!tg && dflt) { disp = { x: dflt.x, y: dflt.y, r: dflt.r, t: now, ease: 0 }; return { x: dflt.x, y: dflt.y, r: dflt.r, held: false, open: true }; }
      if (!tg) { disp = null; return null; }
      if (dflt) { dflt = null; reacq = false; if (disp) { disp.x = tg.x; disp.y = tg.y; disp.t = now; disp.ease = disp.lockEnd = now + o.lockMs; } } // first lock from the big start: centre snaps onto the head at once, only the size shrinks over lockMs
      if (!disp || !(now >= disp.t - 1e-6) && now < disp.t - 1000) { disp = { x: tg.x, y: tg.y, r: tg.r, t: now, ease: 0 }; reacq = false; }
      else {
        if (reacq) { reacq = false; if (Math.hypot(tg.x - disp.x, tg.y - disp.y) > o.reacqSnapR * Math.max(o.minR, tg.r)) { disp.x = tg.x; disp.y = tg.y; disp.r = tg.r; disp.t = now; } else disp.ease = now + o.reacqMs; }
        var dt = Math.max(0, now - disp.t), tp = disp.ease && now < disp.ease ? Math.max(tau, (disp.lockEnd ? o.lockMs : o.reacqMs) / 3) : tau;
        var lk = disp.lockEnd && now < disp.lockEnd, a = 1 - Math.exp(-dt / tp), ar = 1 - Math.exp(-dt / (lk ? tp : tp * o.dispRK));
        if (disp.lockEnd && now >= disp.lockEnd) { disp.x = tg.x; disp.y = tg.y; disp.r = tg.r; disp.lockEnd = 0; a = ar = 0; } // ease done: on the head
        if (lk) { disp.x = tg.x; disp.y = tg.y; } else { disp.x += (tg.x - disp.x) * a; disp.y += (tg.y - disp.y) * a; } // while shrinking after the first lock the centre stays locked on the head
        disp.r += (tg.r - disp.r) * ar; disp.t = now;
      }
      return { x: disp.x, y: disp.y, r: disp.r, held: !!(held && tg === held), src: tg.src };
    }
    return {
      step: function (kps, t, fw, fh, drawT, where) {
        if (lastStepT != null && t > lastStepT && t - lastStepT < 250) pi += (t - lastStepT - pi) * 0.2; // pose-frame interval (ms)
        lastStepT = t;
        var c = (where || headCircle)(kps, fw, fh);
        if (c) { var out = place(c, c.src, t, drawT); last = out; lastT = t; held = null; locked = true; return out; }
        if (last && t - lastT <= o.holdMs) { held = holdOf(fw, fh); return held; }
        if (dflt) return { x: dflt.x, y: dflt.y, r: dflt.r, held: false, open: true }; // still waiting for the first lock: keep the big start
        last = null; f = null; held = null; disp = null; return null;
      },
      // Camera opened: show the big start spot until the first lock (only before any lock on this camera).
      open: function (fw, fh, now) { if (locked) return null; dflt = openCircle(fw, fh); if (dflt) disp = { x: dflt.x, y: dflt.y, r: dflt.r, t: now || 0, ease: 0 }; return dflt; },
      locked: function () { return locked; },
      // Spot to draw at `now` (every screen refresh): the glided display spot following the prediction while the head moves,
      // the held spot while the face is missing, null when there is nothing to draw. The target never runs more than leadMax ms
      // past the last pose frame.
      at: function (now) {
        if (!held && (!last || !f) && !dflt) return null;
        return show(now);
      },
      target: function (now) { if (held) return held; if (!last || !f) return null; return predict(now); },
      reset: function () { last = null; lastT = -1e9; f = null; held = null; disp = null; reacq = false; lastStepT = null; dflt = null; locked = false; }
    };
  }
  // Video pixels -> CSS pixels of the element box (object-fit fill/contain/cover).
  function mapToBox(c, vw, vh, bw, bh, fit) {
    if (!c || !(vw > 0) || !(vh > 0)) return null;
    var sx = bw / vw, sy = bh / vh, ox = 0, oy = 0;
    if (fit === "contain" || fit === "cover") { var s = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy); ox = (bw - vw * s) / 2; oy = (bh - vh * s) / 2; sx = sy = s; }
    return { x: ox + c.x * sx, y: oy + c.y * sy, r: c.r * Math.max(sx, sy) };
  }

  // CSS transform that puts an S x S cover (transform-origin 0 0) on circle m: top-left at (x - r, y - r), scaled to 2r.
  // (Fix Nov 16: it used x - S/2, which shifted the logo by r - S/2 px left/up whenever r was not S/2 - the drift.)
  function coverTransform(m, S) { return "translate(" + (m.x - m.r) + "px," + (m.y - m.r) + "px) scale(" + ((2 * m.r) / S) + ")"; }
  // Big start spot when a camera opens (video px): centred, upper-middle, openR x the short side.
  function openCircle(fw, fh) { return fw > 0 && fh > 0 ? { x: fw / 2, y: fh * P.openY, r: P.openR * Math.min(fw, fh), open: true } : null; }

  // Mini-feed crop (video px, raw = unmirrored) around a head circle given in display (mirrored) px: a square ~3.2 r wide,
  // nudged down so head + shoulders show, kept inside the frame. Returns the logo circle inside an S x S canvas too.
  function miniCrop(c, vw, vh, S) {
    if (!c || !(vw > 0) || !(vh > 0)) return null;
    var side = Math.min(vw, vh, Math.max(40, c.r * 3.2)), rawX = vw - c.x;
    var sx = Math.max(0, Math.min(vw - side, rawX - side / 2)), sy = Math.max(0, Math.min(vh - side, c.y - side * 0.42));
    var k = S / side, lx = S - (rawX - sx) * k; // back to display (mirrored) coords inside the mini canvas
    return { sx: sx, sy: sy, side: side, logo: { x: lx, y: (c.y - sy) * k, r: c.r * k } };
  }
  var api = { photoUrl: photoUrl, initialOf: initialOf, faceCircle: faceCircle, headCircle: headCircle, plankHead: plankHead, coverCircle: coverCircle, coverTransform: coverTransform, openCircle: openCircle, miniCrop: miniCrop, createTracker: createTracker, mapToBox: mapToBox, KEY: KEY, P: P };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // ---- browser side ----
  var doc = root && root.document;
  var userSeen = false, user = null, img = null, imgUrl = "", imgOk = false, overlays = {}, logo = null, logoOk = false, mini = { cv: null, lastT: -1e9, timer: null };
  function ensureLogo() {
    if (logo || typeof Image === "undefined") return;
    logo = new Image(); logo.decoding = "async"; logo.onload = function () { logoOk = true; for (var k in overlays) overlays[k].painted = false; }; logo.onerror = function () { logoOk = false; }; logo.src = P.logo;
  }
  function drawLogo(x, m) { // round-clipped Zabbadat mark (or a gradient Z if the file failed) + thin ring
    x.save(); x.beginPath(); x.arc(m.x, m.y, m.r, 0, Math.PI * 2); x.closePath(); x.clip();
    x.fillStyle = P.coverBack; x.fillRect(m.x - m.r - 1, m.y - m.r - 1, 2 * m.r + 2, 2 * m.r + 2); // opaque backing: transparent bits of the mark never show what is under it
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
  function setOn(v) { try { var s = store(); if (s) s.setItem(KEY, v ? "1" : "0"); } catch (e) {} syncRow(); if (!v) clearAll(); try { syncHide(); if (v && doc) for (var k in OPEN_IDS) { var vv = doc.getElementById(k); if (vv && vv.videoWidth > 0) opened(vv); } } catch (e) {} emit(); }
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
    user = u && u.uid ? u : null; userSeen = true; try { syncHide(); } catch (e) {}
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
  function clearOne(o) { try { if (o.timer) clearTimeout(o.timer); o.timer = null; o.box = null; o.pl = o.pt = null; o.cv.style.display = "none"; o.cv.style.transform = "none"; o.tr.reset(); } catch (e) {} }
  // Switch off: no overlay, no pending clear timers, no mini-feed, no head spot left for recordings.
  function clearAll() { for (var k in overlays) clearOne(overlays[k]); miniStop(); for (var h in heads) heads[h] = null; for (var q in shields) shieldDrop(q); syncHide(); }
  // Camera left / End set / fail exit: drop this video's cover at once (do not wait for clearMs).
  function clear(id) {
    try {
      if (id) { if (overlays[id]) clearOne(overlays[id]); heads[id] = null; if (shields[id]) shieldUnlock(shields[id]); }
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
    if (!m || shields[o.vid.id]) { o.cv.style.display = "none"; return false; }
    paintCover(o);
    var S = P.coverS, b = o.box, L = (b && b.left != null ? b.left : 0), T = (b && b.top != null ? b.top : 0);
    if (o.pl !== L || o.pt !== T) { o.cv.style.left = L + "px"; o.cv.style.top = T + "px"; o.pl = L; o.pt = T; } // left/top only when the box moved: per-frame moves are transform-only (no layout)
    o.cv.style.transform = coverTransform(m, S);
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
    var x = mini.cv.getContext("2d"), sh = shields[vid.id], src = sh && sh.live && sh.snap ? sh.snap : null, vw = src ? src.width : 0, vh = src ? src.height : 0, sc = sh && sh.live ? sh.circle : null;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, S, S);
    var cr = src && sc ? miniCrop(sc, vw, vh, S) : null;
    if (!cr) { drawLogo(x, { x: S / 2, y: S / 2, r: S * 0.75 }); } // no locked, pose-matched frame: the logo only (never raw video)
    else { x.save(); x.translate(S, 0); x.scale(-1, 1); x.drawImage(src, cr.sx, cr.sy, cr.side, cr.side, 0, 0, S, S); x.restore(); drawLogo(x, cr.logo); } // same frame the pose ran on, logo on it
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
      var hc = heads[id] || (heads[id] = { tr: createTracker(), c: null, t: 0 }); hc.c = hc.tr.step(kps, tt, vid.videoWidth, vid.videoHeight, drawT, where); hc.t = tt; hc.timed = given && drawT !== tt;
      if (hc.c && hc.timed) { var g0 = hc.tr.at(drawT); if (g0) hc.c = g0; } // draw the glided spot (same as every screen refresh): no step at pose frames // head spot for the avatar, the recording and the watermark hop
      ensureLogo();
      var o = overlayFor(vid), c = hc.c;
      shieldPose(vid, kps, hc, where);
      draw(o, c);
      try { miniFrame(vid, c, tt); } catch (e) { miniStop(); }
      if (o.timer) clearTimeout(o.timer);
      o.timer = setTimeout(function () { clearOne(o); if (heads[id] === hc) heads[id] = null; }, P.clearMs); // loop stopped (camera off): no stale picture; next open starts big again
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
  // Camera opened (its <video> starts playing): show the logo LARGE at once, before any detection (owner, Nov 16).
  // The first pose frame that finds the head moves + shrinks it onto the head (tracker open/lock). Only the solo camera views.
  var OPEN_IDS = { camVid: 1, plankVid: 1, tbVid: 1, sqVid: 1, zlSelf: 1, zmCamVid: 1 };
  function opened(vid) {
    try {
      if (!doc || !vid || !vid.parentNode || !OPEN_IDS[vid.id] || !isOn() || !(vid.videoWidth > 0)) return;
      var id = vid.id, hc = heads[id], src = vid.srcObject || vid.currentSrc || null;
      shieldFor(vid, src);
      if (hc && hc.src === src && hc.tr.locked && hc.tr.locked()) return; // same stream, already on the head (a resume, not a new camera)
      // New camera or a switched track (front <-> rear, new stream): fresh tracker, big start, snap on its first lock.
      hc = heads[id] = { tr: createTracker(), c: null, t: perfNow(), timed: true, src: src };
      var n = perfNow(), c = hc.tr.open(vid.videoWidth, vid.videoHeight, n); if (!c) return;
      hc.c = c; ensureLogo();
      var o = overlayFor(vid); draw(o, c);
      if (o.timer) clearTimeout(o.timer);
      o.timer = setTimeout(function () { if (heads[id] === hc && !hc.tr.locked()) { clearOne(o); heads[id] = null; } }, P.openMs); // no pose loop came: drop it
    } catch (e) {}
  }
  api.opened = opened;

  // ---- Fail-safe shield (Nov 16, owner: zero face exposure) ----
  // With the PFP switch on, a camera <video> is NEVER shown: a stylesheet hides it (opacity 0) from before its first frame,
  // and a canvas in its place shows only frames that already carry the cover:
  //  * Blanket: before the first steady lock, and whenever tracking is lost, low-confidence (no face points), stale
  //    (no pose frame for staleMs), the tab was hidden, the camera / track / resolution changed, or the model never loads:
  //    the SAME logo scaled up past the box corners (opaque backing), no video at all.
  //  * Lock-on: the exact frame the pose ran on (snapshot taken right before inference, then the model runs on that
  //    snapshot), with the logo on that frame's head. Entering, the logo shrinks from the blanket to the head over shrinkMs;
  //    each step is a circle between two nested circles, so it always contains the head circle (no mid-shrink exposure).
  //  * Lost: the last covered frame stays frozen while the logo grows back to the blanket (growMs), then the blanket.
  var shields = {}, hideCss = null, HIDE_SEL = Object.keys(OPEN_IDS).map(function (k) { return "html.zab-pfp-shield video#" + k; }).join(",");
  function authPending() { return !userSeen; }
  function shieldWanted() { try { var s = store(); return !!s && s.getItem(KEY) === "1" && (!!user || authPending()); } catch (e) { return false; } }
  function syncHide() {
    try {
      if (!doc || !doc.documentElement) return;
      if (!hideCss) hideCss = doc.getElementById("pfpShieldCss"); // index.html <head> ships the rule (hidden from the first paint)
      if (!hideCss) { hideCss = doc.createElement("style"); hideCss.textContent = HIDE_SEL + "{opacity:0!important}"; (doc.head || doc.documentElement).appendChild(hideCss); }
      var on = shieldWanted(); doc.documentElement.classList.toggle("zab-pfp-shield", on);
      if (!on) for (var q in shields) shieldDrop(q);
    } catch (e) {}
  }
  function shieldUnlock(s) { if (s.lockT) { s.lostT = perfNow(); s.lostFrom = s.lastM; } s.lockT = 0; s.good = 0; s.live = false; }
  function shieldDrop(id) { var s = shields[id]; if (!s) return; s.dead = true; try { if (s.cv.parentNode) s.cv.parentNode.removeChild(s.cv); } catch (e) {} delete shields[id]; }
  function shieldFor(vid, src) {
    if (!doc || !vid || !vid.parentNode || !OPEN_IDS[vid.id] || !shieldWanted()) return null;
    syncHide();
    var s = shields[vid.id];
    if (s && (s.vid !== vid || !s.cv.parentNode)) { shieldDrop(vid.id); s = null; }
    if (!s) {
      var cv = doc.createElement("canvas"); cv.className = "pfp-shield"; cv.setAttribute("aria-hidden", "true");
      cv.style.cssText = "position:absolute;pointer-events:none;z-index:1;left:0;top:0;width:0;height:0";
      vid.parentNode.insertBefore(cv, vid.nextSibling);
      s = shields[vid.id] = { vid: vid, cv: cv, bufs: [doc.createElement("canvas"), doc.createElement("canvas"), doc.createElement("canvas")], bi: 0, pend: null, snap: null, circle: null, good: 0, lockT: 0, lostT: 0, lastPoseT: -1e9, live: false, src: src, vw: 0, vh: 0, frames: 0 };
      shieldLoop(s);
    }
    if (src !== undefined && s.src !== src) { s.src = src; shieldUnlock(s); s.lostT = 0; s.snap = null; } // new camera / track: blanket until it locks again
    return s;
  }
  // Called by the pose loops right before inference: snapshot the frame, and run the model on that snapshot when it can
  // (MoveNet takes a canvas; the iOS Vision bridge reads the <video> itself, so it gets the video, snapshot taken first).
  function input(vid, det) {
    try {
      var s = shieldWanted() && vid && OPEN_IDS[vid.id] ? shieldFor(vid) : null, vw = vid && vid.videoWidth, vh = vid && vid.videoHeight;
      if (!s || !(vw > 0 && vh > 0) || !(vid.readyState >= 2)) return vid;
      var b = s.bufs[s.bi]; s.bi = (s.bi + 1) % 3; // 3 buffers: one shown, one awaiting its pose, one being filled
      if (b.width !== vw || b.height !== vh) { b.width = vw; b.height = vh; }
      b.getContext("2d").drawImage(vid, 0, 0, vw, vh);
      s.pend = b; s.pendSrc = s.src;
      return det && det.engine === "vision" ? vid : b;
    } catch (e) { return vid; }
  }
  function enclose(a, b) { // smallest circle containing circles a and b
    if (!a) return b; if (!b) return a;
    var d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d + b.r <= a.r) return a; if (d + a.r <= b.r) return b;
    var r = (d + a.r + b.r) / 2, k = (r - a.r) / d;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, r: r };
  }
  // Plausibility guard (owner, Nov 16): a head far from the shoulders (more than plausK x the head / half-shoulder scale from
  // the nearest shoulder), or not beyond the shoulders as seen from the hips (on the body / between the hands), or face points
  // spread wider than the head can be, is not trusted: the blanket stays up instead of the logo jumping there.
  function plausible(kps, face) {
    var by = byName(kps || []), d = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };
    var ls = by.left_shoulder, rs = by.right_shoulder, lh = by.left_hip, rh = by.right_hip, sh = [ls, rs].filter(ok), hp = [lh, rh].filter(ok);
    var pts = face.pts || [], fx = face.x, fy = face.y, w = face.w || 0;
    for (var i = 0; i < pts.length; i++) if (d(pts[i], face) > P.plausSpread * Math.max(w, 1)) return false; // face points scattered
    if (!sh.length) return true; // no shoulders to check against (close-up selfie): the face points alone
    var smx = sh.reduce(function (a, k) { return a + k.x; }, 0) / sh.length, smy = sh.reduce(function (a, k) { return a + k.y; }, 0) / sh.length, torso = 0, hmx = 0, hmy = 0;
    if (hp.length) { hmx = hp.reduce(function (a, k) { return a + k.x; }, 0) / hp.length; hmy = hp.reduce(function (a, k) { return a + k.y; }, 0) / hp.length; torso = Math.hypot(smx - hmx, smy - hmy); }
    var sw = sh.length === 2 ? d(ls, rs) : 0, scale = Math.max(w, sw * 0.5, torso * 0.35, 8), near = Math.min.apply(null, sh.map(function (k) { return d(k, face); }));
    if (near > P.plausK * scale) return false; // head far from the shoulders
    if (torso > 10 && Math.hypot(fx - hmx, fy - hmy) < torso * P.plausBody) return false; // head not beyond the shoulders: on the body / between the hands
    return true;
  }
  api.plausible = plausible;
  function shieldPose(vid, kps, hc, where) {
    var s = shields[vid.id]; if (!s || s.dead) return;
    var vw = vid.videoWidth, vh = vid.videoHeight, snap = s.pend; s.pend = null;
    if (!snap || s.pendSrc !== s.src || snap.width !== vw || snap.height !== vh) { shieldUnlock(s); return; } // no matched frame (or a camera change in between): stay blanket
    var face = faceCircle(kps), raw = face && plausible(kps, face) ? (where || headCircle)(kps, vw, vh) : null;
    s.dbg = raw ? { kps: kps, c: null } : null;
    if (!raw) { shieldUnlock(s); return; } // no face points (lost / low confidence / hood) or an implausible pose: blanket, never a jump
    s.good += 1;
    s.snap = snap; s.circle = enclose(raw, hc && hc.c && !hc.c.open ? hc.c : null); s.dbg.c = s.circle; s.lastPoseT = perfNow(); s.vw = vw; s.vh = vh;
    if (!s.lockT && s.good >= P.lockFrames) { s.lockT = perfNow(); s.lostT = 0; }
    s.live = !!s.lockT;
  }
  function geom(s) { // box size, object-fit and mirroring of the hidden video (cached per size)
    var v = s.vid, bw = v.clientWidth, bh = v.clientHeight, key = bw + "x" + bh + "x" + v.videoWidth + "x" + v.videoHeight;
    if (s.key !== key || !(Date.now() - s.keyT < 1000)) {
      var fit = "fill", mir = false; try { var cs = root.getComputedStyle(v); fit = cs.objectFit || "fill"; var tf = cs.transform; if (tf && tf !== "none") { var mm = /matrix\(([^,]+)/.exec(tf); mir = !!mm && parseFloat(mm[1]) < 0; } } catch (e) {}
      s.key = key; s.keyT = Date.now(); s.fit = fit; s.mir = mir;
      if (s.vwSeen && (s.vwSeen !== v.videoWidth || s.vhSeen !== v.videoHeight)) { shieldUnlock(s); s.lostT = 0; } // resolution / orientation change: straight to the blanket (no frozen old frame)
      s.vwSeen = v.videoWidth; s.vhSeen = v.videoHeight;
    }
    return { bw: bw, bh: bh, fit: s.fit, mir: s.mir, left: v.offsetLeft, top: v.offsetTop };
  }
  function lerpC(a, b, p) { return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, r: a.r + (b.r - a.r) * p }; }
  function ease(p) { p = Math.max(0, Math.min(1, p)); return p * p * (3 - 2 * p); }
  function blanketAround(g, t) { // the logo past every box corner, grown if needed so it also contains circle t
    var c = { x: g.bw / 2, y: g.bh / 2, r: Math.hypot(g.bw, g.bh) / 2 + 2 };
    if (t) c.r = Math.max(c.r, Math.hypot(t.x - c.x, t.y - c.y) + t.r + 1);
    return c;
  }
  function drawSnap(x, g, snap, vw, vh) {
    var sx = g.bw / vw, sy = g.bh / vh, ox = 0, oy = 0;
    if (g.fit === "contain" || g.fit === "cover") { var k = g.fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy); ox = (g.bw - vw * k) / 2; oy = (g.bh - vh * k) / 2; sx = sy = k; }
    x.save(); if (g.mir) { x.translate(g.bw, 0); x.scale(-1, 1); } x.drawImage(snap, ox, oy, vw * sx, vh * sy); x.restore();
  }
  function shieldPaint(s) {
    var v = s.vid, cv = s.cv, g = geom(s), now = perfNow(), has = !!(v.srcObject || v.currentSrc) && !v.hidden && g.bw > 0 && g.bh > 0;
    if (cv.style.display !== (has ? "block" : "none")) cv.style.display = has ? "block" : "none";
    if (!has) { shieldUnlock(s); return; }
    var dpr = Math.min(root.devicePixelRatio || 1, 2), W = Math.round(g.bw * dpr), H = Math.round(g.bh * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    if (s.L !== g.left || s.T !== g.top || s.BW !== g.bw || s.BH !== g.bh) { cv.style.left = g.left + "px"; cv.style.top = g.top + "px"; cv.style.width = g.bw + "px"; cv.style.height = g.bh + "px"; s.L = g.left; s.T = g.top; s.BW = g.bw; s.BH = g.bh; }
    if (s.lockT && (now - s.lastPoseT > P.staleMs || (doc.visibilityState && doc.visibilityState !== "visible") || !(s.snap && s.snap.width === v.videoWidth && s.snap.height === v.videoHeight))) shieldUnlock(s);
    var x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    var m = null, gk = g.bw + "x" + g.bh + "x" + g.fit + "x" + g.mir + "x" + v.videoWidth + "x" + v.videoHeight;
    if (s.lockT && s.snap && s.circle) { s.lockG = gk;
      var t = mapToBox(s.circle, s.vw, s.vh, g.bw, g.bh, g.fit), B = blanketAround(g, t);
      m = lerpC(B, t, ease((now - s.lockT) / P.shrinkMs));
      x.clearRect(0, 0, g.bw, g.bh); drawSnap(x, g, s.snap, s.vw, s.vh);
    } else if (s.lostT && s.lostFrom && s.snap && now - s.lostT < P.growMs && s.lockG === gk && s.snap.width === s.vw && s.snap.height === s.vh) { // same box, fit, mirror and video size as the last locked frame only
      var B2 = blanketAround(g, s.lostFrom); m = lerpC(s.lostFrom, B2, ease((now - s.lostT) / P.growMs));
      x.clearRect(0, 0, g.bw, g.bh); drawSnap(x, g, s.snap, s.vw, s.vh); // the last covered frame, frozen, while the logo grows
    } else { m = blanketAround(g, null); x.fillStyle = P.coverBack; x.fillRect(0, 0, g.bw, g.bh); }
    ensureLogo(); drawLogo(x, m); s.lastM = s.lockT ? m : null; s.drawM = m; s.drawG = g; s.frames += 1;
    if (!s.lockT && !(s.lostT && now - s.lostT < P.growMs && s.lockG === gk)) { s.lastM = null; s.lostT = 0; }
  }
  function shieldLoop(s) {
    var raf = root && typeof root.requestAnimationFrame === "function" ? root.requestAnimationFrame : function (f) { return setTimeout(f, 16); };
    var tick = function () {
      if (s.dead) return;
      try { if (!shieldWanted() || !s.vid.isConnected) { shieldDrop(s.vid.id); return; } shieldPaint(s); } catch (e) {}
      raf.call(root, tick);
    };
    tick();
  }
  // Recording (rec.js): the same covered, pose-matched frame, or null = blanket (draw the logo full frame, no video).
  function recFrame(id) { var s = shields[id]; return s && s.live && s.snap && s.circle ? { img: s.snap, c: s.circle } : null; }
  api.input = input; api.recFrame = recFrame; api.shielded = function (id) { return !!shields[id] || shieldWanted(); };
  api._shields = shields;
  api.plankFrame = plankFrame;
  // First-lock speed (Nov 16): one inference on a blank 192 px frame right after the pose model loads, so the GPU shaders are
  // compiled before the first camera frame and the cover locks on the very first face frame at full speed. Never throws.
  function warmDetector(det) {
    try {
      if (!doc || !det || typeof det.estimatePoses !== "function") return Promise.resolve();
      var c = doc.createElement("canvas"); c.width = 192; c.height = 192; var x = c.getContext("2d"); if (x) x.fillRect(0, 0, 192, 192);
      return Promise.resolve(det.estimatePoses(c, { flipHorizontal: true })).then(function () {}, function () {});
    } catch (e) { return Promise.resolve(); }
  }
  api.warmDetector = warmDetector;
  api.setUser = setUser; api.frame = frame; api.isOn = isOn; api.setOn = setOn; api.onChange = onChange; api.paintBadge = paintBadge;
  if (root) root.ZabPfp = api;
  if (doc) {
    var wire = function () {
      try { syncHide(); } catch (e) {} // hide camera videos from the very start when the switch is on (before any camera opens)
      try { if (!doc._zabPfpVis) { doc._zabPfpVis = 1; doc.addEventListener("visibilitychange", function () { for (var q in shields) shieldUnlock(shields[q]); }); } } catch (e) {} // tab return: blanket until a fresh pose
      try { ensureLogo(); } catch (e) {} // preload the logo at page load: the first cover is the real logo, never a placeholder then a swap
      try { if (!doc._zabPfpOpen) { doc._zabPfpOpen = 1; var onV = function (e) { var v = e && e.target; if (v && v.tagName === "VIDEO") opened(v); }; doc.addEventListener("loadeddata", onV, true); doc.addEventListener("playing", onV, true); } } catch (e) {} // media events don't bubble: capture. loadeddata = the first frame is ready, so the cover is up before it shows
      try { var t = doc.getElementById("pfpToggle"); if (t && !t._pfp) { t._pfp = 1; t.addEventListener("change", function () { setOn(t.checked); }); } syncRow(); } catch (e) {}
      // Same setting flipped in another tab of this site: follow it here too.
      try { if (root.addEventListener && !root._zabPfpStore) { root._zabPfpStore = 1; root.addEventListener("storage", function (e) { if (e && e.key === KEY) { syncRow(); if (!isOn()) clearAll(); syncHide(); emit(); } }); } } catch (e) {}
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", wire); else wire();
  }
})(typeof window !== "undefined" ? window : this);
