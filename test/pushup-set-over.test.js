// Owner report (Nov 20, voice): "The camera did not detect my failed push-up, I had to end the set myself."
// Owner rule (Nov 20): do not judge single reps; detect when the SET IS OVER and end it at that moment with the reps done
// so far as the result. Over by FAILURE (stuck or collapsed down in the rep, can't push back up) or by GIVING UP (stopped,
// knees down and stayed, stood up, walked out of the picture). A fail means the set has ended, never a per-rep verdict.
// Cause: once the user stopped down in the rep (stuck at the bottom / mid-rep, flat on the floor), the only end rule that
// applied was the 15 s "stalled" clock (createSetEnd), and in Sets leaving the frame never ended a set at all, so the user
// tapped End set first. Fix (push-session.js createSetEnd): "failed" = stuck in the lower 65% of the rep range with no
// movement >= 15% of the range (400 ms low-passed) for 3.5 s; Sets: a breather in the top 35% never runs the 15 s clock;
// "frame" (Sets) = body out of view 10 s, unless a phone pickup was just seen.
// Knees down / collapse / stand up form-break ends are unchanged; a phone pickup still never ends a set.
// Runs the real counter (push-counter.js), the real failure watch and the real set-end watch on synthetic landmark
// sequences, in browser (MoveNet) and app (iOS Vision / Android) counter modes. Run: node test/pushup-set-over.test.js
const S = require("./lib/push-synth.js"), PC = require("../push-counter.js"), SS = require("../push-session.js"), CH = require("../push-challenge.js");
const BS = require("./lib/break-synth.js");
let pass = 0, fail = 0; const check = (n, ok, info) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (info != null && !ok ? " (" + info + ")" : "")); };

// frame(t) -> kps; mode "sets" | "long". Same order as the live poseTick: count the rep, failure watch, then set-end watch.
function sim(frame, ms, mode, counterOpts) {
  const W = 640, ctr = PC.createCounter(counterOpts || {}), w = SS.createFailureWatch(), e = SS.createSetEnd();
  w.reset(0); e.reset(0);
  let end = null, at = null, by = null, lastRepT = 0;
  for (let t = 0; t <= ms && !end; t += 1000 / 30) {
    const kps = frame(t), r = ctr.update(kps, t, W), st = ctr.state();
    if (r.counted) lastRepT = t;
    const atTop = CH.atTopFrom(st);
    const f = w.update(kps, t, st.topSize ? st.topSize * W : 0, { frameW: W, atTop, reps: st.reps, skipFrame: mode !== "sets" });
    if (f && st.reps >= 1) { end = f; at = t; by = "form"; break; }
    const x = e.update({ mode, reps: st.reps, t, atTop, counter: st, kps, liftedAt: w.liftedAt() });
    if (x) { end = x; at = t; by = "set-end"; }
  }
  return { end, at: at && Math.round(at), by, reps: ctr.state().reps, lastRepT: Math.round(lastRepT) };
}
// repPose: side-on push-up reps, 2 s each (top -> bottom -> top), from the break-synth poses.
const repPose = (t) => { const p = (t % 2000) / 2000, f = p < 0.45 ? p / 0.45 : p < 0.55 ? 1 : (1 - p) / 0.45; return BS.lerp(BS.POSE.top, BS.POSE.bottom, Math.max(0, Math.min(1, f))); };
const moveTo = (from, to, t0, ms) => (t) => BS.lerp(from, to, Math.max(0, Math.min(1, (t - t0) / ms)));
const synth = (segs, cfg) => { S.reseed(11); const c = Object.assign({}, S.BASE, cfg || {}); return (t) => S.frameFor(S.fracAt(segs, t), c, t); };
const ENG = { browser: [{}, {}], app: [{ app: true }, { noise: 0.004, drop: 0.05 }] };
const REP = 2000, N = 4, T0 = N * REP; // 4 clean reps, then the scenario starts at 8 s

