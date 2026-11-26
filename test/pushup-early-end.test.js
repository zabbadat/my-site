// Owner report (Nov 16): halfway through a clean push-up set (no knees down) the set ended anyway ("Knees down" -> Set complete).
// Cause: the hidden-knee fallback (3cffd4d) read ANY frame with a weak / missing knee, hips above the hand line and feet on the
// floor as a kneel. That is also a normal plank / push-up top, so a ~1 s pause at the top with the knee landmark below 0.5 ended
// the set. Fix: the hidden-knee side cue needs folded legs (body line bent at the hip and a short hip-to-ankle span), and the
// front-view hip-drop cue needs the shoulders still up at plank height (not the bottom of a rep).
// Run: node test/pushup-early-end.test.js
const SS = require("../push-session.js");
const { kpsOf, lerp, POSE, setScore, dropJoints, frontKps } = require("./lib/break-synth.js");
let pass = 0, fail = 0; const check = (n, ok, info) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (info != null && !ok ? " (" + info + ")" : "")); };
// Realistic side-on push-up: wrists and feet on the floor line, hips well above it at the top.
const P = { top: Object.assign({}, POSE.top, { hip: [345, 272], knee: [440, 300], ankle: [535, 328] }), bottom: Object.assign({}, POSE.bottom, { knee: [440, 310], ankle: [535, 330] }),
  knees: Object.assign({}, POSE.knees) };
