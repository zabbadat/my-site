// Lock-in cue: after a good plank is held 1.5 s the page speaks Three / Two / One / Hold, THEN the hold clock starts. Run: node test/plank-cue.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const P = require("../plank-session.js"), G = require("../get-set.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const pose = (t) => { const j = Math.sin(t / 37) * 1.5 + Math.cos(t / 91); return K({ left_shoulder: [90 + j, 240], left_hip: [270 - j, 246], left_knee: [390, 250], left_ankle: [490 + j, 252], left_elbow: [100, 300], left_wrist: [120, 320] }); };
const sag = () => K({ left_shoulder: [90, 240], left_hip: [270, 300], left_knee: [390, 270], left_ankle: [490, 252] });
const D = { w: 640, h: 480 };
const seq = (from, to, f, dt = 33) => { const a = []; for (let t = from; t < to; t += dt) a.push([t, f(t)]); return a; };

check("no leftover unspoken Hold plank cue", !G.COACH.plank.cue && !/Hold plank/.test(JSON.stringify(G.COACH.plank)));
// ---- logic order
{ const h = P.createPlankHold({ cue: true }); let r, lock = null;
  for (const [t, k] of seq(0, 4000, pose)) { r = h.update(k, t, D); if (r.phase === "cue" && lock == null) lock = t; }
  check(`lock-in after the 1.5 s ready (at ${lock} ms) enters the cue phase, not holding`, lock != null && lock >= 1500 && lock < 1600 && r.phase === "cue" && r.cue === true && r.cueSeq === 1);
  check("clock does not run during the cue (ms stays 0, no hold yet)", r.ms === 0 && !r.ended);
  const ok = h.begin(4000);
  check("begin() starts the clock only after the cue", ok === true && h.state().phase === "holding" && h.state().startT === 4000);
  for (const [t, k] of seq(4033, 6000, pose)) r = h.update(k, t, D);
  check("count runs from begin(), not from lock-in (about 2 s after begin, not 4.5 s)", r.phase === "holding" && Math.abs(r.ms - 2000) < 80);
  check("begin() outside the cue phase does nothing", h.begin(9999) === false); }
{ const h = P.createPlankHold(); let r; for (const [t, k] of seq(0, 3000, pose)) r = h.update(k, t, D);
  check("default (cue off) is unchanged: ready -> holding at lock-in", r.phase === "holding" && r.cue === false); }
{ const h = P.createPlankHold({ cue: true }); let r; for (const [t, k] of seq(0, 1800, pose)) r = h.update(k, t, D);
  for (const [t, k] of seq(1800, 2400, sag)) r = h.update(k, t, D);
  check("cue phase: form lost for more than 250 ms drops back to ready (no clock, no cue left pending)", r.phase === "ready" && r.ms === 0 && h.begin(2500) === false);
  for (const [t, k] of seq(2400, 6000, pose)) r = h.update(k, t, D);
  check("re-locking later gives a new cue (cueSeq 2)", r.phase === "cue" && r.cueSeq === 2); }
{ const h = P.createPlankHold({ cue: true }); let r; for (const [t, k] of seq(0, 1800, pose)) r = h.update(k, t, D);
  for (const [t, k] of seq(1800, 1860, sag)) r = h.update(k, t, D);
  for (const [t, k] of seq(1860, 2500, pose)) r = h.update(k, t, D);
  check("one noisy frame in the cue phase does not cancel it", r.phase === "cue"); }
{ const h = P.createPlankHold({ cue: true, cueMaxMs: 3000 }); let r; for (const [t, k] of seq(0, 6000, pose)) r = h.update(k, t, D);
  check("safety: if the page never calls begin(), the clock starts by itself after cueMaxMs", r.phase === "holding" && r.ms > 800); }
{ const h = P.createPlankHold({ cue: true }); for (const [t, k] of seq(0, 2000, pose)) h.update(k, t, D); const r = h.stop(2100);
  check("stop during the cue ends with no time (the clock never started)", r.ended && r.reason === "stopped" && r.ms === 0); }

