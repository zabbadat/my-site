/* Zabbadat daily Magic Eye (autostereogram).
 * Random-dot, union-find linking like daily.py. Seeded by the America/New_York
 * date from et-day.js so everyone sees the same shape until Eastern midnight.
 * The picture is generated at the canvas's CSS size × devicePixelRatio so the
 * repeat period stays ~80–100 CSS px on a phone (large enough to fuse). A
 * 1400×900 bitmap downscaled into a 343 px column shrinks the period to ~29 px
 * and blurs sub-pixel dots, so the hidden shape will not pop.
 * Wall-eyed default (relax / look through): nearer = narrower separation. Optional cross-eyed mode flips that.
 * Browser: window.ZabbadatMagicEye. Node: require("./magic-eye.js").
 */
(function (root) {
  "use strict";
  var SRC_W = 700, SRC_H = 450, SCALE = 2, BASE = 60, AMP = 14, BLUR = 5, GAIN = 1.5;
  var PERIOD_CSS_MIN = 80, PERIOD_CSS_MAX = 140, AMP_FRAC = 0.3, CELL_CSS = 2, BOLD = 1.22;
  var DEFAULT_MODE = "wall";
  var TIP_CROSS = "Tap for full screen. Cross your eyes until the two dots become three. Hold still and the shape floats up.";
  var TIP_WALL = "Tap for full screen. Relax your eyes and look through the picture, as if at something far behind it, until the two dots become three. Hold still and the shape floats up.";
  var TIP_CROSS_FS = "Tap the picture to go back. Cross your eyes until the two dots become three. Hold still and the shape floats up.";
  var TIP_WALL_FS = "Tap the picture to go back. Relax your eyes and look through the picture, as if at something far behind it, until the two dots become three. Hold still and the shape floats up.";
  function tipFor(mode, fs) {
    if (fs) return mode === "cross" ? TIP_CROSS_FS : TIP_WALL_FS;
    return mode === "cross" ? TIP_CROSS : TIP_WALL;
  }
  // iOS Safari does not synthesize click on a canvas unless cursor is pointer (zoom-in is not enough).
  // Also listen for touchend/pointerup, debounce so touchend + click do not open-then-close.
  function bindTap(el, fn) {
    if (!el || el._meTapBound) return;
    el._meTapBound = true;
    var last = 0;
    function go(e) {
      var now = Date.now();
      if (now - last < 500) {
        if (e && e.cancelable) e.preventDefault();
        return;
      }
      last = now;
      if (e && e.type === "touchend" && e.cancelable) e.preventDefault();
      fn(e);
    }
    el.addEventListener("click", go);
    el.addEventListener("pointerup", function (e) {
      if (e && e.pointerType === "touch") return; // touchend handles this; avoid double fire
      go(e);
    });
    el.addEventListener("touchend", go, { passive: false });
  }

  var SHAPE_NAMES = [
    "heart", "star", "letter Z", "lightning bolt", "smiley face",
    "crescent moon", "dumbbell", "number 7", "arrow", "crown"
  ];
  var PAL = [
    [255, 60, 90], [255, 200, 40], [40, 170, 255], [120, 230, 120],
    [180, 90, 255], [250, 250, 250], [25, 25, 45], [255, 130, 30]
  ];

  function isLeap(y) { return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0); }
  function toOrdinal(y, m, d) {
    var y0 = y - 1;
    var days = y0 * 365 + Math.floor(y0 / 4) - Math.floor(y0 / 100) + Math.floor(y0 / 400);
    var md = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    days += md[m] + d;
    if (m > 2 && isLeap(y)) days += 1;
    return days;
  }
  function parseKey(key) {
    var p = String(key || "").split("-");
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  function ordinalFromKey(key) {
    var p = parseKey(key);
    return toOrdinal(p.y, p.m, p.d);
  }
  function shapeIndex(key) { return ((ordinalFromKey(key) % 10) + 10) % 10; }
  function shapeName(key) { return SHAPE_NAMES[shapeIndex(key)]; }
  function pyRound(x) {
    var n = Math.floor(x), f = x - n;
    if (f < 0.5) return n;
    if (f > 0.5) return n + 1;
    return n % 2 === 0 ? n : n + 1;
  }
  function rngFromSeed(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(rng, arr) {
    var i, j, t;
    for (i = arr.length - 1; i > 0; i--) {
      j = Math.floor(rng() * (i + 1));
      t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Phone-first layout: keep the fusion period in CSS pixels, not canvas pixels.
  function layoutFor(cssW, dpr) {
    cssW = Math.max(160, Math.round(Number(cssW) || 0));
    dpr = Number(dpr);
    if (!isFinite(dpr) || dpr < 1) dpr = 1;
    if (dpr > 3) dpr = 3;
    var cssH = Math.round(cssW * SRC_H / SRC_W);
    // ~cssW/3.6, clamped 80–140 CSS px. A phone column (~343 px) lands near 95;
    // a landscape full-screen picture (~490+ px) can reach the 140 cap.
    var periodCss = Math.round(Math.max(PERIOD_CSS_MIN, Math.min(PERIOD_CSS_MAX, cssW / 3.6)));
    var ampCss = Math.max(20, Math.round(periodCss * AMP_FRAC));
    var cell = CELL_CSS;
    var genW = Math.max(80, Math.round(cssW / cell));
    var genH = Math.max(50, Math.round(cssH / cell));
    var base = Math.max(8, Math.round(periodCss / cell));
    var amp = Math.max(4, Math.round(ampCss / cell));
    if (amp >= base - 4) amp = Math.max(4, base - 5);
    return {
      cssW: cssW, cssH: cssH, dpr: dpr,
      genW: genW, genH: genH,
      pixW: Math.round(cssW * dpr), pixH: Math.round(cssH * dpr),
      base: base, amp: amp, cell: cell, periodCss: periodCss, ampCss: ampCss
    };
  }

  function makeMask(W, H) { return new Uint8Array(W * H); }
  function setPx(m, W, H, x, y, v) {
    if (x >= 0 && x < W && y >= 0 && y < H) m[y * W + x] = v;
  }
  function fillEllipse(m, W, H, x0, y0, x1, y1, v) {
    var a = (x1 - x0) / 2, b = (y1 - y0) / 2;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (a <= 0 || b <= 0) return;
    var y, x, yy, rx, xL, xR;
    var yMin = Math.max(0, Math.floor(y0)), yMax = Math.min(H - 1, Math.ceil(y1));
    for (y = yMin; y <= yMax; y++) {
      yy = (y + 0.5 - cy) / b;
      rx = a * Math.sqrt(Math.max(0, 1 - yy * yy));
      xL = Math.max(0, Math.ceil(cx - rx));
      xR = Math.min(W - 1, Math.floor(cx + rx));
      for (x = xL; x <= xR; x++) m[y * W + x] = v;
    }
  }
  function fillRect(m, W, H, x0, y0, x1, y1, v) {
    var x, y;
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(W - 1, Math.round(x1)); y1 = Math.min(H - 1, Math.round(y1));
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) m[y * W + x] = v;
  }
  function fillRoundRect(m, W, H, x0, y0, x1, y1, r, v) {
    var x, y, dx, dy;
    r = Math.max(0, r);
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        dx = 0; dy = 0;
        if (x < x0 + r && y < y0 + r) { dx = x0 + r - x; dy = y0 + r - y; }
        else if (x > x1 - r && y < y0 + r) { dx = x - (x1 - r); dy = y0 + r - y; }
        else if (x < x0 + r && y > y1 - r) { dx = x0 + r - x; dy = y - (y1 - r); }
        else if (x > x1 - r && y > y1 - r) { dx = x - (x1 - r); dy = y - (y1 - r); }
        if (dx * dx + dy * dy <= r * r + r) setPx(m, W, H, x, y, v);
      }
    }
  }
  function fillPoly(m, W, H, pts, v) {
    var n = pts.length, y, x, i, j, y0, y1, x0, x1, t, xs, k, wind, xi;
    var minY = H, maxY = -1;
    for (i = 0; i < n; i++) { t = pts[i][1]; if (t < minY) minY = t; if (t > maxY) maxY = t; }
    minY = Math.max(0, Math.floor(minY)); maxY = Math.min(H - 1, Math.ceil(maxY));
    for (y = minY; y <= maxY; y++) {
      var yy = y + 0.5;
      xs = [];
      for (i = 0, j = n - 1; i < n; j = i++) {
        y0 = pts[j][1]; y1 = pts[i][1];
        if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) {
          x0 = pts[j][0]; x1 = pts[i][0];
          xi = x0 + (yy - y0) * (x1 - x0) / (y1 - y0);
          xs.push({ x: xi, w: y1 > y0 ? 1 : -1 });
        }
      }
      xs.sort(function (a, b) { return a.x - b.x; });
      wind = 0;
      for (k = 0; k < xs.length - 1; k++) {
        wind += xs[k].w;
        if (wind !== 0) {
          var a = Math.max(0, Math.ceil(xs[k].x)), b = Math.min(W - 1, Math.floor(xs[k + 1].x));
          for (x = a; x <= b; x++) m[y * W + x] = v;
        }
      }
    }
  }
  function strokeArc(m, W, H, x0, y0, x1, y1, startDeg, endDeg, width, v) {
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var a = (x1 - x0) / 2, b = (y1 - y0) / 2;
    var step = 0.5 * Math.PI / 180, rad0 = startDeg * Math.PI / 180, rad1 = endDeg * Math.PI / 180;
    var hw = width / 2, t, dx, dy, px, py;
    for (t = rad0; t <= rad1 + 1e-6; t += step) {
      px = cx + a * Math.cos(t);
      py = cy + b * Math.sin(t);
      for (dy = -Math.ceil(hw); dy <= Math.ceil(hw); dy++) {
        for (dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) {
          if (dx * dx + dy * dy <= hw * hw + hw) setPx(m, W, H, Math.round(px + dx), Math.round(py + dy), v);
        }
      }
    }
  }

  // Coordinates are authored on a 700×450 field, then scaled. `bold` enlarges the shape.
  function u(n, s) { return n * s; }
  function fillHeart(m, W, H, s, bold) {
    var cx = W / 2, cy = H / 2, x, y, X, Y, sx = 150 * s * bold, sy = 165 * s * bold;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        X = (x - cx) / sx;
        Y = -(y - cy) / sy + 0.25;
        if ((X * X + Y * Y - 1) * (X * X + Y * Y - 1) * (X * X + Y * Y - 1) - X * X * Y * Y * Y <= 0) m[y * W + x] = 255;
      }
    }
  }
  function fillStar(m, W, H, s, bold) {
    var cx = W / 2, cy = H / 2, pts = [], i, a, rad, n = 5, R = 170 * s * bold, r = 70 * s * bold;
    for (i = 0; i < 2 * n; i++) {
      a = Math.PI / 2 + i * Math.PI / n;
      rad = i % 2 === 0 ? R : r;
      pts.push([cx + rad * Math.cos(a), cy - rad * Math.sin(a)]);
    }
    fillPoly(m, W, H, pts, 255);
  }
  function fillLetterZ(m, W, H, s, bold) {
    var cx = W / 2, cy = H / 2, k = s * bold, ox = cx - u(350, k), oy = cy - u(225, k);
    fillPoly(m, W, H, [
      [ox + u(248, k), oy + u(103, k)], [ox + u(451, k), oy + u(103, k)], [ox + u(451, k), oy + u(148, k)],
      [ox + u(340, k), oy + u(148, k)], [ox + u(451, k), oy + u(290, k)], [ox + u(451, k), oy + u(335, k)],
      [ox + u(248, k), oy + u(335, k)], [ox + u(248, k), oy + u(290, k)], [ox + u(360, k), oy + u(290, k)],
      [ox + u(248, k), oy + u(148, k)], [ox + u(248, k), oy + u(103, k)]
    ], 255);
  }
  function fillNumber7(m, W, H, s, bold) {
    var cx = W / 2, cy = H / 2, k = s * bold, ox = cx - u(350, k), oy = cy - u(225, k);
    fillPoly(m, W, H, [
      [ox + u(254, k), oy + u(95, k)], [ox + u(441, k), oy + u(95, k)], [ox + u(441, k), oy + u(140, k)],
      [ox + u(360, k), oy + u(140, k)], [ox + u(300, k), oy + u(342, k)], [ox + u(254, k), oy + u(342, k)],
      [ox + u(318, k), oy + u(140, k)], [ox + u(254, k), oy + u(140, k)]
    ], 255);
  }
  function fillLightning(m, W, H, s, bold) {
    var k = s * bold, cx = W / 2, cy = H / 2, ox = cx - u(350, k), oy = cy - u(225, k);
    fillPoly(m, W, H, [[390, 40], [250, 250], [340, 250], [290, 410], [460, 180], [365, 180], [430, 40]].map(function (p) {
      return [ox + u(p[0], k), oy + u(p[1], k)];
    }), 255);
  }
  function fillSmiley(m, W, H, s, bold) {
    var cx = W / 2, cy = H / 2, k = s * bold;
    fillEllipse(m, W, H, cx - 170 * k, cy - 170 * k, cx + 170 * k, cy + 170 * k, 255);
    fillEllipse(m, W, H, cx - 80 * k, cy - 90 * k, cx - 30 * k, cy - 30 * k, 0);
    fillEllipse(m, W, H, cx + 30 * k, cy - 90 * k, cx + 80 * k, cy - 30 * k, 0);
    strokeArc(m, W, H, cx - 100 * k, cy - 40 * k, cx + 100 * k, cy + 110 * k, 20, 160, 22 * k, 0);
  }
  function fillMoon(m, W, H, s, bold) {
    var cx = W / 2, cy = H / 2, k = s * bold;
    fillEllipse(m, W, H, cx - 170 * k, cy - 170 * k, cx + 170 * k, cy + 170 * k, 255);
    fillEllipse(m, W, H, cx - 80 * k, cy - 200 * k, cx + 230 * k, cy + 130 * k, 0);
  }
  function fillDumbbell(m, W, H, s, bold) {
    var cx = W / 2, cy = H / 2, k = s * bold;
    fillRect(m, W, H, cx - 160 * k, cy - 25 * k, cx + 160 * k, cy + 25 * k, 255);
    fillRoundRect(m, W, H, cx - 250 * k, cy - 110 * k, cx - 150 * k, cy + 110 * k, 20 * k, 255);
    fillRoundRect(m, W, H, cx + 150 * k, cy - 110 * k, cx + 250 * k, cy + 110 * k, 20 * k, 255);
  }
  function fillArrow(m, W, H, s, bold) {
    var k = s * bold, cx = W / 2, cy = H / 2, ox = cx - u(350, k), oy = cy - u(225, k);
    fillPoly(m, W, H, [[150, 190], [400, 190], [400, 100], [580, 225], [400, 350], [400, 260], [150, 260]].map(function (p) {
      return [ox + u(p[0], k), oy + u(p[1], k)];
    }), 255);
  }
  function fillCrown(m, W, H, s, bold) {
    var k = s * bold, cx = W / 2, cy = H / 2, ox = cx - u(350, k), oy = cy - u(225, k);
    fillPoly(m, W, H, [[170, 330], [170, 140], [260, 230], [350, 100], [440, 230], [530, 140], [530, 330]].map(function (p) {
      return [ox + u(p[0], k), oy + u(p[1], k)];
    }), 255);
  }
  var DRAW = [
    fillHeart, fillStar, fillLetterZ, fillLightning, fillSmiley,
    fillMoon, fillDumbbell, fillNumber7, fillArrow, fillCrown
  ];

  function gaussKernel(sigma) {
    var r = Math.max(1, Math.ceil(3 * sigma)), n = 2 * r + 1, k = new Float32Array(n), i, s = 0, x;
    for (i = 0; i < n; i++) { x = i - r; k[i] = Math.exp(-(x * x) / (2 * sigma * sigma)); s += k[i]; }
    for (i = 0; i < n; i++) k[i] /= s;
    return { k: k, r: r };
  }
  function blurGain(mask, W, H, blur) {
    var ker = gaussKernel(blur), k = ker.k, r = ker.r;
    var tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    var x, y, i, s, t, xx, yy, row;
    for (y = 0; y < H; y++) {
      row = y * W;
      for (x = 0; x < W; x++) {
        s = 0;
        for (i = 0; i < k.length; i++) {
          xx = x + i - r;
          if (xx < 0) xx = 0; else if (xx >= W) xx = W - 1;
          s += k[i] * mask[row + xx];
        }
        tmp[row + x] = s;
      }
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        s = 0;
        for (i = 0; i < k.length; i++) {
          yy = y + i - r;
          if (yy < 0) yy = 0; else if (yy >= H) yy = H - 1;
          s += k[i] * tmp[yy * W + x];
        }
        t = (s / 255) * GAIN;
        out[y * W + x] = t < 0 ? 0 : t > 1 ? 1 : t;
      }
    }
    return out;
  }

  function buildDepth(key, W, H, bold) {
    var m = makeMask(W, H);
    var s = W / SRC_W;
    DRAW[shapeIndex(key)](m, W, H, s, bold == null ? 1 : bold);
    var blur = Math.max(1.2, BLUR * (W / SRC_W));
    return blurGain(m, W, H, blur);
  }

  function renderRow(depth, y, W, base, amp, mode, pal, rng, rowOut) {
    var same = new Int32Array(W), c, sep, l, rr, cols, i, d, sign;
    sign = mode === "wall" ? -1 : 1; // cross-eyed: near = wider sep; wall-eyed: near = narrower
    for (c = 0; c < W; c++) same[c] = c;
    for (c = 0; c < W; c++) {
      d = depth[y * W + c];
      sep = pyRound(base + sign * amp * d);
      if (sep < 4) sep = 4;
      l = c - (sep >> 1);
      rr = l + sep;
      if (l >= 0 && rr < W) {
        while (same[l] !== l) l = same[l];
        while (same[rr] !== rr) rr = same[rr];
        if (l !== rr) {
          if (l < rr) same[rr] = l;
          else same[l] = rr;
        }
      }
    }
    cols = new Uint8Array(W);
    for (c = 0; c < W; c++) cols[c] = Math.floor(rng() * pal.length);
    for (c = 0; c < W; c++) {
      i = same[c] === c ? cols[c] : null;
      if (i == null) {
        rowOut[c * 3] = rowOut[same[c] * 3];
        rowOut[c * 3 + 1] = rowOut[same[c] * 3 + 1];
        rowOut[c * 3 + 2] = rowOut[same[c] * 3 + 2];
      } else {
        rowOut[c * 3] = pal[i][0];
        rowOut[c * 3 + 1] = pal[i][1];
        rowOut[c * 3 + 2] = pal[i][2];
      }
    }
    return { same: same };
  }

  function renderBitmap(key, opts) {
    opts = opts || {};
    var W = opts.w || SRC_W, H = opts.h || SRC_H;
    var base = opts.base == null ? BASE : opts.base;
    var amp = opts.amp == null ? AMP : opts.amp;
    var mode = opts.mode === "wall" ? "wall" : "cross";
    var bold = opts.bold == null ? 1 : opts.bold;
    var depth = buildDepth(key, W, H, bold), ord = ordinalFromKey(key);
    var rng = rngFromSeed(ord);
    var pal = PAL.map(function (c) { return c.slice(); });
    shuffle(rng, pal);
    var img = new Uint8ClampedArray(W * H * 3);
    var y, row = new Uint8ClampedArray(W * 3);
    for (y = 0; y < H; y++) {
      renderRow(depth, y, W, base, amp, mode, pal, rng, row);
      img.set(row, y * W * 3);
    }
    return {
      width: W, height: H, data: img, depth: depth, name: shapeName(key),
      index: shapeIndex(key), ordinal: ord, base: base, amp: amp, mode: mode
    };
  }

  function scaleNearestAndDots(bmp, pixW, pixH) {
    pixW = pixW || bmp.width * SCALE;
    pixH = pixH || bmp.height * SCALE;
    var out = new Uint8ClampedArray(pixW * pixH * 4);
    var x, y, sx, sy, j, p, W = bmp.width, H = bmp.height;
    for (y = 0; y < pixH; y++) {
      sy = Math.min(H - 1, Math.floor(y * H / pixH));
      for (x = 0; x < pixW; x++) {
        sx = Math.min(W - 1, Math.floor(x * W / pixW));
        p = (sy * W + sx) * 3;
        j = (y * pixW + x) * 4;
        out[j] = bmp.data[p];
        out[j + 1] = bmp.data[p + 1];
        out[j + 2] = bmp.data[p + 2];
        out[j + 3] = 255;
      }
    }
    // Guide dots one background period apart, centered. Radius ~8 CSS px
    // (periodPix / css scale ≈ dpr; rCss=8 → rPix = 8 * pixW / cssW, but cssW is
    // unknown here; use a fraction of the period, at least 8px, typ. 8 CSS px when pix=css*dpr and period~90).
    var periodPix = bmp.base * (pixW / W);
    var r = Math.max(8, Math.round(periodPix * 0.09));
    var outline = Math.max(2, Math.round(r * 0.3));
    var gy = Math.round(Math.max(r + outline + 4, pixH * 0.04 + r));
    var mid = pixW / 2;
    function dot(gx) {
      var x, y, dx, dy, j, d2, ro = r + outline, cx = Math.round(gx), cy = gy;
      for (y = cy - ro; y <= cy + ro; y++) {
        for (x = cx - ro; x <= cx + ro; x++) {
          if (x < 0 || y < 0 || x >= pixW || y >= pixH) continue;
          dx = x - cx; dy = y - cy; d2 = dx * dx + dy * dy;
          j = (y * pixW + x) * 4;
          if (d2 <= r * r) { out[j] = 0; out[j + 1] = 0; out[j + 2] = 0; out[j + 3] = 255; }
          else if (d2 <= ro * ro) { out[j] = 255; out[j + 1] = 255; out[j + 2] = 255; out[j + 3] = 255; }
        }
      }
    }
    dot(mid - periodPix / 2);
    dot(mid + periodPix / 2);
    return { width: pixW, height: pixH, data: out, periodPix: periodPix, guideY: gy, guideR: r };
  }

  function meanSeparation(bmp) {
    var inside = 0, outside = 0, nIn = 0, nOut = 0, i, d, sep, sign;
    sign = bmp.mode === "wall" ? -1 : 1;
    for (i = 0; i < bmp.depth.length; i++) {
      d = bmp.depth[i];
      sep = pyRound(bmp.base + sign * bmp.amp * d);
      if (d > 0.8) { inside += sep; nIn++; }
      else if (d < 0.1) { outside += sep; nOut++; }
    }
    return { inside: nIn ? inside / nIn : 0, outside: nOut ? outside / nOut : 0, nIn: nIn, nOut: nOut };
  }

  function paintCanvas(canvas, rgba) {
    var ctx = canvas.getContext("2d", { alpha: false });
    canvas.width = rgba.width;
    canvas.height = rgba.height;
    if (ctx.imageSmoothingEnabled != null) ctx.imageSmoothingEnabled = false;
    if (ctx.webkitImageSmoothingEnabled != null) ctx.webkitImageSmoothingEnabled = false;
    if (ctx.mozImageSmoothingEnabled != null) ctx.mozImageSmoothingEnabled = false;
    var img;
    if (typeof ImageData === "function") {
      try { img = new ImageData(rgba.data, rgba.width, rgba.height); }
      catch (e) { img = ctx.createImageData(rgba.width, rgba.height); img.data.set(rgba.data); }
    } else {
      img = ctx.createImageData(rgba.width, rgba.height);
      img.data.set(rgba.data);
    }
    ctx.putImageData(img, 0, 0);
  }

  function renderToCanvas(canvas, key, opts) {
    opts = opts || {};
    var cssW = opts.cssW || (canvas && canvas.clientWidth) || SRC_W * SCALE / 2;
    var dpr = opts.dpr;
    if (dpr == null && typeof window !== "undefined") dpr = window.devicePixelRatio || 1;
    if (dpr == null) dpr = 1;
    var layout = layoutFor(cssW, dpr);
    var bmp = renderBitmap(key, {
      w: layout.genW, h: layout.genH, base: layout.base, amp: layout.amp,
      mode: opts.mode, bold: opts.bold == null ? BOLD : opts.bold
    });
    var rgba = scaleNearestAndDots(bmp, layout.pixW, layout.pixH);
    if (canvas) paintCanvas(canvas, rgba);
    return { bmp: bmp, layout: layout, rgba: rgba };
  }


  // Production (ee042b5) path: 700×450 bitmap, 2× nearest-neighbor to 1400×900, then CSS-downscaled.
  // Used on the compare test page so the live defect is visible next to the fix.
  function renderLegacyToCanvas(canvas, key) {
    var bmp = renderBitmap(key, { w: SRC_W, h: SRC_H, base: BASE, amp: AMP, mode: "cross", bold: 1 });
    var pixW = SRC_W * SCALE, pixH = SRC_H * SCALE, W = SRC_W, H = SRC_H;
    var out = new Uint8ClampedArray(pixW * pixH * 4);
    var x, y, sx, sy, j, p;
    for (y = 0; y < pixH; y++) {
      sy = y >> 1;
      for (x = 0; x < pixW; x++) {
        sx = x >> 1;
        p = (sy * W + sx) * 3;
        j = (y * pixW + x) * 4;
        out[j] = bmp.data[p]; out[j + 1] = bmp.data[p + 1]; out[j + 2] = bmp.data[p + 2]; out[j + 3] = 255;
      }
    }
    function dot(gx, gy, r, outline) {
      var x, y, dx, dy, j, d2, ro = r + outline;
      for (y = gy - ro; y <= gy + ro; y++) {
        for (x = gx - ro; x <= gx + ro; x++) {
          if (x < 0 || y < 0 || x >= pixW || y >= pixH) continue;
          dx = x - gx; dy = y - gy; d2 = dx * dx + dy * dy;
          j = (y * pixW + x) * 4;
          if (d2 <= r * r) { out[j] = 0; out[j + 1] = 0; out[j + 2] = 0; out[j + 3] = 255; }
          else if (d2 <= ro * ro) { out[j] = 255; out[j + 1] = 255; out[j + 2] = 255; out[j + 3] = 255; }
        }
      }
    }
    dot(W - BASE, 24, 10, 3);
    dot(W + BASE, 24, 10, 3);
    if (canvas) paintCanvas(canvas, { width: pixW, height: pixH, data: out });
    return { bmp: bmp, width: pixW, height: pixH };
  }

  function ensureFsStyle() {
    if (typeof document === "undefined" || document.getElementById("magicEyeFsCss")) return;
    var s = document.createElement("style");
    s.id = "magicEyeFsCss";
    s.textContent = [
      "#magicEyeFs{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;z-index:2147483000;background:#000;display:flex;flex-direction:column;align-items:stretch;box-sizing:border-box;padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)}",
      "#magicEyeFs[hidden]{display:none!important}",
      "body.me-fs-open{overflow:hidden;overscroll-behavior:none}",
      "#magicEyeFs .me-fs-bar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.55rem .75rem}",
      "#magicEyeFs .me-fs-tip{margin:0;color:#c8d4ce;font-size:.92rem;font-weight:400;text-align:center;flex:1}",
      "#magicEyeFs .me-fs-close{flex:0 0 auto;width:44px;height:44px;border:1px solid rgba(255,255,255,.4);border-radius:999px;background:rgba(8,12,10,.55);color:#fff;font-size:1.6rem;line-height:1;cursor:pointer}",
      "#magicEyeFs .me-fs-stage{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 .5rem .75rem}",
      "#magicEyeFs canvas{display:block;width:100%;height:auto;max-width:100%;max-height:100%;background:#000;image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges;image-rendering:pixelated}"
    ].join("");
    document.head.appendChild(s);
  }

  function ensureOverlay() {
    ensureFsStyle();
    var el = document.getElementById("magicEyeFs");
    if (el) return el;
    el = document.createElement("div");
    el.id = "magicEyeFs";
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Today's Magic Eye, full screen");
    el.innerHTML = '<div class="me-fs-bar"><p class="me-fs-tip" id="magicEyeFsTip"></p><button type="button" class="me-fs-close" id="magicEyeFsClose" aria-label="Close full screen">&times;</button></div><div class="me-fs-stage"><canvas id="magicEyeFsCanvas" width="1400" height="900" role="img" aria-label="Today\'s Magic Eye autostereogram, full screen"></canvas></div>';
    document.body.appendChild(el);
    return el;
  }

  var _fsBound = false, _fsOpen = false, _fsMode = DEFAULT_MODE, _fsPrevOverflow = "", _fsOpenedAt = 0;
  function drawFullscreen(mode) {
    var canvas = document.getElementById("magicEyeFsCanvas");
    var stage = canvas && canvas.parentNode;
    if (!canvas) return;
    var sb = stage ? stage.getBoundingClientRect() : { width: 0, height: 0 };
    var stageW = Math.round((stage && stage.clientWidth) || sb.width || 0);
    var stageH = Math.round((stage && stage.clientHeight) || sb.height || 0);
    if (!stageW) stageW = Math.round(window.innerWidth || 0);
    if (!stageH) stageH = Math.round(window.innerHeight || 0);
    // Largest 14:9 box that fits the stage, then render at that CSS width × dpr.
    var cssW = stageW, cssH = Math.round(stageW * SRC_H / SRC_W);
    if (stageH > 0 && cssH > stageH) {
      cssH = stageH;
      cssW = Math.round(stageH * SRC_W / SRC_H);
    }
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.style.maxWidth = "100%";
    canvas.style.maxHeight = "100%";
    var shown = canvas.getBoundingClientRect();
    if (shown.width && shown.height && (Math.abs(shown.width - cssW) > 1 || Math.abs(shown.height - cssH) > 1)) {
      cssW = Math.round(shown.width);
      cssH = Math.round(shown.height);
      // Keep the 14:9 picture; never let max-width/max-height squash it.
      if (cssW / cssH > SRC_W / SRC_H) cssW = Math.round(cssH * SRC_W / SRC_H);
      else cssH = Math.round(cssW * SRC_H / SRC_W);
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
    }
    var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    if (!cssW) return;
    var key = todayKey();
    renderToCanvas(canvas, key, { cssW: cssW, dpr: dpr, mode: mode || _fsMode || DEFAULT_MODE });
    canvas.setAttribute("data-magic-eye-day", key);
    var tip = document.getElementById("magicEyeFsTip");
    if (tip) tip.textContent = tipFor(mode || _fsMode || DEFAULT_MODE, true);
  }
  function closeFullscreen() {
    if (!_fsOpen) return;
    _fsOpen = false;
    var el = document.getElementById("magicEyeFs");
    function hide() {
      if (el) el.hidden = true;
      if (typeof document !== "undefined" && document.body) {
        document.body.classList.remove("me-fs-open");
        document.body.style.overflow = _fsPrevOverflow;
      }
    }
    var doc = typeof document !== "undefined" ? document : null;
    var fsEl = doc && (doc.fullscreenElement || doc.webkitFullscreenElement);
    if (fsEl && el && fsEl === el) {
      var exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) Promise.resolve(exit.call(doc)).catch(function () {}).then(hide);
      else hide();
    } else hide();
  }
  function openFullscreen(opts) {
    if (typeof document === "undefined") return;
    var mode = (opts && opts.mode) || DEFAULT_MODE;
    _fsMode = mode;
    _fsOpenedAt = Date.now();
    var el = ensureOverlay();
    el.hidden = false;
    _fsOpen = true;
    if (document.body) {
      _fsPrevOverflow = document.body.style.overflow;
      document.body.classList.add("me-fs-open");
      document.body.style.overflow = "hidden";
    }
    var tip = document.getElementById("magicEyeFsTip");
    if (tip) tip.textContent = tipFor(mode, true);
    if (!_fsBound) {
      _fsBound = true;
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && _fsOpen) { e.preventDefault(); closeFullscreen(); }
      });
      function onFsChange() { if (_fsOpen) drawFullscreen(_fsMode); }
      document.addEventListener("fullscreenchange", onFsChange);
      document.addEventListener("webkitfullscreenchange", onFsChange);
      window.addEventListener("resize", function () { if (_fsOpen) drawFullscreen(_fsMode); });
      window.addEventListener("orientationchange", function () { if (_fsOpen) setTimeout(function () { drawFullscreen(_fsMode); }, 120); });
      if (window.visualViewport) window.visualViewport.addEventListener("resize", function () { if (_fsOpen) drawFullscreen(_fsMode); });
    }
    function paint() { drawFullscreen(mode); }
    requestAnimationFrame(function () { requestAnimationFrame(paint); });
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      try { var p = req.call(el); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
    var closeBtn = document.getElementById("magicEyeFsClose");
    if (closeBtn && !closeBtn._meBound) {
      closeBtn._meBound = true;
      closeBtn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); closeFullscreen(); });
    }
    var fsCanvas = document.getElementById("magicEyeFsCanvas");
    if (fsCanvas && !fsCanvas._meCloseBound) {
      fsCanvas._meCloseBound = true;
      fsCanvas.style.cursor = "pointer";
      bindTap(fsCanvas, function (e) {
        if (e) { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); }
        if (Date.now() - _fsOpenedAt < 500) return;
        closeFullscreen();
      });
    }
    var stage = fsCanvas && fsCanvas.parentNode;
    if (stage && !stage._meCloseBound) {
      stage._meCloseBound = true;
      bindTap(stage, function (e) {
        if (e && e.target === fsCanvas) return;
        if (Date.now() - _fsOpenedAt < 500) return;
        closeFullscreen();
      });
    }
  }

  function todayKey(ms) {
    var ET = (typeof module !== "undefined" && module.exports)
      ? require("./et-day.js")
      : (root && root.ZabbadatEtDay);
    if (ET && ET.key) return ET.key(ms);
    var d = ms == null ? new Date() : new Date(ms);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function nextMidnightMs(now) {
    var ET = (typeof module !== "undefined" && module.exports)
      ? require("./et-day.js")
      : (root && root.ZabbadatEtDay);
    var t = now == null ? Date.now() : +now;
    if (!ET || !ET.startMs) return t + 36 * 3600 * 1000;
    return ET.startMs(ET.startMs(t) + 28 * 3600 * 1000);
  }

  var _midnightTimer = 0;
  function mount(opts) {
    if (typeof document === "undefined") return;
    var canvas = document.getElementById((opts && opts.canvasId) || "magicEyeCanvas");
    if (!canvas) return;
    var revealBtn = document.getElementById((opts && opts.revealId) || "magicEyeReveal");
    var shapeEl = document.getElementById((opts && opts.shapeId) || "magicEyeShape");
    var tipEl = document.getElementById((opts && opts.tipId) || "magicEyeTip") || document.querySelector("#magicEye .me-tip");
    var modeBtn = document.getElementById((opts && opts.modeId) || "magicEyeMode");
    var lastKey = "", lastSig = "", drawing = false, drawn = false, mode = DEFAULT_MODE;
    try { if (localStorage.getItem("zabMagicEyeMode") === "cross") mode = "cross"; } catch (e) {}

    function applyReveal(show) {
      if (!shapeEl) return;
      if (show) {
        shapeEl.hidden = false;
        shapeEl.textContent = "Today's shape: " + shapeName(lastKey);
        if (revealBtn) { revealBtn.setAttribute("aria-expanded", "true"); revealBtn.hidden = true; }
      } else {
        shapeEl.hidden = true;
        shapeEl.textContent = "";
        if (revealBtn) { revealBtn.setAttribute("aria-expanded", "false"); revealBtn.hidden = false; }
      }
    }
    function applyModeUi() {
      if (tipEl) tipEl.textContent = tipFor(mode, false);
      if (modeBtn) {
        modeBtn.setAttribute("aria-pressed", mode === "wall" ? "true" : "false");
        modeBtn.textContent = mode === "wall" ? "Viewing: Wall-eyed" : "Viewing: Cross-eyed";
      }
    }

    function draw(force) {
      var key = todayKey();
      var cssW = Math.round(canvas.clientWidth || canvas.getBoundingClientRect().width || 0);
      var dpr = window.devicePixelRatio || 1;
      var sig = key + "|" + cssW + "|" + dpr.toFixed(3) + "|" + mode;
      if (drawing) return;
      if (!cssW) return;
      if (drawn && sig === lastSig && !force) return;
      drawing = true;
      try {
        lastKey = key;
        lastSig = sig;
        renderToCanvas(canvas, key, { cssW: cssW, dpr: dpr, mode: mode });
        drawn = true;
        applyReveal(false);
        applyModeUi();
        canvas.setAttribute("data-magic-eye-day", key);
        canvas.setAttribute("data-magic-eye-mode", mode);
        canvas.setAttribute("data-magic-eye-width", String(cssW));
      } finally {
        drawing = false;
      }
      scheduleMidnight();
    }

    function kick() {
      if (typeof requestIdleCallback === "function") requestIdleCallback(function () { draw(); }, { timeout: 2000 });
      else setTimeout(function () { draw(); }, 0);
    }

    function scheduleMidnight() {
      if (_midnightTimer) clearTimeout(_midnightTimer);
      var wait = Math.max(250, nextMidnightMs(Date.now()) - Date.now() + 50);
      if (wait > 86400000 * 2) wait = 86400000;
      _midnightTimer = setTimeout(function () { drawn = false; draw(true); }, wait);
    }

    if (revealBtn && !revealBtn._meBound) {
      revealBtn._meBound = true;
      revealBtn.addEventListener("click", function () { if (lastKey) applyReveal(true); });
    }
    if (modeBtn && !modeBtn._meBound) {
      modeBtn._meBound = true;
      modeBtn.addEventListener("click", function () {
        mode = mode === "wall" ? "cross" : "wall";
        try { localStorage.setItem("zabMagicEyeMode", mode); } catch (e) {}
        drawn = false;
        draw(true);
      });
    }
    applyModeUi();

    var fsBtn = document.getElementById((opts && opts.fsId) || "magicEyeFsBtn");
    function goFs() { openFullscreen({ mode: mode }); }
    if (fsBtn && !fsBtn._meBound) {
      fsBtn._meBound = true;
      fsBtn.addEventListener("click", function (e) { e.preventDefault(); goFs(); });
    }
    if (canvas && !canvas._meFsBound) {
      canvas._meFsBound = true;
      canvas.style.cursor = "pointer";
      bindTap(canvas, function () { goFs(); });
    }

    var resizeTimer = 0;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { draw(false); }, 80);
    }
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(onResize);
      ro.observe(canvas);
      if (canvas.parentNode) ro.observe(canvas.parentNode);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);

    if (opts && opts.immediate) { draw(true); return; }

    if (typeof IntersectionObserver === "function") {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); kick(); }
      }, { rootMargin: "200px 0px" });
      io.observe(canvas);
    } else kick();
  }

  function autoMount() {
    if (typeof document === "undefined") return;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { mount(); });
    else mount();
  }

  var api = {
    W: SRC_W, H: SRC_H, SCALE: SCALE, BASE: BASE, AMP: AMP, BOLD: BOLD,
    PERIOD_CSS_MIN: PERIOD_CSS_MIN, PERIOD_CSS_MAX: PERIOD_CSS_MAX,
    SHAPE_NAMES: SHAPE_NAMES, DEFAULT_MODE: DEFAULT_MODE, tipFor: tipFor,
    TIP_CROSS: TIP_CROSS, TIP_WALL: TIP_WALL, TIP_CROSS_FS: TIP_CROSS_FS, TIP_WALL_FS: TIP_WALL_FS,
    toOrdinal: toOrdinal, ordinalFromKey: ordinalFromKey,
    shapeIndex: shapeIndex, shapeName: shapeName,
    layoutFor: layoutFor, buildDepth: buildDepth, renderBitmap: renderBitmap,
    renderToCanvas: renderToCanvas, renderLegacyToCanvas: renderLegacyToCanvas,
    scaleNearestAndDots: scaleNearestAndDots, openFullscreen: openFullscreen, closeFullscreen: closeFullscreen,
    meanSeparation: meanSeparation, todayKey: todayKey, nextMidnightMs: nextMidnightMs,
    mount: mount, pyRound: pyRound
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.ZabbadatMagicEye = api;
    autoMount();
  }
})(typeof window !== "undefined" ? window : this);
