/* Gyatt Squats voice cadence: a four-count at 1 s per beat in every phase (owner, Nov 17).
 *
 * One rep = 16 s, looping until stop() / complete() (or opts.maxReps reps):
 *   DOWN     4 s  t=0    "Down, one" · "two" · "three" · "four"
 *   HOLD     4 s  t=4    "Hold, one" · "two" · "three" · "four"
 *   UP       4 s  t=8    "Up, one" · "two" · "three" · "four"
 *   SQUEEZE  4 s  t=12   "Squeeze, one" · "two" · "three" · "four"
 *   rep 2 starts at t=16 ("Down, one"), rep 3 at t=32, ...
 * The phase word and "one" share beat one so each phase is exactly 4 s. Rep numbers are never spoken
 * (reps stay on screen only). This replaces the Nov 16 short-cue / no-per-second-count rule.
 * Squeeze was previously a 2 s top beat; the four-count needs 4 s, so a rep is 16 s (was 14 s).
 *
 * Timing: every tick k has a fixed target  t0 + k*1000  on a monotonic clock (performance.now). Each timer is armed
 * for (target - now), so setTimeout lateness never accumulates (no drift). Every beat is spoken (a late timer still
 * enqueues the word; the serial voice catches up). Speech: the site voice (phone default TTS, rate 0.88) through
 * get-set.js enqueueSpeak / speakAndWait (onend + timed fallback) so iOS never drops a count queued while the
 * previous beat is still speaking. Beats are never cancelled by a later count. Pronunciation map (Gyatt -> Gyot) applies.
 *
 * Coaching lines never talk over the four-count: while the cadence is running there is no quiet gap, so coach()
 * returns "dropped". When it is not running, coach() returns "idle" and the caller speaks the line itself.
 *
 * API:
 *   var c = GyattCadence.makeCadence({ onPhase, onRep, onStop, onOffPace, onCoach, maxReps, lateMs,
 *                                      now, schedule, clear, speak, stopSpeech, poseCheck });
 *   c.start()            begins at rep 1, "Down, one" immediately
 *   c.stop(reason)       halts timers, drops a waiting coaching line and cancels speech; onStop(state, reason)
 *   c.onPhase(fn)        fn(phase, sec, rep, info{ word: the spoken beat, spoken, label, atMs }) every second
 *   c.onRep(fn) / c.onStop(fn)
 *   c.coach(text)        -> "dropped" while running, "idle" when not (caller speaks it itself)
 *   c.resync(rep)        jump NOW to rep `rep`'s squeeze beat, then the next "Down" 4 s later (counted rep finished early / late)
 *   c.complete(cb, rep)  set done: finish this rep's squeeze four-count, say "Set complete.", stop the loop
 *   c.offBoundaryMs()    ms from now to the nearest rep boundary
 *   c.state()            { running, rep, phase, count, repsDone, elapsedMs, nextAtMs, spoken, skipped, coachSpoken, coachDropped }
 *   c.pose(sample)       pose-sync hook: with opts.poseCheck(sample, state) === false, onOffPace(state, sample) fires
 */
