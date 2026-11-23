/* Cooling box: a 16-second 4-count cycle (inhale 4, hold 4, exhale 4, hold empty 4).
 * Each completed cycle adds one to the all-time localStorage counter zabbadat-breath-cycles.
 * Streak, mute, and session length are also device-local. No network and no Firestore writes.
 * Browser: window.ZabbadatCoolingBox. Node: module.exports.
 *
 * Haptics: navigator.vibrate(10) where the Vibration API exists (not iOS Safari).
 * In the native iOS/Android Capacitor wrapper, a light impact is used when
 * Capacitor.Plugins.Haptics is already present (same plugin app-bridge.js uses
 * for plank bests). No new native dependencies are added. If a wrapper build
 * lacks the plugin, wire it later rather than adding a package here. */
(function (root) {
  "use strict";
  var KEY = "zabbadat-breath-cycles";
  var STREAK_KEY = "zabbadat-breath-streak";
  var MUTE_KEY = "zabbadat-breath-mute";
  var SESSION_MIN_KEY = "zabbadat-breath-session-min";
  var CYCLE_MS = 16000;
  var SIDE_MS = 4000;
  var SIDES = ["Inhale", "Hold full", "Exhale", "Hold empty"];
  var LEVELS = [
    { at: 4, name: "Sitkari" },
    { at: 18, name: "Coolbox" },
    { at: 50, name: "Steady" },
    { at: 100, name: "Settled" },
    { at: 250, name: "Deep box" },
    { at: 500, name: "Zabbadat" }
  ];
  var DEFAULT_MIN = 5;
  var MIN_MIN = 1;
  var MAX_MIN = 10;
  var SHARE_URL = "https://zabbadat.com/#cooling-box";
  var PHASE_FREQ = [392, 330, 262, 196];
  var audioCtx = null;

  function storeOf(store) {
    if (store) return store;
    try { if (typeof localStorage !== "undefined") return localStorage; } catch (e) {}
    return { getItem: function () { return null; }, setItem: function () {} };
  }
  function etOf(et) {
    if (et) return et;
    if (root && root.ZabbadatEtDay) return root.ZabbadatEtDay;
    try { if (typeof require === "function") return require("./et-day.js"); } catch (e) {}
    return null;
  }
  function getCycles(store) {
    var n = parseInt(storeOf(store).getItem(KEY), 10);
    return n > 0 ? n : 0;
  }
  function setCycles(store, n) {
    n = Math.max(0, Math.floor(Number(n) || 0));
    storeOf(store).setItem(KEY, String(n));
    return n;
  }
  function addCycle(store, k) {
    k = k == null ? 1 : Math.floor(Number(k) || 0);
    if (k < 1) return getCycles(store);
    return setCycles(store, getCycles(store) + k);
  }

  function emptyStreak() { return { lastDay: "", streak: 0, todayCount: 0 }; }
  function readStreak(store) {
    try {
      var raw = storeOf(store).getItem(STREAK_KEY);
      if (!raw) return emptyStreak();
      var o = JSON.parse(raw);
      return {
        lastDay: typeof o.lastDay === "string" ? o.lastDay : "",
        streak: Math.max(0, Math.floor(Number(o.streak) || 0)),
        todayCount: Math.max(0, Math.floor(Number(o.todayCount) || 0))
      };
    } catch (e) { return emptyStreak(); }
  }
  function writeStreak(store, rec) {
    storeOf(store).setItem(STREAK_KEY, JSON.stringify({
      lastDay: rec.lastDay || "",
      streak: Math.max(0, Math.floor(Number(rec.streak) || 0)),
      todayCount: Math.max(0, Math.floor(Number(rec.todayCount) || 0))
    }));
    return rec;
  }
  function prevDayKey(et, t) {
    if (!et || typeof et.startMs !== "function" || typeof et.key !== "function") return "";
    return et.key(et.startMs(t) - 12 * 3600 * 1000);
  }
  function streakStatus(store, et, t) {
    et = etOf(et);
    var rec = readStreak(store);
    var today = et && typeof et.key === "function" ? et.key(t) : "";
    var yesterday = prevDayKey(et, t);
    var live = !!(rec.lastDay && (rec.lastDay === today || rec.lastDay === yesterday));
    return {
      lastDay: rec.lastDay,
      streak: live ? rec.streak : 0,
      todayCount: rec.lastDay === today ? rec.todayCount : 0,
      live: live,
      todayKey: today
    };
  }
  function recordStreak(store, et, t, k) {
    k = k == null ? 1 : Math.floor(Number(k) || 0);
    et = etOf(et);
    if (k < 1) return streakStatus(store, et, t);
    var today = et && typeof et.key === "function" ? et.key(t) : "";
    if (!today) return streakStatus(store, et, t);
    var rec = readStreak(store);
    var yesterday = prevDayKey(et, t);
    if (rec.lastDay === today) {
      rec.todayCount += k;
    } else if (rec.lastDay === yesterday && rec.streak > 0) {
      rec.lastDay = today;
      rec.streak = rec.streak + 1;
      rec.todayCount = k;
    } else {
      rec.lastDay = today;
      rec.streak = 1;
      rec.todayCount = k;
    }
    writeStreak(store, rec);
    return streakStatus(store, et, t);
  }
  function shouldNudge(store, et, t) {
    et = etOf(et);
    if (!et || typeof et.parts !== "function") return false;
    var p = et.parts(t);
    if (!(p.h >= 18)) return false;
    var st = streakStatus(store, et, t);
    return st.streak > 0 && st.todayCount === 0;
  }
  function nudgeText(st) {
    var n = st && st.streak ? st.streak : 0;
    if (!n) return "";
    return "Keep your streak. " + n + " day" + (n === 1 ? "" : "s") + ". One cycle today keeps it.";
  }

  function levelFor(n) {
    n = Math.floor(Number(n) || 0);
    var found = null;
    for (var i = 0; i < LEVELS.length; i++) if (n >= LEVELS[i].at) found = LEVELS[i];
    return found;
  }
  function levelsReached(prev, next) {
    prev = Math.floor(Number(prev) || 0);
    next = Math.floor(Number(next) || 0);
    var out = [];
    for (var i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].at > prev && LEVELS[i].at <= next) out.push(LEVELS[i]);
    }
    return out;
  }
  function comboFor(sessionCycles) {
    var n = Math.floor(Number(sessionCycles) || 0);
    if (n === 4) return { at: 4, name: "Bariboshi minute" };
    if (n === 18) return { at: 18, name: "Full set" };
    return null;
  }

  function clampMinutes(m) {
    m = Math.floor(Number(m));
    if (!isFinite(m)) m = DEFAULT_MIN;
    if (m < MIN_MIN) return MIN_MIN;
    if (m > MAX_MIN) return MAX_MIN;
    return m;
  }
  // 5 min = 18 rounds is the product rule (18 × 16 s ≈ 4.8 min). Other lengths scale from that.
  function roundsForMinutes(m) {
    return Math.round(clampMinutes(m) * 18 / 5);
  }
  function getSessionMinutes(store) {
    var n = parseInt(storeOf(store).getItem(SESSION_MIN_KEY), 10);
    return n >= MIN_MIN && n <= MAX_MIN ? n : DEFAULT_MIN;
  }
  function setSessionMinutes(store, m) {
    m = clampMinutes(m);
    storeOf(store).setItem(SESSION_MIN_KEY, String(m));
    return m;
  }
  function sessionLabel(m) {
    m = clampMinutes(m);
    return m + " min · " + roundsForMinutes(m) + " rounds";
  }

  function isMuted(store) {
    return storeOf(store).getItem(MUTE_KEY) === "1";
  }
  function setMuted(store, on) {
    storeOf(store).setItem(MUTE_KEY, on ? "1" : "0");
    return !!on;
  }

  function sharePayload(st, level) {
    var parts = [];
    var n = st && st.streak ? st.streak : 0;
    if (n) parts.push(n + "-day streak");
    if (level && level.name) parts.push(level.name);
    return {
      title: "Zabbadat cooling box",
      text: parts.length ? parts.join(" · ") : "Cooling box",
      url: SHARE_URL
    };
  }
  function shareFromTap(nav, st, level) {
    var payload = sharePayload(st, level);
    if (nav && typeof nav.share === "function") {
      try { nav.share(payload).catch(function () {}); } catch (e) {}
      return "share";
    }
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      try { nav.clipboard.writeText(payload.text + " " + payload.url); } catch (e2) {}
      return "copy";
    }
    return "none";
  }

  function ringScale(cycleMs) {
    var t = ((Number(cycleMs) || 0) % CYCLE_MS + CYCLE_MS) % CYCLE_MS;
    if (t < SIDE_MS) return 0.55 + 0.45 * (t / SIDE_MS);
    if (t < SIDE_MS * 2) return 1;
    if (t < SIDE_MS * 3) return 1 - 0.45 * ((t - SIDE_MS * 2) / SIDE_MS);
    return 0.55;
  }
  function reducedMotion(win) {
    win = win || root;
    try { return !!(win && win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }

  function buzz(nav, cap) {
    cap = cap || (root && root.Capacitor);
    try {
      var H = cap && cap.Plugins && cap.Plugins.Haptics;
      if (H && typeof H.impact === "function") H.impact({ style: "Light" });
    } catch (e) {}
    nav = nav || (typeof navigator !== "undefined" ? navigator : null);
    try { if (nav && typeof nav.vibrate === "function") nav.vibrate(10); } catch (e2) {}
  }

  function unlockAudio() {
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }
  function playTone(freq, dur, gain) {
    var ctx = unlockAudio();
    if (!ctx || typeof ctx.createOscillator !== "function") return;
    try {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.value = gain == null ? 0.045 : gain;
      osc.connect(g);
      g.connect(ctx.destination);
      var now = ctx.currentTime;
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + (dur || 0.09));
      osc.start(now);
      osc.stop(now + (dur || 0.09));
    } catch (e) {}
  }
  function phaseTone(sideIndex, store) {
    if (isMuted(store)) return;
    var f = PHASE_FREQ[sideIndex] || 262;
    playTone(f, 0.09, 0.045);
  }
  function popTone(store) {
    if (isMuted(store)) return;
    playTone(523, 0.12, 0.06);
  }

  // now() should be monotonic ms. onTick({ side, sideIndex, count, cycleMs, running, ringScale, ... }).
  // onCycle(total, meta) fires once per completed 16 s cycle. Returns a controller { start, stop, running, state }.
  function createBox(opts) {
    opts = opts || {};
    var store = storeOf(opts.store);
    var nowFn = opts.now || function () { return Date.now(); };
    var onTick = opts.onTick || function () {};
    var onCycle = opts.onCycle || function () {};
    var et = etOf(opts.et);
    var timer = null, startedAt = 0, running = false, cycleBase = 0;
    var sessionCount = 0, sessionTarget = 0, lastSide = -1;

    function snapshot(t, extra) {
      var elapsed = running ? Math.max(0, t - cycleBase) : 0;
      var inCycle = elapsed % CYCLE_MS;
      var sideIndex = running ? Math.min(3, Math.floor(inCycle / SIDE_MS)) : 0;
      var count = running ? Math.min(4, Math.floor((inCycle % SIDE_MS) / 1000) + 1) : 0;
      var st = streakStatus(store, et, t);
      var out = {
        side: SIDES[sideIndex],
        sideIndex: sideIndex,
        count: count,
        cycleMs: running ? inCycle : 0,
        running: running,
        total: getCycles(store),
        ringScale: running ? ringScale(inCycle) : 0.55,
        sessionCount: sessionCount,
        sessionTarget: sessionTarget,
        streak: st.streak,
        todayCount: st.todayCount,
        live: st.live
      };
      if (extra) {
        for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      }
      return out;
    }
    function emit(t, extra) {
      var state = snapshot(t, extra);
      if (running && state.sideIndex !== lastSide) {
        lastSide = state.sideIndex;
        if (typeof opts.onPhase === "function") opts.onPhase(state);
        else phaseTone(state.sideIndex, store);
      }
      onTick(state);
    }
    function endSession(t, reason) {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
      lastSide = -1;
      var summary = {
        rounds: sessionCount,
        minutes: getSessionMinutes(store),
        target: sessionTarget,
        reason: reason || "end",
        streak: streakStatus(store, et, t),
        total: getCycles(store),
        level: levelFor(getCycles(store))
      };
      emit(t, { summary: summary });
      if (typeof opts.onSessionEnd === "function") opts.onSessionEnd(summary);
    }
    function step() {
      if (!running) return;
      var t = nowFn();
      var elapsed = t - cycleBase;
      var done = Math.floor(elapsed / CYCLE_MS);
      if (done > 0) {
        cycleBase += done * CYCLE_MS;
        var before = getCycles(store);
        var total = addCycle(store, done);
        sessionCount += done;
        var st = recordStreak(store, et, t, done);
        var reached = levelsReached(before, total);
        var combo = comboFor(sessionCount);
        var meta = { sessionCount: sessionCount, levels: reached, combo: combo, streak: st, total: total };
        onCycle(total, meta);
        if (typeof opts.onCombo === "function" && combo) opts.onCombo(combo, sessionCount);
        if (typeof opts.onLevel === "function" && reached.length) opts.onLevel(reached, total);
        if (sessionTarget > 0 && sessionCount >= sessionTarget) {
          lastSide = -1;
          endSession(t, "complete");
          return;
        }
        lastSide = -1;
      }
      emit(t);
    }
    function start() {
      if (running) return;
      running = true;
      sessionCount = 0;
      sessionTarget = opts.sessionRounds != null
        ? Math.max(0, Math.floor(Number(opts.sessionRounds) || 0))
        : roundsForMinutes(getSessionMinutes(store));
      startedAt = nowFn();
      cycleBase = startedAt;
      lastSide = -1;
      emit(startedAt);
      if (typeof setInterval === "function") timer = setInterval(step, 200);
    }
    function stop() {
      if (!running) return;
      step();
      if (!running) return;
      endSession(nowFn(), "stop");
    }
    return {
      start: start,
      stop: stop,
      running: function () { return running; },
      tick: step,
      getCycles: function () { return getCycles(store); },
      sessionCount: function () { return sessionCount; },
      sessionTarget: function () { return sessionTarget; }
    };
  }

  function el(doc, id) { return doc && doc.getElementById ? doc.getElementById(id) : null; }

  function flyPlus(doc, fromEl, toEl, calm) {
    if (!doc || !doc.body || !fromEl) return;
    var plus = doc.createElement("span");
    plus.className = "cooling-plus" + (calm ? " is-calm" : "");
    plus.textContent = "+1";
    plus.setAttribute("aria-hidden", "true");
    var a = fromEl.getBoundingClientRect();
    plus.style.left = (a.left + a.width / 2) + "px";
    plus.style.top = (a.top + a.height / 2) + "px";
    doc.body.appendChild(plus);
    if (calm || !toEl) {
      plus.classList.add("is-fade");
      setTimeout(function () { if (plus.parentNode) plus.parentNode.removeChild(plus); }, 700);
      return;
    }
    var b = toEl.getBoundingClientRect();
    var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    plus.style.setProperty("--fly-x", dx + "px");
    plus.style.setProperty("--fly-y", dy + "px");
    plus.classList.add("is-fly");
    setTimeout(function () { if (plus.parentNode) plus.parentNode.removeChild(plus); }, 800);
  }
  function sparkle(doc, fromEl, calm) {
    if (calm || !doc || !doc.body || !fromEl) return;
    var wrap = fromEl;
    var pop = doc.createElement("span");
    pop.className = "cooling-sparkle";
    pop.setAttribute("aria-hidden", "true");
    wrap.appendChild(pop);
    setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 700);
  }

  function bindStartBtn(btn, onTap, nav, cap) {
    if (!btn || typeof onTap !== "function") return null;
    try { btn.style.cursor = "pointer"; } catch (e) {}
    btn.onclick = null;
    var last = 0, downOn = false, didBuzz = false;
    function tap(e) {
      var now = Date.now();
      if (now - last < 400) {
        if (e && e.cancelable && e.preventDefault) e.preventDefault();
        return;
      }
      last = now;
      if (!didBuzz) buzz(nav, cap);
      didBuzz = false;
      onTap(e);
    }
    function onDown(e) {
      if (e && e.isPrimary === false) return;
      if (e && e.type === "pointerdown" && e.pointerType === "mouse" && e.button !== 0) return;
      downOn = true;
      didBuzz = true;
      buzz(nav, cap);
      if (e && e.cancelable && e.pointerType !== "mouse" && e.preventDefault) e.preventDefault();
    }
    function onUp(e) {
      if (e && e.isPrimary === false) return;
      if (e && e.type.indexOf("pointer") === 0 && e.pointerType === "mouse" && e.button !== 0) return;
      if (e && e.type === "touchend" && e.cancelable && e.preventDefault) e.preventDefault();
      if (!downOn && e && e.type !== "touchend") return;
      downOn = false;
      tap(e);
    }
    btn.addEventListener("pointerdown", onDown);
    btn.addEventListener("pointerup", onUp);
    btn.addEventListener("touchend", onUp, { passive: false });
    btn.addEventListener("keydown", function (e) {
      if (!e) return;
      var k = e.key || e.code;
      if (k === "Enter" || k === " " || k === "Spacebar" || k === "Space") {
        if (e.preventDefault) e.preventDefault();
        tap(e);
      }
    });
    return { tap: tap };
  }

  function mount(doc, store) {
    if (!doc || !doc.getElementById) return null;
    var btn = el(doc, "coolingStartBtn");
    var status = el(doc, "coolingStatus");
    var countEl = el(doc, "coolingCycles");
    var ring = el(doc, "coolingRing");
    var ringScaleEl = el(doc, "coolingRingScale");
    var goalFill = el(doc, "coolingGoalFill");
    var goalText = el(doc, "coolingGoalText");
    var streakEl = el(doc, "coolingStreakDays");
    var streakWrap = el(doc, "coolingStreak");
    var miniStreak = el(doc, "miniDashStreak");
    var miniBreath = el(doc, "miniDashBreath");
    var levelBadge = el(doc, "coolingLevelBadge");
    var celeb = el(doc, "coolingCeleb");
    var nudgeEl = el(doc, "coolingNudge");
    var summaryEl = el(doc, "coolingSummary");
    var muteBtn = el(doc, "coolingMuteBtn");
    var shareBtn = el(doc, "coolingShareBtn");
    var gauge = el(doc, "coolingSessionMin");
    var gaugeLabel = el(doc, "coolingSessionLabel");
    if (!btn) return null;
    try { btn.style.cursor = "pointer"; } catch (e0) {}
    var box = null;
    var celebTimer = null;
    var lastPhase = -1;

    function showCeleb(text) {
      if (!celeb || !text) return;
      celeb.textContent = text;
      celeb.hidden = false;
      if (celebTimer) clearTimeout(celebTimer);
      celebTimer = setTimeout(function () { celeb.hidden = true; }, 2200);
    }
    function paintStreak(st) {
      var n = st && st.streak ? st.streak : 0;
      if (streakEl) streakEl.textContent = String(n);
      if (streakWrap) {
        streakWrap.hidden = n < 1;
        streakWrap.setAttribute("data-streak", String(n));
      }
      if (miniStreak) {
        if (n < 1) {
          miniStreak.hidden = true;
          miniStreak.textContent = "";
        } else {
          miniStreak.hidden = false;
          miniStreak.textContent = String(n);
        }
      }
    }
    function paintGoal(todayCount) {
      var n = Math.max(0, Math.floor(Number(todayCount) || 0));
      var frac = Math.max(0, Math.min(1, n / 4));
      if (goalFill) {
        var circ = 2 * Math.PI * 16;
        goalFill.style.strokeDasharray = String(circ);
        goalFill.style.strokeDashoffset = String(circ * (1 - frac));
      }
      if (goalText) goalText.textContent = n + " / 4";
    }
    function paintRing(state) {
      if (!ringScaleEl) return;
      var s = state && state.running ? (state.ringScale != null ? state.ringScale : 0.55) : 0.55;
      var calm = reducedMotion(doc.defaultView || root);
      ringScaleEl.style.transition = calm ? "transform .2s linear, opacity .2s linear" : "transform .2s linear";
      ringScaleEl.style.transform = "scale(" + s + ")";
      if (ring) ring.setAttribute("data-side", state && state.running ? String(state.sideIndex) : "");
    }
    function paintGauge() {
      var m = getSessionMinutes(store);
      if (gauge && gauge.value !== String(m)) gauge.value = String(m);
      if (gaugeLabel) gaugeLabel.textContent = sessionLabel(m);
    }
    function paintMute() {
      if (!muteBtn) return;
      var off = isMuted(store);
      muteBtn.setAttribute("aria-pressed", off ? "true" : "false");
      muteBtn.textContent = off ? "Sound off" : "Sound on";
    }
    function paintLevel(total) {
      var lv = levelFor(total);
      if (!levelBadge) return;
      if (!lv) { levelBadge.hidden = true; levelBadge.textContent = ""; return; }
      levelBadge.hidden = false;
      levelBadge.textContent = lv.name;
    }
    function paintNudge() {
      if (!nudgeEl) return;
      var et = etOf();
      if (shouldNudge(store, et)) {
        nudgeEl.hidden = false;
        nudgeEl.textContent = nudgeText(streakStatus(store, et));
      } else {
        nudgeEl.hidden = true;
        nudgeEl.textContent = "";
      }
    }
    function paint(state) {
      var n = state && state.total != null ? state.total : getCycles(store);
      var st = (state && state.streak != null)
        ? { streak: state.streak, todayCount: state.todayCount, live: state.live }
        : streakStatus(store, etOf());
      if (countEl) countEl.textContent = String(n);
      if (miniBreath) {
        try { miniBreath.textContent = Number(n || 0).toLocaleString(); } catch (e1) { miniBreath.textContent = String(n); }
      }
      paintStreak(st);
      paintGoal(st.todayCount);
      paintRing(state || { running: false, ringScale: 0.55 });
      paintLevel(n);
      if (status) {
        if (state && state.running) status.textContent = state.side + " " + state.count;
        else if (state && state.summary && state.summary.reason === "complete") {
          status.textContent = state.summary.rounds + " rounds done. " + (st.streak ? st.streak + "-day streak." : "Start again when you're ready.");
        } else {
          status.textContent = n ? (n + " breath cycle" + (n === 1 ? "" : "s") + " on this phone.") : "Start a 16-second 4-count cycle.";
        }
      }
      if (summaryEl) {
        if (state && state.summary && state.summary.reason === "complete") {
          var bits = [state.summary.rounds + " rounds"];
          if (state.summary.level && state.summary.level.name) bits.push(state.summary.level.name);
          if (st.streak) bits.push(st.streak + "-day streak");
          summaryEl.hidden = false;
          summaryEl.textContent = bits.join(" · ") + ".";
        } else if (!(state && state.running)) {
          /* keep last summary until the next start */
        } else {
          summaryEl.hidden = true;
        }
      }
      btn.textContent = state && state.running ? "Stop cooling box" : "Start cooling box";
      if (typeof doc.dispatchEvent === "function") {
        try { doc.dispatchEvent(new (root.Event || Event)("zabbadat-breath-cycles")); } catch (e) {}
      }
    }
    function ensure() {
      if (box) return box;
      box = createBox({
        store: store,
        onTick: function (state) {
          if (state.running && state.sideIndex !== lastPhase) {
            lastPhase = state.sideIndex;
          }
          paint(state);
        },
        onPhase: function (state) { phaseTone(state.sideIndex, store); },
        onCycle: function (total, meta) {
          meta = meta || {};
          var calm = reducedMotion(doc.defaultView || root);
          popTone(store);
          sparkle(doc, ring || btn, calm);
          flyPlus(doc, ring || btn, countEl, calm);
          if (meta.combo) showCeleb(meta.combo.name);
          if (meta.levels && meta.levels.length) {
            showCeleb(meta.levels[meta.levels.length - 1].name);
          }
          paint({
            running: true,
            total: total,
            side: "Inhale",
            sideIndex: 0,
            count: 1,
            ringScale: ringScale(0),
            streak: meta.streak && meta.streak.streak,
            todayCount: meta.streak && meta.streak.todayCount,
            live: meta.streak && meta.streak.live
          });
        },
        onSessionEnd: function (summary) {
          lastPhase = -1;
          paint({ running: false, total: summary.total, summary: summary, streak: summary.streak && summary.streak.streak, todayCount: summary.streak && summary.streak.todayCount, live: summary.streak && summary.streak.live });
        }
      });
      return box;
    }
    function toggle() {
      unlockAudio();
      var b = ensure();
      if (summaryEl && !b.running()) { summaryEl.hidden = true; summaryEl.textContent = ""; }
      if (b.running()) b.stop();
      else {
        lastPhase = -1;
        paintNudge();
        b.start();
      }
    }

    paint({ running: false, total: getCycles(store) });
    paintGauge();
    paintMute();
    paintNudge();

    bindStartBtn(btn, toggle, typeof navigator !== "undefined" ? navigator : null, root && root.Capacitor);

    if (muteBtn) {
      bindStartBtn(muteBtn, function () {
        setMuted(store, !isMuted(store));
        paintMute();
      }, typeof navigator !== "undefined" ? navigator : null, root && root.Capacitor);
    }
    if (shareBtn) {
      bindStartBtn(shareBtn, function () {
        var st = streakStatus(store, etOf());
        var via = shareFromTap(typeof navigator !== "undefined" ? navigator : null, st, levelFor(getCycles(store)));
        if (via === "copy" && status && !(box && box.running())) status.textContent = "Copied.";
      }, typeof navigator !== "undefined" ? navigator : null, root && root.Capacitor);
    }
    if (gauge) {
      gauge.setAttribute("min", String(MIN_MIN));
      gauge.setAttribute("max", String(MAX_MIN));
      gauge.setAttribute("step", "1");
      gauge.addEventListener("input", function () {
        setSessionMinutes(store, gauge.value);
        paintGauge();
      });
      gauge.addEventListener("change", function () {
        setSessionMinutes(store, gauge.value);
        paintGauge();
      });
    }
    return { box: function () { return box; }, paint: paint, toggle: toggle };
  }

  var api = {
    KEY: KEY,
    STREAK_KEY: STREAK_KEY,
    MUTE_KEY: MUTE_KEY,
    SESSION_MIN_KEY: SESSION_MIN_KEY,
    SHARE_URL: SHARE_URL,
    CYCLE_MS: CYCLE_MS,
    SIDE_MS: SIDE_MS,
    SIDES: SIDES,
    LEVELS: LEVELS,
    getCycles: getCycles,
    setCycles: setCycles,
    addCycle: addCycle,
    createBox: createBox,
    mount: mount,
    readStreak: readStreak,
    writeStreak: writeStreak,
    streakStatus: streakStatus,
    recordStreak: recordStreak,
    shouldNudge: shouldNudge,
    nudgeText: nudgeText,
    levelFor: levelFor,
    levelsReached: levelsReached,
    comboFor: comboFor,
    clampMinutes: clampMinutes,
    roundsForMinutes: roundsForMinutes,
    getSessionMinutes: getSessionMinutes,
    setSessionMinutes: setSessionMinutes,
    sessionLabel: sessionLabel,
    isMuted: isMuted,
    setMuted: setMuted,
    sharePayload: sharePayload,
    shareFromTap: shareFromTap,
    ringScale: ringScale,
    buzz: buzz,
    bindStartBtn: bindStartBtn,
    reducedMotion: reducedMotion
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatCoolingBox = api;
})(typeof window !== "undefined" ? window : this);
