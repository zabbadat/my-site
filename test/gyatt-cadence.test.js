// Gyatt Squats spoken cadence: exact sequence + timestamps on a fake monotonic clock, no drift, late counts skipped, stop halts speech.
const C = require("../gyatt-cadence.js");
let pass = 0, fail = 0;
const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !why ? "" : " :: " + why}`); ok ? pass++ : fail++; };

// fake clock + timer queue; `jitter(i)` adds lateness (ms) to the i-th timer to mimic a busy main thread
function fakeEnv(jitter) {
  let t = 1000.5, id = 0, q = [], fired = 0;
  const env = {
    now: () => t,
    schedule: (f, d) => { const my = ++id; q.push({ id: my, at: t + d + (jitter ? jitter(fired++) : 0), f }); return my; },
    clear: (i) => { q = q.filter((x) => x.id !== i); },
    advance: (ms) => { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const x = q[0]; if (!x || x.at > end) break; q.shift(); t = Math.max(t, x.at); x.f(); } t = end; },
    pending: () => q.length,
    spoken: [], stops: 0
  };
  env.speak = (w) => env.spoken.push({ w, at: t });
  env.stopSpeech = () => env.stops++;
  return env;
}
function run(opts, ms, jitter) {
  const env = fakeEnv(jitter), ev = [], reps = [], stops = [];
  const c = C.makeCadence(Object.assign({ now: env.now, schedule: env.schedule, clear: env.clear, speak: env.speak, stopSpeech: env.stopSpeech,
    onPhase: (p, n, r, i) => ev.push({ p, n, r, at: i.atMs, fired: i.firedMs, spoken: i.spoken, word: i.word }),
    onRep: (r, i) => reps.push({ r, at: i.atMs }), onStop: (s, why) => stops.push(why) }, opts));
  const t0 = env.now(); c.start(); env.advance(ms);
  return { env, ev, reps, stops, c, t0 };
}

// 1. exact sequence, 3 reps
const { env, ev, reps, c, t0 } = run({}, 36000 - 1);
const exp = C.sequence(3);
check("3 reps = 36 counts", ev.length === 36, ev.length);
check("rep 1: DOWN 1,2,3 at 0,1,2 s; HOLD 1-4 at 3-6 s; UP 1-5 at 7-11 s",
  JSON.stringify(ev.slice(0, 12).map((e) => [e.p, e.n, e.at])) === JSON.stringify([["down",1,0],["down",2,1000],["down",3,2000],["hold",1,3000],["hold",2,4000],["hold",3,5000],["hold",4,6000],["up",1,7000],["up",2,8000],["up",3,9000],["up",4,10000],["up",5,11000]]));
check("rep 2 starts DOWN 1 at 12 s, rep 3 at 24 s", ev[12].r === 2 && ev[12].p === "down" && ev[12].n === 1 && ev[12].at === 12000 && ev[24].r === 3 && ev[24].at === 24000);
check("every event matches the expected schedule (phase, count, rep, target)", ev.every((e, i) => e.p === exp[i].phase && e.n === exp[i].count && e.r === exp[i].rep && e.at === exp[i].atMs));
check("fake-clock fire times equal targets exactly", ev.every((e) => Math.abs(e.fired - e.at) < 1e-6));
const words = env.spoken.map((s) => s.w);
const W1 = ["one","two","three","one","two","three","four","one","two","three","four","five"];
check("spoken words per rep: one two three / one two three four / one two three four five", JSON.stringify(words) === JSON.stringify(W1.concat(W1, W1)), words.join(" "));
check("each word spoken at its target second", env.spoken.every((s, i) => Math.abs(s.at - t0 - i * 1000) < 1e-6));
check("onRep(1) at 12 s, onRep(2) at 24 s (rep 3 not complete before 36 s)", JSON.stringify(reps) === JSON.stringify([{ r: 1, at: 12000 }, { r: 2, at: 24000 }]));
const st = c.state();
check("state(): running, rep 3, UP 5, 2 reps done", st.running && st.rep === 3 && st.phase === "up" && st.count === 5 && st.repsDone === 2 && st.spoken === 36 && st.skipped === 0);
check("rep length constant is 12 s", C.REP_MS === 12000 && C.PHASES.map((p) => p.secs).join() === "3,4,5");

// 2. no drift over 10 reps with jitter (each timer 0-40 ms late)
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const j = run({}, 120000 + 500, () => rnd() * 40);
const lates = j.ev.map((e) => e.fired - e.at);
check("10 reps with 0-40 ms timer jitter: 120 counts + rep 11 start", j.ev.length === 121 && j.reps.length === 10, j.ev.length + "/" + j.reps.length);
check("no drift: every count fires within 40 ms of its own target (max " + Math.max(...lates).toFixed(1) + " ms), last count no later than first", lates.every((x) => x >= 0 && x <= 40) && lates[120] <= 40);
check("no drift: targets stay on the 1 s grid (count 120 target = 120000 ms)", j.ev[120].at === 120000 && j.ev.every((e, i) => e.at === i * 1000));
check("all 121 counts spoken under normal jitter", j.env.spoken.length === 121);

// 3. a late timer: count emitted for the UI but not spoken; missed counts skipped, never queued
const late = run({}, 6500, (i) => (i === 0 ? 2300 : 0)); // the timer for t=1 fires at 3.3 s
const lw = late.ev.map((e) => `${e.p}${e.n}:${e.spoken ? "S" : "-"}`).join(" ");
check("a 2.3 s stall: missed counts (1 s, 2 s) and the 300 ms-late 3 s count are shown but not spoken", lw === "down1:S down2:- down3:- hold1:- hold2:S hold3:S hold4:S", lw);
check("after the stall the next count is back on its target (4 s) and spoken", late.ev.find((e) => e.at === 4000 && e.spoken && Math.abs(e.fired - 4000) < 1e-6));
check("no backlog: spoken words never exceed elapsed seconds", late.env.spoken.length <= 7);

// 4. stop() halts speech and timers
const s = run({}, 5200);
s.c.stop();
const before = s.env.spoken.length; s.env.advance(30000);
check("stop() cancels speech (stopSpeech called) and fires onStop('stop')", s.env.stops === 1 && s.stops.join() === "stop");
check("stop(): no more counts or words after stop, no timers pending", s.env.spoken.length === before && s.ev.length === 6 && s.env.pending() === 0);
check("stop(): state not running", s.c.state().running === false);
s.c.start(); s.env.advance(1500);
check("restart after stop begins again at rep 1 DOWN 1", s.ev[6].r === 1 && s.ev[6].p === "down" && s.ev[6].n === 1 && s.ev[7].n === 2);

// 5. maxReps ends the set at the rep boundary
const m = run({ maxReps: 2 }, 40000);
check("maxReps 2: 24 counts, onRep 1 and 2, stops at 24 s with reason maxReps", m.ev.length === 24 && m.reps.length === 2 && m.stops.join() === "maxReps" && m.env.stops === 1);

// 6. optional phase cue replaces "one" with the phase word
const q = run({ phaseCue: true }, 12000 - 1);
check("phaseCue: Down two three / Hold two three four / Up two three four five", q.env.spoken.map((x) => x.w).join(" ") === "Down two three Hold two three four Up two three four five");

// 7. pose-sync hook (no pose logic): poseCheck false -> onOffPace with current state
let off = [];
const p = run({ poseCheck: (sample, st) => sample.phase === st.phase, onOffPace: (st, sample) => off.push([st.phase, sample.phase]) }, 3500);
const r1 = p.c.pose({ phase: "hold" }), r2 = p.c.pose({ phase: "down" });
check("pose hook: in-phase sample ok, out-of-phase sample fires onOffPace", r1 === true && r2 === false && JSON.stringify(off) === JSON.stringify([["hold", "down"]]));
check("pose hook is inert without poseCheck", run({}, 100).c.pose({}) === null);

// 7b. resync(rep): restart the cycle now at DOWN one of that rep
const rs = run({}, 5500);
rs.c.resync(4); rs.env.advance(1000);
const after = rs.ev.slice(6);
check("resync(4) at 5.5 s: DOWN 1 of rep 4 at once, DOWN 2 one second later", after.length >= 2 && after[0].r === 4 && after[0].p === "down" && after[0].n === 1 && after[1].n === 2 && Math.abs(after[1].fired - after[0].fired - 1000) < 1e-6);
check("resync: spoken 'one' right away", rs.env.spoken[6].w === "one" && rs.env.spoken[7].w === "two");
check("offBoundaryMs: 1 s after a resync = 1000", rs.c.offBoundaryMs() === 1000);
rs.env.advance(11000);
check("resync: next cycle is rep 5 at +12 s", rs.ev.find((e) => e.r === 5 && e.p === "down" && e.n === 1) && rs.reps[rs.reps.length - 1].r === 4);

// 8. default voice: rate 0.88, resume() called, cancels instead of queueing
const calls = []; global.window = { performance: { now: () => 0 }, SpeechSynthesisUtterance: function (t) { this.text = t; },
  speechSynthesis: { speaking: true, pending: false, resume: () => calls.push("resume"), cancel: () => calls.push("cancel"), speak: (u) => calls.push("speak:" + u.text + "@" + u.rate) } };
delete require.cache[require.resolve("../gyatt-cadence.js")];
const C2 = require("../gyatt-cadence.js");
const ids = []; const c2 = C2.makeCadence({ now: () => 0, schedule: (f) => { ids.push(f); return ids.length; }, clear: () => {} });
c2.start();
check("default speech: resume, cancel the still-speaking word, speak 'one' at rate 0.88", calls.join() === "resume,cancel,speak:one@0.88", calls.join());
c2.stop(); check("default stop cancels speechSynthesis", calls[calls.length - 1] === "cancel");
delete global.window;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
