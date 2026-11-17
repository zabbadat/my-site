// Gyatt Squats voice cadence: four-count at 1 s per beat (Down / Hold / Up / Squeeze, 4 s each = 16 s a rep).
// Phase word + "one" share beat one; two, three, four follow. No rep numbers. Fake monotonic clock; resync; complete; stop.
const C = require("../gyatt-cadence.js");
const G = require("../get-set.js");
const fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || why == null ? "" : " :: " + why}`); ok ? pass++ : fail++; };
const REP = ["Down, one", "two", "three", "four", "Hold, one", "two", "three", "four", "Up, one", "two", "three", "four", "Squeeze, one", "two", "three", "four"];
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

check("cycle: Down 4 s, Hold 4 s, Up 4 s, Squeeze 4 s = 16 s a rep", C.PHASES.map((p) => p.id + p.secs).join() === "down4,hold4,up4,top4" && C.PHASES[3].label === "Squeeze" && C.REP_MS === 16000 && C.REP_SECS === 16 && C.TOP_K === 12);
check("beat-one lines: Down, one / Hold, one / Up, one / Squeeze, one", C.CUES.down === "Down, one" && C.CUES.hold === "Hold, one" && C.CUES.up === "Up, one" && C.CUES.top === "Squeeze, one");
check("no cue or set-done line contains a rep number (beat counts one..four are allowed)", Object.values(C.CUES).concat(C.SET_DONE_LINE, C.BEATS).every((w) => !REP_NUM.test(w)));
{ const { env, ev, reps, c, t0 } = run({}, 48000 - 1);
  const w = words(env);
  check("3 reps: exactly 48 spoken beats, one per second", w.length === 48, w.length);
  check("spoken order per rep: Down, one · two · three · four / Hold... / Up... / Squeeze... (x3)", JSON.stringify(w.map((x) => x.w)) === JSON.stringify([].concat(...[1, 2, 3].map(() => REP.slice()))));
  check("beat times: 0..15 s, then 16..31 s, then 32..47 s (exact on the fake clock)", w.every((x, i) => Math.abs(x.at - t0 - 1000 * (i % 16) - 16000 * Math.floor(i / 16)) < 1e-6));
  check("every tick has a spoken word (four-count fills the phase)", ev.every((e) => e.word && e.spoken) && ev.length === 48);
  check("no rep number is ever spoken", w.every((x) => !REP_NUM.test(x.w)));
  check("screen: phase + second, Squeeze shows 1-4, then Down of rep 2", ev[12].p === "top" && ev[12].label === "Squeeze" && ev[12].n === 1 && ev[15].n === 4 && ev[16].p === "down" && ev[16].r === 2 && ev[16].word === "Down, one");
  check("onRep(1) at 16 s, onRep(2) at 32 s (no rep numbers spoken)", JSON.stringify(reps) === JSON.stringify([{ r: 1, at: 16000 }, { r: 2, at: 32000 }]));
  check("state(): rep 3 on the last squeeze beat", c.state().rep === 3 && c.state().phase === "top" && c.state().count === 4 && c.state().spoken === 48); }
{ let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const j = run({}, 160000 + 500, () => rnd() * 40);
  const cues = j.ev.filter((e) => e.word), lates = cues.map((e) => e.fired - e.at);
  check("10 reps with 0-40 ms timer jitter: 161 beats, every beat within 40 ms of its target (no drift; late beats still spoken)", cues.length === 161 && lates.every((x) => x >= 0 && x <= 40) && cues[160].at === 160000 && cues.every((e) => e.spoken), cues.length + " " + Math.max(...lates).toFixed(1)); }
{ const late = run({}, 9000, (i) => (i === 3 ? 400 : 0)); // the timer for t=4 s ("Hold, one") fires 400 ms late
  const w = words(late.env).map((x) => x.w);
  check("a beat 400 ms late is still spoken (serial voice catches up; counts are not dropped)", w.includes("Hold, one") && w[0] === "Down, one" && w.includes("four"), w.join("|")); }
// coaching never talks over the four-count
{ const r = run({}, 0); const e = r.env;
  e.advance(1500); const a = r.c.coach("Step back into view.");
  check("coach while running is dropped (no quiet gap in a four-count)", a === "dropped" && !words(e).some((x) => x.w === "Step back into view."));
  check("not running: coach() says idle (caller speaks it itself)", C.makeCadence({ speak: () => {} }).coach("x") === "idle"); }
// resync: to the squeeze beat, then the next Down 4 s later
{ const r = run({}, 5500); r.c.resync(1); r.env.advance(4500);
  const w = words(r.env).filter((x) => x.at >= r.t0 + 5500 - 1e-6).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("resync during Hold: Squeeze, one now (5.5 s), next Down, one 4 s later (9.5 s), rep 2", JSON.stringify(w.slice(0, 5)) === JSON.stringify(["Squeeze, one@5500", "two@6500", "three@7500", "four@8500", "Down, one@9500"]) && r.ev.slice(-1)[0].r === 2, w.join(" ")); }
// complete: finish the squeeze four-count, then "Set complete.", loop stops
{ const r = run({}, 9000); let done = 0; r.c.complete(() => done++, 1); r.env.advance(12000);
  const w = words(r.env).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("complete() during Up: squeeze four-count at 12-15 s, then 'Set complete.' at 16 s, loop stopped", JSON.stringify(w.slice(-5)) === JSON.stringify(["Squeeze, one@12000", "two@13000", "three@14000", "four@15000", "Set complete.@16000"]) && done === 1 && r.stops.join() === "complete" && !r.c.state().running, w.join(" ")); }
{ const r = run({}, 2000); r.c.complete(null, 1); r.env.advance(6000);
  const w = words(r.env).map((x) => x.w + "@" + Math.round(x.at - r.t0));
  check("complete() during Down: squeeze four-count now, 'Set complete.' 4 s later", JSON.stringify(w.slice(-5)) === JSON.stringify(["Squeeze, one@2000", "two@3000", "three@4000", "four@5000", "Set complete.@6000"]), w.join(" ")); }
// stop halts speech
{ const s = run({}, 5200); s.c.stop(); const n = words(s.env).length; s.env.advance(30000);
  check("stop(): cancels speech, onStop('stop'), nothing more spoken, no timers left", s.env.stops === 1 && s.stops.join() === "stop" && words(s.env).length === n && s.env.pending() === 0 && !s.c.state().running); }
// pose hook
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
  check("plank countdown is unchanged (One, two, three, Hold; not a four-count phase)", G.PLANK_STEPS.map((x) => x[1]).join() === "One,two,three,Hold" && G.PLANK_SET_LINE === "Set up, hold on three.");
  check("push-up / TUT go-cue is unchanged (not applied yet)", G.NEXT_STEPS.map((x) => x[1]).join() === "One,two,three,Go" && G.NEXT_SET_LINE === "Set up, go on three."); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
