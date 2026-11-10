/* ZabbaDat daily steps: one module for the website and the Capacitor app.
 * Source adapter (picked by pickSource):
 *   native: window.Capacitor.Plugins.ZabbaSteps (or .Pedometer) exposing
 *           getTodaySteps() -> Promise<{ steps: number }>   (required; steps since local midnight)
 *           isAvailable()   -> Promise<{ available: boolean }>  (optional)
 *           requestPermissions() -> Promise<{ granted: boolean }> (optional; iOS Motion / Android ACTIVITY_RECOGNITION)
 *   web:    DeviceMotion step detection (step-detector.js) while the page is open ("live walk").
 * Pure helpers are exported for tests; the browser controller is ZabbadatDaily.createController.
 */
(function (root) {
  "use strict";
  var MAX_STEPS = 60000, NAME_MAX = 40, HANDLE_MAX = 21, KEY = "zabbadat-daily-steps-";

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // Day key = the America/New_York date (et-day.js): the day resets at Eastern midnight for everyone. Device-local date only if et-day.js is missing.
  var ET = typeof module !== "undefined" && module.exports ? require("./et-day.js") : root && root.ZabbadatEtDay;
  function localDateKey(d) { if (ET) return ET.key(d || Date.now()); d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function docId(uid, date) { return uid + "_" + date; }
  function clampSteps(n) { n = Math.floor(Number(n)); if (!isFinite(n) || n < 0) return 0; return Math.min(n, MAX_STEPS); }
  // Web adds walk steps to the day; native reports the day's total. Never go down.
  function addWeb(prev, added) { return clampSteps(clampSteps(prev) + clampSteps(added)); }
  function mergeNative(prev, total) { return Math.max(clampSteps(prev), clampSteps(total)); }
  var CACHE_KEY = "zabbadat-steps-cache";
  var WALK_KEY = "zabbadat-walk-live";
  function readCache(store, date) {
    try {
      var c = JSON.parse((store && store.getItem(CACHE_KEY)) || "null");
      if (!c || typeof c !== "object") return null;
      var today = date || localDateKey();
      if (c.date && c.date !== today) return null;
      if (!c.date && ET && c.at && c.at < ET.startMs()) return null;
      if (!c.date && ET && !c.at) return null;
      return c;
    } catch (e) { return null; }
  }
  function writeCache(store, o) {
    try {
      if (!store) return;
      store.setItem(CACHE_KEY, JSON.stringify({
        steps: clampSteps(o.steps), rawSteps: clampSteps(o.rawSteps != null ? o.rawSteps : o.steps),
        debug: o.debug || null, date: o.date || localDateKey(), at: Date.now()
      }));
    } catch (e) {}
  }
  function readWalk(store) {
    try { var c = JSON.parse((store && store.getItem(WALK_KEY)) || "null"); return c && c.walking ? c : null; } catch (e) { return null; }
  }
  function writeWalk(store, o) {
    try { if (!store) return; if (o && o.walking) store.setItem(WALK_KEY, JSON.stringify(o)); else store.removeItem(WALK_KEY); } catch (e) {}
  }
  // Display policy: never flash a lower number; a large catch-up on resume is shown at once (no count-up).
  function nextDisplayed(prev, incoming, opts) {
    opts = opts || {};
    var a = clampSteps(prev), b = clampSteps(incoming);
    if (opts.allowLower) return b;
    return Math.max(a, b);
  }
  function debugLine(d, steps) {
    if (!d) return "";
    var raw = d.rawSteps != null ? d.rawSteps : steps;
    var rej = d.rejectedTotal || 0, why = d.reason || "";
    return "Phone raw " + Number(raw || 0).toLocaleString() + " · counted " + Number(steps || 0).toLocaleString() + (rej ? (" · rejected " + rej + (why ? " (" + why + ")" : "")) : "");
  }

  function buildRecord(o) {
    var r = { name: String(o.name || "Player").trim().slice(0, NAME_MAX) || "Player", uid: o.uid, date: o.date,
              steps: clampSteps(o.steps), source: o.source === "native" ? "native" : "web" };
    var h = String(o.xHandle || "").trim().replace(/^@/, "").slice(0, HANDLE_MAX - 1);
    if (h) r.xHandle = "@" + h;
    return r;
  }
  // Mirrors firestore.rules so the client never sends a doomed write.
  function validateRecord(r, id, prevSteps) {
    var errs = [];
    if (!r.uid) errs.push("not signed in");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) errs.push("bad date");
    if (id !== docId(r.uid, r.date)) errs.push("bad id");
    if (typeof r.name !== "string" || !r.name.length || r.name.length > NAME_MAX) errs.push("bad name");
    if (r.xHandle != null && (typeof r.xHandle !== "string" || r.xHandle.length > HANDLE_MAX)) errs.push("bad handle");
    if (!(r.steps > 0 && r.steps <= MAX_STEPS) || r.steps !== Math.floor(r.steps)) errs.push("steps out of range");
    if (prevSteps != null && r.steps < prevSteps) errs.push("steps can't go down");
    if (r.source !== "native" && r.source !== "web") errs.push("bad source");
    return { ok: errs.length === 0, errors: errs };
  }
  function rankDaily(rows, date, n) {
    return (rows || []).filter(function (r) { return r && r.date === date && Number(r.steps) > 0; })
      .sort(function (a, b) { return Number(b.steps) - Number(a.steps) || String(a.name).localeCompare(String(b.name)); })
      .slice(0, n || 50);
  }
  function pickSource(win) {
    var C = win && win.Capacitor;
    if (C && typeof C.isNativePlatform === "function" && C.isNativePlatform() && C.Plugins) {
      var names = ["ZabbaSteps", "Pedometer"];
      for (var i = 0; i < names.length; i++) {
        var p = C.Plugins[names[i]];
        if (p && typeof p.getTodaySteps === "function") return { kind: "native", plugin: p, name: names[i] };
      }
    }
    if (win && typeof win.DeviceMotionEvent !== "undefined") return { kind: "web" };
    return { kind: "none" };
  }
  function readLocal(store, date) { try { return clampSteps(store.getItem(KEY + date)); } catch (e) { return 0; } }
  function writeLocal(store, date, n) { try { store.setItem(KEY + date, String(clampSteps(n))); } catch (e) {} }

  // Browser controller. hooks: { onChange(state), isLocked(), detectorFactory() }
  function createController(win, hooks) {
    hooks = hooks || {};
    var src = pickSource(win), store = win.localStorage, walking = false, det = null, onMotion = null, nativeOk = false, nativeHooked = false;
    var st = { date: localDateKey(), steps: 0, source: src.kind === "native" ? "native" : "web", kind: src.kind, walking: false, msg: "", rawSteps: 0, debug: null, debugLine: "" };
    st.steps = readLocal(store, st.date);
    var cached0 = readCache(store);
    if (cached0 && cached0.steps > st.steps) { st.steps = clampSteps(cached0.steps); st.rawSteps = clampSteps(cached0.rawSteps); st.debug = cached0.debug; st.debugLine = debugLine(st.debug, st.steps); }
    function emit() { st.walking = walking; hooks.onChange && hooks.onChange(st); }
    function rollDay() {
      var d = localDateKey();
      if (d !== st.date) {
        st.date = d; st.steps = readLocal(store, d); st.rawSteps = 0; st.debug = null; st.debugLine = "";
        det && det.reset();
        try { if (store) store.removeItem(CACHE_KEY); } catch (e) {}
      }
    }
    function setSteps(n) { rollDay(); st.steps = nextDisplayed(st.steps, n); writeLocal(store, st.date, st.steps); writeCache(store, st); emit(); }
    function applyNativeReading(r, opts) {
      opts = opts || {};
      if (!r) return st.steps;
      rollDay();
      var n = r.steps;
      if (n == null && r.cachedSteps != null) n = r.cachedSteps;
      st.rawSteps = Math.max(st.rawSteps || 0, clampSteps(r.rawSteps != null ? r.rawSteps : n));
      if (r.debug) { st.debug = r.debug; st.debugLine = debugLine(r.debug, nextDisplayed(st.steps, n)); }
      else if (r.rawSteps != null) { st.debug = st.debug || { rawSteps: r.rawSteps, filteredSteps: n }; st.debugLine = debugLine(st.debug, nextDisplayed(st.steps, n)); }
      setSteps(mergeNative(st.steps, n));
      if (r.msg) st.msg = r.msg;
      return st.steps;
    }
    function hookNativeStream() {
      if (nativeHooked || src.kind !== "native" || !src.plugin) return;
      nativeHooked = true;
      var p = src.plugin;
      function onData(d) { try { applyNativeReading(d || {}); } catch (e) {} }
      if (typeof p.addListener === "function") {
        try { Promise.resolve(p.addListener("todaySteps", onData)).catch(function () {}); } catch (e) {}
        try { Promise.resolve(p.addListener("stepsResume", onData)).catch(function () {}); } catch (e) {}
      }
      if (typeof p.startTodayUpdates === "function") {
        try { Promise.resolve(p.startTodayUpdates()).catch(function () {}); } catch (e) {}
      }
    }
    async function refreshNative() {
      if (src.kind !== "native") return st.steps;
      hookNativeStream();
      try {
        if (typeof src.plugin.getCachedSteps === "function") {
          try { var c = await src.plugin.getCachedSteps(); if (c) applyNativeReading(c); } catch (e) {}
        }
        if (typeof src.plugin.requestPermissions === "function") await src.plugin.requestPermissions();
        var r = await src.plugin.getTodaySteps();
        nativeOk = true;
        applyNativeReading(Object.assign({ msg: "Phone step counter: today's total." }, r || {}));
      } catch (e) { nativeOk = false; st.msg = "Couldn't read the phone step counter. Check motion/activity permission in Settings."; emit(); }
      return st.steps;
    }
    async function startWalk() { // call from a user gesture (iOS permission)
      if (walking) return true;
      if (src.kind === "native") {
        // App: the phone's step counter owns the total. No DeviceMotion, no addWeb (no double counting): read the phone first, then time the session.
        await refreshNative();
        if (!nativeOk) { emit(); return false; } // no baseline without a phone reading; the permission message stays up
        walking = true; st.source = "native"; st.msg = "Walk on. The phone's step counter keeps counting: lock your phone or use other apps, steps still count.";
        writeWalk(store, { walking: true, startedAt: Date.now(), baseSteps: st.steps, date: st.date });
        if (src.plugin && typeof src.plugin.startWalkSession === "function") {
          try { Promise.resolve(src.plugin.startWalkSession({ startedAt: Date.now(), baseSteps: st.steps, resume: false })).catch(function () {}); } catch (e) {}
        }
        emit(); return true;
      }
      if (typeof win.DeviceMotionEvent === "undefined") { st.msg = "This browser has no motion sensor."; emit(); return false; }
      try {
        if (typeof win.DeviceMotionEvent.requestPermission === "function") {
          var perm = await win.DeviceMotionEvent.requestPermission();
          if (perm !== "granted") { st.msg = "Motion access is off. Allow motion for this site to count steps."; emit(); return false; }
        }
      } catch (e) { st.msg = "Motion access failed."; emit(); return false; }
      det = (hooks.detectorFactory || function () { return win.ZabbadatSteps.createStepDetector(); })();
      onMotion = function (e) {
        // Orientation-free (pocket): prefer the gravity-included magnitude; some browsers send it with null axes.
        var g = e.accelerationIncludingGravity, a = (g && g.x != null) ? g : e.acceleration;
        if (!a || a.x == null) return;
        var r = e.rotationRate;
        var res = det.update({ t: win.performance.now(), x: a.x, y: a.y, z: a.z, gravity: a === g,
          rot: r ? { alpha: r.alpha || 0, beta: r.beta || 0, gamma: r.gamma || 0 } : null });
        if (res.added) setSteps(addWeb(st.steps, res.added));
      };
      win.addEventListener("devicemotion", onMotion);
      walking = true; st.source = "web"; st.msg = "Live walk on. Phone in your pocket, breathe easy, and walk. The screen stays awake and locked; steps keep counting."; emit(); return true;
    }
    function stopWalk() {
      if (onMotion) win.removeEventListener("devicemotion", onMotion);
      onMotion = null; walking = false; st.msg = "Walk stopped. " + st.steps.toLocaleString() + " steps today.";
      writeWalk(store, null);
      if (src.plugin && typeof src.plugin.stopWalkSession === "function") {
        try { Promise.resolve(src.plugin.stopWalkSession()).catch(function () {}); } catch (e) {}
      }
      emit();
    }
    function restoreWalk() {
      var w = readWalk(store);
      if (!w || !w.walking) return false;
      walking = true; st.source = src.kind === "native" ? "native" : st.source;
      emit();
      return w;
    }
    // Manual entry: steps already on the phone (built-in counter or health app), added to today's total.
    function addManual(n) { n = clampSteps(n); if (!n) return st.steps; setSteps(addWeb(st.steps, n)); st.msg = "Added " + n.toLocaleString() + " steps. Total today: " + st.steps.toLocaleString() + "."; emit(); return st.steps; }
    // Signed-in sync: today's board doc (written by web or app) is the shared total. Take the higher, never go down.
    function syncRemote(n) { rollDay(); var m = mergeNative(st.steps, n); if (m !== st.steps) setSteps(m); return st.steps; }
    hookNativeStream();
    emit();
    return { state: function () { return st; }, source: src, refreshNative: refreshNative, startWalk: startWalk, stopWalk: stopWalk, addManual: addManual, syncRemote: syncRemote, rollDay: rollDay, applyNativeReading: applyNativeReading, restoreWalk: restoreWalk, hookNativeStream: hookNativeStream };
  }

  // Foreground refresh: when the app/page comes back, paint the last known total immediately, then
  // run one getTodaySteps / getCachedSteps backfill (no debounce). Never concurrent, errors swallowed.
  // rollDay first so a day change is handled. Totals only ever rise (mergeNative).
  function createForegroundRefresh(ctl, hooks) {
    hooks = hooks || {};
    var now = hooks.now || Date.now, gap = hooks.minGapMs == null ? 0 : hooks.minGapMs, last = -Infinity, busy = false;
    async function run(ev) {
      if (!ctl || !ctl.source || ctl.source.kind !== "native") return false;
      // Always re-emit the last known count synchronously so the first paint after resume is not stale/zero.
      try {
        if (typeof ctl.rollDay === "function") ctl.rollDay();
        if (typeof ctl.applyNativeReading === "function") { var c = readCache(hooks.store); if (c) ctl.applyNativeReading(c); }
        if (hooks.onImmediate) hooks.onImmediate(ctl.state());
      } catch (e) {}
      if (busy) return false;
      var t = now();
      if (t - last < gap) return false;
      busy = true; last = t;
      try {
        await ctl.refreshNative();
        if (hooks.afterRefresh) await hooks.afterRefresh(ctl.state());
        return true;
      } catch (e) { return false; }
      finally { busy = false; }
    }
    return { run: run };
  }
  // Wire the foreground events to run(). Does nothing unless the native step plugin is the source (plain browser: no new listeners).
  function bindForegroundEvents(win, ctl, run) {
    if (!win || !ctl || !ctl.source || ctl.source.kind !== "native") return false;
    var go = function () { try { run(); } catch (e) {} };
    var doc = win.document;
    if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", function () { if (!doc.hidden) go(); });
    if (win.addEventListener) { win.addEventListener("focus", go); win.addEventListener("pageshow", go); }
    var App = win.Capacitor && win.Capacitor.Plugins && win.Capacitor.Plugins.App;
    if (App && typeof App.addListener === "function") {
      try { Promise.resolve(App.addListener("appStateChange", function (st) { if (!st || st.isActive !== false) go(); })).catch(function () {}); } catch (e) {}
      try { Promise.resolve(App.addListener("resume", go)).catch(function () {}); } catch (e) {}
    }
    if (ctl.hookNativeStream) try { ctl.hookNativeStream(); } catch (e) {}
    return true;
  }

  var api = { MAX_STEPS: MAX_STEPS, localDateKey: localDateKey, docId: docId, clampSteps: clampSteps, addWeb: addWeb,
              mergeNative: mergeNative, nextDisplayed: nextDisplayed, debugLine: debugLine, readCache: readCache, writeCache: writeCache,
              readWalk: readWalk, writeWalk: writeWalk, buildRecord: buildRecord, validateRecord: validateRecord, rankDaily: rankDaily,
              pickSource: pickSource, readLocal: readLocal, writeLocal: writeLocal, createController: createController,
              createForegroundRefresh: createForegroundRefresh, bindForegroundEvents: bindForegroundEvents,
              CACHE_KEY: CACHE_KEY, WALK_KEY: WALK_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatDaily = api;
})(this);
