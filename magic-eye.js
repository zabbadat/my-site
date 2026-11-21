/* Zabbadat daily Magic Eye (autostereogram).
 * Random-dot, cross-eyed (near = wider separation), union-find linking like
 * /workspace/stereogram/daily.py. Seeded by the America/New_York date from
 * et-day.js so everyone sees the same picture until Eastern midnight.
 * Browser: window.ZabbadatMagicEye. Node: require("./magic-eye.js").
 */
(function (root) {
  "use strict";
  var W = 700, H = 450, SCALE = 2, BASE = 60, AMP = 14, BLUR = 5, GAIN = 1.5;
  var CX = W >> 1, CY = H >> 1;
  var SHAPE_NAMES = [
    "heart", "star", "letter Z", "lightning bolt", "smiley face",
    "crescent moon", "dumbbell", "number 7", "arrow", "crown"
  ];
  var PAL = [
    [255, 60, 90], [255, 200, 40], [40, 170, 255], [120, 230, 120],
    [180, 90, 255], [250, 250, 250], [25, 25, 45], [255, 130, 30]
  ];

  function isLeap(y) { return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0); }
  // Python datetime.date.toordinal: 0001-01-01 => 1 (proleptic Gregorian).
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

  // Python 3 int(round(x)) — ties to even.
  function pyRound(x) {
    var n = Math.floor(x), f = x - n;
    if (f < 0.5) return n;
    if (f > 0.5) return n + 1;
    return n % 2 === 0 ? n : n + 1;
  }

  // Mulberry32, seeded by the Python ordinal so the same day is the same picture.
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

  function makeMask() { return new Uint8Array(W * H); }
  function setPx(m, x, y, v) {
    if (x >= 0 && x < W && y >= 0 && y < H) m[y * W + x] = v;
  }
  // Inclusive bounding-box ellipse, like PIL ImageDraw.ellipse.
  function fillEllipse(m, x0, y0, x1, y1, v) {
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
  function fillRect(m, x0, y0, x1, y1, v) {
    var x, y;
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(W - 1, Math.round(x1)); y1 = Math.min(H - 1, Math.round(y1));
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) m[y * W + x] = v;
  }
  function fillRoundRect(m, x0, y0, x1, y1, r, v) {
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
        if (dx * dx + dy * dy <= r * r + r) setPx(m, x, y, v);
      }
    }
  }
  // Nonzero-winding polygon fill (canvas / PIL-style, fills a star's center).
  function fillPoly(m, pts, v) {
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
  // Stroke a circular arc (PIL ImageDraw.arc: 0° at 3 o'clock, clockwise, width in px).
  function strokeArc(m, x0, y0, x1, y1, startDeg, endDeg, width, v) {
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var a = (x1 - x0) / 2, b = (y1 - y0) / 2;
    var step = 0.5 * Math.PI / 180, rad0 = startDeg * Math.PI / 180, rad1 = endDeg * Math.PI / 180;
    var hw = width / 2, t, x, y, dx, dy, px, py, qx, qy;
    for (t = rad0; t <= rad1 + 1e-6; t += step) {
      px = cx + a * Math.cos(t);
      py = cy + b * Math.sin(t);
      for (dy = -Math.ceil(hw); dy <= Math.ceil(hw); dy++) {
        for (dx = -Math.ceil(hw); dx <= Math.ceil(hw); dx++) {
          if (dx * dx + dy * dy <= hw * hw + hw) setPx(m, Math.round(px + dx), Math.round(py + dy), v);
        }
      }
    }
  }
  function fillHeart(m) {
    var x, y, X, Y;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        X = (x - CX) / 150;
        Y = -(y - CY) / 165 + 0.25;
        if ((X * X + Y * Y - 1) * (X * X + Y * Y - 1) * (X * X + Y * Y - 1) - X * X * Y * Y * Y <= 0) m[y * W + x] = 255;
      }
    }
  }
  function fillStar(m) {
    var pts = [], i, a, rad, n = 5, R = 170, r = 70;
    for (i = 0; i < 2 * n; i++) {
      a = Math.PI / 2 + i * Math.PI / n;
      rad = i % 2 === 0 ? R : r;
      pts.push([CX + rad * Math.cos(a), CY - rad * Math.sin(a)]);
    }
    fillPoly(m, pts, 255);
  }
  // Vector stand-ins for DejaVuSans-Bold "Z" (320) and "7" (340), same box and weight.
  function fillLetterZ(m) {
    fillPoly(m, [
      [248, 103], [451, 103], [451, 148], [340, 148], [451, 290],
      [451, 335], [248, 335], [248, 290], [360, 290], [248, 148], [248, 103]
    ], 255);
  }
  function fillNumber7(m) {
    fillPoly(m, [
      [254, 95], [441, 95], [441, 140], [360, 140], [300, 342],
      [254, 342], [318, 140], [254, 140]
    ], 255);
  }
  function fillLightning(m) {
    fillPoly(m, [[390, 40], [250, 250], [340, 250], [290, 410], [460, 180], [365, 180], [430, 40]], 255);
  }
  function fillSmiley(m) {
    fillEllipse(m, CX - 170, CY - 170, CX + 170, CY + 170, 255);
    fillEllipse(m, CX - 80, CY - 90, CX - 30, CY - 30, 0);
    fillEllipse(m, CX + 30, CY - 90, CX + 80, CY - 30, 0);
    strokeArc(m, CX - 100, CY - 40, CX + 100, CY + 110, 20, 160, 22, 0);
  }
  function fillMoon(m) {
    fillEllipse(m, CX - 170, CY - 170, CX + 170, CY + 170, 255);
    fillEllipse(m, CX - 80, CY - 200, CX + 230, CY + 130, 0);
  }
  function fillDumbbell(m) {
    fillRect(m, CX - 160, CY - 25, CX + 160, CY + 25, 255);
    fillRoundRect(m, CX - 250, CY - 110, CX - 150, CY + 110, 20, 255);
    fillRoundRect(m, CX + 150, CY - 110, CX + 250, CY + 110, 20, 255);
  }
  function fillArrow(m) {
    fillPoly(m, [[150, 190], [400, 190], [400, 100], [580, 225], [400, 350], [400, 260], [150, 260]], 255);
  }
  function fillCrown(m) {
    fillPoly(m, [[170, 330], [170, 140], [260, 230], [350, 100], [440, 230], [530, 140], [530, 330]], 255);
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
  function blurGain(mask) {
    var ker = gaussKernel(BLUR), k = ker.k, r = ker.r;
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

  function buildDepth(key) {
    var m = makeMask();
    DRAW[shapeIndex(key)](m);
    return blurGain(m);
  }

  // Union-find linking, same walk as daily.py: for each column c, sep = base + amp*d,
  // link c-sep//2 with that plus sep, always pointing the larger index at the smaller.
  function renderRow(depth, y, pal, rng, rowOut) {
    var same = new Int32Array(W), c, sep, l, rr, cols, i;
    for (c = 0; c < W; c++) same[c] = c;
    for (c = 0; c < W; c++) {
      sep = pyRound(BASE + AMP * depth[y * W + c]);
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
        // parent is already colored (always a smaller index)
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

  function renderBitmap(key) {
    var depth = buildDepth(key), ord = ordinalFromKey(key);
    var rng = rngFromSeed(ord);
    var pal = PAL.map(function (c) { return c.slice(); });
    shuffle(rng, pal);
    var img = new Uint8ClampedArray(W * H * 3);
    var y, row = new Uint8ClampedArray(W * 3);
    for (y = 0; y < H; y++) {
      renderRow(depth, y, pal, rng, row);
      img.set(row, y * W * 3);
    }
    return { width: W, height: H, data: img, depth: depth, name: shapeName(key), index: shapeIndex(key), ordinal: ord, base: BASE, amp: AMP };
  }

  function scaleNearestAndDots(bmp) {
    var w2 = W * SCALE, h2 = H * SCALE;
    var out = new Uint8ClampedArray(w2 * h2 * 4);
    var x, y, sx, sy, i, j, p;
    for (y = 0; y < h2; y++) {
      sy = y >> 1;
      for (x = 0; x < w2; x++) {
        sx = x >> 1;
        p = (sy * W + sx) * 3;
        j = (y * w2 + x) * 4;
        out[j] = bmp.data[p];
        out[j + 1] = bmp.data[p + 1];
        out[j + 2] = bmp.data[p + 2];
        out[j + 3] = 255;
      }
    }
    // Guide dots on the 2x image, same placement as daily.py (W-base, W+base).
    function dot(gx, gy, r, outline) {
      var x, y, dx, dy, j, d2, ro = r + outline;
      for (y = gy - ro; y <= gy + ro; y++) {
        for (x = gx - ro; x <= gx + ro; x++) {
          if (x < 0 || y < 0 || x >= w2 || y >= h2) continue;
          dx = x - gx; dy = y - gy; d2 = dx * dx + dy * dy;
          j = (y * w2 + x) * 4;
          if (d2 <= r * r) { out[j] = 0; out[j + 1] = 0; out[j + 2] = 0; out[j + 3] = 255; }
          else if (d2 <= (r + outline) * (r + outline)) { out[j] = 255; out[j + 1] = 255; out[j + 2] = 255; out[j + 3] = 255; }
        }
      }
    }
    // ellipse [gx-10,14,gx+10,34] => center (gx, 24), radius 10, outline width 3
    dot(W - BASE, 24, 10, 3);
    dot(W + BASE, 24, 10, 3);
    return { width: w2, height: h2, data: out };
  }

  function meanSeparation(bmp) {
    var inside = 0, outside = 0, nIn = 0, nOut = 0, i, d, sep;
    for (i = 0; i < bmp.depth.length; i++) {
      d = bmp.depth[i];
      sep = pyRound(BASE + AMP * d);
      if (d > 0.8) { inside += sep; nIn++; }
      else if (d < 0.1) { outside += sep; nOut++; }
    }
    return { inside: nIn ? inside / nIn : 0, outside: nOut ? outside / nOut : 0, nIn: nIn, nOut: nOut };
  }

  function paintCanvas(canvas, rgba) {
    var ctx = canvas.getContext("2d");
    canvas.width = rgba.width;
    canvas.height = rgba.height;
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

  function renderToCanvas(canvas, key) {
    var bmp = renderBitmap(key);
    var rgba = scaleNearestAndDots(bmp);
    paintCanvas(canvas, rgba);
    return bmp;
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
    var drawn = false, drawing = false, lastKey = "";

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

    function draw(force) {
      var key = todayKey();
      if (drawing) return;
      if (drawn && key === lastKey && !force) return;
      drawing = true;
      try {
        lastKey = key;
        renderToCanvas(canvas, key);
        drawn = true;
        applyReveal(false);
        canvas.setAttribute("data-magic-eye-day", key);
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
    W: W, H: H, SCALE: SCALE, BASE: BASE, AMP: AMP, SHAPE_NAMES: SHAPE_NAMES,
    toOrdinal: toOrdinal, ordinalFromKey: ordinalFromKey,
    shapeIndex: shapeIndex, shapeName: shapeName,
    buildDepth: buildDepth, renderBitmap: renderBitmap, renderToCanvas: renderToCanvas,
    scaleNearestAndDots: scaleNearestAndDots, meanSeparation: meanSeparation,
    todayKey: todayKey, nextMidnightMs: nextMidnightMs, mount: mount, pyRound: pyRound
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.ZabbadatMagicEye = api;
    autoMount();
  }
})(typeof window !== "undefined" ? window : this);
