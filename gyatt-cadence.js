/* Gyatt Squats spoken cadence timer (self-contained; the future Gyatt Squats tile's camera / video section will use it).
 *
 * One rep = 12 s, one spoken count per second, aligned to the phase starts:
 *   DOWN  3 s  t=0,1,2    "one","two","three"                 (lowering into the squat)
 *   HOLD  4 s  t=3..6     "one","two","three","four"          (hold at the bottom)
 *   UP    5 s  t=7..11    "one","two","three","four","five"   (rising)
 *   rep 2 starts at t=12, rep 3 at t=24, ... and repeats until stop() (or opts.maxReps reps are complete).
 * Counts are the spoken words. The phase name (Down / Hold / Up) is shown on screen, not spoken, by default:
 * at rate 0.88 "Down, one" runs ~0.9 s and would crowd the 1 s slot. opts.phaseCue = true says the phase word INSTEAD
 * of "one" on each phase's first count ("Down", "two", "three", "Hold", "two", ...), which still fits one word per second.
 *
 * Timing: every count k has a fixed target  t0 + k*1000  on a monotonic clock (performance.now). Each timer is armed
 * for (target - now), so setTimeout lateness never accumulates (no drift). A count whose timer fires more than
 * lateMs (250) after its target is still emitted for the UI (late: true) but NOT spoken, and counts that were missed
 * entirely (throttled tab) are emitted as skipped and never spoken, so the voice never lags behind the movement.
 * Speech uses the site voice (phone default TTS, rate 0.88, speechSynthesis.resume()); a word still speaking
 * when the next count is due is cancelled rather than queued behind.
 *
 * API:
 *   var c = GyattCadence.makeCadence({ onPhase, onRep, onStop, onOffPace, maxReps, phaseCue, lateMs,
 *                                      now, schedule, clear, speak, stopSpeech, poseCheck });
 *   c.start()            begins at rep 1, DOWN "one" immediately (call inside the tap on iOS: it unlocks speech)
 *   c.stop(reason)       halts timers and cancels speech; onStop(state, reason)
 *   c.onPhase(fn) / c.onRep(fn) / c.onStop(fn)   add listeners: fn(phase, count, rep, info) / fn(rep, info) / fn(state, reason)
 *   c.state()            { running, rep, phase, count, repsDone, elapsedMs, nextAtMs, spoken, skipped }
 *   c.pose(sample)       FUTURE pose-sync hook: pass any pose sample; if opts.poseCheck(sample, state) returns false
 *                        (user's movement out of phase) onOffPace(state, sample) fires. No pose logic is built here.
 */
(function (root) {
  var PHASES = [
    { id: "down", label: "Down", secs: 3 },
    { id: "hold", label: "Hold", secs: 4 },
    { id: "up", label: "Up", secs: 5 }
  ];
  var WORDS = ["one", "two", "three", "four", "five"];
  var STEP_MS = 1000;
  var REP_SECS = 12;
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
  function wordFor(slot, phaseCue) { return phaseCue && slot.count === 1 ? slot.label : WORDS[slot.count - 1]; }

  // Full expected schedule for n reps (used by tests and the video check): [{ k, atMs, rep, phase, count, word }]
  function sequence(reps, phaseCue) {
    var out = [];
    for (var k = 0; k < reps * REP_SECS; k++) { var s = slotAt(k); out.push({ k: k, atMs: k * STEP_MS, rep: s.rep, phase: s.phase, count: s.count, word: wordFor(s, phaseCue) }); }
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
    var phaseCue = !!opts.phaseCue;
    var L = { phase: [], rep: [], stop: [], offPace: [] };
    if (opts.onPhase) L.phase.push(opts.onPhase);
    if (opts.onRep) L.rep.push(opts.onRep);
    if (opts.onStop) L.stop.push(opts.onStop);
    if (opts.onOffPace) L.offPace.push(opts.onOffPace);
    var running = false, t0 = 0, next = 0, timer = null, gen = 0, cur = null, repsDone = 0, spoken = 0, skipped = 0;

    function emit(list, args) { list.forEach(function (f) { try { f.apply(null, args); } catch (e) {} }); }
    function sayIt(w) { try { speak(w); } catch (e) {} }
    function state() {
      return { running: running, rep: cur ? cur.rep : 0, phase: cur ? cur.phase : null, count: cur ? cur.count : 0, repsDone: repsDone,
        elapsedMs: running ? now() - t0 : 0, nextAtMs: running ? next * STEP_MS : null, spoken: spoken, skipped: skipped };
    }
    function finish(reason) {
      if (!running) return;
      running = false; gen++;
      if (timer != null) { try { clear(timer); } catch (e) {} timer = null; }
      try { stopSpeech(); } catch (e) {}
      emit(L.stop, [state(), reason || "stop"]);
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
          repsDone = k / REP_SECS;
          emit(L.rep, [repsDone, { atMs: atMs, firedMs: t }]);
          if (maxReps && repsDone >= maxReps) { finish("maxReps"); return; }
          if (!running) return;
        }
        var s = slotAt(k), late = t - atMs, word = wordFor(s, phaseCue);
        var say = k === due && late <= lateMs; // only the current count, and only if on time
        cur = s;
        if (say) { sayIt(word); spoken++; } else skipped++;
        emit(L.phase, [s.phase, s.count, s.rep, { k: k, atMs: atMs, firedMs: t, lateMs: late, word: word, spoken: say, label: s.label }]);
      }
      if (running) arm();
    }
    var api = {
      start: function () {
        if (running) return api;
        running = true; gen++; t0 = now(); next = 0; cur = null; repsDone = 0; spoken = 0; skipped = 0;
        tick(); // count 0 ("one", DOWN, rep 1) right away, inside the caller's tap
        return api;
      },
      stop: function (reason) { finish(reason || "stop"); return api; },
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

  var api = { makeCadence: makeCadence, sequence: sequence, PHASES: PHASES, WORDS: WORDS, STEP_MS: STEP_MS, REP_MS: REP_MS, LATE_MS: LATE_MS, VOICE: VOICE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GyattCadence = api;
})(this);