// 3 s reps with a 1.2 s rest at the top (what people do halfway through a set), rep counted on the way up
const REP = 3000, rep = (t) => { const p = (t % REP) / REP; const f = p < 0.4 ? 0 : p < 0.6 ? (p - 0.4) / 0.2 : p < 0.7 ? 1 : p < 0.9 ? 1 - (p - 0.7) / 0.2 : 0; return lerp(P.top, P.bottom, f); };
const repsAt = (t) => Math.floor((t + 300) / REP);
function watch(frame, ms, tw, opts) {
  tw = tw || 0; // side view: no shoulder-width baseline (a side-on shoulder line is a few px)
  const w = SS.createFailureWatch(opts), e = SS.createSetEnd(), g = SS.createPostureGuard(); w.reset(0); e.reset(0); g.reset();
  let flags = 0;
  for (let t = 0; t <= ms; t += 33) {
    const kps = frame(t), reps = repsAt(t), atTop = (t % REP) / REP < 0.4;
    if (g.update(kps, t, tw).event) flags++;
    const f = w.update(kps, t, tw, { frameW: 640, atTop, reps }); if (f) return { end: f, at: t, flags };
    const s = e.update({ mode: "sets", reps, t, atTop, kps }); if (s) return { end: s, at: t, flags };
  }
  return { end: null, flags };
}
// ---- the reported bug: proper form, knee landmark weak or missing, rests at the top ----
for (const [name, fr] of [["knee score 0.45", (t) => setScore(kpsOf(rep(t)), /_knee$/, 0.45)], ["knee score 0.35", (t) => setScore(kpsOf(rep(t)), /_knee$/, 0.35)],
  ["knees missing", (t) => dropJoints(kpsOf(rep(t)), /_knee$/)], ["knees missing, hood (no nose)", (t) => dropJoints(kpsOf(rep(t), { hood: true }), /_knee$/)],
  ["knees missing, 4 px jitter, 1 in 6 frames dropped", (t) => (Math.floor(t / 33) % 6 === 0 ? [] : dropJoints(kpsOf(rep(t), { noise: 4 }), /_knee$/))]]) {
  const r = watch(fr, 65000);
  check(`proper-form reps for 65 s with ${name} (1.2 s rests at the top): set never ends, no knees flag`, r.end === null && r.flags === 0, JSON.stringify(r));
}
check("classify: straight plank top with a hidden knee is not 'knees'", SS.classify(dropJoints(kpsOf(P.top, { noise: 0 }), /_knee$/), 0) !== "knees");
check("kneesFallback: straight body line, hips above hands, feet on floor, knee missing -> not knees", !SS.kneesFallback({ x: 345, y: 272, score: 0.9 }, null, { x: 535, y: 328, score: 0.9 }, { x: 200, y: 250, score: 0.9 }, 340, 0, SS.GUARD));
// front view: bottom of a slow rep (shoulders down by the hands, far hips near the hand line) held 1.5 s
{
  const front = frontKps(false), bot = front.map((k) => /shoulder/.test(k.name) ? Object.assign({}, k, { y: 330 }) : /elbow/.test(k.name) ? Object.assign({}, k, { y: 345 }) : /nose/.test(k.name) ? Object.assign({}, k, { y: 305 }) : /_hip$/.test(k.name) ? Object.assign({}, k, { y: 360 }) : /_knee$/.test(k.name) ? Object.assign({}, k, { y: 405, score: 0.3 }) : k);
  const fr = (t) => ((t % 4000) < 2000 ? front : bot);
  const r = watch(fr, 65000, 128);
  check("front camera: slow reps pausing 2 s at the bottom (hips near the hand line) for 65 s: no knees end", r.end !== "knees" && r.flags === 0, JSON.stringify(r));
}
// ---- real knees-down still ends the set ----
{
  const side = (t) => { const k = kpsOf(t < 6000 ? rep(t) : lerp(P.top, P.knees, Math.min(1, (t - 6000) / 400))); return t < 6000 ? k : dropJoints(k, /_knee$/); };
  const r = watch(side, 20000); check("real knees down mid-set with the knees hidden (side view) still ends 'knees' within ~1.5 s", r.end === "knees" && r.at >= 6900 && r.at <= 7700, JSON.stringify(r));
  const low = (t) => { const k = kpsOf(t < 6000 ? rep(t) : lerp(P.top, P.knees, Math.min(1, (t - 6000) / 400))); return t < 6000 ? k : setScore(k, /_knee$/, 0.32); };
  const r2 = watch(low, 20000); check("real knees down mid-set with low-confidence knees still ends 'knees'", r2.end === "knees", JSON.stringify(r2));
  const vis = (t) => kpsOf(t < 6000 ? rep(t) : lerp(P.top, P.knees, Math.min(1, (t - 6000) / 400)));
  const r3 = watch(vis, 20000); check("real knees down mid-set, knees visible, still ends (knees or form break)", (r3.end === "knees" || r3.end === "form"), JSON.stringify(r3));
  const fk = (t) => (t < 6000 ? frontKps(false) : frontKps(true, { noKnee: true }));
  const r4 = watch(fk, 20000, 128); check("front camera kneel with the knees hidden still ends 'knees'", r4.end === "knees", JSON.stringify(r4));
}
// ---- owner end rules (Nov 16): mid-set false triggers must NOT end; knees down / hard collapse / standing / 15 s / 45 s DO ----
const BOT = P.bottom, TOUCH = Object.assign({}, P.bottom, { shoulder: [205, 337], nose: [168, 333], elbow: [250, 330], hip: [345, 300] }); // chest at the floor
const repWith = (low, period, holdLow) => (t) => { const p = (t % period) / period, d = 0.3 * (1 - holdLow); const f = p < 0.2 ? 0 : p < 0.2 + d ? (p - 0.2) / d : p < 0.2 + d + holdLow ? 1 : p < 0.2 + 2 * d + holdLow ? 1 - (p - 0.2 - d - holdLow) / d : 0; return lerp(P.top, low, Math.max(0, Math.min(1, f))); };
function sim(frame, ms, repsAt, atTopAt, mode) {
  const w = SS.createFailureWatch(), e = SS.createSetEnd(); w.reset(0); e.reset(0);
  for (let t = 0; t <= ms; t += 33) {
    const kps = frame(t), reps = repsAt(t), atTop = atTopAt(t);
    const f = w.update(kps, t, 0, { frameW: 640, atTop, reps, skipFrame: mode !== "sets" }); if (f) return { end: f, at: t };
    const x = e.update({ mode: mode || "sets", reps, t, atTop, kps }); if (x) return { end: x, at: t };
  }
  return { end: null };
}
const every = (period, first) => (t) => (t < (first || 0) ? 0 : 1 + Math.floor((t - (first || 0)) / period));
{
  const r = sim((t) => kpsOf(repWith(TOUCH, 2500, 0.1)(t)), 65000, every(2500, 1500), (t) => (t % 2500) / 2500 < 0.2);
  check("chest touches the floor on every rep for 65 s: no end", r.end === null, JSON.stringify(r));
  const slow = sim((t) => kpsOf(repWith(BOT, 6000, 0.3)(t)), 70000, every(6000, 4000), (t) => (t % 6000) / 6000 < 0.2);
  check("slow reps (6 s each, 1.8 s pause at the bottom) for 70 s: no end", slow.end === null, JSON.stringify(slow));
  const wob = sim((t) => kpsOf(rep(t), { noise: 4 }), 65000, repsAt, (t) => (t % REP) / REP < 0.4);
  check("wobbly tracking (4 px jitter) through 65 s of reps: no end", wob.end === null, JSON.stringify(wob));
  const SAG = Object.assign({}, P.top, { hip: [345, 340] });
  const brief = sim((t) => kpsOf(t >= 9000 && t < 9800 ? SAG : rep(t)), 20000, repsAt, (t) => (t % REP) / REP < 0.4);
  check("brief deep hip sag (0.8 s) mid-set: no end", brief.end === null, JSON.stringify(brief));
  const pike = sim((t) => kpsOf(t >= 9000 && t < 13000 ? POSE.pike : rep(t)), 20000, repsAt, (t) => (t % REP) / REP < 0.4 || (t >= 9000 && t < 13000));
  check("pike held 4 s mid-set: no end", pike.end === null, JSON.stringify(pike));
  const bottom = sim((t) => kpsOf(t < 6000 ? rep(t) : BOT), 16000, (t) => Math.min(repsAt(t), 2), (t) => t < 6000 && (t % REP) / REP < 0.4);
  check("normal bottom position held 10 s: no end", bottom.end === null, JSON.stringify(bottom));
  const leave = sim((t) => (t >= 9000 && t < 10500 ? [] : kpsOf(rep(t))), 25000, repsAt, (t) => (t % REP) / REP < 0.4);
  check("brief 1.5 s dropout mid-set, comes back: no end", leave.end === null, JSON.stringify(leave));
  const leaveLong = sim((t) => (t >= 9000 ? [] : kpsOf(rep(t))), 70000, (t) => Math.min(repsAt(t), 3), () => false);
  check("Sets: out of frame for 2.5 s ends the set as 'frame' (~11.5 s, left at 9 s)", leaveLong.end === "frame" && leaveLong.at >= 11400 && leaveLong.at <= 11800, JSON.stringify(leaveLong));
  const leaveTut = sim((t) => (t >= 9000 ? [] : kpsOf(rep(t))), 70000, (t) => Math.min(repsAt(t), 3), () => false, "long");
  check("TUT: out of frame for 2.5 s ends the TUT set as 'frame'", leaveTut.end === "frame" && leaveTut.at >= 11400 && leaveTut.at <= 11800, JSON.stringify(leaveTut));
  const elb = sim((t) => kpsOf(t >= 9000 && t < 12000 ? Object.assign({}, BOT, { elbow: [240, 338] }) : rep(t)), 20000, repsAt, (t) => (t % REP) / REP < 0.4);
  check("elbows flat 3 s mid-set: no end", elb.end === null, JSON.stringify(elb));
  for (const hold of [1500, 3000]) {
    const r2 = sim((t) => kpsOf(t >= 9000 && t < 9000 + hold ? TOUCH : rep(t)), 25000, repsAt, (t) => (t % REP) / REP < 0.4);
    check(`chest down ${hold / 1000} s then presses up: no end`, r2.end === null, JSON.stringify(r2));
  }
  const fail = sim((t) => kpsOf(t >= 9000 ? TOUCH : rep(t)), 20000, (t) => Math.min(repsAt(t), 3), (t) => t < 9000 && (t % REP) / REP < 0.4);
  check("chest stays on the floor 4 s+ with no press: ends as collapse at ~4 s", fail.end === "collapse" && fail.at >= 12900 && fail.at <= 13600, JSON.stringify(fail));
  const HARD = Object.assign({}, P.top, { hip: [345, 360], knee: [440, 346] }); // hips ~75 px below the shoulder-ankle line
  const sagEnd = sim((t) => kpsOf(t >= 9000 ? HARD : rep(t)), 20000, (t) => Math.min(repsAt(t), 3), () => false);
  check("hard hip sag held: ends as collapse after >= 1.5 s", sagEnd.end === "collapse" && sagEnd.at - 9000 >= 1450 && sagEnd.at - 9000 <= 2500, JSON.stringify(sagEnd));
  const stand = sim((t) => kpsOf(t >= 9000 ? POSE.stand : rep(t)), 20000, (t) => Math.min(repsAt(t), 3), () => false);
  check("stands all the way up: ends as standing", stand.end === "standing", JSON.stringify(stand));
  const top60 = sim((t) => kpsOf(t < 6000 ? rep(t) : P.top), 70000, (t) => Math.min(repsAt(t), 2), (t) => t >= 6000 || (t % REP) / REP < 0.4);
  check("Sets: reps, then 60 s with no rep (held at the top) ends via the 45 s timer", top60.end === "stalled" && top60.at >= 50000 && top60.at <= 52500, JSON.stringify(top60));
  const low60 = sim((t) => kpsOf(t < 6000 ? rep(t) : BOT), 70000, (t) => Math.min(repsAt(t), 2), (t) => t < 6000 && (t % REP) / REP < 0.4, "long");
  check("TUT: reps, then parked low with no rep ends via the 15 s timer", low60.end === "stalled" && low60.at >= 19000 && low60.at <= 22000, JSON.stringify(low60));
}
// ---- stall timers: reset on every rep and on the top; never fire while reps continue ----
{
  const K1 = [{ name: "left_shoulder", x: 1, y: 1, score: 0.9 }];
  const e = SS.createSetEnd(); e.reset(0); let got = null;
  for (let t = 0; t <= 120000 && !got; t += 33) got = e.update({ mode: "sets", reps: 1 + Math.floor(t / 14000), t, atTop: false, kps: K1 });
  check("15 s stall: a rep every 14 s (always read off the top, e.g. counter top re-based / bottom latched) never stalls", got === null, got);
  const c = SS.createSetEnd(); c.reset(0); let gc = null; // counter object with a frozen range reading the body as low the whole time
  for (let t = 0; t <= 120000 && !gc; t += 33) gc = c.update({ mode: "sets", reps: 1 + Math.floor(t / 3000), t, atTop: true, counter: { top: 100, bottom: 200, smooth: 190 }, kps: K1 });
  check("15 s stall: counter says 'top' but its range reads low (re-based top) while reps continue every 3 s for 120 s: never stalls", gc === null, gc);
  const e2 = SS.createSetEnd(); e2.reset(0); let g2 = null;
  for (let t = 0; t <= 44000 && !g2; t += 33) g2 = e2.update({ mode: "sets", reps: 1, t, atTop: (t % 10000) < 2000, kps: K1 });
  check("15 s stall: returning to the top every 10 s restarts the low-stall clock", g2 === null, g2);
  const e3 = SS.createSetEnd(); e3.reset(0); let g3 = null, at3 = null;
  for (let t = 0; t <= 140000 && !g3; t += 33) { g3 = e3.update({ mode: "sets", reps: 1, t, atTop: (t % 40000) < 30000 || t > 80000, kps: K1 }); if (g3) at3 = t; }
  check(`45 s timer restarts on every return to the top (dips off and back every 40 s keep it alive; ends 45 s after the last return, at ${at3})`, g3 === "stalled" && at3 >= 125000 && at3 <= 126000, at3);
}
check("final end rules: knees, frame, collapse (hip sag 35 deg / 1.5 s; chest on the floor 4 s no press), standing, 15 s / 45 s timers; no elbows / pike-form ends",
  SS.FAIL.endOn.knees && SS.FAIL.endOn.sag && SS.FAIL.endOn.left && SS.FAIL.endOn.upright && SS.FAIL.endOn.frame && !SS.FAIL.endOn.elbows && !SS.FAIL.endOn.form && !SS.FAIL.endOn.lifted &&
  SS.FAIL.sagDeg === 35 && SS.FAIL.sagMs === 1500 && SS.VIEW.chestMs === 4000 && SS.SET_END.stallMs === 15000 && SS.SET_END.setsIdleMs === 45000);
