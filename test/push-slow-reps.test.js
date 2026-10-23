// Slow push-ups (3.5 / 5 / 7 s per rep) count with lockOnDip through the real start flow (was 0: the slow bottom
// was read as "parked at a new level" after 2 x calibMs). DEFAULTS unchanged.
const path = require("path"), run = require("./lib/push-flow-harness.js"), P = require("../push-counter.js");
const HTML = path.join(__dirname, "..", "index.html"), TOP = 0.3, BOT = 0.45;
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const rep = (t0, per) => (t) => { if (t < t0) return { w: TOP, e: 170 }; const p = (t - t0) % per, q = per / 2.5; const f = p < q ? p / q : p < q * 1.3 ? 1 : p < q * 2.3 ? 1 - (p - q * 1.3) / q : 0; return { w: TOP + f * (BOT - TOP), e: 170 - f * 90 }; };
check("DEFAULTS unchanged", JSON.stringify(P.DEFAULTS) === JSON.stringify({ minScore: 0.3, holdMs: 300, poorMs: 1000, tauMs: 70, glitchRatio: 0.45, glitchMaxMs: 250, calibMs: 1000, steadyTol: 0.05, minDepth: 0.12, downRom: 0.7, upRom: 0.3, minBottomMs: 120, minRepMs: 400, maxRepMs: 6000, adapt: 0.15, elbowFrac: 0.4 }));
(async () => {
  // Go at 9 s (no speech); reps start at 10 s; run to 10 s + 6 reps
  for (const [per, min] of [[2000, 15], [3500, 5], [5000, 5], [7000, 5]]) {
    for (const mode of ["sets", "long", "challenge"]) {
      const r = await run(HTML, { mode, script: rep(10000, per), ms: 10000 + per * 6 + 500 });
      check(`${mode}: ${per / 1000} s reps count (${r.reps} of 6, need >= ${per === 2000 ? 6 : min})`, r.reps >= (per === 2000 ? 6 : min));
    }
  }
  // parked at a new level (moved closer) for > maxRepMs still re-bases, then reps count
  const park = (t) => { if (t < 10000) return { w: TOP, e: 170 }; if (t < 18000) return { w: TOP * 1.2, e: 165 }; const x = rep(18000, 2000)(t); return { ...x, w: x.w * 1.2 }; };
  const r = await run(HTML, { mode: "sets", script: park, ms: 31000 });
  check(`parked closer to the phone > 6 s: start level moves, reps then count (${r.reps})`, r.reps >= 5);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
