/* Zabbadat lower-third card for the outgoing YouTube (WHIP) stream (owner Nov 20).
 * Site-side burn-in so the relay stays -c copy / never adds an ffmpeg overlay.
 * The card is pre-rendered ONCE to an offscreen canvas; each output frame is one drawImage of the already-covered
 * PFP shield canvas plus one small drawImage of the card. The compositor only ever reads the covered shield while
 * Profile is on (never the raw camera); if the shield is missing it paints nothing new for that frame.
 * Local preview, match viewers (peer-to-peer) and Record are unchanged.
 */
(function (root) {
  "use strict";
  var LABEL = "Zabbadat";
  // Layout in 1920x1080 design units (lower-third.svg), scaled by the output width; ~4% title-safe margin.
  var D = { W: 1920, x: 80, bottom: 72, w: 470, h: 120, r: 18, bar: 6, pad: 40, font: 64 };
  function layout(w, h) {
    if (!(w > 0 && h > 0)) return null;
    // Scale from the long side (landscape: width/1920, like the design), capped at 40% of the width so a portrait
    // phone frame still gets a readable card that stays in the bottom-left corner.
    var k = Math.min(Math.max(w, h) / D.W, (w * 0.4) / D.w, h / 1080);
    var cw = Math.round(D.w * k), ch = Math.round(D.h * k);
    var x = Math.max(Math.round(D.x * k), Math.round(w * 0.04)), y = Math.round(h - Math.max(D.bottom * k, h * 0.04) - ch);
    return { x: x, y: y, w: Math.max(1, cw), h: Math.max(1, ch), k: k };
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  // Card at native resolution for this output size (drawn at 1:1 each frame, no per-frame scaling).
  function renderCard(doc, L) {
    var c = doc.createElement("canvas"); c.width = L.w; c.height = L.h;
    var g = c.getContext("2d"); if (!g) return c;
    var k = L.k, r = Math.max(2, D.r * k), lw = Math.max(1, 2 * k);
    g.clearRect(0, 0, L.w, L.h);
    roundRect(g, lw / 2, lw / 2, L.w - lw, L.h - lw, r);
    g.fillStyle = "rgba(14,20,18,0.90)"; g.fill();
    g.lineWidth = lw; g.strokeStyle = "rgba(255,46,147,0.63)"; g.stroke();
    var bw = Math.max(2, D.bar * k), by = Math.round(8 * k);
    roundRect(g, 0, by, bw, L.h - 2 * by, bw / 2); g.fillStyle = "#C6FF00"; g.fill();
    var fs = Math.max(8, Math.round(D.font * k));
    g.font = "600 " + fs + "px 'Cormorant Garamond', 'Times New Roman', serif";
    g.textBaseline = "middle"; g.fillStyle = "#eef4f1";
    var tx = Math.round(D.pad * k), maxW = L.w - tx - Math.round(24 * k);
    g.fillText(LABEL, tx, Math.round(L.h / 2), maxW);
    return c;
  }
  // opts: { doc, host (element the canvas is appended to; iOS needs it in the document),
  //         source(): the canvas/video to draw this frame, or null to skip (caller enforces PFP rules), fps }
  function compositor(opts) {
    var doc = opts.doc || root.document, fps = opts.fps || 24, raf = root.requestAnimationFrame || function (f) { return setTimeout(f, 1000 / fps); };
    var cv = doc.createElement("canvas"); cv.className = "zl-lower-third"; cv.setAttribute("aria-hidden", "true");
    cv.width = 2; cv.height = 2;
    cv.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:0";
    (opts.host || doc.body || doc.documentElement).appendChild(cv);
    var g = cv.getContext("2d"), card = null, cardKey = "", dead = false, last = 0, frames = 0, gap = 1000 / fps - 2;
    function ensureCard(w, h) {
      var key = w + "x" + h; if (card && cardKey === key) return;
      var L = layout(w, h); if (!L) return;
      card = { img: renderCard(doc, L), L: L }; cardKey = key;
    }
    try { if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { cardKey = ""; }); } catch (e) {} // re-render once web fonts arrive
    function paint() {
      var src = opts.source && opts.source(); if (!src) return false;
      var w = src.videoWidth || src.width, h = src.videoHeight || src.height; if (!(w > 0 && h > 0)) return false;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      g.drawImage(src, 0, 0, w, h); // already-covered shield (PFP on) — the face cover is drawn first, untouched
      ensureCard(w, h);
      if (card) g.drawImage(card.img, card.L.x, card.L.y);
      frames++; return true;
    }
    function tick() {
      if (dead) return;
      var now = root.performance && root.performance.now ? root.performance.now() : Date.now(); // one clock (rAF and timer paths)
      if (now - last >= gap) { last = now; try { paint(); } catch (e) {} }
      raf.call(root, tick);
    }
    paint(); tick();
    var stream = typeof cv.captureStream === "function" ? cv.captureStream(fps) : null;
    return {
      canvas: cv, stream: stream, paint: paint, frames: function () { return frames; },
      stop: function () {
        dead = true;
        try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        try { if (cv.parentNode) cv.parentNode.removeChild(cv); } catch (e) {}
      }
    };
  }
  var api = { LABEL: LABEL, layout: layout, renderCard: renderCard, compositor: compositor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabLowerThird = api;
})(typeof window !== "undefined" ? window : this);
