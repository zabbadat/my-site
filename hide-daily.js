/* Zabbadat Today's Hide: daily seek-and-find with a 4-count breath ring.
 * Teaser day rolls at 08:00 America/New_York (et-day.js keyAtHour). If today's
 * file or manifest entry is missing, the last available day is shown.
 * Answers are packed in /hide/manifest.json (not plaintext coords or names).
 * Browser: window.ZabbadatHide. Node: require("./hide-daily.js").
 */
(function (root) {
  "use strict";
  var HOUR = 8;
  var MAX_SCALE = 4;
  var TAP_PX = 12;
  var HIT_MIN_CSS = 44;
  var HIT_R_MULT = 2;
  var HINT_AFTER = 3;
  var SNAP_PX = 26;
  var SALT = "zd.hide.v1";
  var FOUND_PREFIX = "zabHideFound:";
  var STREAK_KEY = "zabHideStreak";
  var MANIFEST_URL = "/hide/manifest.json";
  var CYCLE_MS = 16000;
  var PHASE = ["In", "Hold", "Out", "Hold"];
  var DBL_MS = 300;
  var DBL_PX = 28;

  function getET() {
    if (typeof module !== "undefined" && module.exports) return require("./et-day.js");
    return root && root.ZabbadatEtDay;
  }
  function teaserKey(ms) {
    var ET = getET();
    if (ET && ET.keyAtHour) return ET.keyAtHour(ms, HOUR);
    var d = ms == null ? new Date() : new Date(ms);
    var m = d.getMonth() + 1, day = d.getDate(), h = d.getHours();
    if (h < HOUR) { d = new Date(d.getTime() - 24 * 3600 * 1000); m = d.getMonth() + 1; day = d.getDate(); }
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function nextRolloverMs(ms) {
    var ET = getET();
    var t = ms == null ? Date.now() : +ms;
    if (ET && ET.nextAtHourMs) return ET.nextAtHourMs(t, HOUR);
    return t + 36 * 3600 * 1000;
  }

  function xorBytes(u8) {
    var out = new Uint8Array(u8.length);
    var i, s;
    for (i = 0; i < u8.length; i++) {
      s = SALT.charCodeAt(i % SALT.length);
      out[i] = u8[i] ^ s ^ ((i * 13 + 7) & 255);
    }
    return out;
  }
  function toB64(u8) {
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function" && typeof window === "undefined") {
      return Buffer.from(u8).toString("base64");
    }
    var s = "";
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  function fromB64(str) {
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function" && typeof window === "undefined") {
      return new Uint8Array(Buffer.from(String(str), "base64"));
    }
    var s = atob(String(str)), u8 = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }
  function wr16(v, a, i) { a[i] = (v >> 8) & 255; a[i + 1] = v & 255; }
  function rd16(a, i) { return (a[i] << 8) | a[i + 1]; }

  function packAnswer(ans) {
    var name = String((ans && ans.name) || "");
    var nb = [];
    for (var i = 0; i < name.length; i++) {
      var c = name.charCodeAt(i);
      if (c > 255) throw new Error("packAnswer: name must be latin-1");
      nb.push(c);
    }
    if (nb.length > 255) throw new Error("packAnswer: name too long");
    var buf = new Uint8Array(8 + nb.length);
    buf[0] = 0x48;
    wr16(Math.round((ans.x || 0) * 10000), buf, 1);
    wr16(Math.round((ans.y || 0) * 10000), buf, 3);
    wr16(Math.round((ans.r || 0) * 10000), buf, 5);
    buf[7] = nb.length;
    for (i = 0; i < nb.length; i++) buf[8 + i] = nb[i];
    return toB64(xorBytes(buf));
  }
  function unpackAnswer(k) {
    if (!k) return null;
    var buf = xorBytes(fromB64(k));
    if (!buf || buf.length < 8 || buf[0] !== 0x48) return null;
    var nlen = buf[7];
    if (buf.length < 8 + nlen) return null;
    var name = "";
    for (var i = 0; i < nlen; i++) name += String.fromCharCode(buf[8 + i]);
    return { x: rd16(buf, 1) / 10000, y: rd16(buf, 3) / 10000, r: rd16(buf, 5) / 10000, name: name };
  }

  var LINE_FALLBACK = "Breathe and look.";
  function recReady(rec) {
    return !!(rec && rec.src && (rec.k || (rec.ks && rec.ks.length)));
  }
  function dayLine(rec) {
    var s = rec && rec.line != null ? String(rec.line).trim() : "";
    return s || LINE_FALLBACK;
  }
  function pickDay(manifest, key) {
    var days = (manifest && manifest.days) || {};
    if (recReady(days[key])) return { key: key, rec: days[key], fallback: false };
    var keys = Object.keys(days).filter(function (d) { return recReady(days[d]); }).sort();
    var last = null, i;
    for (i = 0; i < keys.length; i++) { if (keys[i] <= key) last = keys[i]; }
    if (last) return { key: last, rec: days[last], fallback: true };
    if (keys.length) return { key: keys[0], rec: days[keys[0]], fallback: true };
    return null;
  }
  function unpackDay(rec) {
    var out = [], i, a;
    if (!rec) return out;
    if (rec.ks && rec.ks.length) {
      for (i = 0; i < rec.ks.length; i++) {
        a = unpackAnswer(rec.ks[i]);
        if (a) { a.id = String(i); out.push(a); }
      }
      return out;
    }
    a = unpackAnswer(rec.k);
    if (a) { a.id = "0"; out.push(a); }
    return out;
  }

  function hitTest(nx, ny, target, cssW, cssH) {
    if (!target || cssW <= 0 || cssH <= 0) return false;
    var dx = (nx - target.x) * cssW;
    var dy = (ny - target.y) * cssH;
    var r = Math.max((target.r || 0) * HIT_R_MULT * cssW, HIT_MIN_CSS);
    return dx * dx + dy * dy <= r * r;
  }
  function objectRadiusCss(target, cssW) {
    return Math.max(0, (target && target.r ? target.r : 0) * HIT_R_MULT * cssW);
  }
  function fairHit(nx, ny, target, cssW, cssH, scale) {
    scale = scale == null || scale < 0.01 ? 1 : scale;
    if (!target || cssW <= 0 || cssH <= 0) return { hit: false, snap: false, dist: Infinity };
    var dx = (nx - target.x) * cssW * scale;
    var dy = (ny - target.y) * cssH * scale;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var core = objectRadiusCss(target, cssW) * scale;
    if (dist <= core) return { hit: true, snap: false, dist: dist };
    if (dist <= core + SNAP_PX) return { hit: true, snap: true, dist: dist };
    return { hit: false, snap: false, dist: dist };
  }
  function quadrant(x, y) {
    return (y < 0.5 ? "n" : "s") + (x < 0.5 ? "w" : "e");
  }

  function shareText(looks, streak) {
    var line = "Found today's hide on Zabbadat.";
    if (looks > 0) line += " " + looks + (looks === 1 ? " look." : " looks.");
    if (streak > 1) line += " Day " + streak + ".";
    return line;
  }
  function shareUrl() {
    return "https://www.zabbadat.com/#todays-hide";
  }

  function storage() {
    try { return root && root.localStorage; } catch (e) { return null; }
  }
  function readFound(key, store) {
    store = store || storage();
    if (!store) return null;
    try { return JSON.parse(store.getItem(FOUND_PREFIX + key) || "null"); } catch (e) { return null; }
  }
  function writeFound(key, rec, store) {
    store = store || storage();
    if (!store) return;
    try { store.setItem(FOUND_PREFIX + key, JSON.stringify(rec)); } catch (e) {}
  }
  function previousTeaserKey(key) {
    var p = String(key || "").split("-");
    var y = +p[0], m = +p[1], d = +p[2];
    var dt = new Date(Date.UTC(y, m - 1, d - 1));
    var mm = dt.getUTCMonth() + 1, dd = dt.getUTCDate();
    return dt.getUTCFullYear() + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
  }
  function bumpStreak(key, store) {
    store = store || storage();
    if (!store) return { count: 1, lastKey: key };
    var cur;
    try { cur = JSON.parse(store.getItem(STREAK_KEY) || "null"); } catch (e) { cur = null; }
    var n = 1;
    if (cur && cur.lastKey === key && cur.count > 0) n = cur.count;
    else if (cur && cur.count > 0 && cur.lastKey) {
      n = (cur.lastKey === previousTeaserKey(key)) ? (cur.count + 1) : 1;
    }
    var out = { count: n, lastKey: key };
    try { store.setItem(STREAK_KEY, JSON.stringify(out)); } catch (e) {}
    return out;
  }
  function readStreak(store) {
    store = store || storage();
    if (!store) return null;
    try { return JSON.parse(store.getItem(STREAK_KEY) || "null"); } catch (e) { return null; }
  }

  function breathParts(now) {
    var t = ((now % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
    var phase = Math.floor(t / 4000);
    var count = Math.min(4, 1 + Math.floor((t % 4000) / 1000));
    return { phase: phase, label: PHASE[phase], count: count, text: PHASE[phase] + " \u00b7 " + count, t: t };
  }

  var _rollTimer = 0;
  var _bound = false;
  var _showDay = null;

  function mount(opts) {
    if (typeof document === "undefined") return;
    opts = opts || {};
    var section = document.getElementById((opts && opts.sectionId) || "todays-hide");
    if (!section) return;
    var stage = document.getElementById("todaysHideStage");
    var pan = document.getElementById("todaysHidePan");
    var img = document.getElementById("todaysHideImg");
    var marks = document.getElementById("todaysHideMarks");
    var glow = document.getElementById("todaysHideGlow");
    var ring = document.getElementById("todaysHideFound");
    var tip = document.getElementById("todaysHideTip");
    var msg = document.getElementById("todaysHideMsg");
    var listEl = document.getElementById("todaysHideList");
    var lineEl = document.getElementById("todaysHideLine");
    var hintBtn = document.getElementById("todaysHideHint");
    var breathLbl = document.getElementById("todaysHideBreathLbl");
    var resetBtn = document.getElementById("todaysHideReset");
    var shareBtn = document.getElementById("todaysHideShare");
    var zoomInBtn = document.getElementById("todaysHideZoomIn");
    var zoomOutBtn = document.getElementById("todaysHideZoomOut");
    if (!stage || !pan || !img) return;

    var items = [], selected = null, foundIds = {}, misses = {};
    var dayKey = "", looks = 0, solved = false;
    var scale = 1, tx = 0, ty = 0;
    var pts = {}, tapX = 0, tapY = 0, tapOn = false, moved = false, pinching = false, lastDist = 0;
    var lastTapAt = 0, lastTapX = 0, lastTapY = 0, guessTimer = 0;

    function applyTransform() {
      pan.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
      if (resetBtn) resetBtn.hidden = scale <= 1.01;
    }
    function clampPan() {
      var sw = stage.clientWidth, sh = stage.clientHeight;
      var w = img.offsetWidth * scale, h = img.offsetHeight * scale;
      if (w <= sw) tx = (sw - w) / 2;
      else tx = Math.min(0, Math.max(sw - w, tx));
      if (h <= sh) ty = (sh - h) / 2;
      else ty = Math.min(0, Math.max(sh - h, ty));
    }
    function zoomAt(cx, cy, newScale) {
      var ns = Math.max(1, Math.min(MAX_SCALE, newScale));
      var ox = (cx - tx) / scale, oy = (cy - ty) / scale;
      scale = ns;
      tx = cx - ox * scale;
      ty = cy - oy * scale;
      clampPan();
      applyTransform();
    }
    function resetView() {
      scale = 1; tx = 0; ty = 0;
      clampPan();
      applyTransform();
    }
    function zoomBy(factor) {
      var r = stage.getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, scale * factor);
    }
    function normFromClient(cx, cy) {
      var r = img.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height };
    }
    function setMsg(text) { if (msg) msg.textContent = text || ""; }
    function leftCount() {
      var n = 0, i;
      for (i = 0; i < items.length; i++) if (!foundIds[items[i].id]) n += 1;
      return n;
    }
    function itemById(id) {
      var i;
      for (i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
      return null;
    }
    function clearMarks() {
      if (marks) marks.innerHTML = "";
      if (ring) ring.hidden = true;
      if (glow) glow.hidden = true;
    }
    function addItemRing(it, snap) {
      if (!marks || !it) return;
      var el = document.createElement("div");
      el.className = "th-item-ring" + (snap ? " th-snap" : "");
      el.setAttribute("data-id", it.id);
      var size = Math.max((it.r || 0) * 2.6 * 100, 7);
      el.style.width = size + "%";
      el.style.height = (size * (img.offsetWidth && img.offsetHeight ? (img.offsetWidth / img.offsetHeight) : (1152 / 864))) + "%";
      // keep the ring circular in the image's own box: width % of marks width, height same px
      el.style.height = "";
      el.style.aspectRatio = "1";
      el.style.left = (it.x * 100) + "%";
      el.style.top = (it.y * 100) + "%";
      marks.appendChild(el);
    }
    function pulseHint(it) {
      if (!it) return;
      if (marks) {
        var el = document.createElement("div");
        el.className = "th-hint-pulse";
        var size = Math.max((it.r || 0) * 8 * 100, 18);
        el.style.width = size + "%";
        el.style.aspectRatio = "1";
        el.style.left = (it.x * 100) + "%";
        el.style.top = (it.y * 100) + "%";
        marks.appendChild(el);
        window.setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 1700);
      }
      if (glow) {
        glow.hidden = false;
        glow.setAttribute("data-q", quadrant(it.x, it.y));
        window.setTimeout(function () { if (glow) glow.hidden = true; }, 1600);
      }
    }
    function renderList() {
      if (!listEl) return;
      if (items.length <= 1) {
        listEl.hidden = true;
        listEl.innerHTML = "";
        return;
      }
      listEl.hidden = false;
      listEl.innerHTML = "";
      items.forEach(function (it) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = it.name;
        btn.setAttribute("data-id", it.id);
        if (foundIds[it.id]) btn.className = "th-done";
        btn.setAttribute("aria-pressed", selected && selected.id === it.id && !foundIds[it.id] ? "true" : "false");
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          if (foundIds[it.id] || solved) return;
          selected = it;
          renderList();
          setMsg("");
        });
        li.appendChild(btn);
        listEl.appendChild(li);
      });
    }
    function persist() {
      var got = [], id;
      for (id in foundIds) if (Object.prototype.hasOwnProperty.call(foundIds, id) && foundIds[id]) got.push(id);
      writeFound(dayKey, { found: solved, got: got, looks: looks, at: Date.now() });
    }
    function finishSolved() {
      solved = true;
      section.classList.add("th-found");
      bumpStreak(dayKey);
      persist();
      var line = items.length > 1 ? "Found them all." : (items[0] && items[0].name ? items[0].name : "Found.");
      var st = readStreak();
      if (st && st.count > 0 && st.lastKey === dayKey) line += " Day " + st.count + ".";
      setMsg(line);
      if (tip) tip.textContent = "Found.";
      if (shareBtn) shareBtn.hidden = false;
    }
    function markFound(it, snap) {
      if (!it || foundIds[it.id]) return;
      foundIds[it.id] = true;
      addItemRing(it, !!snap);
      var left = leftCount();
      if (left === 0) {
        renderList();
        finishSolved();
        return;
      }
      persist();
      renderList();
      selected = null;
      setMsg((it.name || "Found") + ". " + left + " to go.");
    }
    function hint(it) {
      it = it || selected;
      if (!it || solved || foundIds[it.id]) return;
      pulseHint(it);
      setMsg("Look near there.");
    }
    function guess(cx, cy) {
      if (solved) return;
      if (!selected) {
        if (items.length > 1) setMsg("Pick one from the list, then tap where it is.");
        return;
      }
      if (foundIds[selected.id]) return;
      var n = normFromClient(cx, cy);
      if (!n) return;
      looks += 1;
      var cssW = img.offsetWidth, cssH = img.offsetHeight;
      var fh = fairHit(n.x, n.y, selected, cssW, cssH, scale);
      if (fh.hit) markFound(selected, fh.snap);
      else {
        misses[selected.id] = (misses[selected.id] || 0) + 1;
        if (misses[selected.id] >= HINT_AFTER) hint(selected);
        else setMsg("");
      }
    }
    function doShare() {
      if (!solved) return;
      var st = readStreak();
      var text = shareText(looks, st && st.lastKey === dayKey ? st.count : 0);
      var url = shareUrl();
      if (navigator.share) {
        navigator.share({ title: "Today's Hide", text: text, url: url }).catch(function () {});
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text + " " + url);
          setMsg("Copied.");
        }
      } catch (e) {}
    }

    function ptrCount() { return Object.keys(pts).length; }
    function eachPtr(fn) { for (var id in pts) if (Object.prototype.hasOwnProperty.call(pts, id)) fn(pts[id]); }
    function midDist() {
      var a = null, b = null;
      eachPtr(function (p) { if (!a) a = p; else if (!b) b = p; });
      if (!a || !b) return null;
      var dx = b.x - a.x, dy = b.y - a.y;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.sqrt(dx * dx + dy * dy) };
    }
    function stagePt(e) {
      var r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    if (!_bound) {
      _bound = true;
      stage.addEventListener("pointerdown", function (e) {
        if (e.button && e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest("button")) return;
        stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
        var sp = stagePt(e);
        pts[e.pointerId] = { x: sp.x, y: sp.y };
        if (ptrCount() === 1) {
          tapX = e.clientX; tapY = e.clientY; tapOn = true; moved = false; pinching = false;
        } else {
          tapOn = false; pinching = true;
          var md = midDist();
          lastDist = md ? md.d : 0;
        }
        if (e.cancelable) e.preventDefault();
      });
      stage.addEventListener("pointermove", function (e) {
        if (!pts[e.pointerId]) return;
        var sp = stagePt(e);
        var prev = pts[e.pointerId];
        var mx = sp.x - prev.x, my = sp.y - prev.y;
        pts[e.pointerId] = { x: sp.x, y: sp.y };
        if (ptrCount() >= 2) {
          var md = midDist();
          if (md && lastDist > 0) zoomAt(md.x, md.y, scale * (md.d / lastDist));
          if (md) lastDist = md.d;
          tapOn = false;
          if (e.cancelable) e.preventDefault();
          return;
        }
        if (tapOn) {
          var dx = e.clientX - tapX, dy = e.clientY - tapY;
          if (!moved && (dx * dx + dy * dy) < TAP_PX * TAP_PX) return;
          moved = true; tapOn = false;
        }
        if (scale > 1.01) {
          tx += mx; ty += my;
          clampPan(); applyTransform();
          if (e.cancelable) e.preventDefault();
        }
      });
      function endPtr(e) {
        var wasTap = tapOn && !moved && !pinching && ptrCount() <= 1;
        var cx = e.clientX, cy = e.clientY;
        delete pts[e.pointerId];
        if (ptrCount() < 2) { pinching = false; lastDist = 0; }
        if (wasTap) {
          var now = Date.now();
          var sp2 = stagePt(e);
          if (now - lastTapAt < DBL_MS && Math.hypot(cx - lastTapX, cy - lastTapY) < DBL_PX) {
            if (guessTimer) { window.clearTimeout(guessTimer); guessTimer = 0; }
            lastTapAt = 0;
            if (scale > 1.35) resetView();
            else zoomAt(sp2.x, sp2.y, Math.min(MAX_SCALE, 2.2));
          } else {
            lastTapAt = now; lastTapX = cx; lastTapY = cy;
            if (guessTimer) window.clearTimeout(guessTimer);
            guessTimer = window.setTimeout(function () {
              guessTimer = 0;
              guess(cx, cy);
            }, DBL_MS);
          }
        }
        tapOn = false;
      }
      stage.addEventListener("pointerup", endPtr);
      stage.addEventListener("pointercancel", endPtr);
      stage.addEventListener("touchstart", function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
      stage.addEventListener("touchmove", function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
      stage.addEventListener("wheel", function (e) {
        var r = stage.getBoundingClientRect();
        var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomAt(e.clientX - r.left, e.clientY - r.top, scale * factor);
        if (e.cancelable) e.preventDefault();
      }, { passive: false });

      if (hintBtn) hintBtn.addEventListener("click", function (e) { e.preventDefault(); hint(selected); });
      if (resetBtn) resetBtn.addEventListener("click", function (e) { e.preventDefault(); resetView(); });
      if (shareBtn) shareBtn.addEventListener("click", function (e) { e.preventDefault(); doShare(); });
      if (zoomInBtn) zoomInBtn.addEventListener("click", function (e) { e.preventDefault(); zoomBy(1.25); });
      if (zoomOutBtn) zoomOutBtn.addEventListener("click", function (e) { e.preventDefault(); zoomBy(1 / 1.25); });

      // Decorative tick is retired: the Breath Equity dial under the picture is a live session
      // started from cooling-box.js (same ring as Breathe on camera). Keep breathLbl updates
      // only if the old label is still in the document.
      function tickBreath() {
        if (document.getElementById("todaysHideRing")) return;
        if (!breathLbl) return;
        var b = breathParts(Date.now());
        breathLbl.textContent = b.text;
        section.setAttribute("data-th-phase", String(b.phase));
      }
      tickBreath();
    }

    function loadFor(now, forceKey) {
      var want = forceKey || teaserKey(now);
      return fetch(opts.manifestUrl || MANIFEST_URL, { cache: "no-cache" }).then(function (res) {
        if (!res.ok) throw new Error("manifest");
        return res.json();
      }).then(function (man) {
        var picked = pickDay(man, want);
        if (!picked) throw new Error("empty");
        var dayItems = unpackDay(picked.rec);
        if (!dayItems.length) throw new Error("pack");
        if (lineEl) lineEl.textContent = dayLine(picked.rec);
        items = dayItems;
        selected = dayItems.length === 1 ? dayItems[0] : null;
        foundIds = {};
        misses = {};
        dayKey = want;
        looks = 0;
        solved = false;
        section.classList.remove("th-found");
        clearMarks();
        if (shareBtn) shareBtn.hidden = true;
        setMsg("");
        if (tip) {
          tip.textContent = dayItems.length > 1
            ? "Pick one, then tap where it is. Pinch to look closer."
            : "Pinch to look closer. Tap when you see it.";
        }
        img.alt = "Today's hide. Breathe and look.";
        img.onload = function () { resetView(); };
        img.src = picked.rec.src;
        var rec = readFound(want);
        if (rec) {
          looks = rec.looks || looks;
          var got = rec.got || (rec.found ? dayItems.map(function (it) { return it.id; }) : []);
          var i, it;
          for (i = 0; i < got.length; i++) {
            it = itemById(String(got[i]));
            if (it) {
              foundIds[it.id] = true;
              addItemRing(it, false);
            }
          }
          if (rec.found || leftCount() === 0) finishSolved();
        }
        renderList();
      }).catch(function () {
        setMsg("Today's hide is on its way.");
      });
    }

    _showDay = function (key, now) { return loadFor(now == null ? Date.now() : now, key); };

    if (opts.dayKey) loadFor(opts.now != null ? opts.now : Date.now(), opts.dayKey);
    else loadFor(opts.now != null ? opts.now : Date.now());
    if (_rollTimer) window.clearTimeout(_rollTimer);
    function armRoll() {
      var wait = Math.max(250, nextRolloverMs(Date.now()) - Date.now() + 50);
      _rollTimer = window.setTimeout(function () {
        if (!opts.dayKey) loadFor(Date.now());
        armRoll();
      }, Math.min(wait, 6 * 3600 * 1000));
    }
    armRoll();
  }

  var api = {
    HOUR: HOUR, HINT_AFTER: HINT_AFTER, HIT_MIN_CSS: HIT_MIN_CSS, HIT_R_MULT: HIT_R_MULT,
    SNAP_PX: SNAP_PX,
    teaserKey: teaserKey, nextRolloverMs: nextRolloverMs,
    packAnswer: packAnswer, unpackAnswer: unpackAnswer, unpackDay: unpackDay, pickDay: pickDay,
    dayLine: dayLine, LINE_FALLBACK: LINE_FALLBACK,
    hitTest: hitTest, fairHit: fairHit, objectRadiusCss: objectRadiusCss,
    quadrant: quadrant, breathParts: breathParts,
    shareText: shareText, shareUrl: shareUrl,
    previousTeaserKey: previousTeaserKey, readFound: readFound, writeFound: writeFound,
    bumpStreak: bumpStreak, readStreak: readStreak, mount: mount,
    showDay: function (key, now) { return _showDay ? _showDay(key, now) : Promise.resolve(); }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.ZabbadatHide = api;
    if (typeof document !== "undefined") {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { api.mount(); });
      else api.mount();
    }
  }
})(typeof window !== "undefined" ? window : this);
