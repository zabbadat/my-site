/* Zabba Washers game steps, app-only (Capacitor.isNativePlatform + ZabbaSteps.startGameSteps).
 * Reuses daily-steps.js helpers (debugLine, nextDisplayed policy, bindForegroundEvents) without
 * changing Step Equity. Browser callers leave this module unused, so DeviceMotion is unchanged.
 *
 * Native: one GameStepLedger segment while the game is running. Pause / finish / reset finalizes
 * the ledger (stopGameSteps). Resume after pause starts a new segment and adds it to baseSteps.
 * A webview reload mid-game restores the same gameId (resume: true). Displayed steps are
 * monotonic and a large catch-up snaps at once. Eastern midnight never resets a running game
 * (per-game total, not a daily total). Tonight's board still uses et-day.js.
 */
(function (root) {
  "use strict";
  var D = typeof module !== "undefined" && module.exports ? require("./daily-steps.js") : root && root.ZabbadatDaily;
  var LIVE_KEY = "zabbadat-washers-live";

  function pickGameSource(win) {
    var C = win && win.Capacitor;
    if (C && typeof C.isNativePlatform === "function" && C.isNativePlatform() && C.Plugins) {
      var names = ["ZabbaSteps", "Pedometer"], i, p;
      for (i = 0; i < names.length; i++) {
        p = C.Plugins[names[i]];
        if (p && typeof p.startGameSteps === "function") return { kind: "native", plugin: p, name: names[i] };
      }
    }
    return { kind: "web" };
  }

  function clampGame(n) {
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(n, 100000);
  }
  // Same policy as ZabbadatDaily.nextDisplayed, without the daily 60_000 cap.
  function nextDisplayed(prev, incoming) { return Math.max(clampGame(prev), clampGame(incoming)); }

  function readLive(store) {
    try {
      var c = JSON.parse((store && store.getItem(LIVE_KEY)) || "null");
      return c && typeof c === "object" ? c : null;
    } catch (e) { return null; }
  }
  function writeLive(store, o) {
    try {
      if (!store) return;
      if (o) store.setItem(LIVE_KEY, JSON.stringify(o));
      else store.removeItem(LIVE_KEY);
    } catch (e) {}
  }

  function debugFrom(r, steps) {
    if (!D || !D.debugLine) return "";
    var d = r && (r.debug || null);
    if (!d && r && r.rawSteps != null) d = { rawSteps: r.rawSteps, filteredSteps: r.steps, rejectedTotal: r.rejectedSteps || 0, reason: r.activityMissing ? "activity unlabeled" : "" };
    return d ? D.debugLine(d, steps) : "";
  }

  function createGameController(win, hooks) {
    hooks = hooks || {};
    var src = pickGameSource(win), store = win && win.localStorage, nativeHooked = false;
    var st = { steps: 0, rawSteps: 0, debug: null, debugLine: "", gameId: null, startedAt: 0, baseSteps: 0,
               active: false, source: src.kind, kind: src.kind, msg: "", ended: false };

    function emit() { hooks.onChange && hooks.onChange(st); }

    function applyNativeReading(r) {
      if (!r) return st.steps;
      if (r.active === false && r.steps == null && r.displayedSteps == null) return st.steps;
      var n = r.steps != null ? r.steps : r.displayedSteps;
      if (n == null) return st.steps;
      var total = nextDisplayed(st.steps, clampGame(st.baseSteps) + clampGame(n));
      st.rawSteps = Math.max(st.rawSteps || 0, clampGame(r.rawSteps != null ? r.rawSteps : n));
      if (r.debug) { st.debug = r.debug; st.debugLine = D && D.debugLine ? D.debugLine(r.debug, total) : ""; }
      else { st.debug = st.debug || { rawSteps: st.rawSteps, filteredSteps: total, rejectedTotal: r.rejectedSteps || 0, reason: r.activityMissing ? "activity unlabeled" : "" }; st.debugLine = debugFrom(r, total); }
      st.steps = total;
      if (r.gameId) st.gameId = r.gameId;
      if (r.msg) st.msg = r.msg;
      emit();
      return st.steps;
    }

    function hookNativeStream() {
      if (nativeHooked || src.kind !== "native" || !src.plugin) return;
      nativeHooked = true;
      var p = src.plugin;
      function onData(d) { try { applyNativeReading(d || {}); } catch (e) {} }
      if (typeof p.addListener === "function") {
        try { Promise.resolve(p.addListener("gameSteps", onData)).catch(function () {}); } catch (e) {}
      }
    }

    // Shape expected by daily-steps bindForegroundEvents / a local createForegroundRefresh:
    // paint last known, then one getGameSteps + syncGameSteps backfill. No rollDay (midnight
    // must not reset a running game). Never reads the daily-steps cache.
    async function refreshNative() {
      if (src.kind !== "native" || !src.plugin) return st.steps;
      hookNativeStream();
      try {
        if (typeof src.plugin.getGameSteps === "function") {
          try { var c = await src.plugin.getGameSteps(); if (c && (c.active !== false || c.steps != null)) applyNativeReading(c); } catch (e) {}
        }
        if (typeof src.plugin.syncGameSteps === "function") {
          var r = await src.plugin.syncGameSteps();
          if (r && (r.active !== false || r.steps != null)) applyNativeReading(r);
        }
      } catch (e) {}
      return st.steps;
    }

    async function start(opts) {
      opts = opts || {};
      if (src.kind !== "native" || !src.plugin) return false;
      hookNativeStream();
      if (opts.newSegment) st.baseSteps = st.steps;
      var id = opts.gameId || st.gameId || ("washers-" + Date.now());
      var started = opts.startedAt || Date.now();
      st.gameId = id; st.startedAt = started; st.active = true; st.ended = false;
      try {
        if (typeof src.plugin.requestPermissions === "function") {
          try { await src.plugin.requestPermissions(); } catch (e) {}
        }
        var resume = opts.resume !== false && !opts.newSegment;
        var r = await src.plugin.startGameSteps({ gameId: id, startedAt: started, resume: resume });
        applyNativeReading(r || { steps: 0, gameId: id });
        st.msg = "Game on. The phone's step counter keeps counting: lock your phone or use other apps, steps still count.";
        emit();
        return true;
      } catch (e) {
        st.msg = "Couldn't start the phone step counter. Check motion permission in Settings.";
        emit();
        return false;
      }
    }

    async function stop() {
      if (src.kind !== "native" || !src.plugin) { st.active = false; emit(); return st.steps; }
      try {
        if (typeof src.plugin.stopGameSteps === "function") {
          var r = await src.plugin.stopGameSteps();
          if (r && r.steps != null) applyNativeReading(r);
        }
      } catch (e) {}
      st.active = false;
      st.ended = true;
      st.baseSteps = st.steps;
      emit();
      return st.steps;
    }

    function reset() {
      st.steps = 0; st.rawSteps = 0; st.debug = null; st.debugLine = ""; st.gameId = null;
      st.startedAt = 0; st.baseSteps = 0; st.active = false; st.ended = false; st.msg = "";
      writeLive(store, null);
      emit();
    }

    async function restore() {
      if (src.kind !== "native" || !src.plugin) return null;
      hookNativeStream();
      var live = readLive(store), peek = null;
      try { if (typeof src.plugin.getGameSteps === "function") peek = await src.plugin.getGameSteps(); } catch (e) {}
      var active = peek && peek.active !== false && (peek.gameId || peek.steps != null) && peek.ended !== true;
      if (!active && !(live && live.running && live.gameId)) return null;
      if (live) {
        st.baseSteps = clampGame(live.baseSteps);
        st.steps = clampGame(live.steps);
        st.rawSteps = clampGame(live.rawSteps || live.steps);
        st.gameId = live.gameId || st.gameId;
        st.startedAt = live.nativeStartedAt || live.startedAt || st.startedAt;
      }
      if (peek && (peek.steps != null || peek.gameId)) applyNativeReading(peek);
      if (active) {
        st.active = true;
        st.gameId = peek.gameId || st.gameId;
        await start({ gameId: st.gameId, startedAt: st.startedAt || Date.now(), resume: true });
      }
      return { live: live, peek: peek, active: !!st.active, steps: st.steps };
    }

    hookNativeStream();
    emit();
    return {
      state: function () { return st; }, source: src, refreshNative: refreshNative, start: start, stop: stop,
      reset: reset, restore: restore, applyNativeReading: applyNativeReading, hookNativeStream: hookNativeStream,
      readLive: function () { return readLive(store); },
      writeLive: function (o) { writeLive(store, o); }
    };
  }

  // Immediate last-known paint, then one sync. Does not touch the daily-steps cache.
  // Reuses bindForegroundEvents from daily-steps.js (native source only).
  function createGameForegroundRefresh(ctl, hooks) {
    hooks = hooks || {};
    var now = hooks.now || Date.now, gap = hooks.minGapMs == null ? 0 : hooks.minGapMs, last = -Infinity, busy = false;
    async function run() {
      if (!ctl || !ctl.source || ctl.source.kind !== "native") return false;
      try {
        // Re-emit the last known game total synchronously so the first paint is not stale.
        // Do not feed the persisted full total through applyNativeReading (that adds baseSteps).
        if (hooks.onImmediate) hooks.onImmediate(ctl.state());
      } catch (e) {}
      if (busy) return false;
      var t = now();
      if (t - last < gap) return false;
      busy = true; last = t;
      try { await ctl.refreshNative(); if (hooks.afterRefresh) await hooks.afterRefresh(ctl.state()); return true; }
      catch (e) { return false; }
      finally { busy = false; }
    }
    return { run: run };
  }

  function bindGameForeground(win, ctl, run) {
    if (!D || typeof D.bindForegroundEvents !== "function") return false;
    return D.bindForegroundEvents(win, ctl, run);
  }

  // Native washers verification: skip DeviceMotion gap / hidden / no-sensor rules (the coprocessor
  // keeps counting). Keep the 60 s and min-steps-per-pack bars so a post still matches games/{id} rules.
  function nativeResult(verifier, steps, ms) {
    var o = (root && root.ZabbadatSteps && root.ZabbadatSteps.VERIFY) || { minMs: 60000, minSteps: 20, stepsPerPack: 5 };
    if (typeof module !== "undefined" && module.exports) {
      try { o = require("./step-detector.js").VERIFY || o; } catch (e) {}
    }
    var packs = 0, reasons = [];
    try { if (verifier && typeof verifier.state === "function") packs = verifier.state().packs || 0; } catch (e) {}
    if ((ms || 0) < o.minMs) reasons.push("game shorter than 60 s");
    var need = Math.max(o.minSteps, o.stepsPerPack * packs);
    if ((steps || 0) < need) reasons.push("only " + (steps || 0) + " steps for " + packs + " pack" + (packs === 1 ? "" : "s") + " (need " + need + ")");
    return { verified: reasons.length === 0, reasons: reasons, samples: 0, maxGapMs: 0, packs: packs, minSteps: need, native: true };
  }

  var api = { LIVE_KEY: LIVE_KEY, pickGameSource: pickGameSource, clampGame: clampGame, nextDisplayed: nextDisplayed,
              readLive: readLive, writeLive: writeLive, createGameController: createGameController,
              createGameForegroundRefresh: createGameForegroundRefresh, bindGameForeground: bindGameForeground,
              nativeResult: nativeResult };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatGameSteps = api;
})(this);
