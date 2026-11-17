/* Gyatt Squats voice cadence: ONE short cue at the start of each phase, nothing in between.
 *
 * One rep = 14 s, looping until stop() / complete() (or opts.maxReps reps):
 *   DOWN  4 s  t=0    "Down"                                         (lowering into the squat)
 *   HOLD  4 s  t=4    "Hold. Focus on squeezing with your glutes."   (bottom hold; ~2.6 s spoken, ends before Up)
 *   UP    4 s  t=8    "Up"                                           (rising)
 *   TOP   2 s  t=12   "Squeeze your glutes at the top."              (~1.6 s spoken, then the next Down)
 *   rep 2 starts at t=14 ("Down"), rep 3 at t=28, ...
 * Seconds are never counted aloud and rep numbers are never spoken (reps are on screen only). The module still ticks
 * once a second (silently) so a screen can show the phase and a 1-4 progress.
 *
 * Timing: every tick k has a fixed target  t0 + k*1000  on a monotonic clock (performance.now). Each timer is armed
 * for (target - now), so setTimeout lateness never accumulates (no drift). A cue whose timer fires more than lateMs
 * (250) after its target is shown but NOT spoken (the voice never lags behind the movement). Speech: the site voice
 * (phone default TTS, rate 0.88, speechSynthesis.resume()); a cue cuts off anything still speaking instead of queueing.
 *
 * Coaching lines (coach(text)) never talk over a cue: while the cadence runs, a line is spoken only inside the quiet
 * gap after a cue (>= 800 ms after it, and only if it ends >= 300 ms before the next cue, by a words-based length
 * estimate). Otherwise it waits for the next gap (one waiting line, the newest wins) and is dropped if it is still
 * waiting after 5 s or can never fit. "After a cue" means after the cue's own spoken length (CUE_MS) + 200 ms, so the
 * long Hold and Top cues leave no gap and coaching only lands after "Down" or "Up". A cue that comes due always wins: it cuts a coaching line still speaking.
 *
 * API:
 *   var c = GyattCadence.makeCadence({ onPhase, onRep, onStop, onOffPace, onCoach, maxReps, lateMs,
 *                                      now, schedule, clear, speak, stopSpeech, poseCheck });
 *   c.start()            begins at rep 1, "Down" immediately
 *   c.stop(reason)       halts timers, drops a waiting coaching line and cancels speech; onStop(state, reason)
 *   c.onPhase(fn)        fn(phase, sec, rep, info{ word: the cue on a phase's first second else null, spoken, label, atMs }) every second
 *   c.onRep(fn) / c.onStop(fn)
 *   c.coach(text)        -> "now" | "queued" | "dropped" | "idle" (not running: caller speaks it itself)
 *   c.resync(rep)        jump NOW to rep `rep`'s top beat (squeeze cue), then the next "Down" (counted rep finished early / late)
 *   c.complete(cb, rep)  set done: finish the top beat, say "Set complete.", stop the loop
 *   c.offBoundaryMs()    ms from now to the nearest rep boundary
 *   c.state()            { running, rep, phase, count, repsDone, elapsedMs, nextAtMs, spoken, skipped, coachSpoken, coachDropped }
 *   c.pose(sample)       pose-sync hook: with opts.poseCheck(sample, state) === false, onOffPace(state, sample) fires
 */
