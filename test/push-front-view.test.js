// Push-up counter, leaned-up front-facing camera: what is specific to this view. Camera only.
// (The shared rep scenarios are in push-counter.test.js.) Run: node test/push-front-view.test.js
const path = require("path"), { createCounter } = require("../push-counter.js"), S = require("./lib/push-synth.js"), flow = require("./lib/push-flow-harness.js");
let pass = 0, fail = 0; const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + n + (extra ? "  " + extra : "")); };
const cal = S.hold(1200), tail = S.hold(500);
const go = (segs, cfg, opts) => { S.reseed(5); return S.run(createCounter, segs, cfg, opts); };
const eq = (n, segs, want, cfg, opts) => { const r = go(segs, cfg, opts); check(n, r.reps === want, `expected ${want} got ${r.reps}`); return r; };

// zero calibration
{ const r = go([...S.hold(100), ...S.reps(3, 1500), ...tail]); check("the FIRST rep counts, credited on the way up (before the rep is even over)", r.countTimes.length === 3 && r.countTimes[0] < 100 + 1500); }
// rolling top
{ const r = eq("user/phone shifts lower mid-set: top re-bases, reps count again", [...cal, ...S.reps(5, 1500), ...S.hold(2000), ...S.reps(14, 1500), ...tail], 15, { shiftAt: [1200 + 7500 + 500, 0.7] }); check("re-based exactly once", r.state.rebased === 1); }
eq("user shifts higher mid-set: top follows up at once", [...cal, ...S.reps(5, 1500), ...S.hold(2000), ...S.reps(8, 1500), ...tail], 13, { shiftAt: [1200 + 7500 + 500, -0.5] });
// both signals
eq("shallow dips (travel 0.15 shoulder widths) never count", [...cal, ...S.reps(6, 1500), ...tail], 0, { travel: 0.15 });
eq("shoulders sink but hands travel with them (leaning, not a push-up): not counted after rep 2", [...cal, ...S.reps(2, 1500), ...S.reps(6, 1500), ...tail], 2, { followAfter: 1200 + 3000 });
{ // wrist signal must also come back: a rep whose shoulders are back up but hands stay close is not credited until they open again
  const r = go([...cal, ...S.reps(4, 1500), ...tail]); check("wrist-to-shoulder signal learned from rep 1 (top > bottom)", r.state.topQ > r.state.bottomQ + 0.2, `${r.state.topQ.toFixed(2)} > ${r.state.bottomQ.toFixed(2)}`); }
// posture-guard reference
{ const st = go([...cal, ...S.reps(4, 1500), ...tail]).state;
  check("exposes topSize (shoulder width / frame width) for the posture guard", Math.abs(st.topSize - 0.2) < 0.01, `topSize ${st.topSize && st.topSize.toFixed(3)} want ~0.2`); }
// real start flow (index.html: startPush -> openCam -> poseTick) with front-view frames
const HTML = path.join(__dirname, "..", "index.html");
const prof = (t0, per) => (t) => ({ d: t < t0 ? 0 : S.fracAt(S.reps(40, per), t - t0) });
(async () => {
  for (const mode of ["sets", "long", "challenge"]) {
    const r = await flow(HTML, { mode, script: prof(9500, 1500), ms: 9500 + 15000 });
    check(`flow (${mode}): first rep after Go counts, 10 reps in 15 s`, r.reps === 10 && r.running, `got ${r.reps}`);
  }
  const r = await flow(HTML, { mode: "sets", script: prof(2000, 1500), ms: 9000 + 6000 });
  check("flow: dips during the prompts / countdown never count, counting starts at Go", r.trace.every((x) => x.run || x.reps === 0) && r.reps <= 4, `got ${r.reps}`);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
