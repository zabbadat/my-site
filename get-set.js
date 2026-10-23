/* 3-2-1 countdown for camera Start buttons (push Start set / Start session / Start challenge, Plank House).
 * Runs AFTER camera, pose model and calibration are ready; the clock starts when run() resolves true.
 * makeGetSet({ ms: 2000, speak, unlock, stop, schedule }) -> { unlock(), run(show, cancelled) -> Promise<bool>, cancel() }
 * Words "3", "2", "1" at 0 / 700 / 1400 ms of a 2000 ms window (offsets scale with ms); resolves at ms.
 * iOS: call unlock() synchronously inside the tap (cancel + silent volume-0 utterance) so later speech is allowed.
 * Speech is optional: missing or throwing speechSynthesis falls back to on-screen only, silently.
 */
(function (root) {
  var READY = "Ready, get set", POSITION_SPOKEN;
  var SPOKEN = ["3", "2", "1"];
  var SHOWN = ["3", "2", "1"];
  var AT = [0, 0.35, 0.7]; // fraction of the window
  function g() { return typeof window !== "undefined" ? window : root; }
  function utter(text, volume) {
    var w = g();
    if (!w || !w.speechSynthesis || typeof w.SpeechSynthesisUtterance !== "function") return;
    var u = new w.SpeechSynthesisUtterance(text); u.rate = 1.3; if (volume !== undefined) u.volume = volume;
    w.speechSynthesis.speak(u);
  }
  function defaultUnlock() { var w = g(); if (!w || !w.speechSynthesis) return; w.speechSynthesis.cancel(); utter(" ", 0); }
  function defaultSpeak(word) { utter(word); }
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
  function makeGoCountdown(opts) {
    opts = opts || {};
    var ms = opts.ms || 5000, n = Math.round(ms / 1000);
    var speak = safe(opts.speak || defaultSpeak), unlock = safe(opts.unlock || defaultUnlock), stopSpeech = safe(opts.stop || defaultStop);
    var schedule = opts.schedule || function (f, d) { return setTimeout(f, d); }, runId = 0;
    return {
      ms: ms, words: [READY, "Go"],
      unlock: function () { unlock(); },
      run: function (show, cancelled) {
        var my = ++runId; cancelled = cancelled || function () { return false; };
        var dead = function () { return my !== runId || cancelled(); };
        return new Promise(function (resolve) {
          var tick = function (i) { // i = seconds elapsed
            if (dead()) { stopSpeech(); return resolve(false); }
            if (i >= n) { try { show("GO"); } catch (e) {} speak("Go"); return resolve(true); }
            try { show(i === 0 ? READY + " · " + n : String(n - i)); } catch (e) {}
            if (i === 0) speak(READY);
            schedule(function () { tick(i + 1); }, i === n - 1 ? ms - (n - 1) * 1000 : 1000);
          };
          tick(0);
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
    pushups: ["Phone flat under your chest · Shoulders in frame", "Arms straight · Eyes forward"],
    plank: ["Prop the phone on the floor off to your side, a few steps away, screen facing you, so your whole body shows side-on, head to heels."]
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
            var u = new w.SpeechSynthesisUtterance(text); u.rate = 1.1; u.onend = ended; u.onerror = ended;
            w.speechSynthesis.cancel(); w.speechSynthesis.speak(u); started = true;
          }
        }
      } catch (e) { started = false; }
      schedule(finish, started ? maxMs : minMs);
    });
  }
  function positionPrompt(kind) { return (POSITION[kind] || POSITION.pushups).join("\n"); }
  // Rep / score callout: cancel anything queued first so the number never lags behind fast reps. Silent fallback.
  function makeRepVoice(opts) {
    opts = opts || {};
    var speak = safe(opts.speak || defaultSpeak), stopSpeech = safe(opts.stop || defaultStop), last = null;
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
    var speak = safe(opts.speak || defaultSpeak), stopSpeech = safe(opts.stop || defaultStop), every = opts.everyMs || HOLD_EVERY_MS, last = 0, ended = false;
    return {
      tick: function (ms) {
        if (ended) return null;
        var k = Math.floor((Number(ms) || 0) / every); if (k < 1 || k <= last) return null;
        last = k; var w = holdCallout(k * every / 1000); stopSpeech(); speak(w); return w;
      },
      end: function () { ended = true; }, reset: function () { last = 0; ended = false; }
    };
  }
  var api = { sayAndWait: sayAndWait, POSITION_SPOKEN: POSITION_SPOKEN, holdCallout: holdCallout, makeHoldVoice: makeHoldVoice, HOLD_EVERY_MS: HOLD_EVERY_MS, repCallout: repCallout, makeRepVoice: makeRepVoice, POSITION: POSITION, positionPrompt: positionPrompt, READY: READY, makeGetSet: makeGetSet, makeGoCountdown: makeGoCountdown, makeBattleVoice: makeBattleVoice };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatGetSet = api;
})(this);
