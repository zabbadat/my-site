// Synthetic tests for push-counter.js: leaned-up front-facing camera (test/lib/push-synth.js). Camera only.
// Run: node test/push-counter.test.js
const { createCounter, tutForRep, formatTut } = require("../push-counter.js"), S = require("./lib/push-synth.js");
const R = [];
function run(name, segs, expected, cfg, opts) {
  S.reseed(5); const r = S.run(createCounter, segs, cfg, opts), pass = r.reps === expected;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(56)} expected ${String(expected).padStart(2)}  got ${String(r.reps).padStart(2)}`);
  // tut as the page computes it: sum of the counted reps' cycle times
  R.push({ pass }); return Object.assign({ pass }, r);
}
const { full, half, hold, reps } = S, cal = hold(1200), end = hold(500);
run("baseline: 10 reps @1.5s", [...cal, ...reps(10, 1500), ...end], 10);
run("far phone (shoulders 12% of the frame)", [...cal, ...reps(10, 1500), ...end], 10, { sw: 0.12, topY: 200 });
run("close phone (shoulders 34% of the frame)", [...cal, ...reps(10, 1500), ...end], 10, { sw: 0.34, topY: 120 });
run("off-centre placement", [...cal, ...reps(10, 1500), ...end], 10, { cx: 90 });
run("keypoint noise 0.3% + 10% low-score frames", [...cal, ...reps(10, 1500), ...end], 10, { noise: 0.003, drop: 0.1 });
run("heavier noise 0.6% + 20% low-score frames", [...cal, ...reps(10, 1500), ...end], 10, { noise: 0.006, drop: 0.2 });
{ // single frame where one shoulder jumps across the frame
  S.reseed(5); const c = createCounter(), segs = [...cal, ...reps(10, 1500), ...end], dt = 1000 / 30, cfg = Object.assign({}, S.BASE); let n = 0;
  for (let t = 0; t <= S.total(segs); t += dt, n++) { let k = S.frameFor(S.fracAt(segs, t), cfg, t); if (n === 250) k = k.map((p) => (p.name === "right_shoulder" ? { ...p, x: p.x + 0.9 * 640 } : p)); c.update(k, t, 640); }
  const pass = c.state().reps === 10; console.log(`${pass ? "PASS" : "FAIL"}  ${"single glitch frame (shoulder jumps across the frame)".padEnd(56)} expected 10  got ${String(c.state().reps).padStart(2)}`); R.push({ pass }); }
run("fast reps 0.6s", [...cal, ...reps(10, 600), ...end], 10);
run("slow reps 4s", [...cal, ...reps(5, 4000), ...end], 5);
run("half reps (40% depth) ignored", [...cal, ...reps(3, 1500), ...Array.from({ length: 5 }, () => half(1500, 0.4)).flat(), ...reps(2, 1500), ...end], 5);
run("near-miss half reps (60% depth) ignored", [...cal, ...reps(3, 1500), ...Array.from({ length: 4 }, () => half(1200, 0.6)).flat(), ...end], 3);
{ const bob = Array.from({ length: 5 }, () => [[400, 1, 0.5], [400, 0.5, 1]]).flat();
  run("bottom bounces without coming back up not counted", [...cal, ...reps(3, 1500), [600, 0, 1], ...bob, [600, 1, 0], ...end], 4); }
run("bouncy 0.25s reps not counted", [...cal, ...reps(2, 1500), ...reps(6, 250), ...end], 2);
run("no wrists visible (head/shoulder signal only)", [...cal, ...reps(10, 1500), ...end], 10, { wrists: 0 });
run("one wrist visible", [...cal, ...reps(10, 1500), ...end], 10, { wrists: 1 });
run("no nose (shoulders only)", [...cal, ...reps(10, 1500), ...end], 10, { nose: false });
run("low frame rate 12 fps", [...cal, ...reps(10, 1500), ...end], 10, { fps: 12 });
run("too-slow rep (10s) not counted", [...cal, ...reps(2, 1500), ...full(10000), ...reps(1, 1500), ...end], 3);
run("small bounces at top (15% depth) = 0 after rep 1", [...cal, ...reps(1, 1500), ...Array.from({ length: 8 }, () => half(700, 0.15)).flat(), ...end], 1);
run("slow drift of the user 0.3 shoulder widths over the set", [...cal, ...reps(10, 1500), ...end], 10, { driftY: 0.3 * 0.2 * 640 });
run("shoulders out of view 1.5s mid-set", [...cal, ...reps(5, 1500), ...hold(2500), ...reps(5, 1500), ...end], 10, { gone: [1200 + 7500 + 300, 1200 + 7500 + 1800] });
run("steady, never dips = 0 (no calibration step, nothing to count)", hold(10000), 0);
run("first dip counts with no hold (zero calibration)", [...hold(100), ...reps(10, 1500), ...end], 10);
run("hands travel with the shoulders after 2 reps (second signal): not counted", [...cal, ...reps(2, 1500), ...reps(5, 1500), ...end], 2, { followAfter: 1200 + 3000 });
// time under tension
function check(name, ok) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); R.push({ pass: !!ok }); }
{ const segs = [...cal, ...reps(10, 1500), ...end]; S.reseed(5); const c = createCounter(), dt = 1000 / 30; let tut = 0;
  for (let t = 0; t <= S.total(segs); t += dt) { const r = c.update(S.frameFor(S.fracAt(segs, t), S.BASE, t), t, 640); if (r.counted) tut += tutForRep(r.repMs, 10000); }
  console.log("  tut ms:", Math.round(tut)); check("TUT ~ 10 x rep cycle (each 0.8-2.2s)", tut >= 8000 && tut <= 22000); }
{ const segs = [...cal, ...reps(5, 3000), ...end]; S.reseed(5); const c = createCounter(), dt = 1000 / 30; let tut = 0;
  for (let t = 0; t <= S.total(segs); t += dt) { const r = c.update(S.frameFor(S.fracAt(segs, t), S.BASE, t), t, 640); if (r.counted) tut += tutForRep(r.repMs, 10000); }
  check("TUT 3s reps ~ 5 x (2-4s)", tut >= 10000 && tut <= 20000); }
check("tutForRep caps at 10s", tutForRep(25000, 10000) === 10000 && tutForRep(1500) === 1500);
check("tutForRep ignores bad input", tutForRep(undefined) === 0 && tutForRep(-5) === 0 && tutForRep(NaN) === 0);
check("formatTut m:ss", formatTut(0) === "0:00" && formatTut(65400) === "1:05" && formatTut(3599999) === "59:59");
check("formatTut h:mm:ss", formatTut(3600000) === "1:00:00" && formatTut(3725000) === "1:02:05");
const fails = R.filter((r) => !r.pass).length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