for (const [eng, [copts, cfg]] of Object.entries(ENG)) {
  for (const mode of ["sets", "long"]) {
    const tag = `${eng}/${mode}`;
    // 1. FAILURE at the bottom: lowers for rep 5 and can't push back up (stays down, small struggle wobble from noise).
    {
      const r = sim(synth([...S.reps(N, REP), [900, 0, 1], [20000, 1, 1]], cfg), T0 + 20000, mode, copts);
      check(`${tag}: failed at the bottom (can't push back up) -> set over as 'failed' ~3.5 s after stopping, ${N} reps kept (${r.end} at ${r.at}, reps ${r.reps})`,
        r.end === "failed" && r.reps === N && r.at >= T0 + 900 + 3400 && r.at <= T0 + 900 + 4500, JSON.stringify(r));
    }
    // 2. FAILURE mid-rep: stuck 55% down, never pressed out.
    {
      const r = sim(synth([...S.reps(N, REP), [600, 0, 0.55], [20000, 0.55, 0.55]], cfg), T0 + 20000, mode, copts);
      check(`${tag}: stuck mid-rep (55% down) -> 'failed' within ~4.5 s, ${N} reps kept (${r.end} at ${r.at})`, r.end === "failed" && r.reps === N && r.at <= T0 + 600 + 4500, JSON.stringify(r));
    }
    // 3. FAILURE, collapsed flat: drops below the bottom of the rep and lies there.
    {
      const r = sim(synth([...S.reps(N, REP), [700, 0, 1.35], [20000, 1.35, 1.35]], cfg), T0 + 20000, mode, copts);
      check(`${tag}: FAILURE, collapsed flat -> set over within ~5.5 s, ${N} reps kept (${r.end} at ${r.at})`,
        (r.end === "failed" || r.end === "collapse") && r.reps === N && r.at <= T0 + 700 + 5500, JSON.stringify(r));
    }
    // 4. Normal SLOW set -> never ends. Browser counter: a rep must finish inside 6 s (maxRepMs), so 2 s down, 1.5 s pause,
    //    2 s up; app counters have no speed cap: 3 s down, 2 s pause at the bottom, 3 s up.
    {
      const [dn, ps, up] = eng === "app" ? [3000, 2000, 3000] : [2000, 1500, 2000], per = dn + ps + up;
      const slow = Array.from({ length: 6 }, () => [[dn, 0, 1], [ps, 1, 1], [up, 1, 0]]).flat();
      const r = sim(synth([...S.reps(2, REP), ...slow, [1500, 0, 0]], cfg), 2 * REP + 6 * per + 1500, mode, copts);
      check(`${tag}: normal slow set (${dn / 1000} s down, ${ps / 1000} s bottom pause, ${up / 1000} s up) -> no end, all reps counted (${r.end}, reps ${r.reps})`, r.end === null && r.reps === 8, JSON.stringify(r));
    }
    // 5. Brief rest at the top (lockout 20 s, then a relaxed breather 25% down 15 s), then 3 more reps -> never ends.
    {
      const r = sim(synth([...S.reps(N, REP), [20000, 0, 0], [500, 0, 0.25], [15000, 0.25, 0.25], [500, 0.25, 0], ...S.reps(3, REP), [1000, 0, 0]], cfg), T0 + 36000 + 3 * REP + 1000, mode, copts);
      check(`${tag}: rest at the top (20 s lockout + 15 s breather 25% down) then more reps -> no end (${r.end}, reps ${r.reps})`, r.end === null && r.reps === N + 3, JSON.stringify(r));
    }
  }
}

// 6. Phone pickup must never end the set: shoulders AND hands jump together (camera moved), then held still off-plank.
{
  for (const lose of [false, true]) {
    S.reseed(11);
    const c = Object.assign({}, S.BASE), segs = [...S.reps(N, REP), [1000, 0, 0]], T1 = T0 + 1000;
    const r = sim((t) => {
      const k = S.frameFor(S.fracAt(segs, Math.min(t, T1)), c, t);
      if (t < T1) return k;
      if (lose && t > T1 + 800) return [];
      const f = Math.min(1, (t - T1) / 300); return k.map((p) => Object.assign({}, p, { x: p.x + 40 * f, y: p.y + 190 * f }));
    }, T1 + 40000, "sets");
    check(`sets: phone picked up after ${N} reps${lose ? " and the body leaves the picture" : " (picture shifted, held still)"}: no end in 40 s (${r.end} at ${r.at})`, r.end === null && r.reps === N, JSON.stringify(r));
  }
}