// ---- plank hold rules unchanged: plank does not opt in to the push-up hidden-knee fold check ----
{
  const PL = require("../plank-session.js"), { execSync } = require("child_process"), os = require("os"), fs = require("fs"), path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plank-70786fd-"));
  for (const f of ["push-session.js", "plank-session.js", "push-counter.js"]) fs.writeFileSync(path.join(dir, f), execSync("git show 70786fd:" + f, { encoding: "utf8", cwd: path.join(__dirname, "..") }));
  const OLD = require(path.join(dir, "plank-session.js"));
  const frames = [P.top, P.knees, POSE.top, POSE.collapse, POSE.sag, POSE.pike, POSE.stand].flatMap((p) => [kpsOf(p, { noise: 0 }), dropJoints(kpsOf(p, { noise: 0 }), /_knee$/), setScore(kpsOf(p, { noise: 0 }), /_knee$/, 0.35)]);
  check("plank: classifyPlank gives the same result as live 70786fd on every test pose (plank rules unchanged)", frames.every((k) => JSON.stringify(PL.classifyPlank(k)) === JSON.stringify(OLD.classifyPlank(k))));
  check("plank: real kneel with hidden knees still reads knees", PL.classifyPlank(dropJoints(kpsOf(P.knees), /_knee$/)).frame === "knees");
}
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
