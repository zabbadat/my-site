// Slow push-ups (3.5 / 5 / 7 s per rep) count through the real start flow, leaned-up front-facing camera.
// (Regression: the slow bottom was once read as "parked at a new level" after 2 x calibMs.)
// DEFAULTS are pinned deliberately in push-recalibrate.test.js.
const path = require("path"), run = require("./lib/push-flow-harness.js");
const HTML = path.join(__dirname, "..", "index.html");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const rep = (t0, per) => (t) => { if (t < t0) return { d: 0 }; const p = (t - t0) % per, q = per / 2.5; return { d: p < q ? p / q : p < q * 1.3 ? 1 : p < q * 2.3 ? 1 - (p - q * 1.3) / q : 0 }; };
(async () => {
  // Go at 9 s (no speech); reps start at 10 s; run to 10 s + 6 reps
  for (const [per, min] of [[2000, 15], [3500, 5], [5000, 5], [7000, 5]]) {
    for (const mode of ["sets", "long", "challenge"]) {
      const r = await run(HTML, { mode, script: rep(10000, per), ms: 10000 + per * 6 + 500 });
      check(`${mode}: ${per / 1000} s reps count (${r.reps} of 6, need >= ${per === 2000 ? 6 : min})`, r.reps >= (per === 2000 ? 6 : min));
    }
  }
  // parked at a new level (stepped closer: bigger shoulders, lower in the frame) for > maxRepMs still re-bases, then reps count
  const park = (t) => { if (t < 10000) return { d: 0 }; if (t < 18000) return { d: 0, sw: 0.24, y: 190 }; const x = rep(18000, 2000)(t); return { d: x.d, sw: 0.24, y: 190 }; };
  const r = await run(HTML, { mode: "sets", script: park, ms: 31000 });
  check(`parked at a new level > 6 s: start level moves, reps then count (${r.reps})`, r.reps >= 5);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