// 7. GIVING UP (full body, side-on): knees down and stayed, stood up, walked out. Form-break ends unchanged.
function bodySim(frame, ms, mode) {
  const w = SS.createFailureWatch(), e = SS.createSetEnd(); w.reset(0); e.reset(0);
  const reps = (t) => (t < 1500 ? 0 : Math.min(3, 1 + Math.floor((t - 1500) / 2000)));
  for (let t = 0; t <= ms; t += 33) {
    const kps = frame(t), atTop = t < 7000 ? ((t % 2000) / 2000 < 0.2) : false;
    const f = w.update(kps, t, 0, { frameW: 640, atTop, reps: reps(t), skipFrame: mode !== "sets" }); if (f) return { end: f, at: t };
    const x = e.update({ mode, reps: reps(t), t, atTop, kps, liftedAt: w.liftedAt() }); if (x) return { end: x, at: t };
  }
  return { end: null };
}
{
  const B = 7000, pre = (t) => BS.kpsOf(repPose(t));
  const kn = bodySim((t) => (t < B ? pre(t) : BS.kpsOf(moveTo(BS.POSE.top, BS.POSE.knees, B, 500)(t))), B + 10000, "sets");
  check(`sets: knees down and stayed -> 'knees' within ~2 s (${kn.end} at ${kn.at})`, kn.end === "knees" && kn.at <= B + 2500, JSON.stringify(kn));
  const st = bodySim((t) => (t < B ? pre(t) : BS.kpsOf(moveTo(BS.POSE.top, BS.POSE.stand, B, 800)(t))), B + 10000, "sets");
  check(`sets: stood up -> 'standing' within ~3 s (${st.end} at ${st.at})`, st.end === "standing" && st.at <= B + 3000, JSON.stringify(st));
  // FAILURE seen side-on (full body): chest down on the floor and no press back up -> collapse (existing 4 s rule, unchanged).
  const flat = bodySim((t) => (t < B ? pre(t) : BS.kpsOf(moveTo(BS.POSE.bottom, BS.POSE.collapse, B, 500)(t))), B + 10000, "sets");
  check(`sets (side-on): collapsed onto the floor, can't push back up -> 'collapse' within ~5 s (${flat.end} at ${flat.at})`, flat.end === "collapse" && flat.at <= B + 5000, JSON.stringify(flat));
  const walk = bodySim((t) => (t < B ? pre(t) : t < B + 300 ? BS.kpsOf(BS.POSE.top) : []), B + 15000, "sets");
  check(`sets: walked out of the picture -> 'frame' 10 s after the body left (${walk.end} at ${walk.at})`, walk.end === "frame" && walk.at >= B + 10000 && walk.at <= B + 10500, JSON.stringify(walk));
  const walkT = bodySim((t) => (t < B ? pre(t) : t < B + 300 ? BS.kpsOf(BS.POSE.top) : []), B + 40000, "long");
  check(`TUT: out of the picture keeps pausing (no frame end in 40 s) (${walkT.end})`, walkT.end === null, JSON.stringify(walkT));
}
// 8. Defaults are what the comments say.
check("SET_END defaults: stuckMs 3500, stuckFrac 0.35, moveFrac 0.15 (emaMs 400), frameMs 10000 (Sets), liftGraceMs 3000; 15 s / 45 s kept",
  SS.SET_END.stuckMs === 3500 && SS.SET_END.stuckFrac === 0.35 && SS.SET_END.moveFrac === 0.15 && SS.SET_END.emaMs === 400 && SS.SET_END.frameMs === 10000 && SS.SET_END.liftGraceMs === 3000 &&
  SS.SET_END.frameModes.sets && !SS.SET_END.frameModes.long && !SS.SET_END.stuckModes.battle && SS.SET_END.stallMs === 15000 && SS.SET_END.setsIdleMs === 45000 && SS.FAIL_TEXT.failed && SS.FAIL_TEXT.frame);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
