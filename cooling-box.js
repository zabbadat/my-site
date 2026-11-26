/* Cooling box: a 16-second 4-count cycle (inhale 4, hold 4, exhale 4, hold empty 4).
 * Each completed cycle adds one to the all-time localStorage counter zabbadat-breath-cycles.
 * Streak and session length are also device-local. No network and no Firestore writes.
 * A leftover zabbadat-breath-mute key is ignored and removed on load; there is no mute button.
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
  var RECORD_KEY = "zabbadat-breath-record";
  var MODE_KEY = "zabbadat-breath-mode";
  var PROOF_CAPTION = "Proof of Sitkari";
  var CLOSE_HINT = "Sit up close so your mouth and chin show.";
  var INTRO_LINE = "Sitkari time. Sit up close so your mouth shows, then breathe in through your teeth and out through your nose.";
  var INTRO_SOLO = "Sitkari time. Breathe in through your teeth and out through your nose.";
  var ALIGN_LINE = "Sit tall. Shoulders down and soft. Relax your jaw.";
  var ALIGN_COUNTS = ["One.", "Two.", "Three.", "Breathe."];
  var ALIGN_COUNT_MS = 1000;
  var ALIGN_RING_SIZE = 96;
  var CYCLE_MS = 16000;
  var SIDE_MS = 4000;
  var SIDES = ["Inhale", "Hold full", "Exhale", "Hold empty"];
  // Hold phases (after inhale, after exhale) show the 1-4 count in the shared arcade-num style.
  function isHoldSide(sideIndex) { return sideIndex === 1 || sideIndex === 3; }
  function statusView(state) {
    if (!state || !state.running) return { running: false, hold: false, status: "", count: "", label: "Hold" };
    var hold = isHoldSide(state.sideIndex);
    return {
      running: true,
      hold: hold,
      side: state.side,
      sideIndex: state.sideIndex,
      count: String(state.count),
      label: "Hold",
      status: hold ? state.side : (state.side + " " + state.count)
    };
  }
  function isRecordOn(store) { return storeOf(store).getItem(RECORD_KEY) === "1"; }
  function setRecordOn(store, on) { storeOf(store).setItem(RECORD_KEY, on ? "1" : "0"); return !!on; }
  function getMode(store) {
    return storeOf(store).getItem(MODE_KEY) === "camera" ? "camera" : "solo";
  }
  function setMode(store, mode) {
    mode = mode === "camera" ? "camera" : "solo";
    storeOf(store).setItem(MODE_KEY, mode);
    return mode;
  }
  function alignmentScript(mode) {
    return [(mode === "camera" ? INTRO_LINE : INTRO_SOLO), ALIGN_LINE].concat(ALIGN_COUNTS);
  }
  function boxesOverlap(a, b) {
    if (!a || !b) return 0;
    var x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    var y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return x * y;
  }
  // Mouth and chin sit just below the sitkari logo (the logo covers the nose and everything above).
  function mouthChinBox(head) {
    if (!head || !(head.r > 0)) return null;
    var w = Math.max(24, head.r * 1.05), h = Math.max(28, head.r * 1.15);
    return { x: head.x - w / 2, y: head.y + head.r + 2, w: w, h: h };
  }
  function logoBox(head) {
    if (!head || !(head.r > 0)) return null;
    return { x: head.x - head.r, y: head.y - head.r, w: head.r * 2, h: head.r * 2 };
  }
  // Place the alignment ring below the tracked logo, offset to the side of the mouth, clamped in view.
  // Never covers the mouth or chin; stays off the logo, optional caption, and branding boxes. Lower side corner if needed.
  function alignRingPos(head, vw, vh, ringSize, opts) {
    opts = opts || {};
    var size = ringSize || ALIGN_RING_SIZE, R = size / 2, margin = opts.margin != null ? opts.margin : 8;
    var mouth = mouthChinBox(head), logo = logoBox(head);
    var avoid = [];
    if (logo) avoid.push(logo);
    if (mouth) avoid.push(mouth);
    if (opts.caption) avoid.push(opts.caption);
    if (opts.brand && opts.brand.length) avoid = avoid.concat(opts.brand);
    function ok(c) {
      if (c.x - R < margin || c.y - R < margin || c.x + R > vw - margin || c.y + R > vh - margin) return false;
      var box = { x: c.x - R, y: c.y - R, w: 2 * R, h: 2 * R };
      for (var i = 0; i < avoid.length; i++) if (boxesOverlap(box, avoid[i]) > 0) return false;
      return true;
    }
    function clamp(c) {
      return {
        x: Math.max(R + margin, Math.min(vw - R - margin, c.x)),
        y: Math.max(R + margin, Math.min(vh - R - margin, c.y)),
        r: R, size: size
      };
    }
    var cands = [];
    if (head) {
      var below = head.y + head.r + R + 10;
      var side = head.x < vw / 2 ? 1 : -1;
      cands.push({ x: head.x + side * (head.r * 0.9 + R), y: below });
      cands.push({ x: head.x - side * (head.r * 0.9 + R), y: below });
    }
    cands.push({ x: vw - R - margin - 4, y: vh - R - margin - 4 });
    cands.push({ x: R + margin + 4, y: vh - R - margin - 4 });
    for (var i = 0; i < cands.length; i++) {
      var c = clamp(cands[i]);
      if (ok(c)) return c;
    }
    return clamp(cands[cands.length - 1]);
  }
  function createAlign(opts) {
    opts = opts || {};
    var speak = opts.speak || function () { return Promise.resolve(); };
    var wait = opts.wait || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var now = opts.now || function () { return Date.now(); };
    var onCount = opts.onCount || function () {};
    var onBreathe = opts.onBreathe || function () {};
    var seq = 0;
    function dead(my) { return my !== seq; }
    function cancel() { seq += 1; if (typeof opts.stopSpeech === "function") opts.stopSpeech(); }
    function running() { return seq > 0; }
    function run() {
      var my = ++seq;
      var intro = opts.intro || INTRO_LINE;
      var onStage = typeof opts.onStage === "function" ? opts.onStage : function () {};
      function stepSpeak(line) {
        return Promise.resolve().then(function () { return speak(line); }).then(function () { return !dead(my); });
      }
      onStage("intro", intro);
      return stepSpeak(intro).then(function (ok) {
        if (!ok) return false;
        onStage("align", ALIGN_LINE);
        return stepSpeak(ALIGN_LINE);
      }).then(function (ok) {
        if (!ok) return false;
        function countAt(i) {
          if (i >= 3) {
            onCount(0);
            onBreathe();
            speak(ALIGN_COUNTS[3]);
            return !dead(my);
          }
          onCount(i + 1, ALIGN_COUNTS[i]);
          var t0 = now();
          return stepSpeak(ALIGN_COUNTS[i]).then(function (ok2) {
            if (!ok2) return false;
            var left = ALIGN_COUNT_MS - (now() - t0);
            return (left > 0 ? wait(left) : Promise.resolve()).then(function () {
              if (dead(my)) return false;
              return countAt(i + 1);
            });
          });
        }
        return countAt(0);
      });
    }
    return { run: run, cancel: cancel, running: function () { return seq > 0; } };
  }
  function summaryLine(summary, camRan) {
    var bits = [];
    if (camRan) bits.push(PROOF_CAPTION);
    bits.push(((summary && summary.rounds) || 0) + " rounds");
    if (summary && summary.level && summary.level.name) bits.push(levelLabel(summary.level));
    var days = summary && summary.streak && summary.streak.streak;
    if (days) bits.push(days + "-day streak");
    var zab = summary && summary.zab;
    if (zab > 0) bits.push("+" + zab + " ZAB");
    return bits.join(" · ") + ".";
  }

  var LEVELS = [
    { at: 4, name: "Sitkari" },
    { at: 18, name: "Coolbox" },
    { at: 50, name: "Steady" },
    { at: 100, name: "Settled" },
    { at: 250, name: "Deep box" },
    { at: 500, name: "Zabbadat" }
  ];
  var DEFAULT_MIN = 2;
  var MIN_MIN = 1;
  var MAX_MIN = 10;
  var TWO_MIN_MS = 120000;
  var TWO_MIN_LINE = "Two minutes. One ZAB earned.";
  var STOP_LABEL = "Stop Breath Equity";
  // Visible label in this block: the 18-round level stays "Coolbox" in logic, shown as "Breath Equity".
  function levelLabel(level) {
    var name = typeof level === "string" ? level : (level && level.name) || "";
    return name === "Coolbox" ? "Breath Equity" : name;
  }
  function formatClock(ms) {
    var sec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    var m = Math.floor(sec / 60), r = sec % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  // Completing a full session: under 2 min = 0, 2–4 min = 1 ZAB, 5+ min = 3 ZAB. Awarded only on reason "complete".
  function breathZabFor(minutes) {
    var m = Math.floor(Number(minutes) || 0);
    if (m >= 5) return 3;
    if (m >= 2) return 1;
    return 0;
  }
  function zabEndCopy(zab) {
    zab = Math.floor(Number(zab) || 0);
    if (zab === 1) return "Plus 1 ZAB.";
    if (zab > 0) return "Plus " + zab + " ZAB.";
    return "";
  }
  function completeSpeakLine(zab) {
    zab = Math.floor(Number(zab) || 0);
    if (zab === 1) return "Session complete. One ZAB earned.";
    if (zab === 3) return "Session complete. Three ZAB earned.";
    if (zab > 0) return "Session complete. " + zab + " ZAB earned.";
    return "Session complete.";
  }
  // Mid-session 2:00 cue: once, only if the session continues past 2 minutes. A 2-minute session uses completeSpeakLine at the end.
  function twoMinCue(opts) {
    opts = opts || {};
    if (opts.said) return { speak: null, said: true };
    if (!(opts.elapsedMs >= TWO_MIN_MS)) return { speak: null, said: false };
    if (opts.running && (opts.minutes || 0) > 2) return { speak: TWO_MIN_LINE, said: true };
    return { speak: null, said: true };
  }
  var SHARE_URL = "https://zabbadat.com/#cooling-box";
  var PHASE_FREQ = [392, 330, 262, 196];
  var audioCtx = null;

  function storeOf(store) {
    if (store) return store;
    try { if (typeof localStorage !== "undefined") return localStorage; } catch (e) {}
    return { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
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

  // Sound/mute button removed. Tones always play. Drop a leftover mute key so an earlier mute cannot stick.
  function clearMutePref(store) {
    try {
      var st = storeOf(store);
      if (st && typeof st.removeItem === "function") st.removeItem(MUTE_KEY);
    } catch (e) {}
  }
  function isMuted() { return false; }

  function sharePayload(st, level) {
    var parts = [];
    var n = st && st.streak ? st.streak : 0;
    if (n) parts.push(n + "-day streak");
    if (level && level.name) parts.push(levelLabel(level));
    return {
      title: "Zabbadat Breath Equity",
      text: parts.length ? parts.join(" · ") : "Breath Equity",
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
  function phaseTone(sideIndex) {
    var f = PHASE_FREQ[sideIndex] || 262;
    playTone(f, 0.09, 0.045);
  }
  function popTone() {
    playTone(523, 0.12, 0.06);
  }

  // now() should be monotonic ms. onTick({ side, sideIndex, count, cycleMs, running, ringScale, ... }).
  // onCycle(total, meta) fires once per completed 16 s cycle. Returns a controller { start, stop, running, state }.
  function createBox(opts) {
    opts = opts || {};
    var store = storeOf(opts.store);
    clearMutePref(store);
    var nowFn = opts.now || function () { return Date.now(); };
    var onTick = opts.onTick || function () {};
    var onCycle = opts.onCycle || function () {};
    var et = etOf(opts.et);
    var timer = null, startedAt = 0, running = false, cycleBase = 0;
    var sessionCount = 0, sessionTarget = 0, sessionMinutes = 0, lastSide = -1, frozenMs = 0;

    function sessionElapsed(t) {
      if (running) return Math.max(0, t - startedAt);
      return frozenMs;
    }
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
        sessionMinutes: sessionMinutes,
        sessionMs: sessionElapsed(t),
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
      frozenMs = Math.max(0, t - startedAt);
      var zab = (reason === "complete") ? breathZabFor(sessionMinutes) : 0;
      var summary = {
        rounds: sessionCount,
        minutes: sessionMinutes || getSessionMinutes(store),
        target: sessionTarget,
        reason: reason || "end",
        elapsedMs: frozenMs,
        zab: zab,
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
      sessionMinutes = opts.sessionMinutes != null
        ? clampMinutes(opts.sessionMinutes)
        : getSessionMinutes(store);
      sessionTarget = opts.sessionRounds != null
        ? Math.max(0, Math.floor(Number(opts.sessionRounds) || 0))
        : roundsForMinutes(sessionMinutes);
      startedAt = nowFn();
      frozenMs = 0;
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
      liveScale: function () { return running ? ringScale(Math.max(0, nowFn() - cycleBase)) : 0.55; },
      liveSide: function () { return running ? Math.min(3, Math.floor((Math.max(0, nowFn() - cycleBase) % CYCLE_MS) / SIDE_MS)) : 0; },
      getCycles: function () { return getCycles(store); },
      sessionCount: function () { return sessionCount; },
      sessionTarget: function () { return sessionTarget; },
      sessionMinutes: function () { return sessionMinutes; },
      sessionMs: function () { return sessionElapsed(nowFn()); }
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
    btn.addEventListener("pointercancel", function () { downOn = false; didBuzz = false; });
    btn.addEventListener("touchend", onUp, { passive: false });
    btn.addEventListener("click", function (e) { if (!downOn) tap(e); });
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

  var camMount = null;

  function mount(doc, store) {
    if (!doc || !doc.getElementById) return null;
    var soloBtn = el(doc, "coolingSoloBtn");
    var camBtn = el(doc, "coolingCamBtn");
    var stopBtn = el(doc, "coolingStopBtn");
    var startRow = el(doc, "coolingStartRow");
    var status = el(doc, "coolingStatus");
    var hintEl = el(doc, "coolingCloseHint");
    var alignRing = el(doc, "coolingAlignRing");
    var alignScale = el(doc, "coolingAlignScale");
    var alignCount = el(doc, "coolingAlignCount");
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
    var holdStrip = el(doc, "coolingHoldStrip");
    var holdCount = el(doc, "coolingHoldCount");
    var holdLbl = el(doc, "coolingHoldLbl");
    var celeb = el(doc, "coolingCeleb");
    var nudgeEl = el(doc, "coolingNudge");
    var summaryEl = el(doc, "coolingSummary");
    var shareBtn = el(doc, "coolingShareBtn");
    var gauge = el(doc, "coolingSessionMin");
    var gaugeLabel = el(doc, "coolingSessionLabel");
    var recBtn = el(doc, "coolingRecBtn");
    var wrap = el(doc, "coolingWrap");
    var vid = el(doc, "coolingVid");
    var proofCap = el(doc, "coolingProofCaption");
    var camCue = el(doc, "coolingCamCue");
    var camRing = el(doc, "coolingCamRing");
    var camRingScale = el(doc, "coolingCamRingScale");
    var camNum = el(doc, "coolingCamNum");
    var camLabel = el(doc, "coolingCamLabel");
    var camStopBtn = el(doc, "coolingCamStopBtn");
    var clockEl = el(doc, "coolingClock");
    var camClockEl = el(doc, "coolingCamClock");
    var hideCue = el(doc, "todaysHideBreath");
    var hideRing = el(doc, "todaysHideRing");
    var hideRingScale = el(doc, "todaysHideRingScale");
    var hideNum = el(doc, "todaysHideCamNum");
    var hideLabel = el(doc, "todaysHideCamLabel");
    var hideClock = el(doc, "todaysHideClock");
    var hideStop = el(doc, "todaysHideBreathStop");
    var hideStatus = el(doc, "todaysHideBreathStatus");
    var twoMinSaid = false;
    var camStream = null;
    var camLoopId = 0;
    var camRan = false;
    var camSeq = 0;
    var rafRingId = 0;
    var alignRafId = 0;
    var nativeFsActive = false;
    var exitingFs = false;
    function host() { return root && root.ZabCoolingHost; }
    function fsEl() { return doc.fullscreenElement || doc.webkitFullscreenElement || null; }
    function coolingFsOn() { return !!(wrap && (wrap.classList.contains("cam-fs") || fsEl() === wrap)); }
    function enterCoolingFs() {
      if (!wrap) return;
      try { if (doc.documentElement) doc.documentElement.classList.add("zab-cooling-fs"); } catch (e0) {}
      try { if (doc.body) doc.body.classList.add("zab-cooling-fs"); } catch (e1) {}
      wrap.hidden = false;
      wrap.classList.add("cam-fs");
      if (camStopBtn) camStopBtn.hidden = false;
      if (camCue) camCue.hidden = false;
      var req = wrap.requestFullscreen || wrap.webkitRequestFullscreen || wrap.webkitRequestFullScreen;
      if (req && !fsEl()) {
        try {
          Promise.resolve(req.call(wrap, { navigationUI: "hide" })).then(function () {
            if (coolingFsOn()) nativeFsActive = true;
          }).catch(function () { nativeFsActive = false; });
        } catch (e2) { nativeFsActive = false; }
      }
    }
    function exitCoolingFs() {
      if (!wrap) return;
      exitingFs = true;
      nativeFsActive = false;
      try {
        var exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if (fsEl() === wrap && exit) Promise.resolve(exit.call(doc)).catch(function () {});
      } catch (e0) {}
      wrap.classList.remove("cam-fs");
      try { if (doc.documentElement) doc.documentElement.classList.remove("zab-cooling-fs"); } catch (e1) {}
      try { if (doc.body) doc.body.classList.remove("zab-cooling-fs"); } catch (e2) {}
      if (camStopBtn) camStopBtn.hidden = true;
      if (camCue) camCue.hidden = true;
      if (camNum) camNum.textContent = "";
      if (camLabel) camLabel.textContent = "Sitkari";
      if (camRing) camRing.setAttribute("data-side", "");
      if (camRingScale) { camRingScale.style.transition = "none"; camRingScale.style.transform = "scale(0.55)"; }
      setTimeout(function () { exitingFs = false; }, 80);
    }
    function showProofCaption(on) {
      if (proofCap) {
        proofCap.textContent = PROOF_CAPTION;
        proofCap.hidden = !on;
      }
    }
    function stopCoolingCam() {
      camLoopId += 1;
      camSeq += 1;
      try { if (root.ZabRec && root.ZabRec.onFs) root.ZabRec.onFs("coolingWrap", false); } catch (e0) {}
      try { if (root.ZabPfp && root.ZabPfp.clear) root.ZabPfp.clear("coolingVid"); } catch (e1) {}
      var H = host();
      if (camStream) {
        try { if (H && H.stopCamTracks) H.stopCamTracks(camStream); } catch (e2) {}
        camStream = null;
      }
      if (vid) vid.srcObject = null;
      exitCoolingFs();
      if (wrap) wrap.hidden = true;
      showProofCaption(false);
      hideCloseHint();
      hideAlignRing();
      try { if (H && H.wake && H.wake.stop) H.wake.stop(); } catch (e3) {}
    }
    async function tickCam(id) {
      if (id !== camLoopId) return;
      var H = host();
      try {
        var det = H && H.ensurePose ? await H.ensurePose() : null;
        if (id !== camLoopId) return;
        if (det && vid && vid.videoWidth) {
          var t = (root.performance && root.performance.now) ? root.performance.now() : Date.now();
          var input = root.ZabPfp && root.ZabPfp.input ? root.ZabPfp.input(vid, det) : vid;
          var poses = await det.estimatePoses(input, { flipHorizontal: true });
          if (id !== camLoopId) return;
          var kps = poses && poses[0] ? poses[0].keypoints : [];
          if (root.ZabPfp && root.ZabPfp.sitkariFrame) root.ZabPfp.sitkariFrame(vid, kps, t);
          else if (root.ZabPfp && root.ZabPfp.frame) root.ZabPfp.frame(vid, kps, t, root.ZabPfp.sitkariHead);
          if (aligning && activeMode === "camera" && !camCue) placeAlignRingCamera();
        }
      } catch (e) {}
      if (id === camLoopId && root.requestAnimationFrame) root.requestAnimationFrame(function () { tickCam(id); });
    }
    async function startCoolingCam() {
      var H = host();
      var my = ++camSeq;
      if (!H || !H.attachCam || !vid || !wrap) return false;
      if (!root.navigator || !root.navigator.mediaDevices || !root.navigator.mediaDevices.getUserMedia) return false;
      try {
        if (H.stopOtherCams) H.stopOtherCams();
        if (H.wake && H.wake.start) H.wake.start().catch(function () {});
        enterCoolingFs();
        showProofCaption(true);
        if (camNum) camNum.textContent = "";
        if (camLabel) camLabel.textContent = "Sitkari";
        try { if (root.ZabPfp && root.ZabPfp.prepare) root.ZabPfp.prepare(vid); } catch (e0) {}
        var gum = root.navigator.mediaDevices.getUserMedia(H.CAM_CONSTRAINTS);
        if (H.ensurePose) H.ensurePose().catch(function () {});
        var stream = await gum;
        if (my !== camSeq || !sessionOn) { if (H.stopCamTracks) H.stopCamTracks(stream); return false; }
        camStream = stream;
        await H.attachCam(vid, stream);
        if (my !== camSeq) return false;
        camRan = true;
        if (H.ensurePose) await H.ensurePose().catch(function () {});
        tickCam(++camLoopId);
        if (isRecordOn(store) && root.ZabRec && root.ZabRec.ctl) {
          var st = root.ZabRec.ctl.state();
          if (!st.armed.coolingWrap && st.recording !== "coolingWrap") root.ZabRec.ctl.tap("coolingWrap");
        }
        if (isRecordOn(store) && root.ZabRec && root.ZabRec.onFs) root.ZabRec.onFs("coolingWrap", true);
        return true;
      } catch (e) {
        if (my === camSeq) {
          try { if (H && H.camErrorText) H.camErrorText(e); } catch (e1) {}
          stopCoolingCam();
        }
        return false;
      }
    }
    function syncRecordPref() {
      var on = false;
      try {
        var st = root.ZabRec && root.ZabRec.ctl && root.ZabRec.ctl.state();
        on = !!(st && (st.armed.coolingWrap || st.recording === "coolingWrap"));
      } catch (e) {}
      setRecordOn(store, on);
    }
    function restoreRecordPref() {
      if (!isRecordOn(store) || !root.ZabRec || !root.ZabRec.ctl) return;
      var st = root.ZabRec.ctl.state();
      if (!st.armed.coolingWrap && st.recording !== "coolingWrap") root.ZabRec.ctl.tap("coolingWrap");
    }
    if (!soloBtn || !camBtn) return null;
    try { soloBtn.style.cursor = "pointer"; camBtn.style.cursor = "pointer"; if (stopBtn) stopBtn.style.cursor = "pointer"; } catch (e0) {}
    var box = null;
    var celebTimer = null;
    var lastPhase = -1;
    var sessionOn = false;
    var aligning = false;
    var alignCtl = null;
    var hintTimer = null;
    var activeMode = getMode(store);

    function hideCloseHint() {
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
      if (hintEl) { hintEl.hidden = true; hintEl.classList.remove("is-fade"); }
    }
    function showCloseHint() {
      if (!hintEl) return;
      hintEl.textContent = CLOSE_HINT;
      hintEl.hidden = false;
      hintEl.classList.remove("is-fade");
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { fadeCloseHint(); }, 5000);
    }
    function fadeCloseHint() {
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
      if (!hintEl || hintEl.hidden) return;
      if (reducedMotion(doc.defaultView || root)) { hintEl.hidden = true; return; }
      hintEl.classList.add("is-fade");
      setTimeout(function () { if (hintEl) { hintEl.hidden = true; hintEl.classList.remove("is-fade"); } }, 700);
    }
    function hideAlignRing() {
      if (alignRafId && root.cancelAnimationFrame) { try { root.cancelAnimationFrame(alignRafId); } catch (e) {} alignRafId = 0; }
      if (alignRing) alignRing.hidden = true;
      if (alignCount) alignCount.textContent = "";
      if (alignScale) { alignScale.style.transition = "none"; alignScale.style.transform = "scale(0.55)"; }
    }
    function animCueRing(elScale, calm) {
      if (!elScale) return;
      elScale.style.transition = "none";
      elScale.style.transform = "scale(0.55)";
      if (calm) { elScale.style.transform = "scale(1)"; return; }
      if (alignRafId && root.cancelAnimationFrame) { try { root.cancelAnimationFrame(alignRafId); } catch (e) {} alignRafId = 0; }
      var raf = root.requestAnimationFrame;
      if (typeof raf === "function") {
        alignRafId = raf(function () {
          alignRafId = raf(function () {
            alignRafId = 0;
            elScale.style.transition = "transform 1s linear";
            elScale.style.transform = "scale(1)";
          });
        });
      } else {
        elScale.style.transition = "transform 1s linear";
        elScale.style.transform = "scale(1)";
      }
    }
    function fillAlignRing(n) {
      var calm = reducedMotion(doc.defaultView || root);
      if (activeMode === "camera" && camCue && wrap && !wrap.hidden) {
        if (alignRing) alignRing.hidden = true;
        if (camRing) camRing.setAttribute("data-side", "0");
        if (camNum) camNum.textContent = n ? String(n) : "";
        if (camLabel) camLabel.textContent = n ? ALIGN_COUNTS[n - 1].replace(/\.$/, "") : "Sitkari";
        if (n) animCueRing(camRingScale, calm);
        return;
      }
      if (!alignRing) return;
      alignRing.hidden = false;
      if (alignCount) alignCount.textContent = n ? String(n) : "";
      animCueRing(alignScale, calm);
    }
    function stageRect() {
      var stage = startRow && startRow.parentNode ? startRow.parentNode : (ring && ring.parentNode);
      return stage && stage.getBoundingClientRect ? stage.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
    }
    function placeAlignRingSolo() {
      if (!alignRing || !ring) return;
      var sr = stageRect(), rr = ring.getBoundingClientRect();
      var x = rr.left - sr.left + rr.width / 2;
      var y = rr.top - sr.top + rr.height / 2;
      alignRing.style.left = x + "px";
      alignRing.style.top = y + "px";
      alignRing.hidden = false;
    }
    function placeAlignRingCamera() {
      if (!alignRing || !vid) return;
      var sr = stageRect(), vr = vid.getBoundingClientRect();
      var vw = vid.videoWidth || 640, vh = vid.videoHeight || 480;
      if (!(vr.width > 0) || !(vw > 0)) return;
      var head = null;
      try { if (root.ZabPfp && root.ZabPfp.lastHead) head = root.ZabPfp.lastHead("coolingVid", root.performance && root.performance.now ? root.performance.now() : Date.now()); } catch (e) {}
      var cap = null;
      if (proofCap && !proofCap.hidden && proofCap.getBoundingClientRect) {
        var cr = proofCap.getBoundingClientRect();
        cap = { x: (cr.left - vr.left) * (vw / vr.width), y: (cr.top - vr.top) * (vh / vr.height), w: cr.width * (vw / vr.width), h: cr.height * (vh / vr.height) };
      }
      var pos = alignRingPos(head || { x: vw / 2, y: vh * 0.32, r: Math.min(vw, vh) * 0.16 }, vw, vh, ALIGN_RING_SIZE, { caption: cap });
      var x = vr.left - sr.left + (pos.x / vw) * vr.width;
      var y = vr.top - sr.top + (pos.y / vh) * vr.height;
      alignRing.style.left = x + "px";
      alignRing.style.top = y + "px";
      alignRing.hidden = false;
    }
    function placeAlignRing() {
      if (activeMode === "camera" && vid && wrap && !wrap.hidden) placeAlignRingCamera();
      else placeAlignRingSolo();
    }
    function unlockSpeech() {
      var H = host();
      if (H && H.unlock) { try { H.unlock(); return; } catch (e) {} }
      try {
        var GS = root.ZabbadatGetSet, w = root;
        if (w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === "function") {
          if (typeof w.speechSynthesis.resume === "function") w.speechSynthesis.resume();
          var u = new w.SpeechSynthesisUtterance(" ");
          u.volume = 0;
          u.rate = (GS && GS.VOICE && GS.VOICE.rate) || 0.88;
          w.speechSynthesis.speak(u);
        }
      } catch (e2) {}
    }
    function speakLine(text) {
      var GS = root.ZabbadatGetSet;
      try {
        if (GS && typeof GS.enqueueSpeak === "function") return GS.enqueueSpeak(text);
        if (GS && typeof GS.speakAndWait === "function") return GS.speakAndWait(text);
      } catch (e) {}
      return Promise.resolve();
    }
    function stopSpeech() {
      try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) {}
    }
    function paintMode() {
      activeMode = getMode(store);
      if (soloBtn) {
        if (activeMode === "solo") soloBtn.classList.remove("ghost");
        else soloBtn.classList.add("ghost");
      }
      if (camBtn) {
        if (activeMode === "camera") camBtn.classList.remove("ghost");
        else camBtn.classList.add("ghost");
      }
    }
    function paintStartStop(busy) {
      if (startRow) startRow.hidden = !!busy;
      if (stopBtn) {
        stopBtn.hidden = !busy;
        stopBtn.textContent = STOP_LABEL;
      }
      if (hideStop) {
        hideStop.hidden = !busy;
        hideStop.textContent = STOP_LABEL;
      }
      if (hideCue) {
        hideCue.setAttribute("aria-pressed", busy ? "true" : "false");
        hideCue.classList.toggle("is-running", !!busy);
      }
    }
    function paintClock(ms, visible) {
      var txt = formatClock(ms);
      var nodes = [clockEl, camClockEl, hideClock];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n) continue;
        n.textContent = txt;
        if (visible) n.removeAttribute("hidden");
        else n.hidden = true;
      }
    }
    function maybeSpeak(text) {
      if (!text || isMuted()) return Promise.resolve();
      return speakLine(text);
    }
    function awardBreathIfDue(summary) {
      if (!summary || summary.reason !== "complete" || !(summary.zab > 0)) return;
      var H = host();
      if (!H || typeof H.saveAndAwardBreath !== "function") return;
      try {
        H.saveAndAwardBreath({
          reason: "complete",
          minutes: summary.minutes,
          rounds: summary.rounds,
          elapsedMs: summary.elapsedMs,
          zab: summary.zab,
          mode: activeMode
        });
      } catch (eA) {}
    }
    function onAlignCount(n) {
      if (n) {
        if (status) status.textContent = ALIGN_COUNTS[n - 1].replace(/\.$/, "");
        if (!(activeMode === "camera" && camCue && wrap && !wrap.hidden)) {
          try { placeAlignRing(); } catch (eP) {}
        }
        fillAlignRing(n);
      } else {
        hideAlignRing();
      }
    }

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
    function stopRingAnim() {
      if (rafRingId && root.cancelAnimationFrame) { try { root.cancelAnimationFrame(rafRingId); } catch (e) {} }
      rafRingId = 0;
    }
    function stepRingAnim() {
      if (!box || !box.running()) { stopRingAnim(); return; }
      var s = box.liveScale ? box.liveScale() : 0.55;
      var side = box.liveSide ? String(box.liveSide()) : "";
      var tf = "scale(" + s.toFixed(4) + ")";
      if (ringScaleEl) { ringScaleEl.style.transition = "none"; ringScaleEl.style.transform = tf; }
      if (ring) ring.setAttribute("data-side", side);
      if (camCue && !camCue.hidden && camRingScale) {
        camRingScale.style.transition = "none";
        camRingScale.style.transform = tf;
        if (camRing) camRing.setAttribute("data-side", side);
      }
      if (hideRingScale) {
        hideRingScale.style.transition = "none";
        hideRingScale.style.transform = tf;
        if (hideRing) hideRing.setAttribute("data-side", side);
      }
      if (typeof root.requestAnimationFrame === "function") rafRingId = root.requestAnimationFrame(stepRingAnim);
    }
    function startRingAnim() {
      stopRingAnim();
      if (reducedMotion(doc.defaultView || root) || typeof root.requestAnimationFrame !== "function") return;
      rafRingId = root.requestAnimationFrame(stepRingAnim);
    }
    function paintRing(state) {
      var side = state && state.running ? String(state.sideIndex) : "";
      if (ring) ring.setAttribute("data-side", side);
      if (camRing && camCue && !camCue.hidden) camRing.setAttribute("data-side", side);
      if (hideRing) hideRing.setAttribute("data-side", side);
      if (rafRingId && state && state.running) return;
      var s = state && state.running ? (state.ringScale != null ? state.ringScale : 0.55) : 0.55;
      var calm = reducedMotion(doc.defaultView || root);
      var tf = "scale(" + s + ")";
      if (ringScaleEl) {
        ringScaleEl.style.transition = calm ? "transform .2s linear, opacity .2s linear" : "transform .2s linear";
        ringScaleEl.style.transform = tf;
      }
      if (camRingScale && camCue && !camCue.hidden) {
        camRingScale.style.transition = calm ? "transform .2s linear, opacity .2s linear" : "transform .2s linear";
        camRingScale.style.transform = tf;
      }
      if (hideRingScale) {
        hideRingScale.style.transition = calm ? "transform .2s linear, opacity .2s linear" : "transform .2s linear";
        hideRingScale.style.transform = tf;
      }
    }
    function paintGauge() {
      var m = getSessionMinutes(store);
      if (gauge && gauge.value !== String(m)) gauge.value = String(m);
      if (gaugeLabel) gaugeLabel.textContent = sessionLabel(m);
    }
    function paintLevel(total) {
      var lv = levelFor(total);
      if (!levelBadge) return;
      if (!lv) { levelBadge.hidden = true; levelBadge.textContent = ""; return; }
      levelBadge.hidden = false;
      levelBadge.textContent = levelLabel(lv);
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
      var view = statusView(state);
      if (holdStrip) {
        holdStrip.hidden = !view.hold;
        if (view.hold && !reducedMotion(doc.defaultView || root)) holdStrip.removeAttribute("data-calm");
        else if (holdStrip) holdStrip.setAttribute("data-calm", reducedMotion(doc.defaultView || root) ? "1" : "0");
      }
      if (holdCount) {
        if (view.hold) holdCount.textContent = view.count;
        else holdCount.textContent = "";
      }
      if (holdLbl && view.hold) holdLbl.textContent = view.label;
      if (status) {
        if (state && state.running) status.textContent = view.status;
        else if (state && state.summary && state.summary.reason === "complete") {
          var zabBit = zabEndCopy(state.summary.zab);
          status.textContent = state.summary.rounds + " rounds done." + (zabBit ? " " + zabBit : "") + " " + (st.streak ? st.streak + "-day streak." : "Start again when you're ready.");
        } else {
          status.textContent = n ? (n + " breath cycle" + (n === 1 ? "" : "s") + " on this phone.") : "Start a 16-second 4-count cycle.";
        }
      }
      if (camCue && !camCue.hidden && state && state.running) {
        if (camNum) camNum.textContent = view.count;
        if (camLabel) camLabel.textContent = view.status;
      }
      if (hideCue) {
        if (state && (state.running || sessionOn)) {
          if (hideNum) hideNum.textContent = view.count || "";
          if (hideLabel) hideLabel.textContent = view.status || "Sitkari";
        } else if (!(state && state.summary)) {
          if (hideNum) hideNum.textContent = "";
          if (hideLabel) hideLabel.textContent = "Breathe";
        }
      }
      if (hideStatus) {
        if (state && state.summary && state.summary.reason === "complete") {
          hideStatus.hidden = false;
          hideStatus.textContent = status ? status.textContent : "";
        } else if (state && state.running) {
          hideStatus.hidden = true;
        }
      }
      if (state && (state.running || sessionOn || (state.summary && state.sessionMs != null))) {
        var clockShow = (state.sessionMs != null) ? state.sessionMs : (state.summary && state.summary.elapsedMs) || 0;
        paintClock(clockShow, true);
      } else if (state && state.summary && state.summary.elapsedMs != null) {
        paintClock(state.summary.elapsedMs, true);
      }
      if (summaryEl) {
        if (state && state.summary && (state.summary.reason === "complete" || state.summary.reason === "stop")) {
          var line = summaryLine(state.summary, camRan);
          if (line && state.summary.rounds) {
            summaryEl.hidden = false;
            summaryEl.textContent = line;
          }
        } else if (!(state && state.running)) {
          /* keep last summary until the next start */
        } else {
          summaryEl.hidden = true;
        }
      }
      paintMode();
      paintStartStop(sessionOn || (state && state.running) || aligning);
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
          if (state.running) {
            var cue = twoMinCue({
              said: twoMinSaid,
              elapsedMs: state.sessionMs,
              running: true,
              minutes: state.sessionMinutes
            });
            if (cue.speak) maybeSpeak(cue.speak);
            twoMinSaid = cue.said;
          }
          paint(state);
        },
        onPhase: function (state) { phaseTone(state.sideIndex, store); },
        onCycle: function (total, meta) {
          meta = meta || {};
          fadeCloseHint();
          var calm = reducedMotion(doc.defaultView || root);
          popTone(store);
          sparkle(doc, ring || soloBtn, calm);
          flyPlus(doc, ring || soloBtn, countEl, calm);
          if (meta.combo) showCeleb(meta.combo.name);
          if (meta.levels && meta.levels.length) {
            showCeleb(levelLabel(meta.levels[meta.levels.length - 1]));
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
          stopRingAnim();
          lastPhase = -1;
          sessionOn = false;
          aligning = false;
          twoMinSaid = true;
          summary.line = summaryLine(summary, camRan);
          paint({ running: false, total: summary.total, summary: summary, sessionMs: summary.elapsedMs, streak: summary.streak && summary.streak.streak, todayCount: summary.streak && summary.streak.todayCount, live: summary.streak && summary.streak.live });
          if (summary.reason === "complete") maybeSpeak(completeSpeakLine(summary.zab));
          awardBreathIfDue(summary);
          stopCoolingCam();
        }
      });
      return box;
    }
    function stopSession() {
      unlockAudio();
      stopRingAnim();
      if (alignCtl) { alignCtl.cancel(); alignCtl = null; }
      aligning = false;
      stopSpeech();
      hideAlignRing();
      hideCloseHint();
      var b = ensure();
      if (b.running()) b.stop();
      else {
        sessionOn = false;
        stopCoolingCam();
        paint({ running: false, total: getCycles(store) });
      }
    }
    function startSession(mode) {
      unlockAudio();
      unlockSpeech();
      var b = ensure();
      if (sessionOn || b.running() || aligning) return;
      mode = setMode(store, mode);
      activeMode = mode;
      paintMode();
      if (summaryEl) { summaryEl.hidden = true; summaryEl.textContent = ""; }
      lastPhase = -1;
      camRan = false;
      twoMinSaid = false;
      sessionOn = true;
      aligning = true;
      paintClock(0, true);
      paintNudge();
      paintStartStop(true);
      if (status) status.textContent = "Sitkari time.";
      function beginBreath() {
        if (!sessionOn) return;
        aligning = false;
        hideAlignRing();
        if (!b.running()) b.start();
        startRingAnim();
        paintStartStop(true);
      }
      function onAlignStage(stage) {
        if (!sessionOn) return;
        if (stage === "intro") {
          if (status) status.textContent = "Sitkari time.";
          if (camCue && !camCue.hidden && camLabel) { camLabel.textContent = "Sitkari"; if (camNum) camNum.textContent = ""; }
        } else if (stage === "align") {
          if (status) status.textContent = "Sit tall. Relax your jaw.";
          if (camCue && !camCue.hidden && camLabel) { camLabel.textContent = "Sit tall"; if (camNum) camNum.textContent = ""; }
        }
      }
      function runShared() {
        alignCtl = createAlign({
          intro: mode === "camera" && camRan ? INTRO_LINE : INTRO_SOLO,
          speak: speakLine,
          stopSpeech: stopSpeech,
          onStage: onAlignStage,
          onCount: onAlignCount,
          onBreathe: beginBreath
        });
        return alignCtl.run().then(function (ok) {
          aligning = false;
          if (!ok) return;
        });
      }
      if (mode === "camera") {
        startCoolingCam().then(function (ok) {
          if (!sessionOn) return;
          if (!ok) {
            mode = "solo";
            activeMode = "solo";
            /* permission denied: continue the shared Sitkari flow as solo, no camera extras */
          } else {
            showCloseHint();
          }
          return runShared();
        }).catch(function () {
          if (sessionOn) return runShared();
        });
      } else {
        runShared();
      }
    }

    clearMutePref(store);
    paint({ running: false, total: getCycles(store) });
    paintGauge();
    paintNudge();
    paintMode();
    paintStartStop(false);

    camMount = { stopCam: stopCoolingCam };
    restoreRecordPref();
    if (recBtn) {
      try { recBtn.style.cursor = "pointer"; } catch (eR) {}
      recBtn.addEventListener("click", function () { setTimeout(syncRecordPref, 0); });
    }
    var nav = typeof navigator !== "undefined" ? navigator : null, cap = root && root.Capacitor;
    bindStartBtn(soloBtn, function () { startSession("solo"); }, nav, cap);
    bindStartBtn(camBtn, function () { startSession("camera"); }, nav, cap);
    if (stopBtn) bindStartBtn(stopBtn, stopSession, nav, cap);
    if (camStopBtn) bindStartBtn(camStopBtn, stopSession, nav, cap);
    if (hideCue) bindStartBtn(hideCue, function () { startSession("solo"); }, nav, cap);
    if (hideStop) bindStartBtn(hideStop, stopSession, nav, cap);
    function onFsChange() {
      if (!exitingFs && nativeFsActive && !fsEl() && sessionOn && activeMode === "camera") {
        nativeFsActive = false;
        stopSession();
      }
    }
    if (doc.addEventListener) {
      doc.addEventListener("fullscreenchange", onFsChange);
      doc.addEventListener("webkitfullscreenchange", onFsChange);
      doc.addEventListener("keydown", function (e) {
        if (!e || (e.key !== "Escape" && e.key !== "Esc")) return;
        if (coolingFsOn() && sessionOn) {
          if (e.preventDefault) e.preventDefault();
          stopSession();
        }
      });
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
    return { box: function () { return box; }, paint: paint, startSession: startSession, stopSession: stopSession, stopCam: stopCoolingCam };
  }

  var api = {
    KEY: KEY,
    STREAK_KEY: STREAK_KEY,
    MUTE_KEY: MUTE_KEY,
    SESSION_MIN_KEY: SESSION_MIN_KEY,
    RECORD_KEY: RECORD_KEY,
    MODE_KEY: MODE_KEY,
    PROOF_CAPTION: PROOF_CAPTION,
    CLOSE_HINT: CLOSE_HINT,
    INTRO_LINE: INTRO_LINE,
    INTRO_SOLO: INTRO_SOLO,
    ALIGN_LINE: ALIGN_LINE,
    ALIGN_COUNTS: ALIGN_COUNTS,
    ALIGN_COUNT_MS: ALIGN_COUNT_MS,
    ALIGN_RING_SIZE: ALIGN_RING_SIZE,
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
    clearMutePref: clearMutePref,
    isRecordOn: isRecordOn,
    setRecordOn: setRecordOn,
    getMode: getMode,
    setMode: setMode,
    alignmentScript: alignmentScript,
    createAlign: createAlign,
    alignRingPos: alignRingPos,
    mouthChinBox: mouthChinBox,
    boxesOverlap: boxesOverlap,
    summaryLine: summaryLine,
    levelLabel: levelLabel,
    formatClock: formatClock,
    breathZabFor: breathZabFor,
    zabEndCopy: zabEndCopy,
    completeSpeakLine: completeSpeakLine,
    twoMinCue: twoMinCue,
    TWO_MIN_MS: TWO_MIN_MS,
    TWO_MIN_LINE: TWO_MIN_LINE,
    DEFAULT_MIN: DEFAULT_MIN,
    STOP_LABEL: STOP_LABEL,
    stopCam: function () { if (camMount && camMount.stopCam) camMount.stopCam(); },
    sharePayload: sharePayload,
    shareFromTap: shareFromTap,
    isHoldSide: isHoldSide,
    statusView: statusView,
    ringScale: ringScale,
    buzz: buzz,
    bindStartBtn: bindStartBtn,
    reducedMotion: reducedMotion
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatCoolingBox = api;
})(typeof window !== "undefined" ? window : this);
