/* 3-2-1 countdown for camera Start buttons (push Start set / Start session / Start challenge, Plank House).
 * Runs AFTER camera, pose model and calibration are ready; the clock starts when run() resolves true.
 * makeGetSet({ ms: 2000, speak, unlock, stop, schedule }) -> { unlock(), run(show, cancelled) -> Promise<bool>, cancel() }
 * makeQuickCountdown: restart-only Ready, set, Go (2.4 s); makeSessionTracker: fresh vs restart.
 * makeGoCountdown: 7 s "Ready" · "get set" · "three" · "two" · "one" · "Go" (see STEPS). COACH: spoken setup lines.
 * iOS: call unlock() synchronously inside the tap (cancel + silent volume-0 utterance) so later speech is allowed.
 * Speech is optional: missing or throwing speechSynthesis falls back to on-screen only, silently.
 */
(function (root) {
  var READY = "Ready, get set", POSITION_SPOKEN;
  var SPOKEN = ["3", "2", "1"];
  var SHOWN = ["3", "2", "1"];
  var AT = [0, 0.35, 0.7]; // fraction of the window
  function g() { return typeof window !== "undefined" ? window : root; }
  /* the currency is written ZAB but spoken "Zab" (never spelled out) */
  function say(t) { return String(t == null ? "" : t).replace(/\bZAB\b/g, "Zab"); }
  function utter(text, volume) {
    var w = g();
    if (!w || !w.speechSynthesis || typeof w.SpeechSynthesisUtterance !== "function") return;
    var u = new w.SpeechSynthesisUtterance(say(text)); u.rate = 1.3; if (volume !== undefined) u.volume = volume;
    w.speechSynthesis.speak(u);
  }
  function defaultUnlock() { var w = g(); if (!w || !w.speechSynthesis) return; w.speechSynthesis.cancel(); utter(" ", 0); }
  function defaultSpeak(word) { utter(word); }
  // Interrupting speak for callouts (reps, hold time): WebKit / iOS Safari can silently drop an utterance queued in
  // the same tick as speechSynthesis.cancel(). Only cancel when something is actually speaking / queued, then speak
  // ~60 ms later; otherwise speak at once.
  function interruptSpeak(word) {
    var w = g(); if (!w || !w.speechSynthesis) return;
    var ss = w.speechSynthesis;
    if (ss.speaking || ss.pending) { ss.cancel(); setTimeout(function () { try { utter(word); } catch (e) {} }, 60); }
    else utter(word);
  }
  function defaultStop() { var w = g(); if (w && w.speechSynthesis) w.speechSynthesis.cancel(); }
  function safe(f) { return function () { try { return f.apply(null, arguments); } catch (e) { /* on-screen only */ } }; }
  function makeGetSet(opts) {
    opts = opts || {};
    var ms = opts.ms || 2000;
    var speak = safe(opts.speak || defaultSpeak), unlock = safe(opts.unlock || defaultUnlock), stopSpeech = safe(opts.stop || defaultStop);
    var schedule = opts.schedule || function (f, d) { return setTimeout(f, d); };
    var offs = AT.map(function (f) { return Math.round(f * ms); }), runId = 0;
    return {
      ms: ms, offsets: offs.slice(), words: SPOKEN.slice(), labels: SHOWN.slice(),
      unlock: function () { unlock(); },
      run: function (show, cancelled) {
        var my = ++runId; cancelled = cancelled || function () { return false; };
        var dead = function () { return my !== runId || cancelled(); };
        return new Promise(function (resolve) {
          var step = function (i) {
            if (dead()) { stopSpeech(); return resolve(false); }
            try { show(SHOWN[i]); } catch (e) {}
            speak(SPOKEN[i]);
            if (i === SPOKEN.length - 1) return schedule(function () { if (dead()) { stopSpeech(); resolve(false); } else resolve(true); }, ms - offs[i]);
            schedule(function () { step(i + 1); }, offs[i + 1] - offs[i]);
          };
          step(0);
        });
      },
      cancel: function () { runId += 1; stopSpeech(); }
    };
  }
  /* Push-ups + Plank House: 5-second countdown. 0 ms: show "Ready, get set · 5" + speak "Ready, get set"; 1000..4000: show 4,3,2,1;
   * 5000 ms: show "GO" + speak "Go", resolve true (counting starts). unlock() inside the tap (iOS). Silent fallback. */
  // Shared start countdown (push-ups all modes, TUT, Plank House): slower pacing, 7 s total.
  //   0 s "Ready" · 2 s "get set" · 4 s "three" · 5 s "two" · 6 s "one" · 7 s "Go" (clock starts). Screen shows the same.
  var STEPS = [[0, "Ready", "Ready"], [2000, "get set", "Get set"], [4000, "three", "3"], [5000, "two", "2"], [6000, "one", "1"], [7000, "Go", "GO"]], DEFAULT_STEPS = STEPS;
  var COUNTDOWN_MS = 7000;
  /* Quick restart start (no coaching, no 3-2-1): "Ready" 0 s, "set" 1.2 s, "Go" 2.4 s (clock starts). */
  var QUICK_STEPS = [[0, "Ready", "Ready"], [1200, "set", "Set"], [2400, "Go", "GO"]], QUICK_MS = 2400;
  function makeQuickCountdown(opts) { var o = {}, k; opts = opts || {}; for (k in opts) o[k] = opts[k]; o.steps = QUICK_STEPS; return makeGoCountdown(o); }
  /* Session tracker: decides "fresh" (full coaching + 7 s countdown) vs "restart" (quick Ready, set, Go only).
   *   plan(kind) -> "restart" only if the SAME kind (pushups / tut / plank / ...) completed a start before (commit), with
   *   activity (commit or touch) within idleMs (default 10 min), and no reset() since. Anything else -> "fresh":
   *   first start after page load, switching exercise or mode, leaving the section (reset), a long idle, or a start that
   *   was cancelled before its countdown finished (never committed).
   *   commit(kind) after a start succeeds; touch() on stop / finish / activity; reset() on leaving the exercise. */
  var SESSION_IDLE_MS = 10 * 60 * 1000;
  function makeSessionTracker(opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); }, idleMs = opts.idleMs != null ? opts.idleMs : SESSION_IDLE_MS, kind = null, last = 0;
    return {
      idleMs: idleMs,
      plan: function (k) { return k && kind === k && now() - last <= idleMs ? "restart" : "fresh"; },
      commit: function (k) { kind = k || null; last = now(); },
      touch: function () { if (kind) last = now(); },
      reset: function () { kind = null; last = 0; }
    };
  }
  function makeGoCountdown(opts) {
    opts = opts || {};
    var STEPS = opts.steps || DEFAULT_STEPS;
    var speak = safe(opts.speak || defaultSpeak), unlock = safe(opts.unlock || defaultUnlock), stopSpeech = safe(opts.stop || defaultStop);
    var schedule = opts.schedule || function (f, d) { return setTimeout(f, d); }, runId = 0;
    return {
      ms: STEPS[STEPS.length - 1][0], words: STEPS.map(function (x) { return x[1]; }), steps: STEPS,
      unlock: function () { unlock(); },
      run: function (show, cancelled) {
        var my = ++runId; cancelled = cancelled || function () { return false; };
        var dead = function () { return my !== runId || cancelled(); };
        return new Promise(function (resolve) {
          var step = function (i) {
            if (dead()) { stopSpeech(); return resolve(false); }
            try { show(STEPS[i][2]); } catch (e) {}
            speak(STEPS[i][1]);
            if (i === STEPS.length - 1) return resolve(true);
            schedule(function () { step(i + 1); }, STEPS[i + 1][0] - STEPS[i][0]);
          };
          step(0);
        });
      },
      cancel: function () { runId += 1; stopSpeech(); }
    };
  }

  /* Battles (shared 5 s room countdown from battle-rooms.js): speak "Ready, get set" once when the countdown
   * appears and "Go" once at GO, per room start. voice.phase(key, phase) with phase from countdownState(). */
  function makeBattleVoice(opts) {
    opts = opts || {};
    var speak = safe(opts.speak || defaultSpeak), unlock = safe(opts.unlock || defaultUnlock), said = {};
    return {
      unlock: function () { unlock(); },
      phase: function (key, ph) {
        if (!key) return null;
        if (ph === "countdown" && !said[key + ":r"]) { said[key + ":r"] = 1; speak(READY); return READY; }
        if ((ph === "go" || ph === "live") && !said[key + ":g"]) { said[key + ":r"] = 1; said[key + ":g"] = 1; if (ph === "go") { speak("Go"); return "Go"; } }
        return null;
      }
    };
  }
  // Camera setup prompt (max 2 short lines) shown while the camera loads and ~2 s after it opens, before the countdown.
  var POSITION = {
    pushups: ["Lean your phone up in front of you, camera facing you", "Shoulders and hands in frame"],
    plank: ["Prop your phone sideways on the floor, off to your side.", "Step back until the outline shows your whole body, head to heels."]
  };
  // Plank setup line is also SPOKEN once when the camera opens; the countdown waits for it to finish.
  POSITION_SPOKEN = { plank: POSITION.plank[0] };
  POSITION.tut = POSITION.pushups;
  // Speak a line and resolve when it has finished (onend / onerror), never before minMs, never after maxMs.
  // No speech available: resolves after minMs (the plain on-screen prompt time). Resolves false if cancelled.
  function sayAndWait(text, opts) {
    opts = opts || {};
    var minMs = opts.minMs != null ? opts.minMs : 2000, maxMs = opts.maxMs != null ? opts.maxMs : 8000, t0 = Date.now();
    var now = opts.now || function () { return Date.now(); }; t0 = now();
    var schedule = opts.schedule || function (f, d) { return setTimeout(f, d); }, cancelled = opts.cancelled || function () { return false; };
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; resolve(!cancelled()); }
      function ended() { var left = minMs - (now() - t0); if (left > 0) schedule(finish, left); else finish(); }
      var started = false;
      try {
        if (opts.speak) started = opts.speak(text, ended) !== false;
        else {
          var w = g();
          if (w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === "function") {
            var u = new w.SpeechSynthesisUtterance(say(text)); u.rate = 1.1; u.onend = ended; u.onerror = ended;
            var ss = w.speechSynthesis;
            if (ss.speaking || ss.pending) { ss.cancel(); setTimeout(function () { try { ss.speak(u); } catch (e) {} }, 60); } else ss.speak(u);
            started = true;
          }
        }
      } catch (e) { started = false; }
      schedule(finish, started ? maxMs : minMs);
    });
  }
  // Spoken + on-screen start coaching, one shared sequence for all camera exercises:
  //   tap -> PLACE line (spoken in the tap; camera opens meanwhile) -> CRITERIA line -> countdown.
  var COACH = {
    pushups: { place: "Lean your phone up in front of you, camera facing you.", criteria: "Shoulders and hands in frame. Go all the way down and back up." },
    tut: { place: "Lean your phone up in front of you, camera facing you.", criteria: "Shoulders and hands in frame. Slow, controlled reps, all the way down and back up." },
    plank: { place: "Prop your phone sideways on the floor, off to your side. Turn so the camera sees your side.", criteria: "Step back until the outline shows your whole body, head to heels. Hold still until I say go.", rules: "Hips sagging, hips piking up, knees down, standing up, or leaving the frame for a second ends the hold." }
  };
  function coachLines(kind) { return COACH[kind] || COACH.pushups; }
  function positionPrompt(kind) { return (POSITION[kind] || POSITION.pushups).join("\n"); }
  // Rep / score callout: cancel anything queued first so the number never lags behind fast reps. Silent fallback.
  function makeRepVoice(opts) {
    opts = opts || {};
    var speak = safe(opts.speak || interruptSpeak), stopSpeech = safe(opts.speak ? (opts.stop || defaultStop) : function () {}), last = null;
    return { say: function (n) { if (n == null || n === last) return; last = n; stopSpeech(); speak(String(n)); }, reset: function () { last = null; } };
  }
  // Spoken rep callout. With a target (Sets): counts DOWN, rep 1 of 20 says "20" ... rep 20 says "1";
  // reps past the target say "Plus 1", "Plus 2"... No target (One long set, challenge, battles): counts up "1", "2"...
  function repCallout(reps, target) {
    reps = Math.floor(Number(reps) || 0); if (reps < 1) return null;
    var t = Math.floor(Number(target) || 0);
    if (t < 1) return String(reps);
    return reps <= t ? String(t - reps + 1) : "Plus " + (reps - t);
  }
  // Spoken hold time every 15 s: "15 seconds", "30 seconds", "45 seconds", "1 minute", "1 minute 15", ... "2 minutes".
  var HOLD_EVERY_MS = 15000;
  function holdCallout(sec) {
    sec = Math.floor(Number(sec) || 0); if (sec < 1) return null;
    var m = Math.floor(sec / 60), s = sec % 60;
    if (!m) return s + " seconds";
    return m + (m === 1 ? " minute" : " minutes") + (s ? " " + s : "");
  }
  // tick(ms) with the hold's own elapsed ms; speaks once per new 15 s mark (a skipped mark speaks only the latest),
  // cancels anything queued first; end() silences it until reset() (a new hold / set starts from 0).
  function makeHoldVoice(opts) {
    opts = opts || {};
    var speak = safe(opts.speak || interruptSpeak), stopSpeech = safe(opts.speak ? (opts.stop || defaultStop) : function () {}), every = opts.everyMs || HOLD_EVERY_MS, last = 0, ended = false;
    return {
      tick: function (ms) {
        if (ended) return null;
        var k = Math.floor((Number(ms) || 0) / every); if (k < 1 || k <= last) return null;
        last = k; var w = holdCallout(k * every / 1000); stopSpeech(); speak(w); return w;
      },
      end: function () { ended = true; }, reset: function () { last = 0; ended = false; }
    };
  }
  // Shared battle countdown (battle-rooms.js: 5 s, n = 5..1 then "go"): same words as the solo countdown, one per
  // second: 5 "Ready", 4 "get set", 3 "three", 2 "two", 1 "one", go "Go". Each word once per room+startAt key.
  var BATTLE_WORDS = { 5: "Ready", 4: "get set", 3: "three", 2: "two", 1: "one" };
  function makeSharedCountdownVoice(opts) {
    opts = opts || {};
    var speak = safe(opts.speak || interruptSpeak), said = {};
    return {
      phase: function (key, ph, n) {
        if (!key) return null;
        var w = ph === "countdown" ? BATTLE_WORDS[n] : ph === "go" ? "Go" : null, k = key + ":" + (ph === "go" ? "go" : n);
        if (!w || said[k]) return null; said[k] = 1; speak(w); return w;
      }
    };
  }
  var api = { makeQuickCountdown: makeQuickCountdown, QUICK_STEPS: QUICK_STEPS, QUICK_MS: QUICK_MS, makeSessionTracker: makeSessionTracker, SESSION_IDLE_MS: SESSION_IDLE_MS, makeSharedCountdownVoice: makeSharedCountdownVoice, BATTLE_WORDS: BATTLE_WORDS, COACH: COACH, coachLines: coachLines, STEPS: STEPS, COUNTDOWN_MS: COUNTDOWN_MS, interruptSpeak: interruptSpeak, sayAndWait: sayAndWait, POSITION_SPOKEN: POSITION_SPOKEN, holdCallout: holdCallout, makeHoldVoice: makeHoldVoice, HOLD_EVERY_MS: HOLD_EVERY_MS, repCallout: repCallout, makeRepVoice: makeRepVoice, POSITION: POSITION, positionPrompt: positionPrompt, READY: READY, makeGetSet: makeGetSet, makeGoCountdown: makeGoCountdown, makeBattleVoice: makeBattleVoice };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatGetSet = api;
})(this);
