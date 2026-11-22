// Gyatt Squats voice cadence: Down four-count, Hold four-count, a single "Up", a short "Squeeze" (12 s guidance loop).
// Reps are not taken from this clock. No rep numbers. Fake monotonic clock; complete; stop; quiet-gap coaching.
const C = require("../gyatt-cadence.js");
const G = require("../get-set.js");
const fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || why == null ? "" : " :: " + why}`); ok ? pass++ : fail++; };
const REP = ["Down, one", "two", "three", "four", "Hold, one", "two", "three", "four", "Up", "Squeeze"];
const REP_NUM = /\b(rep|reps|zero|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third)\b|\d/i;
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
    onPhase: (p, n, r, i) => ev.push({ p, n, r, at: i.atMs, fired: i.firedMs, spoken: i.spoken, word: i.word, label: i.label }), onRep: (r, i) => reps.push({ r, at: i.atMs }), onStop: (s, why) => stops.push(why) }, opts));
  const t0 = env.now(); c.start(); env.advance(ms); return { env, ev, reps, stops, c, t0 };
}
const words = (env) => env.spoken.filter((s) => s.w !== "<cancel>");

check("cycle: Down 4 s, Hold 4 s, Up 1 s, Squeeze 3 s (word then quiet) = 12 s of guidance", C.PHASES.map((p) => p.id + p.secs).join() === "down4,hold4,up1,top3" && C.PHASES[3].label === "Squeeze" && C.REP_MS === 12000 && C.REP_SECS === 12 && C.TOP_K === 9);
check("spoken lines: Down, one / Hold, one / Up (no number) / Squeeze (no number)", C.CUES.down === "Down, one" && C.CUES.hold === "Hold, one" && C.CUES.up === "Up" && C.CUES.top === "Squeeze");
check("no cue or set-done line contains a rep number (beat counts one..four are allowed on Down and Hold)", Object.values(C.CUES).concat(C.SET_DONE_LINE, C.BEATS).every((w) => !REP_NUM.test(w)));
{ const { env, ev, reps, c, t0 } = run({}, 36000 - 1);
  const w = words(env);
  check("3 loops: exactly 30 spoken words (10 per 12 s loop)", w.length === 30, w.length);
  check("spoken order per loop: Down, one · two · three · four / Hold... / Up / Squeeze (x3)", JSON.stringify(w.map((x) => x.w)) === JSON.stringify([].concat(...[1, 2, 3].map(() => REP.slice()))));
  const spokenAt = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // seconds within a 12 s loop
  check("beat times: Down 0-3 s, Hold 4-7 s, Up at 8 s, Squeeze at 9 s, then 2 s quiet (x3)", w.every((x, i) => Math.abs(x.at - t0 - 1000 * spokenAt[i % 10] - 12000 * Math.floor(i / 10)) < 1e-6));
  check("quiet top beats are not spoken (2 s after Squeeze)", ev.filter((e) => e.p === "top" && e.n > 1).every((e) => !e.word && !e.spoken) && ev.filter((e) => e.spoken).length === 30);
  check("no rep number is ever spoken", w.every((x) => !REP_NUM.test(x.w)));
  check("screen: Squeeze at 9 s, then Down of loop 2 at 12 s", ev[9].p === "top" && ev[9].label === "Squeeze" && ev[9].n === 1 && ev[9].word === "Squeeze" && ev[12].p === "down" && ev[12].r === 2 && ev[12].word === "Down, one");
  check("onRep(1) at 12 s, onRep(2) at 24 s (timer boundaries only; pose counts the real reps)", JSON.stringify(reps) === JSON.stringify([{ r: 1, at: 12000 }, { r: 2, at: 24000 }]));
  check("state(): loop 3 on the last quiet squeeze beat", c.state().rep === 3 && c.state().phase === "top" && c.state().count === 3 && c.state().spoken === 30); }
{ let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const j = run({}, 120000 + 500, () => rnd() * 40);
  const cues = j.ev.filter((e) => e.word), lates = cues.map((e) => e.fired - e.at);
  check("10 loops with 0-40 ms timer jitter: 101 spoken words, every word within 40 ms of its target (no drift; late beats still spoken)", cues.length === 101 && lates.every((x) => x >= 0 && x <= 40) && cues[100].at === 120000 && cues.every((e) => e.spoken), cues.length + " " + Math.max(...lates).toFixed(1)); }
{ const late = run({}, 9000, (i) => (i === 3 ? 400 : 0)); // the timer for t=4 s ("Hold, one") fires 400 ms late
  const w = words(late.env).map((x) => x.w);
  check("a beat 400 ms late is still spoken (serial voice catches up; counts are not dropped)", w.includes("Hold, one") && w[0] === "Down, one" && w.includes("four"), w.join("|")); }
// coaching never talks over the down / hold four-count; it may speak in the quiet gap after Squeeze
{ const r = run({}, 0); const e = r.env;
  e.advance(1500); const a = r.c.coach("Knees out");
  check("coach during Down is not spoken over the count", a !== "idle" && !words(e).some((x) => x.w === "Knees out"));
  e.advance(9500); // 11 s: first quiet second after Squeeze (Squeeze at 9 s, quiet at 10-11)
  check("queued coach is spoken in the quiet gap after Squeeze", words(e).some((x) => x.w === "Knees out"), words(e).map((x) => x.w).join("|"));
  check("not running: coach() says idle (caller speaks it itself)", C.makeCadence({ speak: () => {} }).coach("x") === "idle"); }
// complete: play Squeeze, then "Set complete.", loop stops
{ const r = run({}, 8000); let done = 0; r.c.complete(() => done++, 1); r.env.advance(12000);
  const w = words(r.env).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("complete() at the Up beat: Squeeze now, then 'Set complete.' after the quiet top, loop stopped", JSON.stringify(w.slice(-2)) === JSON.stringify(["Squeeze@8000", "Set complete.@11000"]) && done === 1 && r.stops.join() === "complete" && !r.c.state().running, w.join(" ")); }
{ const r = run({}, 2000); r.c.complete(null, 1); r.env.advance(6000);
  const w = words(r.env).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("complete() during Down: Squeeze now, 'Set complete.' after the quiet top", JSON.stringify(w.slice(-2)) === JSON.stringify(["Squeeze@2000", "Set complete.@5000"]), w.join(" ")); }
// stop halts speech
{ const s = run({}, 5200); s.c.stop(); const n = words(s.env).length; s.env.advance(30000);
  check("stop(): cancels speech, onStop('stop'), nothing more spoken, no timers left", s.env.stops === 1 && s.stops.join() === "stop" && words(s.env).length === n && s.env.pending() === 0 && !s.c.state().running); }
// pose hook still available (hint only)
{ let off = []; const p = run({ poseCheck: (x, st) => x.phase === st.phase, onOffPace: (st, x) => off.push(st.phase + ">" + x.phase) }, 4500);
  check("pose hook: out-of-phase sample fires onOffPace", p.c.pose({ phase: "hold" }) === true && p.c.pose({ phase: "up" }) === false && off.join() === "hold>up"); }
// default voice: serial, no cancel, first beat is "Down, one"
{ const calls = []; global.window = { performance: { now: () => 0 }, SpeechSynthesisUtterance: function (t) { this.text = t; },
    speechSynthesis: { speaking: true, pending: false, resume: () => calls.push("resume"), cancel: () => calls.push("cancel"), speak: (u) => calls.push("speak:" + u.text + "@" + u.rate) } };
  delete require.cache[require.resolve("../gyatt-cadence.js")]; const C2 = require("../gyatt-cadence.js");
  const c2 = C2.makeCadence({ now: () => 0, schedule: () => 1, clear: () => {} }); c2.start();
  check("default voice: resume, no cancel, 'Down, one' at rate 0.88", calls.join() === "resume,speak:Down, one@0.88", calls.join());
  c2.stop(); check("default stop cancels speechSynthesis", calls[calls.length - 1] === "cancel"); delete global.window; }
// page path uses serial enqueueSpeak; plank / push-up cues are unchanged
{ const src = fs.readFileSync(path.join(__dirname, "../gyatt-cadence.js"), "utf8");
  check("cadence default speak uses enqueueSpeak / speakAndWait (no cancel of the previous beat)", /enqueueSpeak/.test(src) && !/if \(ss\.speaking \|\| ss\.pending\) ss\.cancel\(\)/.test(src));
  check("plank countdown ends on hold (One, two, three, hold; not a four-count phase)", G.PLANK_STEPS.map((x) => x[1]).join() === "One,two,three,hold" && G.PLANK_SET_LINE === "Go on, hold on three.");
  check("push-up / TUT go-cue is unchanged (not applied yet)", G.NEXT_STEPS.map((x) => x[1]).join() === "One,two,three,Go" && G.NEXT_SET_LINE === "Set up, go on three."); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
