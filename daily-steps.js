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
  function localDateKey(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function docId(uid, date) { return uid + "_" + date; }
  function clampSteps(n) { n = Math.floor(Number(n)); if (!isFinite(n) || n < 0) return 0; return Math.min(n, MAX_STEPS); }
  // Web adds walk steps to the day; native reports the day's total. Never go down.
  function addWeb(prev, added) { return clampSteps(clampSteps(prev) + clampSteps(added)); }
  function mergeNative(prev, total) { return Math.max(clampSteps(prev), clampSteps(total)); }

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
    var src = pickSource(win), store = win.localStorage, walking = false, det = null, onMotion = null;
    var st = { date: localDateKey(), steps: 0, source: src.kind === "native" ? "native" : "web", kind: src.kind, walking: false, msg: "" };
    st.steps = readLocal(store, st.date);
    function emit() { st.walking = walking; hooks.onChange && hooks.onChange(st); }
    function rollDay() { var d = localDateKey(); if (d !== st.date) { st.date = d; st.steps = readLocal(store, d); det && det.reset(); } }
    function setSteps(n) { rollDay(); st.steps = n; writeLocal(store, st.date, n); emit(); }
    async function refreshNative() {
      if (src.kind !== "native") return st.steps;
      try {
        if (typeof src.plugin.requestPermissions === "function") await src.plugin.requestPermissions();
        var r = await src.plugin.getTodaySteps();
        rollDay(); setSteps(mergeNative(st.steps, r && r.steps)); st.msg = "Phone step counter: today's total.";
      } catch (e) { st.msg = "Couldn't read the phone step counter. Check motion/activity permission in Settings."; }
      emit(); return st.steps;
    }
    async function startWalk() { // call from a user gesture (iOS permission)
      if (walking) return true;
      if (typeof win.DeviceMotionEvent === "undefined") { st.msg = "This browser has no motion sensor."; emit(); return false; }
      try {
        if (typeof win.DeviceMotionEvent.requestPermission === "function") {
          var perm = await win.DeviceMotionEvent.requestPermission();
          if (perm !== "granted") { st.msg = "Motion access is off. Allow motion for this site to count steps."; emit(); return false; }
        }
      } catch (e) { st.msg = "Motion access failed."; emit(); return false; }
      det = (hooks.detectorFactory || function () { return win.ZabbadatSteps.createStepDetector(); })();
      onMotion = function (e) {
        var a = e.accelerationIncludingGravity || e.acceleration, g = e.accelerationIncludingGravity;
        if (!a) return;
        var r = e.rotationRate;
        var res = det.update({ t: win.performance.now(), x: a.x, y: a.y, z: a.z, gravity: a === g,
          rot: r ? { alpha: r.alpha || 0, beta: r.beta || 0, gamma: r.gamma || 0 } : null });
        if (res.added) setSteps(addWeb(st.steps, res.added));
      };
      win.addEventListener("devicemotion", onMotion);
      walking = true; st.source = "web"; st.msg = "Live walk on. Keep this page open and the screen on."; emit(); return true;
    }
    function stopWalk() {
      if (onMotion) win.removeEventListener("devicemotion", onMotion);
      onMotion = null; walking = false; st.msg = "Walk stopped. " + st.steps.toLocaleString() + " steps today."; emit();
    }
    // Manual entry: steps already on the phone (built-in counter or health app), added to today's total.
    function addManual(n) { n = clampSteps(n); if (!n) return st.steps; setSteps(addWeb(st.steps, n)); st.msg = "Added " + n.toLocaleString() + " steps. Total today: " + st.steps.toLocaleString() + "."; emit(); return st.steps; }
    // Signed-in sync: today's board doc (written by web or app) is the shared total. Take the higher, never go down.
    function syncRemote(n) { rollDay(); var m = mergeNative(st.steps, n); if (m !== st.steps) setSteps(m); return st.steps; }
    emit();
    return { state: function () { return st; }, source: src, refreshNative: refreshNative, startWalk: startWalk, stopWalk: stopWalk, addManual: addManual, syncRemote: syncRemote, rollDay: rollDay };
  }

  // Foreground refresh: when the app/page comes back, re-read the phone's step total (native source only) and let the caller post it.
  // Debounced (default 1 s), never concurrent, errors swallowed. rollDay first so a day change is handled. Totals only ever rise (mergeNative).
  function createForegroundRefresh(ctl, hooks) {
    hooks = hooks || {};
    var now = hooks.now || Date.now, gap = hooks.minGapMs == null ? 1000 : hooks.minGapMs, last = -Infinity, busy = false;
    async function run() {
      if (!ctl || !ctl.source || ctl.source.kind !== "native" || busy) return false;
      var t = now();
      if (t - last < gap) return false;
      busy = true; last = t;
      try {
        ctl.rollDay();
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
    return true;
  }

  var api = { MAX_STEPS: MAX_STEPS, localDateKey: localDateKey, docId: docId, clampSteps: clampSteps, addWeb: addWeb,
              mergeNative: mergeNative, buildRecord: buildRecord, validateRecord: validateRecord, rankDaily: rankDaily,
              pickSource: pickSource, readLocal: readLocal, writeLocal: writeLocal, createController: createController,
              createForegroundRefresh: createForegroundRefresh, bindForegroundEvents: bindForegroundEvents };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatDaily = api;
})(this);
