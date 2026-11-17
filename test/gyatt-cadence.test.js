// Gyatt Squats voice cadence: one cue per phase (Down 4 s, Hold 4 s, Up 4 s, Top 2 s = 14 s a rep), no counting, no
// numbers; exact cue times on a fake monotonic clock; no drift; coaching lines never overlap a cue; resync; complete; stop.
const C = require("../gyatt-cadence.js");
let pass = 0, fail = 0;
const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || why == null ? "" : " :: " + why}`); ok ? pass++ : fail++; };
const NUM = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third)\b|\d/i;
function fakeEnv(jitter) {
  let t = 1000.5, id = 0, q = [], fired = 0;
  const env = { now: () => t, schedule: (f, d) => { const my = ++id; q.push({ id: my, at: t + d + (jitter ? jitter(fired++) : 0), f }); return my; },
    clear: (i) => { q = q.filter((x) => x.id !== i); },
    advance: (ms) => { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const x = q[0]; if (!x || x.at > end) break; q.shift(); t = Math.max(t, x.at); x.f(); } t = end; },
    pending: () => q.length, spoken: [], stops: 0 };
  env.speak = (w) => env.spoken.push({ w, at: t }); env.stopSpeech = () => { env.stops++; env.spoken.push({ w: "<cancel>", at: t }); };
  return env;
}
function run(opts, ms, jitter) {
  const env = fakeEnv(jitter), ev = [], reps = [], stops = [];
  const c = C.makeCadence(Object.assign({ now: env.now, schedule: env.schedule, clear: env.clear, speak: env.speak, stopSpeech: env.stopSpeech,
    onPhase: (p, n, r, i) => ev.push({ p, n, r, at: i.atMs, fired: i.firedMs, spoken: i.spoken, word: i.word }), onRep: (r, i) => reps.push({ r, at: i.atMs }), onStop: (s, why) => stops.push(why) }, opts));
  const t0 = env.now(); c.start(); env.advance(ms); return { env, ev, reps, stops, c, t0 };
}
const words = (env) => env.spoken.filter((s) => s.w !== "<cancel>");
const HOLD = "Hold. Focus on squeezing with your glutes.", TOP = "Squeeze your glutes at the top.";

check("cycle: Down 4 s, Hold 4 s, Up 4 s, Top 2 s = 14 s a rep", C.PHASES.map((p) => p.id + p.secs).join() === "down4,hold4,up4,top2" && C.REP_MS === 14000);
check("cue text: Down / Hold. Focus on squeezing with your glutes. / Up / Squeeze your glutes at the top.", C.CUES.down === "Down" && C.CUES.hold === HOLD && C.CUES.up === "Up" && C.CUES.top === TOP);
check("no cue and no set-done line contains a number word", Object.values(C.CUES).concat(C.SET_DONE_LINE).every((w) => !NUM.test(w)));
check("spoken lengths fit their beats with room (Hold 2.61 s < 4 s - 0.5; Top 1.58 s < 2 s; Down/Up < 0.6 s)", C.CUE_MS.hold <= 3500 && C.CUE_MS.top <= 1800 && C.CUE_MS.down < 600 && C.CUE_MS.up < 600);
{ const { env, ev, reps, c, t0 } = run({}, 42000 - 1);
  const w = words(env);
  check("3 reps: exactly 12 spoken lines, one per phase start", w.length === 12, w.length);
  check("spoken order per rep: Down, Hold.., Up, Squeeze.. (x3)", JSON.stringify(w.map((x) => x.w)) === JSON.stringify([].concat(...[1, 2, 3].map(() => ["Down", HOLD, "Up", TOP]))));
  check("cue times: 0, 4, 8, 12 s then 14, 18, 22, 26 s, 28, 32, 36, 40 s (exact on the fake clock)", w.every((x, i) => Math.abs(x.at - t0 - [0, 4000, 8000, 12000][i % 4] - 14000 * Math.floor(i / 4)) < 1e-6));
  check("nothing spoken between cues (no seconds counted aloud)", ev.filter((e) => !e.word).every((e) => !e.spoken) && ev.filter((e) => e.word).length === 12 && ev.length === 42);
  check("no number word ever spoken", w.every((x) => !NUM.test(x.w)));
  check("silent ticks still drive the screen: phase + second, Top shows 1-2", ev[12].p === "top" && ev[12].n === 1 && ev[13].n === 2 && ev[14].p === "down" && ev[14].r === 2);
  check("onRep(1) at 14 s, onRep(2) at 28 s (no rep numbers spoken)", JSON.stringify(reps) === JSON.stringify([{ r: 1, at: 14000 }, { r: 2, at: 28000 }]));
  check("state(): rep 3 at the top beat", c.state().rep === 3 && c.state().phase === "top" && c.state().spoken === 12); }
{ let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const j = run({}, 140000 + 500, () => rnd() * 40);
  const cues = j.ev.filter((e) => e.word), lates = cues.map((e) => e.fired - e.at);
  check("10 reps with 0-40 ms timer jitter: 41 cues, every cue within 40 ms of its own target (no drift)", cues.length === 41 && lates.every((x) => x >= 0 && x <= 40) && cues[40].at === 140000, cues.length + " " + Math.max(...lates).toFixed(1)); }
{ const late = run({}, 9000, (i) => (i === 3 ? 400 : 0)); // the timer for t=4 s (Hold) fires 400 ms late
  const w = words(late.env).map((x) => x.w);
  check("a cue 400 ms late is shown but not spoken (voice never lags)", JSON.stringify(w) === JSON.stringify(["Down", "Up"]), w.join("|")); }
// coaching lines never overlap a cue
{ const r = run({}, 0); const e = r.env;
  e.advance(1500); const a = r.c.coach("Step back into view.");
  check("coach line 1.5 s after Down (quiet gap, fits before Hold): spoken now", a === "now" && words(e).slice(-1)[0].w === "Step back into view.");
  e.advance(1000); const b = r.c.coach("Stay on your spot.");   // 2.5 s: would run into Hold at 4 s
  check("coach line too close to the next cue: queued, not spoken over Hold", b === "queued");
  e.advance(5100); // through Hold (no gap after the long Hold cue) to Up at 8 s + gap
  const after = words(e).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("queued line is not spoken during the Hold cue's gap (too short); dropped when stale (> 5 s)", !after.some((x) => x.startsWith("Stay on your spot.")), after.join(" "));
  e.advance(1700); const c2 = r.c.coach("Go lower."); // 9.3 s: after Up + its gap
  check("coach after Up's gap: spoken now; the stale queued line was dropped, never spoken", c2 === "now" && r.c.state().coachDropped === 1 && !words(e).some((x) => x.w === "Stay on your spot."));
  check("every coaching line ends before the next cue (estimate + 300 ms)", words(e).filter((x) => !Object.values(C.CUES).includes(x.w)).every((x) => { const rel = x.at - r.t0; const nextCue = [0, 4000, 8000, 12000, 14000, 18000].find((c) => c > rel); return rel + C.estMs(x.w) + 300 <= nextCue; }));
  check("a line too long for any gap is dropped", r.c.coach("Keep your chest up and your knees out and push the floor away hard") === "dropped");
  check("not running: coach() says idle (caller speaks it itself)", C.makeCadence({ speak: () => {} }).coach("x") === "idle"); }
{ const r = run({}, 4100); const q = r.c.coach("Stay on your spot.");
  r.env.advance(4700); const w = words(r.env).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("line asked during the Hold cue waits and lands after Up's quiet gap (8.8 s), not over a cue", q === "queued" && w.includes("Stay on your spot.@8800"), w.join(" ")); }
// resync: to the top beat, then the next Down
{ const r = run({}, 5500); r.c.resync(1); r.env.advance(2500);
  const w = words(r.env).slice(2).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("resync during Hold: top cue now (5.5 s), next Down 2 s later (7.5 s), rep 2", JSON.stringify(w) === JSON.stringify([TOP + "@5500", "Down@7500"]) && r.ev.slice(-1)[0].r === 2, w.join(" ")); }
// complete: finish the top beat, then "Set complete.", loop stops
{ const r = run({}, 9000); let done = 0; r.c.complete(() => done++, 1); r.env.advance(10000);
  const w = words(r.env).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("complete() during Up: top cue at 12 s, then 'Set complete.' at 14 s, loop stopped", JSON.stringify(w.slice(-2)) === JSON.stringify([TOP + "@12000", "Set complete.@14000"]) && done === 1 && r.stops.join() === "complete" && !r.c.state().running, w.join(" ")); }
{ const r = run({}, 2000); r.c.complete(null, 1); r.env.advance(5000);
  const w = words(r.env).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("complete() during Down: top cue now, 'Set complete.' 2 s later", JSON.stringify(w.slice(-2)) === JSON.stringify([TOP + "@2000", "Set complete.@4000"]), w.join(" ")); }
// stop halts speech
{ const s = run({}, 5200); s.c.stop(); const n = words(s.env).length; s.env.advance(30000);
  check("stop(): cancels speech, onStop('stop'), nothing more spoken, no timers left", s.env.stops === 1 && s.stops.join() === "stop" && words(s.env).length === n && s.env.pending() === 0 && !s.c.state().running); }
// pose hook
{ let off = []; const p = run({ poseCheck: (x, st) => x.phase === st.phase, onOffPace: (st, x) => off.push(st.phase + ">" + x.phase) }, 4500);
  check("pose hook: out-of-phase sample fires onOffPace", p.c.pose({ phase: "hold" }) === true && p.c.pose({ phase: "up" }) === false && off.join() === "hold>up"); }
// default voice
{ const calls = []; global.window = { performance: { now: () => 0 }, SpeechSynthesisUtterance: function (t) { this.text = t; },
    speechSynthesis: { speaking: true, pending: false, resume: () => calls.push("resume"), cancel: () => calls.push("cancel"), speak: (u) => calls.push("speak:" + u.text + "@" + u.rate) } };
  delete require.cache[require.resolve("../gyatt-cadence.js")]; const C2 = require("../gyatt-cadence.js");
  const c2 = C2.makeCadence({ now: () => 0, schedule: () => 1, clear: () => {} }); c2.start();
  check("default voice: resume, cut what is speaking, 'Down' at rate 0.88", calls.join() === "resume,cancel,speak:Down@0.88", calls.join());
  c2.stop(); check("default stop cancels speechSynthesis", calls[calls.length - 1] === "cancel"); delete global.window; }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
