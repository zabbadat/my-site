/* Crisp arcade digits for the Washers scoreboard (and shared arcade readouts).
 * Source is vector 7-segment SVG — not a font and not a bitmap — so nothing is
 * upscaled. A solid outset glow sits on a layer BEHIND the digits; the digit
 * layer is opaque, unfiltered, and snapped to integer CSS pixels. */
(function () {
  const SEL = "#score.arcade-page,#stepsStat.arcade-page,#clock.arcade-page,#pushRepsBig.arcade-page,#pushClock.arcade-page,#plankClock.arcade-page,.arcade-strip .arcade-num,.wb-board .arc-score";
  // Integer unit grid. One digit is 11×19; colon is 5×19; 2-unit gap after each cell.
  const DIG_W = 11, COL_W = 5, H = 19, GAP = 4, PAD = 2;
  const MAP = {
    "0": "abcdef",
    "1": "bc",
    "2": "abged",
    "3": "abcdg",
    "4": "bcfg",
    "5": "acdfg",
    "6": "acdefg",
    "7": "abc",
    "8": "abcdefg",
    "9": "abcdfg",
    "-": "g"
  };
  // Axis-aligned segment rects (x, y, w, h) in the 11×19 cell.
  const SEGS = {
    a: [2, 0, 7, 3],
    b: [8, 2, 3, 6],
    c: [8, 11, 3, 6],
    d: [2, 16, 7, 3],
    e: [0, 11, 3, 6],
    f: [0, 2, 3, 6],
    g: [2, 8, 7, 3]
  };

  function cellW(ch) { return ch === ":" ? COL_W : DIG_W; }

  function unitsFor(text) {
    let w = PAD;
    for (let i = 0; i < text.length; i++) w += cellW(text[i]) + GAP;
    return { w: w + PAD, h: H + PAD * 2 };
  }

  function rectsFor(ch, ox, oy, outset) {
    const o = outset || 0;
    const out = [];
    if (ch === " ") return out;
    if (ch === ":") {
      const boxes = [[1, 4, 3, 3], [1, 12, 3, 3]];
      for (const [x, y, w, h] of boxes) out.push([ox + x - o, oy + y - o, w + o * 2, h + o * 2]);
      return out;
    }
    const keys = MAP[ch];
    if (!keys) return out;
    for (const k of keys) {
      const [x, y, w, h] = SEGS[k];
      out.push([ox + x - o, oy + y - o, w + o * 2, h + o * 2]);
    }
    return out;
  }

  function svgFor(text, fill, glowFill) {
    const dim = unitsFor(text);
    const glow = [];
    const digits = [];
    let x = PAD;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const oy = PAD;
      for (const r of rectsFor(ch, x, oy, 1)) {
        glow.push('<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '"/>');
      }
      for (const r of rectsFor(ch, x, oy, 0)) {
        digits.push('<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '"/>');
      }
      x += cellW(ch) + GAP;
    }
    return '<svg class="arcade-crisp" viewBox="0 0 ' + dim.w + ' ' + dim.h + '" width="0" height="0" aria-hidden="true" focusable="false" shape-rendering="crispEdges">' +
      '<g class="arcade-glow" fill="' + glowFill + '" stroke="none" filter="none">' + glow.join("") + "</g>" +
      '<g class="arcade-digits" fill="' + fill + '" stroke="none" filter="none" opacity="1" shape-rendering="crispEdges">' + digits.join("") + "</g>" +
      "</svg>";
  }

  function snapCss(px, dpr) {
    return Math.round(px * dpr) / dpr;
  }

  // Group separators from toLocaleString() (e.g. steps) are not part of the digit grid.
  function normalize(text) {
    return String(text || "").replace(/[\u00a0\u202f\u2009]/g, " ").replace(/,/g, "").replace(/\s+/g, " ").trim();
  }

  function textOf(el) {
    let t = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.textContent;
      else if (n.nodeType === 1 && n.classList && n.classList.contains("arcade-src")) t += n.textContent;
    }
    t = normalize(t);
    if (t) el.dataset.arcadeText = t;
    return t || el.dataset.arcadeText || "";
  }

  function isSimple(el) {
    for (const n of el.childNodes) {
      if (n.nodeType !== 1) continue;
      if (n.classList && (n.classList.contains("arcade-src") || n.classList.contains("arcade-crisp"))) continue;
      return false;
    }
    return true;
  }

  function clearPaint(el) {
    el.classList.remove("arcade-crisp-on");
    const svg = el.querySelector(":scope > svg.arcade-crisp");
    if (svg) svg.remove();
  }

  function stashText(el, text) {
    el.dataset.arcadeText = text;
    if (!el.dataset.arcadeSize) {
      const fs = Math.max(16, Math.round(parseFloat(getComputedStyle(el).fontSize) || 24));
      el.dataset.arcadeSize = String(fs);
    }
    const nodes = [];
    for (const n of el.childNodes) if (n.nodeType === 3) nodes.push(n);
    nodes.forEach((n) => n.parentNode.removeChild(n));
    let src = el.querySelector(":scope > .arcade-src");
    if (!src) {
      src = document.createElement("span");
      src.className = "arcade-src";
      el.insertBefore(src, el.firstChild);
    }
    src.textContent = text;
  }

  function supported(text) {
    return text.length > 0 && /^[0-9:.\-\s]+$/.test(text);
  }

  function paint(el) {
    if (!el || !el.isConnected) return;
    if (!isSimple(el)) return;
    const text = textOf(el);
    if (!supported(text)) { clearPaint(el); return; }
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;

    const rawColor = cs.color;
    const transparent = !rawColor || rawColor === "transparent" || rawColor === "rgba(0, 0, 0, 0)";
    if (!el.dataset.arcadeFill && !transparent) el.dataset.arcadeFill = rawColor;
    const fill = el.dataset.arcadeFill || "#7dff7d";
    // Solid (no alpha) darker mate for the glow layer — never composited onto the digit pixels.
    const glowFill = fill === "#fff" || fill === "rgb(255, 255, 255)" || fill === "white" ? "#6e6e6e" : "#157a15";

    stashText(el, text);
    const fontSize = parseInt(el.dataset.arcadeSize, 10) || Math.max(16, Math.round(parseFloat(cs.fontSize) || 24));
    const dim = unitsFor(text);
    // Snap so one 7-segment grid unit is an integer number of device pixels (DPR 2/3 phones).
    const dpr = window.devicePixelRatio || 1;
    const unitDev = Math.max(1, Math.round((fontSize * dpr) / dim.h));
    const height = unitDev * dim.h / dpr;
    const width = unitDev * dim.w / dpr;

    let svg = el.querySelector(":scope > svg.arcade-crisp");
    const markup = svgFor(text, fill, glowFill);
    if (!svg) {
      el.insertAdjacentHTML("beforeend", markup);
      svg = el.querySelector(":scope > svg.arcade-crisp");
    } else if (svg.getAttribute("data-text") !== text || svg.getAttribute("data-fill") !== fill) {
      const tmp = document.createElement("div");
      tmp.innerHTML = markup;
      svg.replaceWith(tmp.firstChild);
      svg = el.querySelector(":scope > svg.arcade-crisp");
    }
    svg.setAttribute("data-text", text);
    svg.setAttribute("data-fill", fill);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.style.width = width + "px";
    svg.style.height = height + "px";
    svg.style.filter = "none";
    svg.style.opacity = "1";
    svg.style.transform = "none";

    el.classList.add("arcade-crisp-on");
    el.style.minHeight = height + "px";
    const left = snapCss((el.clientWidth - width) / 2, dpr);
    const top = snapCss((el.clientHeight - height) / 2, dpr);
    svg.style.left = left + "px";
    svg.style.top = top + "px";
  }

  function paintAll(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const list = [];
    if (scope.matches && scope.matches(SEL)) list.push(scope);
    scope.querySelectorAll?.(SEL).forEach((el) => list.push(el));
    list.forEach(paint);
  }

  const ro = (typeof ResizeObserver === "function") ? new ResizeObserver((entries) => {
    entries.forEach((e) => paint(e.target));
  }) : null;

  function watch(el) {
    if (ro && !el._arcadeRO) { ro.observe(el); el._arcadeRO = true; }
  }

  function boot() {
    paintAll(document);
    document.querySelectorAll(SEL).forEach(watch);
  }

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") {
        const el = m.target.parentElement;
        if (el && el.matches && el.matches(SEL)) { paint(el); watch(el); }
      } else if (m.type === "childList") {
        if (m.target && m.target.matches && m.target.matches(SEL)) { paint(m.target); watch(m.target); }
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) { paintAll(n); n.querySelectorAll?.(SEL).forEach(watch); }
        });
      }
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });

  function onResize() { paintAll(document); }
  window.addEventListener("resize", onResize);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);

  const start = () => {
    if (document.readyState === "loading") return;
    boot();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