// ---- page: speech order. Run the real plankCue() from index.html against a mock speech engine.
const src = html.slice(html.indexOf("let plankCueSeq = 0"), html.indexOf("function plankOutlineSet"));
const $stub = "const __els = {}; function $(id) { return __els[id] || (__els[id] = { textContent: '', hidden: true }); }\n";
function page(busyMs) {
  const log = [], t0 = Date.now(), now = () => Date.now() - t0;
  const speechSynthesis = { get speaking() { return now() < busyMs; }, pending: false, cancel() { log.push(["cancel", now()]); }, speak(u) { log.push(["speak", u.text, now()]); setTimeout(() => u.onend && u.onend(), 300); } };
  let phase = "cue"; const hold = { begin() { log.push(["begin", now()]); phase = "holding"; }, state() { return { phase, cueSeq: 1 }; } };
  const win = { speechSynthesis, ZabbadatGetSet: G, SpeechSynthesisUtterance: function (t) { this.text = t; } };
  const ctx = vm.createContext({ window: win, plankHold: hold, plankLoop: true, plankSaved: false, performance: { now }, setTimeout, Promise });
  vm.runInContext($stub + src, ctx);
  return { log, win, msg: () => vm.runInContext("$('plankMsg').textContent", ctx), drop: () => { phase = "ready"; }, cue: (n) => vm.runInContext(`plankCue({ phase: "cue", cueSeq: ${n} })`, ctx), stop: () => vm.runInContext("plankLoop = false", ctx) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
check("page source: 3-2-1-Hold countdown (makeGoCountdown with PLANK_STEPS), then hold.begin; waits for earlier speech; once per cueSeq; new hold uses cue mode", /PLANK_STEPS/.test(src) && /plankCount\.run\(plankCountShow, cancelled\)/.test(src) && /hold\.begin\(performance\.now\(\)\)/.test(src) && /plankSpeechIdle\(\)/.test(src) && /r\.cueSeq === plankCueSeq\) return/.test(src) && /createPlankHold\(\{ cue: true, cueMaxMs: 20000 \}\)/.test(html));
check("page: no stray 'Hold it… 1.5s' digits and no second (pre-camera) plank countdown", !/Hold it… " \+ Math\.ceil/.test(html) && !/getSetCountdown\([^\n]*plankStatus/.test(html));
check("get-set: PLANK_STEPS 3, 2, 1, Hold at 1.2 s each", JSON.stringify(G.PLANK_STEPS) === JSON.stringify([[0, "Three.", "3"], [1200, "Two.", "2"], [2400, "One.", "1"], [3600, "Hold.", "HOLD"]]));
(async () => {
  const useWin = (p) => { global.window = p.win; global.self = p.win; };
  { const p = page(0); useWin(p); p.cue(1); await wait(100);
    check("idle speech: 'three' spoken + shown at once, begin() NOT yet", p.log.some((x) => x[0] === "speak" && x[1] === "Three.") && p.msg() === "3" && !p.log.some((x) => x[0] === "begin"));
    await wait(2400); check("still counting at 2.5 s ('one'), no clock yet", p.log.some((x) => x[1] === "One.") && !p.log.some((x) => x[0] === "begin"));
    await wait(1300);
    const words = p.log.filter((x) => x[0] === "speak").map((x) => x[1]), bg = p.log.find((x) => x[0] === "begin"), hs = p.log.find((x) => x[1] === "Hold.");
    check(`spoken three, two, one, Hold; clock starts exactly at Hold (${hs && hs[2]} / ${bg && bg[1]} ms)`, words.join(",") === "Three.,Two.,One.,Hold." && !!bg && !!hs && Math.abs(bg[1] - hs[2]) < 30 && bg[1] >= 3550);
    p.cue(1); await wait(300);
    check("the same lock-in never runs the countdown twice", p.log.filter((x) => x[1] === "Three.").length === 1 && p.log.filter((x) => x[0] === "begin").length === 1); }
  { const p = page(700); useWin(p); p.cue(1); await wait(500);
    check("earlier line still speaking: the countdown waits, never cancels or overlaps it", !p.log.some((x) => x[0] === "speak" || x[0] === "cancel"));
    await wait(4400);
    const sp = p.log.find((x) => x[0] === "speak");
    check("...then counts right after it ends, and the clock starts at Hold", !!sp && sp[2] >= 700 && sp[2] < 1000 && p.log.some((x) => x[0] === "begin")); }
  { const p = page(0); useWin(p); p.cue(1); await wait(1100); p.drop(); await wait(2500);
    check("form lost during the countdown: countdown stops, clock never starts", !p.log.some((x) => x[0] === "begin") && !p.log.some((x) => x[1] === "Hold.")); }
  { const p = page(0); useWin(p); p.stop(); p.cue(1); await wait(700);
    check("camera stopped before the cue: nothing spoken, no begin", p.log.length === 0); }
  delete global.window; delete global.self;
  const fails = R.filter((x) => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);
})();
