// Latency before vs after on the same synthetic smooth (cosine) reps. "Before" = the old smoothing: a fixed EMA (tauMs 70),
// optionally with the camera library's own keypoint smoothing in front of it (emulated here as a 60 ms low-pass on the
// keypoints: an ASSUMPTION about MoveNet's enableSmoothing, not a measurement). "After" = One Euro filter, no pre-smoothing.
// Lag = time the rep is credited minus the moment the TRUE depth comes back through the up threshold (30% range of motion).
// Run: node test/push-latency.test.js
const { createCounter } = require("../push-counter.js"), S = require("./lib/push-synth.js");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + n); };
function lag(repMs, fps, opts, pre) {
  S.reseed(3);
  const segs = [...S.hold(1500), ...S.cosReps(8, repMs, 20), ...S.hold(600)];
  const r = S.run(createCounter, segs, { fps }, opts, pre), tr = S.trueReturns(segs, 0.3, 5).slice(1), ct = r.countTimes.slice(1);
  const d = tr.map((x, i) => (ct[i] == null ? NaN : ct[i] - x));
  return { reps: r.reps, lag: d.reduce((a, b) => a + b, 0) / d.length };
}
const BEFORE = { filter: "ema", tauMs: 70 }, MOVENET_MS = 60;
const rows = [];
for (const [rep, fps] of [[1500, 30], [1500, 15], [800, 30], [800, 15]]) {
  const a = lag(rep, fps, BEFORE, 0), b = lag(rep, fps, BEFORE, MOVENET_MS), c = lag(rep, fps, {}, 0);
  rows.push({ rep, fps, a, b, c });
  console.log(`  ${String(rep).padStart(4)} ms reps @${String(fps).padStart(2)} fps: before(EMA 70) ${a.lag.toFixed(0).padStart(4)} ms | before(+camera-library smoothing) ${b.lag.toFixed(0).padStart(4)} ms | after(One Euro) ${c.lag.toFixed(0).padStart(4)} ms | reps ${a.reps}/${b.reps}/${c.reps}`);
}
const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
const mA = mean((r) => r.a.lag), mB = mean((r) => r.b.lag), mC = mean((r) => r.c.lag);
console.log(`  mean lag: before(EMA) ${mA.toFixed(0)} ms, before(+library smoothing) ${mB.toFixed(0)} ms, after ${mC.toFixed(0)} ms`);
check("every run counts all 8 reps, before and after (no lost reps from the faster filter)", rows.every((r) => r.a.reps === 8 && r.b.reps === 8 && r.c.reps === 8));
check("after is earlier than before in every case (filter alone)", rows.every((r) => r.c.lag < r.a.lag));
check("after is earlier than before in every case (with the library's own smoothing removed too)", rows.every((r) => r.c.lag < r.b.lag));
check("mean lag drops by at least 30 ms (filter alone) and 60 ms (filter + library smoothing off)", mA - mC >= 30 && mB - mC >= 60);
// no double counts from the faster filter: noisy slow bottom holds
{ S.reseed(9); const segs = [...S.hold(1200), ...S.reps(6, 1500), [700, 0, 1], [3000, 1, 1], [700, 1, 0], ...S.hold(1500), ...S.reps(6, 1500), ...S.hold(500)];
  const r = S.run(createCounter, segs, { noise: 0.004, drop: 0.1 }); check("noisy 3 s bottom hold between sets: no double counts (13 reps)", r.reps === 13); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
