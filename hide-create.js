// Create-your-own Hide: on-device compositor. The photo never leaves this device.
// The AI path is wired but dark: HIDE_AI_ENABLED is hard-off and no button is shown.
(function (root) {
  "use strict";

  var HIDE_AI_ENABLED = false;
  var IMAGINE_MODEL = "grok-imagine-image-2.0";
  var IMAGINE_DAILY_CAP = 5;
  var MAX_SIDE = 1600;
  var SNAP_PX = 26;
  var HIT_R_MULT = 2;
  var MARGIN = 0.08;
  var CUSTOM_LINE = "Your hide. Breathe and look.";
  var HEIC_MSG = "This photo format isn't supported here. Try a JPG or PNG.";
  var FAIL_MSG = "Couldn't read that photo. Try a JPG or PNG.";
  var PROP_BASE = "/hide/props/";

  var PROPS = [
    { id: "washer", name: "Steel washer", src: PROP_BASE + "washer.png", aspect: 1, targetWFrac: 0.048 },
    { id: "bottle", name: "Water bottle", src: PROP_BASE + "bottle.png", aspect: 180 / 571, targetWFrac: 0.07 },
    { id: "jumprope", name: "Jump rope", src: PROP_BASE + "jumprope.png", aspect: 320 / 209, targetWFrac: 0.13 },
    { id: "glove", name: "Work glove", src: PROP_BASE + "glove.png", aspect: 220 / 309, targetWFrac: 0.09 },
    { id: "chalk", name: "Chalk", src: PROP_BASE + "chalk.png", aspect: 160 / 131, targetWFrac: 0.04 }
  ];

  function aiUiAllowed() { return HIDE_AI_ENABLED === true; }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function seedNum(s) {
    if (typeof s === "number" && isFinite(s)) return s >>> 0;
    var str = String(s == null ? "hide" : s), h = 2166136261, i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function boxesClear(a, b, width, height, snapPx, cssW) {
    var dist = Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
    var need = (a.r + b.r) * HIT_R_MULT * width + 2 * (snapPx || SNAP_PX) * (width / (cssW || 300));
    return dist >= need;
  }

  function inBounds(it, width, height) {
    width = width || 1600; height = height || 1200;
    var hw = it.r;
    var hh = it.r * (width / height) / Math.max(0.2, it.aspect || 1);
    return it.x - hw >= MARGIN && it.x + hw <= 1 - MARGIN &&
      it.y - hh >= MARGIN && it.y + hh <= 1 - MARGIN;
  }

  function overlapsFace(it, faces, width, height) {
    if (!faces || !faces.length) return false;
    var hw = it.r, hh = it.r * (width / height) / Math.max(0.2, it.aspect || 1);
    var i, f, pad, fx0, fy0, fx1, fy1;
    for (i = 0; i < faces.length; i++) {
      f = faces[i];
      pad = 0.06;
      fx0 = f.x - pad; fy0 = f.y - pad;
      fx1 = f.x + f.w + pad; fy1 = f.y + f.h + pad;
      if (it.x + hw > fx0 && it.x - hw < fx1 && it.y + hh > fy0 && it.y - hh < fy1) return true;
    }
    return false;
  }

  function cellScores(imageData, width, height, cols, rows) {
    var data = imageData.data, scores = [], r, c, x0, x1, y0, y1, x, y, i, lum, sum, sum2, n, step, mean, v;
    for (r = 0; r < rows; r++) {
      scores[r] = [];
      for (c = 0; c < cols; c++) {
        x0 = Math.floor(c * width / cols); x1 = Math.floor((c + 1) * width / cols);
        y0 = Math.floor(r * height / rows); y1 = Math.floor((r + 1) * height / rows);
        sum = 0; sum2 = 0; n = 0;
        step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 8));
        for (y = y0; y < y1; y += step) {
          for (x = x0; x < x1; x += step) {
            i = (y * width + x) * 4;
            lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            sum += lum; sum2 += lum * lum; n++;
          }
        }
        mean = sum / Math.max(1, n);
        v = Math.max(0, sum2 / Math.max(1, n) - mean * mean);
        scores[r][c] = v < 40 ? 80 + (40 - v) : v;
      }
    }
    return scores;
  }

  function isSkin(r, g, b) {
    return r > 95 && g > 40 && b > 20 && r > g && r > b && (r - g) > 15 && r < 245;
  }

  function detectFacesCheap(imageData, width, height) {
    if (!imageData || !imageData.data) return [];
    var data = imageData.data, cols = 16, rows = 12, r, c, x0, x1, y0, y1, x, y, i, n, skin, step;
    var cells = [], maxR = Math.floor(rows * 0.62);
    for (r = 0; r < maxR; r++) {
      for (c = 0; c < cols; c++) {
        x0 = Math.floor(c * width / cols); x1 = Math.floor((c + 1) * width / cols);
        y0 = Math.floor(r * height / rows); y1 = Math.floor((r + 1) * height / rows);
        n = 0; skin = 0;
        step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 6));
        for (y = y0; y < y1; y += step) {
          for (x = x0; x < x1; x += step) {
            i = (y * width + x) * 4;
            n++;
            if (isSkin(data[i], data[i + 1], data[i + 2])) skin++;
          }
        }
        if (n && skin / n >= 0.42) cells.push({ c: c, r: r });
      }
    }
    if (cells.length < 3) return [];
    var minC = 99, maxC = 0, minR = 99, maxR2 = 0;
    for (i = 0; i < cells.length; i++) {
      minC = Math.min(minC, cells[i].c); maxC = Math.max(maxC, cells[i].c);
      minR = Math.min(minR, cells[i].r); maxR2 = Math.max(maxR2, cells[i].r);
    }
    var bw = (maxC - minC + 1) / cols, bh = (maxR2 - minR + 1) / rows;
    if (bw * bh < 0.035 || bw * bh > 0.45) return [];
    return [{ x: minC / cols, y: minR / rows, w: bw, h: bh }];
  }

  function placeItems(opts) {
    opts = opts || {};
    var width = opts.width || 1600, height = opts.height || 1200;
    var rng = mulberry32(seedNum(opts.seed == null ? 1 : opts.seed));
    var cssW = opts.cssW || 300;
    var snapPx = opts.snapPx || SNAP_PX;
    var faces = opts.faces || [];
    var cols = 10, rows = 8, r, c, scores = opts.scores, cands = [], x0, y0;
    if (!scores && opts.imageData) scores = cellScores(opts.imageData, width, height, cols, rows);
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        x0 = MARGIN + (1 - 2 * MARGIN) * (c + 0.5) / cols;
        y0 = MARGIN + (1 - 2 * MARGIN) * (r + 0.5) / rows;
        cands.push({
          x: x0 + (rng() - 0.5) * ((1 - 2 * MARGIN) / cols) * 0.8,
          y: y0 + (rng() - 0.5) * ((1 - 2 * MARGIN) / rows) * 0.8,
          score: ((scores && scores[r] && scores[r][c] != null) ? scores[r][c] : (Math.abs(y0 - 0.68) * 80 + Math.abs(x0 - 0.5) * 12)) + rng() * 4
        });
      }
    }
    cands.sort(function (a, b) { return a.score - b.score; });

    var placed = [], i, p, tw, rnorm, found, k, it, ok, j, shrink;
    for (i = 0; i < PROPS.length; i++) {
      p = PROPS[i];
      tw = p.targetWFrac * (0.92 + rng() * 0.16);
      rnorm = tw / 2;
      found = null;
      function tryPlace(rad) {
        for (k = 0; k < cands.length; k++) {
          it = { id: p.id, name: p.name, x: cands[k].x, y: cands[k].y, r: rad, aspect: p.aspect, src: p.src };
          if (!inBounds(it, width, height)) continue;
          if (overlapsFace(it, faces, width, height)) continue;
          ok = true;
          for (j = 0; j < placed.length; j++) {
            if (!boxesClear(it, placed[j], width, height, snapPx, cssW)) { ok = false; break; }
          }
          if (ok) { cands.splice(k, 1); return it; }
        }
        return null;
      }
      found = tryPlace(rnorm);
      for (shrink = 0; !found && shrink < 6; shrink++) {
        rnorm *= 0.9;
        found = tryPlace(rnorm);
      }
      if (!found && faces.length) {
        faces = [];
        rnorm = tw / 2;
        found = tryPlace(rnorm);
        for (shrink = 0; !found && shrink < 6; shrink++) {
          rnorm *= 0.9;
          found = tryPlace(rnorm);
        }
      }
      if (!found) {
        // Last resort: park it in a free-ish grid cell so a hide still builds.
        rnorm = Math.max(0.012, (tw / 2) * 0.6);
        for (k = 0; k < cands.length && !found; k++) {
          it = { id: p.id, name: p.name, x: Math.min(1 - MARGIN - rnorm, Math.max(MARGIN + rnorm, cands[k].x)), y: Math.min(1 - MARGIN - rnorm, Math.max(MARGIN + rnorm, cands[k].y)), r: rnorm, aspect: p.aspect, src: p.src };
          ok = true;
          for (j = 0; j < placed.length; j++) {
            if (!boxesClear(it, placed[j], width, height, snapPx, cssW)) { ok = false; break; }
          }
          if (ok) found = it;
        }
      }
      if (!found) throw new Error("place");
      found.rot = (rng() - 0.5) * (p.id === "washer" ? 28 : 40);
      placed.push(found);
    }
    return placed;
  }

  function isHeic(file) {
    var n = ((file && file.name) || "").toLowerCase();
    var typ = ((file && file.type) || "").toLowerCase();
    return /\.heic$|\.heif$/.test(n) || /heic|heif/.test(typ);
  }

  function downscaleToCanvas(img, maxSide) {
    var w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    var scale = Math.min(1, maxSide / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas;
  }

  function analysisFrame(srcCanvas) {
    var max = 320;
    var scale = Math.min(1, max / Math.max(srcCanvas.width, srcCanvas.height));
    var w = Math.max(1, Math.round(srcCanvas.width * scale));
    var h = Math.max(1, Math.round(srcCanvas.height * scale));
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h), width: w, height: h };
  }

  function decodeAndDownscale(file) {
    return new Promise(function (resolve, reject) {
      var fail = function () { reject(new Error(isHeic(file) ? "heic" : "format")); };
      function viaImg() {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var c = downscaleToCanvas(img, MAX_SIDE);
            URL.revokeObjectURL(url);
            resolve({ canvas: c, width: c.width, height: c.height });
          } catch (e) {
            URL.revokeObjectURL(url);
            fail();
          }
        };
        img.onerror = function () { URL.revokeObjectURL(url); fail(); };
        img.src = url;
      }
      if (typeof createImageBitmap === "function") {
        createImageBitmap(file).then(function (bmp) {
          try {
            var c = downscaleToCanvas(bmp, MAX_SIDE);
            if (bmp.close) bmp.close();
            resolve({ canvas: c, width: c.width, height: c.height });
          } catch (e) { viaImg(); }
        }).catch(function () { viaImg(); });
      } else viaImg();
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("prop")); };
      img.src = src;
    });
  }

  function localStats(ctx, x, y, w, h, iw, ih) {
    var x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    var x1 = Math.min(iw, Math.ceil(x + w)), y1 = Math.min(ih, Math.ceil(y + h));
    var d = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
    var r = 0, g = 0, b = 0, n = d.length / 4, i;
    for (i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    n = Math.max(1, n);
    return { r: r / n, g: g / n, b: b / n };
  }

  function featherAlpha(imgData, passes) {
    var w = imgData.width, h = imgData.height, d = imgData.data, p, copy, x, y, i, dx, dy, xx, yy, minN;
    for (p = 0; p < passes; p++) {
      copy = new Uint8ClampedArray(d);
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          i = (y * w + x) * 4;
          if (copy[i + 3] === 0) continue;
          minN = copy[i + 3];
          for (dy = -1; dy <= 1; dy++) {
            for (dx = -1; dx <= 1; dx++) {
              xx = x + dx; yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) minN = 0;
              else minN = Math.min(minN, copy[(yy * w + xx) * 4 + 3]);
            }
          }
          if (minN < copy[i + 3]) d[i + 3] = Math.round(copy[i + 3] * 0.55 + minN * 0.45);
        }
      }
    }
  }

  function tintProp(sctx, stats) {
    var pd = sctx.getImageData(0, 0, sctx.canvas.width, sctx.canvas.height);
    var d = pd.data, pr = 0, pg = 0, pb = 0, n = 0, i, r, g, b, gray, tr, tg, tb;
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 20) { pr += d[i]; pg += d[i + 1]; pb += d[i + 2]; n++; }
    }
    if (!n) return;
    pr /= n; pg /= n; pb /= n;
    tr = Math.min(1.22, Math.max(0.72, (stats.r / Math.max(1, pr)) * 0.32 + 0.68));
    tg = Math.min(1.22, Math.max(0.72, (stats.g / Math.max(1, pg)) * 0.32 + 0.68));
    tb = Math.min(1.22, Math.max(0.72, (stats.b / Math.max(1, pb)) * 0.32 + 0.68));
    for (i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 2) continue;
      r = (d[i] * tr - 128) * 0.86 + 128;
      g = (d[i + 1] * tg - 128) * 0.86 + 128;
      b = (d[i + 2] * tb - 128) * 0.86 + 128;
      gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = r * 0.85 + gray * 0.15 + (Math.random() - 0.5) * 6;
      g = g * 0.85 + gray * 0.15 + (Math.random() - 0.5) * 6;
      b = b * 0.85 + gray * 0.15 + (Math.random() - 0.5) * 6;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
      d[i + 3] = d[i + 3] * 0.96;
    }
    featherAlpha(pd, 1);
    sctx.putImageData(pd, 0, 0);
  }

  function blitProp(baseCtx, photoCanvas, propImg, item, width, height) {
    var tw = item.r * 2 * width;
    var th = tw / Math.max(0.2, item.aspect || 1);
    var cx = item.x * width, cy = item.y * height;
    var sc = document.createElement("canvas");
    sc.width = Math.max(2, Math.ceil(tw));
    sc.height = Math.max(2, Math.ceil(th));
    var sctx = sc.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(propImg, 0, 0, sc.width, sc.height);
    tintProp(sctx, localStats(baseCtx, cx - tw / 2, cy - th / 2, tw, th, width, height));

    baseCtx.save();
    baseCtx.translate(cx, cy);
    baseCtx.rotate((item.rot || 0) * Math.PI / 180);
    baseCtx.save();
    baseCtx.shadowColor = "rgba(0,0,0,0.38)";
    baseCtx.shadowBlur = Math.max(2, tw * 0.08);
    baseCtx.shadowOffsetX = tw * 0.03;
    baseCtx.shadowOffsetY = th * 0.05;
    baseCtx.globalAlpha = 0.5;
    baseCtx.drawImage(sc, -tw / 2, -th / 2, tw, th);
    baseCtx.restore();
    baseCtx.globalAlpha = 1;
    baseCtx.drawImage(sc, -tw / 2, -th / 2, tw, th);
    baseCtx.restore();

    // Soft ground wrap over the lower edge, from the original photo.
    var wrap = document.createElement("canvas");
    wrap.width = Math.max(2, Math.ceil(tw));
    wrap.height = Math.max(2, Math.ceil(th * 0.35));
    var wctx = wrap.getContext("2d", { willReadFrequently: true });
    var sx = Math.max(0, cx - tw / 2), sy = Math.max(0, cy + th * 0.15);
    try {
      wctx.drawImage(photoCanvas, sx, sy, tw, wrap.height, 0, 0, wrap.width, wrap.height);
      var grd = wctx.createLinearGradient(0, 0, 0, wrap.height);
      grd.addColorStop(0, "rgba(0,0,0,0)");
      grd.addColorStop(0.45, "rgba(0,0,0,0.2)");
      grd.addColorStop(1, "rgba(0,0,0,0.55)");
      wctx.globalCompositeOperation = "destination-in";
      wctx.fillStyle = grd;
      wctx.fillRect(0, 0, wrap.width, wrap.height);
      baseCtx.save();
      baseCtx.globalAlpha = 0.55;
      baseCtx.drawImage(wrap, cx - tw / 2, cy + th * 0.15, tw, wrap.height);
      baseCtx.restore();
    } catch (e) {}
  }

  function composite(photoCanvas, items, propImgs) {
    var out = document.createElement("canvas");
    out.width = photoCanvas.width;
    out.height = photoCanvas.height;
    var ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(photoCanvas, 0, 0);
    var i, it;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (propImgs[it.id]) blitProp(ctx, photoCanvas, propImgs[it.id], it, out.width, out.height);
    }
    return out;
  }

  function canvasToFile(canvas) {
    return new Promise(function (resolve, reject) {
      if (!canvas.toBlob) {
        try {
          var data = canvas.toDataURL("image/jpeg", 0.88);
          var bin = atob(data.split(",")[1]), arr = new Uint8Array(bin.length), i;
          for (i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new File([arr], "zabbadat-hide.jpg", { type: "image/jpeg" }));
        } catch (e) { reject(e); }
        return;
      }
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error("blob")); return; }
        try { resolve(new File([blob], "zabbadat-hide.jpg", { type: "image/jpeg" })); }
        catch (e) { resolve(blob); }
      }, "image/jpeg", 0.88);
    });
  }

  var lastFile = null, lastSeed = 1, lastUrl = null, lastBuild = null;

  function buildHide(file, seed) {
    var usedSeed = seed == null ? Date.now() : seed;
    return decodeAndDownscale(file).then(function (decoded) {
      var canvas = decoded.canvas;
      var anal = analysisFrame(canvas);
      var faces = detectFacesCheap(anal.data, anal.width, anal.height);
      var scores = cellScores(anal.data, anal.width, anal.height, 10, 8);
      var items = placeItems({
        width: canvas.width, height: canvas.height, seed: usedSeed,
        faces: faces, scores: scores, cssW: 300, snapPx: SNAP_PX
      });
      return Promise.all(PROPS.map(function (p) { return loadImage(p.src).then(function (im) { return [p.id, im]; }); }))
        .then(function (pairs) {
          var propImgs = {}, i;
          for (i = 0; i < pairs.length; i++) propImgs[pairs[i][0]] = pairs[i][1];
          var out = composite(canvas, items, propImgs);
          return canvasToFile(out).then(function (fileOut) {
            var url = URL.createObjectURL(fileOut);
            return {
              items: items, src: url, file: fileOut,
              width: out.width, height: out.height,
              line: CUSTOM_LINE, seed: usedSeed
            };
          });
        });
    });
  }

  function setErr(msg) {
    var el = document.getElementById("todaysHideCreateErr");
    if (!el) return;
    if (msg) { el.hidden = false; el.textContent = msg; }
    else { el.hidden = true; el.textContent = ""; }
  }

  function showPanel(on) {
    var panel = document.getElementById("todaysHideCreate");
    if (panel) panel.hidden = !on;
    if (on) setErr("");
  }

  function syncChrome() {
    var custom = !!(root.ZabbadatHide && root.ZabbadatHide.isCustom && root.ZabbadatHide.isCustom());
    var newBtn = document.getElementById("todaysHideNew");
    var backBtn = document.getElementById("todaysHideBack");
    if (newBtn) newBtn.hidden = !custom;
    if (backBtn) backBtn.hidden = !custom;
    var section = document.getElementById("todays-hide");
    if (section && !custom) section.classList.remove("th-custom");
  }

  function playBuilt(res) {
    if (lastUrl) { try { URL.revokeObjectURL(lastUrl); } catch (e) {} }
    lastUrl = res.src;
    lastBuild = res;
    if (root.ZabbadatHideCreate) root.ZabbadatHideCreate.lastBuild = res;
    setErr("");
    showPanel(false);
    return root.ZabbadatHide.playCustom({
      src: res.src, items: res.items, file: res.file, line: res.line
    }).then(function () { syncChrome(); return res; });
  }

  function runWithFile(file, seed) {
    if (!file) return Promise.resolve();
    setErr("");
    lastFile = file;
    lastSeed = seed == null ? Date.now() : seed;
    setErr("Making your hide…");
    return buildHide(file, lastSeed).then(playBuilt).catch(function (err) {
      var msg = (err && String(err.message || err)) || "";
      if (typeof console !== "undefined" && console.warn) console.warn("hide-create", err);
      setErr(/heic/i.test(msg) ? HEIC_MSG : FAIL_MSG);
      var errEl = typeof document !== "undefined" ? document.getElementById("todaysHideCreateErr") : null;
      if (errEl) errEl.setAttribute("data-reason", msg.slice(0, 80));
    });
  }

  function mount() {
    if (typeof document === "undefined") return;
    var makeBtn = document.getElementById("todaysHideMake");
    var fileInp = document.getElementById("todaysHideFile");
    var newBtn = document.getElementById("todaysHideNew");
    var backBtn = document.getElementById("todaysHideBack");

    // Dark AI path: never create or show a Paint-with-AI control.
    if (aiUiAllowed()) { /* reserved; launch version keeps this off */ }

    if (makeBtn) {
      makeBtn.addEventListener("click", function (e) {
        e.preventDefault();
        showPanel(true);
      });
    }
    if (fileInp) {
      fileInp.addEventListener("change", function () {
        var f = fileInp.files && fileInp.files[0];
        fileInp.value = "";
        if (f) runWithFile(f, Date.now());
      });
    }
    if (newBtn) {
      newBtn.addEventListener("click", function (e) {
        e.preventDefault();
        if (lastFile) runWithFile(lastFile, (Number(lastSeed) || 1) + 1);
      });
    }
    if (backBtn) {
      backBtn.addEventListener("click", function (e) {
        e.preventDefault();
        if (lastUrl) { try { URL.revokeObjectURL(lastUrl); } catch (err) {} lastUrl = null; }
        lastFile = null;
        lastBuild = null;
        showPanel(false);
        var p = root.ZabbadatHide && root.ZabbadatHide.showDay
          ? root.ZabbadatHide.showDay()
          : Promise.resolve();
        Promise.resolve(p).then(syncChrome);
      });
    }
  }

  var api = {
    HIDE_AI_ENABLED: HIDE_AI_ENABLED,
    IMAGINE_MODEL: IMAGINE_MODEL,
    IMAGINE_DAILY_CAP: IMAGINE_DAILY_CAP,
    MAX_SIDE: MAX_SIDE,
    SNAP_PX: SNAP_PX,
    HIT_R_MULT: HIT_R_MULT,
    MARGIN: MARGIN,
    CUSTOM_LINE: CUSTOM_LINE,
    HEIC_MSG: HEIC_MSG,
    PROPS: PROPS,
    aiUiAllowed: aiUiAllowed,
    placeItems: placeItems,
    boxesClear: boxesClear,
    inBounds: inBounds,
    detectFacesCheap: detectFacesCheap,
    decodeAndDownscale: decodeAndDownscale,
    buildHide: buildHide,
    runWithFile: runWithFile,
    mount: mount,
    lastBuild: null
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.ZabbadatHideCreate = api;
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { api.mount(); });
      else api.mount();
    }
  }
})(typeof window !== "undefined" ? window : this);