(function (root) {
  var PHASES = [
    { id: "down", label: "Down", secs: 4 },
    { id: "hold", label: "Hold", secs: 4 },
    { id: "up", label: "Up", secs: 4 },
    { id: "top", label: "Top", secs: 2 }   // short top beat: just long enough for the squeeze cue, then the next Down
  ];
  // The only lines the cadence ever says (no counting, no numbers).
  var CUES = { down: "Down", hold: "Hold. Focus on squeezing with your glutes.", up: "Up", top: "Squeeze your glutes at the top." };
  // Spoken length at the site rate 0.88 (offline neural TTS, en_US voice, length scale 1/0.88; whole clip incl. edges).
  // Hold 2.61 s ends ~1.4 s before Up; Top 1.58 s ends ~0.4 s before the next Down.
  var CUE_MS = { down: 570, hold: 2610, up: 510, top: 1580 };
  var SET_DONE_LINE = "Set complete.";
  var COACH_GAP_MS = 800, COACH_TAIL_MS = 300, COACH_STALE_MS = 5000;
  // rough length of a short line at rate 0.88 (phone TTS ~150 words/min at 1.0): 350 ms + 330 ms a word
  function estMs(text) { var n = String(text || "").trim().split(/\s+/).filter(Boolean).length; return 350 + 330 * n; }
  var STEP_MS = 1000;
  var REP_SECS = PHASES.reduce(function (a, p) { return a + p.secs; }, 0); // 14
  var TOP_K = REP_SECS - PHASES[PHASES.length - 1].secs;                     // 12: tick where the top beat starts
  var REP_MS = REP_SECS * STEP_MS;
  var LATE_MS = 250;
  var VOICE = { rate: 0.88 }; // same as get-set.js VOICE (site-wide voice) and the plank prompts

  // count index within a rep (0..11) -> { phase, count (1-based) }
  var SLOTS = [];
  PHASES.forEach(function (p) { for (var i = 1; i <= p.secs; i++) SLOTS.push({ phase: p.id, label: p.label, count: i }); });

  function g() { return typeof window !== "undefined" ? window : root; }
  function nowDefault() { var w = g(); return w && w.performance && typeof w.performance.now === "function" ? w.performance.now() : Date.now(); }
  function speakDefault(text) {
    try {
      var w = g(); if (!w || !w.speechSynthesis || typeof w.SpeechSynthesisUtterance !== "function") return;
      var ss = w.speechSynthesis;
      try { if (typeof ss.resume === "function") ss.resume(); } catch (e) {}
      if (ss.speaking || ss.pending) ss.cancel(); // never queue: the previous count is cut, not lagged behind
      var u = new w.SpeechSynthesisUtterance(text); u.rate = VOICE.rate;
      ss.speak(u);
    } catch (e) { /* on-screen only */ }
  }
  function stopSpeechDefault() { try { var w = g(); if (w && w.speechSynthesis) w.speechSynthesis.cancel(); } catch (e) {} }

  function slotAt(k) {
    var s = SLOTS[k % REP_SECS];
    return { phase: s.phase, label: s.label, count: s.count, rep: Math.floor(k / REP_SECS) + 1 };
  }
  function wordFor(slot) { return slot.count === 1 ? CUES[slot.phase] : null; }

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
      if (estMs(text) + COACH_GAP_MS + COACH_TAIL_MS > PHASES[0].secs * STEP_MS) { coachDropped++; emit(L.coach, [text, "dropped", "too long"]); return "dropped"; }
      if (fits(text) && !pending) { sayCoach(text); return "now"; }
      if (pending) { coachDropped++; emit(L.coach, [pending.text, "dropped", "replaced"]); }
      pending = { text: text, at: now() }; emit(L.coach, [text, "queued"]);
      return "queued";
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
        var say = !!word && k === due && late <= lateMs; // a phase start, current and on time
        cur = s;
        if (say) { sayIt(word); spoken++; lastCueEnd = t0 + atMs + Math.max(COACH_GAP_MS, (CUE_MS[s.phase] || 600) + 200); afterCue(); } else if (word) skipped++;
        emit(L.phase, [s.phase, s.count, s.rep, { k: k, atMs: atMs, firedMs: t, lateMs: late, word: word, spoken: say, label: s.label }]);
      }
      if (running) arm();
    }
    var api = {
      start: function () {
        if (running) return api;
        running = true; gen++; t0 = now(); next = 0; cur = null; repsDone = 0; spoken = 0; skipped = 0; repBase = 0;
        pending = null; coachSpoken = 0; coachDropped = 0; lastCueEnd = -1e9; completing = null;
        tick(); // "Down" (rep 1) right away
        return api;
      },
      stop: function (reason) { finish(reason || "stop"); return api; },
      coach: coach,
      // resync(rep): a counted rep finished away from the cycle (user faster / slower than the voice): jump to rep
      // `rep`'s top beat NOW (squeeze cue), then the next "Down" 2 s later.
      resync: function (rep) {
        if (!running) return api;
        if (timer != null) { try { clear(timer); } catch (e) {} timer = null; }
        if (coachTimer != null) { try { clear(coachTimer); } catch (e) {} coachTimer = null; }
        gen++; t0 = now() - TOP_K * STEP_MS; next = TOP_K;
        repBase = Math.max(0, Math.floor(Number(rep) || 1) - 1); repsDone = Math.min(repsDone, repBase);
        tick();
        return api;
      },
      // complete(cb): the set is done (tenth counted rep). Finish this rep's top beat (jump to it now if the cycle is still
      // in Down / Hold), then say "Set complete." and stop the loop (onStop reason "complete"). No numbers are spoken.
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

  var api = { makeCadence: makeCadence, sequence: sequence, PHASES: PHASES, CUES: CUES, CUE_MS: CUE_MS, SET_DONE_LINE: SET_DONE_LINE, REP_SECS: REP_SECS, TOP_K: TOP_K, estMs: estMs, COACH_GAP_MS: COACH_GAP_MS, STEP_MS: STEP_MS, REP_MS: REP_MS, LATE_MS: LATE_MS, VOICE: VOICE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GyattCadence = api;
})(this);
