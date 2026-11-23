/* 3-2-1 countdown for camera Start buttons (push Start set / Start session / Start challenge, Plank House).
 * Runs AFTER camera, pose model and calibration are ready; the clock starts when run() resolves true.
 * makeGetSet({ ms: 2000, speak, unlock, stop, schedule }) -> { unlock(), run(show, cancelled) -> Promise<bool>, cancel() }
 * makeNextSetCountdown / makeQuickCountdown: "Set up, go on three." then One · two · three · Go (7.6 s; clock starts at Go).
 * makeSessionTracker: fresh (coaching + go-cue) vs restart (go-cue only). COACH: spoken setup lines.
 * iOS: call unlock() synchronously inside the tap (cancel + silent volume-0 utterance) so later speech is allowed.
 * Speech is optional: missing or throwing speechSynthesis falls back to on-screen only, silently.
 */
(function (root) {
  var READY = "Ready, get set", POSITION_SPOKEN;
  var SPOKEN = ["3", "2", "1"];
  var SHOWN = ["3", "2", "1"];
  var AT = [0, 0.35, 0.7]; // fraction of the window
  // ONE site-wide voice for every spoken prompt (push-ups, TUT, plank, hold cues, battles): the phone's own default TTS
  // voice (never a chosen voice), default pitch, relaxed unhurried rate 0.88 (was 1.3 for cues and 1.1 for coaching lines).
  var VOICE = { rate: 0.88 };
  function g() { return typeof window !== "undefined" ? window : root; }
  /* Pronunciation map applied only to utterance text (on-screen spelling is unchanged):
   * written ZAB is spoken "Zab" (never spelled out); written Gyatt is spoken "Gyot"
   * (owner, Nov 17: one syllable, like "gyot", rhymes with yacht). */
  var PRONOUNCE = [[/\bZAB\b/g, "Zab"], [/Gyatt/gi, "Gyot"]];
  function say(t) {
    var s = String(t == null ? "" : t);
    for (var i = 0; i < PRONOUNCE.length; i++) s = s.replace(PRONOUNCE[i][0], PRONOUNCE[i][1]);
    return s;
  }
  function utter(text, volume, voice) {
    var w = g();
    if (!w || !w.speechSynthesis || typeof w.SpeechSynthesisUtterance !== "function") return;
    try { if (typeof w.speechSynthesis.resume === "function") w.speechSynthesis.resume(); } catch (e) {}
    var u = new w.SpeechSynthesisUtterance(say(text)); u.rate = voice && voice.rate || VOICE.rate; if (volume !== undefined) u.volume = volume;
    w.speechSynthesis.speak(u);
  }
  // Silent unlock for iOS: must run inside a tap. Do not cancel a line already speaking (the end-of-set "Set complete." must finish).
  function defaultUnlock() { var w = g(); if (!w || !w.speechSynthesis) return; utter(" ", 0); }
  function defaultSpeak(word) { utter(word); }
  // Interrupting speak for callouts (reps, hold time): WebKit / iOS Safari can silently drop an utterance queued in
  // the same tick as speechSynthesis.cancel(). Only cancel when something is actually speaking / queued, then speak
  // ~60 ms later; otherwise speak at once.
  // Never throws: speech is optional, so a refused / failing speechSynthesis (iOS NotAllowedError, no voice, a throwing
  // cancel) must not reach the caller. Callers such as startPlankCam call this directly inside their start flow, where an
  // exception used to abort the start ("Camera or pose blocked.") and the hold loop never began.
  function interruptSpeak(word) {
    try {
      if (speechProtect) return; // never cancel Set up / One / two / three / Hold mid-cue
      var w = g(); if (!w || !w.speechSynthesis) return;
      var ss = w.speechSynthesis;
      if (ss.speaking || ss.pending) { ss.cancel(); setTimeout(function () { try { utter(word); } catch (e) {} }, 60); }
      else utter(word);
    } catch (e) { /* on-screen only */ }
  }
  // true while a spoken line is playing or queued (lets a later cue wait instead of cutting it off)
  function isSpeaking() { var w = g(); return !!(w && w.speechSynthesis && (w.speechSynthesis.speaking || w.speechSynthesis.pending)); }
  // Serial speech (Nov 17): iOS WKWebView (and some Android WebView TTS paths) silently drop utterances
  // passed to speak() while another is still speaking, or queued from a timer before onend. We speak one
  // line at a time, wait for onend/onerror, and only then start the next; a timed fallback runs if onend
  // never fires. Protected sequences (the plank One / two / three / Hold cue) are not cancelled by
  // interruptSpeak or defaultStop.
  var speechProtect = 0, speechQueued = 0, speechChain = Promise.resolve();
  function protectSpeech() { speechProtect += 1; return function () { speechProtect = Math.max(0, speechProtect - 1); }; }
  function speechFallbackMs(text) {
    var n = String(text == null ? "" : text).length, rate = VOICE.rate || 0.88;
    return Math.max(1500, Math.min(10000, 1000 + (120 * n) / rate));
  }
  function speakAndWait(text, opts) {
    opts = opts || {};
    var schedule = opts.schedule || function (f, d) { return setTimeout(f, d); };
    var fallback = opts.fallbackMs != null ? opts.fallbackMs : speechFallbackMs(text);
    var volume = opts.volume, voice = opts.voice;
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; resolve(); }
      try {
        var w = g();
        if (!w || !w.speechSynthesis || typeof w.SpeechSynthesisUtterance !== "function") { schedule(finish, 0); return; }
        try { if (typeof w.speechSynthesis.resume === "function") w.speechSynthesis.resume(); } catch (e) {}
        var u = new w.SpeechSynthesisUtterance(say(text));
        u.rate = (voice && voice.rate) || VOICE.rate;
        if (volume !== undefined) u.volume = volume;
        u.onend = finish; u.onerror = finish;
        w.speechSynthesis.speak(u);
      } catch (e) { finish(); return; }
      schedule(finish, fallback);
    });
  }
  function enqueueSpeak(text, opts) {
    speechQueued += 1;
    // Start immediately when the queue is idle so resume()+speak() run in this tick
    // (iOS can drop a speak deferred to a microtask; tests also expect a sync first line).
    var p = speechQueued === 1
      ? speakAndWait(text, opts)
      : speechChain.then(function () { return speakAndWait(text, opts); }, function () { return speakAndWait(text, opts); });
    p = p.then(function () { speechQueued = Math.max(0, speechQueued - 1); }, function () { speechQueued = Math.max(0, speechQueued - 1); });
    speechChain = p.catch(function () {});
    return p;
  }
  function waitSpeechIdle(maxMs, schedule) {
    schedule = schedule || function (f, d) { return setTimeout(f, d); };
    maxMs = maxMs != null ? maxMs : 12000;
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        var engine = false; try { engine = isSpeaking(); } catch (e) {}
        if (speechQueued <= 0 && !engine) return resolve(true);
        if (Date.now() - t0 >= maxMs) return resolve(false);
        schedule(poll, 50);
      })();
    });
  }
  // plankSpeak: same voice and rate; now serial (waits for the previous plank line to end) so iOS never
  // drops a queued count. Never throws, never cancels.
  var PLANK_VOICE = VOICE;
  function plankSpeak(word) { try { enqueueSpeak(word); } catch (e) { /* on-screen only */ } }
  function defaultStop() { if (speechProtect) return; var w = g(); if (w && w.speechSynthesis) w.speechSynthesis.cancel(); }
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
  // Universal go-cue, every mode, first start (after coaching) and every later set:
  //   0 s speak/show "Set up, go on three." · 4.0 s "One" · 5.2 s "two" · 6.4 s "three" · 7.6 s "Go" (clock starts at Go).
  // The 4 s lead lets the setup line finish (~1.8 s at rate 0.88) and leaves a beat to get back into position.
  var NEXT_SET_LINE = "Set up, go on three.";
  var NEXT_LEAD_MS = 4000;
  var NEXT_STEPS = [[0, "One", "1"], [1200, "two", "2"], [2400, "three", "3"], [3600, "Go", "GO"]];
  var NEXT_COUNT_MS = 3600;
  var NEXT_TOTAL_MS = NEXT_LEAD_MS + NEXT_COUNT_MS; // 7600
  // Legacy names kept so older tests and any leftover callers still resolve. STEPS/QUICK now follow the same go-cue
  // (no separate hasty 2.4 s restart). Plank: same pace and voice, but "One, two, three, hold" after "Go on, hold on three."; the clock starts at "hold", and only once a proper plank is locked in.
  var STEPS = [[0, NEXT_SET_LINE, NEXT_SET_LINE], [4000, "One", "1"], [5200, "two", "2"], [6400, "three", "3"], [7600, "Go", "GO"]], DEFAULT_STEPS = STEPS;
  var COUNTDOWN_MS = NEXT_TOTAL_MS;
  var PLANK_STEP_MS = 1200;
  var PLANK_SET_LINE = "Go on, hold on three.";
  var PLANK_STEPS = [[0, "One", "1"], [1200, "two", "2"], [2400, "three", "3"], [3600, "hold", "hold"]];
  var PLANK_COUNT_MS = NEXT_COUNT_MS;
  var QUICK_STEPS = STEPS;
  var QUICK_MS = NEXT_TOTAL_MS;
  function makeQuickCountdown(opts) { return makeNextSetCountdown(opts); }
  function makeNextSetCountdown(opts) {
    opts = opts || {};
    var leadMs = opts.leadMs != null ? opts.leadMs : NEXT_LEAD_MS;
    var line = opts.line != null ? opts.line : NEXT_SET_LINE;
    var STEPS = opts.steps || NEXT_STEPS;
    var speak = safe(opts.speak || defaultSpeak), unlock = safe(opts.unlock || defaultUnlock), stopSpeech = safe(opts.stop || defaultStop);
    var schedule = opts.schedule || function (f, d) { return setTimeout(f, d); }, runId = 0;
    var idle = opts.isSpeaking || isSpeaking;
    var waitMax = opts.waitIdleMaxMs != null ? opts.waitIdleMaxMs : 0;
    return {
      ms: leadMs + STEPS[STEPS.length - 1][0], leadMs: leadMs, line: line, steps: STEPS, words: [line].concat(STEPS.map(function (x) { return x[1]; })),
      unlock: function () { unlock(); },
      run: function (show, cancelled) {
        var my = ++runId; cancelled = cancelled || function () { return false; };
        var dead = function () { return my !== runId || cancelled(); };
        return new Promise(function (resolve) {
          function go() {
            if (dead()) { stopSpeech(); return resolve(false); }
            try { show(line); } catch (e) {}
            speak(line);
            var step = function (i) {
              if (dead()) { stopSpeech(); return resolve(false); }
              try { show(STEPS[i][2]); } catch (e) {}
              speak(STEPS[i][1]);
              if (i === STEPS.length - 1) return resolve(true);
              schedule(function () { step(i + 1); }, STEPS[i + 1][0] - STEPS[i][0]);
            };
            schedule(function () { step(0); }, leadMs);
          }
          if (!waitMax) return go();
          var waited = 0;
          (function hold() {
            if (dead()) { stopSpeech(); return resolve(false); }
            var busy = false; try { busy = !!idle(); } catch (e) { busy = false; }
            if (!busy || waited >= waitMax) return go();
            waited += 100;
            schedule(hold, 100);
          })();
        });
      },
      cancel: function () { runId += 1; stopSpeech(); },
      cancelKeepSpeech: function () { runId += 1; }
    };
  }
  /* Session tracker: decides "fresh" (placement + criteria coaching, then the shared go-cue) vs "restart" (go-cue only).
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
    var waitEnd = !!opts.waitEnd, line = opts.line, idleMax = opts.idleMaxMs != null ? opts.idleMaxMs : 12000;
    return {
      ms: STEPS[STEPS.length - 1][0], words: STEPS.map(function (x) { return x[1]; }), steps: STEPS, waitEnd: waitEnd, line: line,
      unlock: function () { unlock(); },
      run: function (show, cancelled) {
        var my = ++runId; cancelled = cancelled || function () { return false; };
        var dead = function () { return my !== runId || cancelled(); };
        var release = opts.protect ? protectSpeech() : function () {};
        return new Promise(function (resolve) {
          function finish(ok) { try { release(); } catch (e) {} resolve(ok); }
          if (!waitEnd) {
            var step = function (i) {
              if (dead()) { stopSpeech(); return finish(false); }
              try { show(STEPS[i][2]); } catch (e) {}
              speak(STEPS[i][1]);
              if (i === STEPS.length - 1) return finish(true);
              schedule(function () { step(i + 1); }, STEPS[i + 1][0] - STEPS[i][0]);
            };
            return step(0);
          }
          // Wait for any earlier line (Go on, hold on three. / rules / camera-on) to finish, then
          // speak each count on utterance end (timed fallback if onend never fires). Clock starts
          // when the last word (Hold) is *started*, not when it ends.
          function counts() {
            if (dead()) { stopSpeech(); return finish(false); }
            var i = 0;
            function lead() {
              if (!line) return step();
              try { show(line); } catch (e) {}
              enqueueSpeak(line, { schedule: schedule }).then(function () { if (dead()) return finish(false); step(); }, function () { if (dead()) return finish(false); step(); });
            }
            function step() {
              if (dead()) { stopSpeech(); return finish(false); }
              try { show(STEPS[i][2]); } catch (e) {}
              var last = i === STEPS.length - 1;
              if (last) { enqueueSpeak(STEPS[i][1], { schedule: schedule }); return finish(true); }
              enqueueSpeak(STEPS[i][1], { schedule: schedule }).then(function () { i += 1; step(); }, function () { i += 1; step(); });
            }
            lead();
          }
          waitSpeechIdle(idleMax, schedule).then(counts, counts);
        });
      },
      cancel: function () { runId += 1; stopSpeech(); }
    };
  }

  /* Washer Battle (1v1 + 2v2) shared countdown: speak "Ready, get set" once when the countdown
   * appears, then "three", "two", "one" as n hits 3-2-1, and "Go" once at GO, per room start.
   * voice.phase(key, phase, n) with phase/n from countdownState(). */
  var BATTLE_COUNT = { 3: "three", 2: "two", 1: "one" };
  function makeBattleVoice(opts) {
    opts = opts || {};
    var speak = safe(opts.speak || defaultSpeak), unlock = safe(opts.unlock || defaultUnlock), said = {};
    return {
      unlock: function () { unlock(); },
      phase: function (key, ph, n) {
        if (!key) return null;
        if (ph === "countdown" && !said[key + ":r"]) { said[key + ":r"] = 1; speak(READY); return READY; }
        if (ph === "countdown" && BATTLE_COUNT[n] && !said[key + ":" + n]) { said[key + ":" + n] = 1; speak(BATTLE_COUNT[n]); return BATTLE_COUNT[n]; }
        if ((ph === "go" || ph === "live") && !said[key + ":g"]) { said[key + ":r"] = 1; said[key + ":g"] = 1; if (ph === "go") { speak("Go"); return "Go"; } }
        return null;
      }
    };
  }
  // Camera setup prompt (max 2 short lines) shown while the camera loads and ~2 s after it opens, before the countdown.
  var POSITION = {
    pushups: ["Lean your phone up in front of you, camera facing you", "Shoulders and hands in frame"],
    plank: ["Phone on the floor, on its side, off to your side.", "Step back until you're head to heels."]
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
            var u = new w.SpeechSynthesisUtterance(say(text)); u.rate = opts.rate || VOICE.rate; u.onend = ended; u.onerror = ended;
            var ss = w.speechSynthesis;
            if (opts.resume) { try { if (typeof ss.resume === "function") ss.resume(); } catch (e) {} } // iOS: wake a paused engine first (opt-in)
            if (opts.queue) ss.speak(u); // plank: wait in line behind the current line, never cut it off
            else if (ss.speaking || ss.pending) { ss.cancel(); setTimeout(function () { try { ss.speak(u); } catch (e) {} }, 60); } else ss.speak(u);
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
    pushups: { place: "Lean your phone up in front of you, camera facing you.", criteria: "Shoulders and hands in frame. Go all the way down and back up.", theme: "Stay under tension the whole set." },
    tut: { place: "Lean your phone up in front of you, camera facing you.", criteria: "Shoulders and hands in frame. Slow, controlled reps, all the way down and back up.", theme: "Stay under tension the whole set." },
    squats: { place: "Phone up in front of you, camera facing you.", criteria: "Whole body in frame, head to feet. Stance one and a half to two times shoulder width, toes out about forty-five degrees. Glutes the whole way.", theme: "Stay under tension: down, hold, and up." },
    plank: { clock: "Clock starts on a proper plank.", next: PLANK_SET_LINE, place: "Phone on the floor, on its side, off to your side.", criteria: "Step back until you're head to heels.", rules: "Bad form fails the plank.", theme: "You're under tension the whole hold, so breathe through it." }
  };
  function coachLines(kind) { return COACH[kind] || COACH.pushups; }
  // Plank House (owner, Nov 20): if the phone is still upright at setup, say and show this once
  // before the countdown / clock. Clear it in landscape. Re-prompt at most once if the phone
  // goes back to portrait before the clock starts. Never blocks the start if orientation can't
  // be read, and never nags during the hold.
  var PLANK_SIDE_LINE = "Turn your phone to the side for optimal framing.";
  function isPortrait(win) {
    try {
      var w = win || g();
      if (!w) return null;
      if (typeof w.matchMedia === "function") {
        var p = w.matchMedia("(orientation: portrait)"), l = w.matchMedia("(orientation: landscape)");
        if (p && p.matches) return true;
        if (l && l.matches) return false;
      }
      var so = w.screen && w.screen.orientation;
      if (so && typeof so.type === "string") {
        if (/^portrait/i.test(so.type)) return true;
        if (/^landscape/i.test(so.type)) return false;
      }
      var iw = w.innerWidth, ih = w.innerHeight;
      if (isFinite(iw) && isFinite(ih) && iw > 0 && ih > 0) return iw < ih;
    } catch (e) {}
    return null;
  }
  function makePlankSidePrompt(opts) {
    opts = opts || {};
    var speak = safe(opts.speak || plankSpeak);
    var isPor = opts.isPortrait || function () { return isPortrait(opts.win || g()); };
    var onShow = opts.show || function () {}, onClear = opts.clear || function () {};
    var shown = 0, active = false, visible = false, unsubs = [];
    function readPortrait() {
      try {
        var v = isPor();
        if (v === true) return true;
        if (v === false) return false;
      } catch (e) {}
      return null;
    }
    function display() {
      if (visible) return;
      visible = true;
      try { onShow(PLANK_SIDE_LINE); } catch (e) {}
      speak(PLANK_SIDE_LINE);
    }
    function hide() {
      if (!visible) return;
      visible = false;
      try { onClear(); } catch (e) {}
    }
    function tick() {
      if (!active) return;
      var por = readPortrait();
      if (por === true) { if (!visible && shown < 2) { shown += 1; display(); } }
      else hide();
    }
    function listen() {
      stopListen();
      var w = opts.win || g();
      if (!w || typeof w.addEventListener !== "function") return;
      function on() { tick(); }
      try { w.addEventListener("orientationchange", on); unsubs.push(function () { try { w.removeEventListener("orientationchange", on); } catch (e) {} }); } catch (e) {}
      try { w.addEventListener("resize", on); unsubs.push(function () { try { w.removeEventListener("resize", on); } catch (e) {} }); } catch (e) {}
      try {
        var so = w.screen && w.screen.orientation;
        if (so && typeof so.addEventListener === "function") {
          so.addEventListener("change", on);
          unsubs.push(function () { try { so.removeEventListener("change", on); } catch (e) {} });
        }
      } catch (e) {}
      try {
        if (typeof w.matchMedia === "function") {
          var mq = w.matchMedia("(orientation: portrait)");
          if (mq && typeof mq.addEventListener === "function") {
            mq.addEventListener("change", on);
            unsubs.push(function () { try { mq.removeEventListener("change", on); } catch (e) {} });
          } else if (mq && typeof mq.addListener === "function") {
            mq.addListener(on);
            unsubs.push(function () { try { mq.removeListener(on); } catch (e) {} });
          }
        }
      } catch (e) {}
    }
    function stopListen() { while (unsubs.length) { try { unsubs.pop()(); } catch (e) {} } }
    function start() { active = true; listen(); tick(); return visible ? PLANK_SIDE_LINE : null; }
    function clockStarted() { active = false; stopListen(); hide(); }
    function reset() { active = false; shown = 0; stopListen(); hide(); }
    return { start: start, tick: tick, clockStarted: clockStarted, reset: reset, line: PLANK_SIDE_LINE,
      visible: function () { return visible; }, prompted: function () { return shown; }, active: function () { return active; } };
  }
  // Camera-on line (owner, Nov 17): spoken every time a camera turns on, with what to do. The face part is said only
  // when the face cover (PFP) is actually on. Coached starts (push-ups, TUT, TUT Battle, plank, squats) put it in front of
  // the CRITERIA line, which is spoken once the camera is up (after the tap unlock) and is followed by the countdown, so it
  // never talks over / cancels the place line, "Set complete." or the countdown. Restarts between sets skip the criteria
  // line, so they say nothing extra. Cameras without start coaching (Live Match board camera, Live cast) get the line plus
  // guidance from watchCameraVoice(), queued politely (never cancels, waits for quiet, at most once a minute per camera).
  var CAMERA_ON = "Camera on.", FACE_COVERED = "Your face is covered.";
  var CAMERA_GUIDE = { zmCamVid: "Point the camera at the board.", zlSelf: "Point the camera at the board." };
  function faceCovered() { try { var w = g(), P = w && w.ZabPfp; return !!(P && typeof P.isOn === "function" && P.isOn()); } catch (e) { return false; } }
  function cameraOnLine(covered) { if (covered === undefined) covered = faceCovered(); return covered ? CAMERA_ON + " " + FACE_COVERED : CAMERA_ON; }
  function withCameraOn(line, covered) { return cameraOnLine(covered) + (line ? " " + line : ""); }
  function watchCameraVoice(doc, opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); }, schedule = opts.schedule || function (f, d) { return setTimeout(f, d); };
    var speak = safe(opts.speak || plankSpeak), busy = opts.busy || isSpeaking, guide = opts.guide || CAMERA_GUIDE, last = {}, waitMs = opts.waitMs || 6000, gapMs = opts.gapMs || 60000;
    if (!doc || typeof doc.addEventListener !== "function") return null;
    function onPlaying(ev) {
      try {
        var v = ev && ev.target, id = v && v.id;
        if (!id || !guide[id]) return;
        var src = v.srcObject; if (!src || typeof src.getVideoTracks !== "function" || !src.getVideoTracks().length) return; // a camera, not a clip
        var t = now(); if (last[id] != null && t - last[id] < gapMs) return; last[id] = t;
        var line = withCameraOn(guide[id]), t0 = t;
        (function attempt() {
          var b = false; try { b = !!busy(); } catch (e) {}
          if (!b) { speak(line); return; }
          if (now() - t0 < waitMs) schedule(attempt, 150); // never talk over another line; give up after waitMs
        })();
      } catch (e) {}
    }
    doc.addEventListener("playing", onPlaying, true);
    return { stop: function () { try { doc.removeEventListener("playing", onPlaying, true); } catch (e) {} }, handle: onPlaying };
  }
  function positionPrompt(kind) { return (POSITION[kind] || POSITION.pushups).join("\n"); }
  // Rep / score callout: cancel anything queued first so the number never lags behind fast reps. Silent fallback.
  function makeRepVoice(opts) {
    opts = opts || {};
    var speak = safe(opts.speak || interruptSpeak), stopSpeech = safe(opts.speak ? (opts.stop || defaultStop) : function () {}), last = null;
    return { say: function (n) { if (n == null || n === last) return; last = n; stopSpeech(); speak(String(n)); }, reset: function () { last = null; } };
  }
  // Spoken rep callout. With a target (Sets): counts DOWN, rep 1 of 10 says "10" ... rep 10 says "1";
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
  // Optional polite mode (opts.polite, used by the TUT set count; Plank keeps the default): a mark never cancels or talks over
  // other speech. If something is speaking when the mark arrives, the count waits up to opts.graceMs (4 s) for it to finish, then is
  // dropped (never piles up, never repeats). opts.busy() overrides the speech check. Beyond opts.denseMs (10 min) only whole
  // minutes are spoken, and nothing is spoken past opts.maxMs (60 min).
  function makeHoldVoice(opts) {
    opts = opts || {};
    var speak = safe(opts.speak || interruptSpeak), stopSpeech = safe(opts.speak ? (opts.stop || defaultStop) : function () {}), every = opts.everyMs || HOLD_EVERY_MS, last = 0, ended = false;
    var polite = !!opts.polite, busy = opts.busy || isSpeaking, grace = opts.graceMs != null ? opts.graceMs : 4000, dense = opts.denseMs != null ? opts.denseMs : 600000, cap = opts.maxMs != null ? opts.maxMs : 3600000, pend = null;
    return {
      tick: function (ms) {
        if (ended) return null;
        ms = Number(ms) || 0;
        var k = Math.floor(ms / every);
        if (!polite) {
          if (k < 1 || k <= last) return null;
          last = k; var w = holdCallout(k * every / 1000); stopSpeech(); speak(w); return w;
        }
        if (k >= 1 && k > last) {
          last = k; var at = k * every;
          pend = at > cap || (at > dense && at % 60000 !== 0) ? null : { at: at, word: holdCallout(at / 1000) };
        }
        if (!pend) return null;
        if (ms - pend.at > grace) { pend = null; return null; }
        var b = false; try { b = !!busy(); } catch (e) { b = false; }
        if (b) return null;
        var word = pend.word; pend = null; speak(word); return word;
      },
      end: function () { ended = true; pend = null; }, reset: function () { last = 0; ended = false; pend = null; }
    };
  }
  // Plank elapsed-time voice: NO end cap. A spoken mark every PLANK_TIME_EVERY_MS of the credited hold clock for as long as the hold
  // lasts: "15 seconds", "30 seconds", "45 seconds", "One minute", "One minute fifteen", ... "Two minutes", ... "Thirty minutes",
  // then "One hour", "One hour fifteen seconds", ... Polite and non-blocking: tick() never waits or awaits, never cancels other speech,
  // and a mark is skipped (never queued, never repeated) when a line is still playing, when muted, or when the clock jumped past it
  // (only the latest mark is spoken). end() silences it until reset().
  var PLANK_TIME_EVERY_MS = 15000;
  var ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  var TENS = ["", "", "twenty", "thirty", "forty", "fifty"];
  function numWord(n) { n = Math.floor(n); if (n < 20) return ONES[n]; return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : ""); }
  function capFirst(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function plankTimeCallout(sec) {
    sec = Math.floor(Number(sec) || 0); if (sec < 1) return null;
    if (sec < 60) return sec + " seconds";
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (!h) return capFirst(numWord(m)) + (m === 1 ? " minute" : " minutes") + (s ? " " + numWord(s) : "");
    return capFirst(numWord(h)) + (h === 1 ? " hour" : " hours") + (m ? " " + numWord(m) + (m === 1 ? " minute" : " minutes") : "") + (s ? " " + numWord(s) + (m ? "" : s === 1 ? " second" : " seconds") : "");
  }
  function makePlankTimeVoice(opts) {
    opts = opts || {};
    // defaultSpeak (not plankSpeak): tick() must stay polite and non-blocking — a mark is skipped when busy, never queued behind another line, never cancelled.
    var speak = safe(opts.speak || defaultSpeak), every = opts.everyMs || PLANK_TIME_EVERY_MS, busy = opts.busy || isSpeaking, muted = opts.muted || null, last = 0, ended = false;
    return {
      tick: function (ms) {
        if (ended) return null;
        var k = Math.floor((Number(ms) || 0) / every);
        if (k < 1 || k <= last) return null;
        last = k; // the mark is used up even if it is skipped below: no later repeat, no catch-up
        try { if (muted && muted()) return null; } catch (e) { return null; }
        var b = false; try { b = !!busy(); } catch (e) { b = false; }
        if (b) return null;
        var word = plankTimeCallout(k * every / 1000); speak(word); return word;
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
  // Pocket cue for walking features (live walk, Zabba Washers): one relaxed line in the shared voice plus a short buzz,
  // so the walker can pocket the phone without looking. Breath first. Never throws.
  var POCKET_LINE = "Phone in your pocket. Breathe easy, and walk.";
  function pocketCue(opts) {
    opts = opts || {};
    var w = g(), spoke = false, buzzed = false;
    try { if (w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === "function") { utter(POCKET_LINE, undefined, VOICE); spoke = true; } } catch (e) {}
    try { var n = w && w.navigator; if (n && typeof n.vibrate === "function") { n.vibrate([120, 80, 120]); buzzed = true; } } catch (e) {}
    return { line: POCKET_LINE, spoke: spoke, buzzed: buzzed };
  }
  // Spoken once when a One long set first reaches the TUT target (ZabbadatSession.TUT_DONE,
  // currently 1:20 / 80 s and 10 push-ups). Announcement only: the clock and set keep running.
  // "TUT" is left as written; existing cues never say the word, and PRONOUNCE has no TUT entry,
  // so the phone TTS pronounces it the same way it would any other unmapped word.
  var TUT_EXECUTED_LINE = "TUT set, TUT set executed.";
  function speakTutExecuted() {
    try {
      var unprotect = protectSpeech();
      function done() { try { unprotect(); } catch (e) {} }
      if (isSpeaking() || speechQueued > 0) {
        return waitSpeechIdle(2000).then(function () { return enqueueSpeak(TUT_EXECUTED_LINE); }).then(done, done);
      }
      return enqueueSpeak(TUT_EXECUTED_LINE).then(done, done);
    } catch (e) { /* on-screen only */ }
  }
  var api = { say: say, PRONOUNCE: PRONOUNCE, speakAndWait: speakAndWait, enqueueSpeak: enqueueSpeak, waitSpeechIdle: waitSpeechIdle, protectSpeech: protectSpeech, CAMERA_ON: CAMERA_ON, FACE_COVERED: FACE_COVERED, CAMERA_GUIDE: CAMERA_GUIDE, cameraOnLine: cameraOnLine, withCameraOn: withCameraOn, watchCameraVoice: watchCameraVoice, POCKET_LINE: POCKET_LINE, pocketCue: pocketCue, VOICE: VOICE, plankSpeak: plankSpeak, PLANK_VOICE: PLANK_VOICE, PLANK_STEP_MS: PLANK_STEP_MS, makeQuickCountdown: makeQuickCountdown, makeNextSetCountdown: makeNextSetCountdown, NEXT_SET_LINE: NEXT_SET_LINE, NEXT_LEAD_MS: NEXT_LEAD_MS, NEXT_STEPS: NEXT_STEPS, NEXT_COUNT_MS: NEXT_COUNT_MS, NEXT_TOTAL_MS: NEXT_TOTAL_MS, QUICK_STEPS: QUICK_STEPS, QUICK_MS: QUICK_MS, makeSessionTracker: makeSessionTracker, SESSION_IDLE_MS: SESSION_IDLE_MS, makeSharedCountdownVoice: makeSharedCountdownVoice, BATTLE_WORDS: BATTLE_WORDS, COACH: COACH, coachLines: coachLines, PLANK_SIDE_LINE: PLANK_SIDE_LINE, isPortrait: isPortrait, makePlankSidePrompt: makePlankSidePrompt, STEPS: STEPS, COUNTDOWN_MS: COUNTDOWN_MS, interruptSpeak: interruptSpeak, isSpeaking: isSpeaking, SET_DONE_LINE: "Set complete.", PLANK_SET_DONE_LINE: "Set complete", PLANK_TIME_EVERY_MS: PLANK_TIME_EVERY_MS, plankTimeCallout: plankTimeCallout, makePlankTimeVoice: makePlankTimeVoice, TUT_EXECUTED_LINE: TUT_EXECUTED_LINE, speakTutExecuted: speakTutExecuted, TUT_FAIL_LINE: "Set complete.", sayAndWait: sayAndWait, POSITION_SPOKEN: POSITION_SPOKEN, holdCallout: holdCallout, makeHoldVoice: makeHoldVoice, HOLD_EVERY_MS: HOLD_EVERY_MS, repCallout: repCallout, makeRepVoice: makeRepVoice, POSITION: POSITION, positionPrompt: positionPrompt, READY: READY, makeGetSet: makeGetSet, makeGoCountdown: makeGoCountdown, PLANK_STEPS: PLANK_STEPS, PLANK_SET_LINE: PLANK_SET_LINE, PLANK_COUNT_MS: PLANK_COUNT_MS, makeBattleVoice: makeBattleVoice };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.ZabbadatGetSet = api;
    try { if (root.document) watchCameraVoice(root.document); } catch (e) {}
  }
})(this);