(function (root) {
  var PHASES = [
    { id: "down", label: "Down", secs: 4 },
    { id: "hold", label: "Hold", secs: 4 },
    { id: "up", label: "Up", secs: 4 },
    { id: "top", label: "Squeeze", secs: 4 }  // was 2 s with a single squeeze cue; four-count needs 4 s
  ];
  // Phase word on beat one (then "one"); counts two / three / four follow at 1 s steps. Never a rep number.
  var PHASE_WORD = { down: "Down", hold: "Hold", up: "Up", top: "Squeeze" };
  var BEATS = ["one", "two", "three", "four"];
  var CUES = { down: "Down, one", hold: "Hold, one", up: "Up, one", top: "Squeeze, one" };
  // Spoken length at the site rate 0.88 for the beat-one line ("Down, one", ...).
  var CUE_MS = { down: 900, hold: 900, up: 800, top: 1000 };
  var SET_DONE_LINE = "Set complete.";
  var COACH_GAP_MS = 800, COACH_TAIL_MS = 300, COACH_STALE_MS = 5000;
  // rough length of a short line at rate 0.88 (phone TTS ~150 words/min at 1.0): 350 ms + 330 ms a word
  function estMs(text) { var n = String(text || "").trim().split(/\s+/).filter(Boolean).length; return 350 + 330 * n; }
  var STEP_MS = 1000;
  var REP_SECS = PHASES.reduce(function (a, p) { return a + p.secs; }, 0); // 16
  var TOP_K = REP_SECS - PHASES[PHASES.length - 1].secs;                     // 12: tick where the squeeze beat starts
  var REP_MS = REP_SECS * STEP_MS;
  var LATE_MS = 250;
  var VOICE = { rate: 0.88 }; // same as get-set.js VOICE (site-wide voice) and the plank prompts

  // count index within a rep (0..15) -> { phase, count (1-based) }
  var SLOTS = [];
  PHASES.forEach(function (p) { for (var i = 1; i <= p.secs; i++) SLOTS.push({ phase: p.id, label: p.label, count: i }); });

  function g() { return typeof window !== "undefined" ? window : root; }
  function nowDefault() { var w = g(); return w && w.performance && typeof w.performance.now === "function" ? w.performance.now() : Date.now(); }
  // Same pronunciation map as get-set.js say() so a Gyatt line is spoken "Gyot" even when this
  // module speaks through its own speechSynthesis path (and so the Android TTS bridge, which
  // receives utterance.text, hears it too). Prefer the shared helper when the page has loaded it.
  function say(text) {
    try { var w = g(), GS = w && w.ZabbadatGetSet; if (GS && typeof GS.say === "function") return GS.say(text); } catch (e) {}
    return String(text == null ? "" : text).replace(/\bZAB\b/g, "Zab").replace(/Gyatt/gi, "Gyot");
  }
  function speakDefault(text) {
    try {
      var w = g();
      var GS = w && w.ZabbadatGetSet;
      // Page path: serial enqueueSpeak (onend + timed fallback) so iOS never drops a count
      // queued while the previous beat is still speaking. Do not cancel a beat already in flight.
      if (GS && typeof GS.enqueueSpeak === "function") { GS.enqueueSpeak(text); return; }
      if (!w || !w.speechSynthesis || typeof w.SpeechSynthesisUtterance !== "function") return;
      var ss = w.speechSynthesis;
      try { if (typeof ss.resume === "function") ss.resume(); } catch (e) {}
      var u = new w.SpeechSynthesisUtterance(say(text)); u.rate = VOICE.rate;
      ss.speak(u);
    } catch (e) { /* on-screen only */ }
  }
  function stopSpeechDefault() { try { var w = g(); if (w && w.speechSynthesis) w.speechSynthesis.cancel(); } catch (e) {} }

  function slotAt(k) {
    var s = SLOTS[k % REP_SECS];
    return { phase: s.phase, label: s.label, count: s.count, rep: Math.floor(k / REP_SECS) + 1 };
  }
  function wordFor(slot) {
    var beat = BEATS[slot.count - 1];
    if (!beat) return null;
    if (slot.count === 1) return (PHASE_WORD[slot.phase] || slot.label) + ", " + beat;
    return beat;
  }

  // Expected cue schedule for n reps (tests and the video check): [{ atMs, rep, phase, word }] - spoken cues only
  function sequence(reps) {
    var out = [];
    for (var k = 0; k < reps * REP_SECS; k++) { var s = slotAt(k), w = wordFor(s); if (w) out.push({ k: k, atMs: k * STEP_MS, rep: s.rep, phase: s.phase, word: w }); }
    return out;
  }

  function makeCadence(opts) {
    opts = opts || {};
    var now = opts.now || nowDefault;
    var schedule = opts.schedule || function (f, d) { return setTimeout(f, d); };
    var clear = opts.clear || function (id) { clearTimeout(id); };
    var speak = opts.speak || speakDefault;
    var stopSpeech = opts.stopSpeech || stopSpeechDefault;
    var lateMs = opts.lateMs != null ? opts.lateMs : LATE_MS;
    var maxReps = opts.maxReps || 0;
    var L = { phase: [], rep: [], stop: [], offPace: [], coach: [] };
    if (opts.onCoach) L.coach.push(opts.onCoach);
    if (opts.onPhase) L.phase.push(opts.onPhase);
    if (opts.onRep) L.rep.push(opts.onRep);
    if (opts.onStop) L.stop.push(opts.onStop);
    if (opts.onOffPace) L.offPace.push(opts.onOffPace);
    var running = false, t0 = 0, next = 0, timer = null, gen = 0, cur = null, repsDone = 0, spoken = 0, skipped = 0, repBase = 0;
    var pending = null, coachTimer = null, coachSpoken = 0, coachDropped = 0, lastCueEnd = -1e9, completing = null;

    function emit(list, args) { list.forEach(function (f) { try { f.apply(null, args); } catch (e) {} }); }
    function sayIt(w) { try { speak(w); } catch (e) {} }
    function state() {
      return { running: running, rep: cur ? cur.rep : 0, phase: cur ? cur.phase : null, count: cur ? cur.count : 0, repsDone: repsDone,
        elapsedMs: running ? now() - t0 : 0, nextAtMs: running ? next * STEP_MS : null, spoken: spoken, skipped: skipped, coachSpoken: coachSpoken, coachDropped: coachDropped };
    }
    function finish(reason) {
      if (!running) return;
      running = false; gen++;
      if (timer != null) { try { clear(timer); } catch (e) {} timer = null; }
      dropPending("stopped");
      try { stopSpeech(); } catch (e) {}
      emit(L.stop, [state(), reason || "stop"]);
    }
    // ---- coaching lines: only in the quiet gap after a cue ----
    function nextCueAbs() { var k = Math.ceil(((now() - t0) / STEP_MS) - 1e-9); while (wordFor(slotAt(k)) == null) k++; return t0 + k * STEP_MS; }
    function fits(text) { var n = now(); return n >= lastCueEnd - 1e-6 && n + estMs(text) + COACH_TAIL_MS <= nextCueAbs() + 1e-6; }
    function dropPending(why) { if (coachTimer != null) { try { clear(coachTimer); } catch (e) {} coachTimer = null; } if (pending) { coachDropped++; emit(L.coach, [pending.text, "dropped", why]); } pending = null; }
    function sayCoach(text) { sayIt(text); coachSpoken++; emit(L.coach, [text, "now"]); }
    function tryPending() {
      coachTimer = null;
      if (!pending || !running) return;
      if (now() - pending.at > COACH_STALE_MS) return dropPending("stale");
      if (fits(pending.text)) { var t = pending.text; pending = null; sayCoach(t); }
    }
    function afterCue() { // a cue was just spoken: offer the waiting line the gap that follows
      if (!pending) return;
      if (coachTimer != null) { try { clear(coachTimer); } catch (e) {} }
      var my = gen; coachTimer = schedule(function () { if (my === gen) tryPending(); }, Math.max(0, lastCueEnd - now()));
    }
    function coach(text) {
      text = String(text || "").trim(); if (!text) return "dropped";
      if (!running) return "idle";
      // The four-count fills every second; never talk over it. On-screen coaching in squat-page.js still shows.
      coachDropped++; emit(L.coach, [text, "dropped", "counting"]);
      return "dropped";
    }
    function arm() {
      var my = gen, delay = Math.max(0, t0 + next * STEP_MS - now());
      timer = schedule(function () { if (my === gen && running) tick(); }, delay);
    }
    function tick() {
      timer = null;
      var t = now() - t0;
      var due = Math.floor(t / STEP_MS + 1e-9); // newest count whose target has passed
      while (running && next <= due) {
        var k = next++, atMs = k * STEP_MS;
        // a rep boundary: rep r completes the moment rep r+1's first count is due
        if (k > 0 && k % REP_SECS === 0) {
          repsDone = repBase + k / REP_SECS;
          emit(L.rep, [repsDone, { atMs: atMs, firedMs: t }]);
          if (completing) { var c0 = completing; completing = null; finish("complete"); sayIt(c0.text); try { c0.cb && c0.cb(); } catch (e) {} return; }
          if (maxReps && repsDone >= maxReps) { finish("maxReps"); return; }
          if (!running) return;
        }
        var s = slotAt(k), late = t - atMs, word = wordFor(s);
        s.rep += repBase;
        // Speak every beat (phase word + "one" together at count 1, then two / three / four). A late
        // timer still enqueues the word so iOS / a slow tick never drops a count; skipped stays for API compat.
        var said = !!word;
        cur = s;
        if (said) { sayIt(word); spoken++; lastCueEnd = t0 + atMs + Math.max(COACH_GAP_MS, (CUE_MS[s.phase] || 600) + 200); afterCue(); } else if (word) skipped++;
        emit(L.phase, [s.phase, s.count, s.rep, { k: k, atMs: atMs, firedMs: t, lateMs: late, word: word, spoken: said, label: s.label }]);
      }
      if (running) arm();
    }
    var api = {
      start: function () {
        if (running) return api;
        running = true; gen++; t0 = now(); next = 0; cur = null; repsDone = 0; spoken = 0; skipped = 0; repBase = 0;
        pending = null; coachSpoken = 0; coachDropped = 0; lastCueEnd = -1e9; completing = null;
        tick(); // "Down, one" (rep 1) right away
        return api;
      },
      stop: function (reason) { finish(reason || "stop"); return api; },
      coach: coach,
      // resync(rep): a counted rep finished away from the cycle (user faster / slower than the voice): jump to rep
      // `rep`'s squeeze beat NOW ("Squeeze, one"), then the next "Down, one" 4 s later.
      resync: function (rep) {
        if (!running) return api;
        if (timer != null) { try { clear(timer); } catch (e) {} timer = null; }
        if (coachTimer != null) { try { clear(coachTimer); } catch (e) {} coachTimer = null; }
        gen++; t0 = now() - TOP_K * STEP_MS; next = TOP_K;
        repBase = Math.max(0, Math.floor(Number(rep) || 1) - 1); repsDone = Math.min(repsDone, repBase);
        tick();
        return api;
      },
      // complete(cb): the set is done (tenth counted rep). Finish this rep's squeeze four-count (jump to it now if the cycle is still
      // in Down / Hold), then say "Set complete." and stop the loop (onStop reason "complete"). No rep numbers are spoken.
      complete: function (cb, rep) {
        if (!running) { sayIt(SET_DONE_LINE); try { cb && cb(); } catch (e) {} return api; }
        completing = { text: SET_DONE_LINE, cb: cb };
        if (cur && (cur.phase === "down" || cur.phase === "hold")) api.resync(rep || cur.rep);
        return api;
      },
      // ms from now to the nearest cadence rep boundary (0 = exactly on one); null when stopped
      offBoundaryMs: function () { if (!running) return null; var e = (now() - t0) % REP_MS; return Math.min(e, REP_MS - e); },
      onPhase: function (f) { L.phase.push(f); return api; },
      onRep: function (f) { L.rep.push(f); return api; },
      onStop: function (f) { L.stop.push(f); return api; },
      onOffPace: function (f) { L.offPace.push(f); return api; },
      state: state,
      // Future pose-sync hook (not built): the tile's pose loop can call pose(sample) every frame. With opts.poseCheck
      // supplied, a false result means the user's actual movement is out of phase with the cadence -> onOffPace.
      pose: function (sample) {
        if (!running || typeof opts.poseCheck !== "function") return null;
        var st = state(), ok;
        try { ok = opts.poseCheck(sample, st); } catch (e) { return null; }
        if (ok === false) emit(L.offPace, [st, sample]);
        return ok;
      }
    };
    return api;
  }

  var api = { say: say, makeCadence: makeCadence, sequence: sequence, PHASES: PHASES, PHASE_WORD: PHASE_WORD, BEATS: BEATS, CUES: CUES, CUE_MS: CUE_MS, SET_DONE_LINE: SET_DONE_LINE, REP_SECS: REP_SECS, TOP_K: TOP_K, estMs: estMs, COACH_GAP_MS: COACH_GAP_MS, STEP_MS: STEP_MS, REP_MS: REP_MS, LATE_MS: LATE_MS, VOICE: VOICE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GyattCadence = api;
})(this);
