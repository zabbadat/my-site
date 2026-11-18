// Gyatt Squats counter (front view): depth, full stand, half reps, hysteresis, foreshortening, 3D knee path, guards.
const SC = require("../squat-counter.js");
const { pose, repProfile } = require("./lib/squat-synth.js");
let pass = 0, fail = 0;
const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || why == null ? "" : " :: " + why}`); ok ? pass++ : fail++; };

function calibrated(o) { const c = SC.createCounter(); let t = 0, r; for (; t < 900; t += 33) r = c.calibrate(pose(0, o), t); return { c, t, ok: r && r.ok }; }
function feed(c, t0, frames, o, extraFn) { let last, t = t0; frames.forEach((f) => { t = t0 + f.t; last = c.update(pose(f.d, Object.assign({}, o, f.o)), t, extraFn ? extraFn(f) : undefined); }); return { last, t }; }
function reps(depth, n, popts, o, extraFn) { const { c, t } = calibrated(o); let tt = t + 33; let half = 0, last;
  for (let i = 0; i < n; i++) { const r = feed(c, tt, repProfile(depth, popts), o, extraFn); tt = r.t + 33; last = r.last; } return { c, last, t: tt }; }

{ const { c, ok } = calibrated(); check("calibration during setup: standing baseline after 0.5 s of upright frames", ok && c.baseline().thigh === 90 && c.baseline().leg === 180); }
{ const r = SC.createCounter().calibrate(pose(0.5), 0); check("calibration refuses a bent-knee frame (stand tall)", r.ok === false); }
{ const r = reps(1.0, 5); check("5 full-depth reps (reach parallel, then stand) = 5 reps", r.last.reps === 5 && r.last.halfReps === 0, JSON.stringify([r.last.reps, r.last.halfReps])); }
{ const r = reps(0.5, 3); check("depth just past threshold (hips 50 % of thigh down) counts", r.last.reps === 3); }
{ const r = reps(0.3, 4); check("half reps (30 % depth) never count; tracked as half reps", r.last.reps === 0 && r.last.halfReps === 4); }
{ // reach depth but never stand fully: stays below the top band, no rep until the full stand
  const { c, t } = calibrated(); let tt = t;
  const part = repProfile(1.0, { upMs: 4000, topMs: 0 }).map((f) => ({ t: f.t, d: Math.max(f.d, 0.3) }));
  let r = feed(c, tt, part); check("depth reached but no full stand (hips stay 30 % down): no rep", r.last.reps === 0);
  r = feed(c, r.t + 33, [{ t: 0, d: 0.05 }, { t: 100, d: 0.02 }, { t: 200, d: 0 }, { t: 300, d: 0 }]); check("then standing all the way up completes the rep", r.last.reps === 1);
}
{ // hysteresis: hips hovering around the depth line and the top line
  const { c, t } = calibrated(); const fr = []; let tt = 0;
  for (let i = 0; i < 90; i++) fr.push({ t: (tt += 33), d: 0.15 * i / 90 + 0 }); // descend to 0.15
  for (let i = 0; i < 60; i++) fr.push({ t: (tt += 33), d: 0.15 + 0.35 * i / 60 });
  for (let i = 0; i < 120; i++) fr.push({ t: (tt += 33), d: 0.45 + (i % 2 ? 0.03 : -0.03) }); // jitter 0.42 / 0.48 around depth
  for (let i = 0; i < 60; i++) fr.push({ t: (tt += 33), d: 0.45 - 0.35 * i / 60 });
  for (let i = 0; i < 120; i++) fr.push({ t: (tt += 33), d: 0.11 + (i % 2 ? 0.03 : -0.03) }); // jitter 0.08 / 0.14 around top
  for (let i = 0; i < 30; i++) fr.push({ t: (tt += 33), d: 0 });
  const r = feed(c, t, fr);
  check("hysteresis: jitter around the depth line and the top line = exactly 1 rep", r.last.reps === 1, r.last.reps);
}
{ // front foreshortening: knees straight at the camera, 2D knee stays ~180 even at depth -> counted from hip drop
  const r = reps(0.9, 3, {}, { kneeOut: 0 });
  const k = SC.measure(pose(0.9, { kneeOut: 0 })).knee2D;
  check("front foreshortening: 2D knee ~" + Math.round(k) + " deg at depth still counts from hip drop (3/3)", k > 165 && r.last.reps === 3);
}
{ // clearly bent 2D knee lowers the needed drop to 0.38
  const k = SC.measure(pose(0.4, { kneeOut: 120 })).knee2D;
  const r = reps(0.4, 2, {}, { kneeOut: 120 });
  const r2 = reps(0.4, 2, {}, { kneeOut: 0 });
  check("2D knee <= 120 deg (" + Math.round(k) + ") lets a 40 % drop count; the same drop with a straight 2D knee does not", k <= 120 && r.last.reps === 2 && r2.last.reps === 0, [r.last.reps, r2.last.reps]);
}
{ // iOS Vision 3D knee path
  const k3 = (deep, top) => (f) => ({ knee3D: f.d >= 0.4 ? deep : f.d <= 0.05 ? top : 140 });
  const a = reps(0.6, 3, {}, {}, k3(95, 170));
  check("3D path: knee3D 95 deg at the bottom, 170 at the top = 3 reps", a.last.reps === 3, a.last.reps);
  const b = reps(0.6, 3, {}, {}, k3(125, 170));
  check("3D path: knee3D only 125 deg (not deep) = no reps even with hips 60 % down", b.last.reps === 0 && b.last.halfReps === 3, [b.last.reps, b.last.halfReps]);
  const c = reps(0.6, 2, {}, {}, k3(95, 150));
  check("3D path: never straightening past 160 deg at the top = no rep", c.last.reps === 0, c.last.reps);
  const d = reps(0.6, 2, {}, {}, () => ({ knee3D: { left: 96, right: 99 } }));
  check("3D knee given as {left,right}: the smaller (deeper) knee is used", SC.knee3DOf({ knee3D: { left: 96, right: 99 } }) === 96 && SC.knee3DOf({ pose3d: { kneeAngleDeg: 101 } }) === 101);
}
{ // walk toward the camera: everything grows about the feet (hips drop in the picture) -> no reps
  const { c, t } = calibrated(); const fr = []; let tt = 0;
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i <= 45; i++) fr.push({ t: (tt += 33), d: 0, o: { scale: 1 + 0.35 * i / 45, dx: 0 } });
    for (let i = 0; i <= 45; i++) fr.push({ t: (tt += 33), d: 0, o: { scale: 1.35 - 0.35 * i / 45 } });
  }
  let last; fr.forEach((f) => { last = c.update(pose(f.d, f.o), t + f.t); });
  check("walking toward / away from the camera 3 times: 0 reps, 0 half reps", last.reps === 0 && last.halfReps === 0, [last.reps, last.halfReps]);
  let g; for (let i = 1; i <= 5; i++) g = c.update(pose(0, { scale: 1.4 }), t + tt + 33 * i);
  check("guard flags the move within 5 frames (scale " + g.scale.toFixed(2) + ")", g.guard === "moved");
  // stand still at the new spot -> re-calibrates, then squats count there
  let rr; for (let i = 0; i < 50; i++) rr = c.update(pose(0, { scale: 1.4 }), t + tt + 66 + i * 33);
  check("standing still 1.2 s at the new spot re-calibrates", rr.guard === "ok" && Math.abs(c.baseline().shW - 84) < 2, c.baseline().shW);
  const r = feed(c, t + tt + 2000, repProfile(1.0), { scale: 1.4 });
  check("after re-calibration a full squat at the new distance counts", r.last.reps === 1, r.last.reps);
}
{ // a walk in the middle of a rep voids it
  const { c, t } = calibrated(); let tt = t;
  let r = feed(c, tt, repProfile(1.0).filter((f) => f.t < 5000));
  r = feed(c, r.t + 33, [{ t: 0, d: 1.0, o: { scale: 1.3 } }, { t: 33, d: 1.0, o: { scale: 1.3 } }, { t: 66, d: 1.0, o: { scale: 1.3 } }]);
  r = feed(c, r.t + 33, repProfile(1.0).filter((f) => f.t >= 7000));
  check("a walk to a new distance mid-rep voids that rep", r.last.reps === 0, r.last.reps);
}
{ // bending over: shoulders come down to the hips, hips stay high
  const { c, t } = calibrated(); const fr = []; let tt = 0;
  for (let k = 0; k < 3; k++) { for (let i = 0; i <= 60; i++) fr.push({ t: (tt += 33), d: 0.2 * i / 60, o: { bend: i / 60 } }); for (let i = 0; i <= 60; i++) fr.push({ t: (tt += 33), d: 0.2 * (1 - i / 60), o: { bend: 1 - i / 60 } }); }
  let last, sawBent = false; fr.forEach((f) => { last = c.update(pose(f.d, f.o), t + f.t); if (last.guard === "bent") sawBent = true; });
  check("bending over (toe touches) 3 times: 0 reps, guard 'bent' seen", last.reps === 0 && sawBent, [last.reps, sawBent]);
}
{ // leaving the frame: no reps, no state change
  const { c, t } = calibrated();
  let r = feed(c, t, repProfile(1.0).filter((f) => f.t < 4000));
  const ph = r.last.phase;
  let m; for (let i = 0; i < 30; i++) m = c.update(pose(1.0, { drop: ["left_knee", "right_knee", "left_ankle", "right_ankle"] }), r.t + 33 * (i + 1));
  check("legs out of frame: frame 'missing', phase held (" + ph + ")", m.frame === "missing" && m.phase === ph && m.reps === 0);
  r = feed(c, r.t + 1100, repProfile(1.0).filter((f) => f.t >= 4000));
  check("back in frame: the rep finishes and counts", r.last.reps === 1, r.last.reps);
}
{ // debounce: two synthetic reps 0.5 s apart -> only the first counts
  const { c, t } = calibrated(); const fast = repProfile(1.0, { downMs: 100, holdMs: 120, upMs: 100, topMs: 200 });
  let r = feed(c, t, fast); r = feed(c, r.t + 10, fast);
  check("debounce: reps closer than 0.8 s count once", r.last.reps === 1, r.last.reps);
}
{ // wobble / noise at the top never starts a rep
  const { c, t } = calibrated(); let last; for (let i = 0; i < 300; i++) last = c.update(pose(0.05, { noise: 4 }), t + i * 33);
  check("10 s of ±4 px wobble standing: 0 reps, 0 half reps", last.reps === 0 && last.halfReps === 0);
}
{ const r = reps(1.0, 3, { downMs: 2000, holdMs: 500, upMs: 800, topMs: 400 });
  check("a quicker squat than the voice (2 s down, brief hold, quick rise) still counts from movement", r.last.reps === 3 && r.last.halfReps === 0, JSON.stringify([r.last.reps, r.last.halfReps])); }
{ const r = reps(1.0, 2, { downMs: 5000, holdMs: 4000, upMs: 2000, topMs: 1000 });
  check("a slower squat than the voice still counts from movement", r.last.reps === 2 && r.last.halfReps === 0, JSON.stringify([r.last.reps, r.last.halfReps])); }
{ const r = reps(1.0, 3, { downMs: 2000, holdMs: 400, upMs: 800, topMs: 400 }, { ankOut: 40 });
  check("wide stance (~2× shoulders, toes out) still calibrates and counts full-depth reps", r.last.reps === 3 && r.last.halfReps === 0 && r.last.stanceNarrow === false, JSON.stringify([r.last.reps, r.last.halfReps, r.last.stance, r.last.stanceNarrow])); }
{ const { c, t } = calibrated({ ankOut: 40 }); // wide stance (~2× shoulders) for a clean cave contrast
  const wide = { ankOut: 40 };
  let last;
  // descend with knees tracking out (good), stay at depth, stand
  last = feed(c, t, repProfile(1.0, { downMs: 2000, holdMs: 400, upMs: 800, topMs: 400 }), wide).last;
  check("wide stance at the top is not flagged as narrow", last.stanceNarrow === false && last.stance >= 1.45, last.stance);
  const { c: c2, t: t2 } = calibrated({ ankOut: 40 });
  const fr = []; let tt = 0;
  for (let i = 0; i <= 60; i++) fr.push({ t: (tt += 33), d: i / 60, o: { ankOut: 40, kneeOut: -30 } }); // knees collapse inward
  for (let i = 0; i < 20; i++) fr.push({ t: (tt += 33), d: 1, o: { ankOut: 40, kneeOut: -30 } });
  const cave = feed(c2, t2, fr, { ankOut: 40 });
  check("knees caving inward relative to the ankles is flagged (hint only, not a fail)", cave.last.kneesCave === true && cave.last.reps === 0 && cave.last.guard === "ok", JSON.stringify({ cave: cave.last.kneesCave, reps: cave.last.reps, guard: cave.last.guard, kneeW: cave.last.kneeW, ankW: cave.last.ankW }));
  // finish the stand with knees still in: still allowed to count if depth + stand happen
  const up = []; let u = 0;
  for (let i = 0; i <= 30; i++) up.push({ t: (u += 33), d: 1 - i / 30, o: { ankOut: 40, kneeOut: -30 } });
  for (let i = 0; i < 20; i++) up.push({ t: (u += 33), d: 0, o: { ankOut: 40, kneeOut: 0 } });
  const stood = feed(c2, cave.t + 33, up, { ankOut: 40 });
  check("knees-cave hint never withholds a full-depth rep", stood.last.reps === 1, stood.last.reps); }
{ const { c, t } = calibrated();
  const fr = []; let tt = 0;
  for (let i = 0; i <= 60; i++) fr.push({ t: (tt += 33), d: i / 60, o: { lean: 0.7 } });
  for (let i = 0; i < 15; i++) fr.push({ t: (tt += 33), d: 1, o: { lean: 0.7 } });
  const r = feed(c, t, fr);
  check("chest folding forward in the squat is flagged as chestDown (hint only)", r.last.chestDown === true && r.last.guard !== "moved", JSON.stringify({ chest: r.last.chestDown, guard: r.last.guard, torso: r.last.torso })); }
{ const { c, t } = calibrated(); // default synth stance is narrower than 1.5× shoulders
  let last; for (let i = 0; i < 10; i++) last = c.update(pose(0), t + 33 * (i + 1));
  check("a narrow stance is a setup hint only: still calibrated, never a fail", last.stanceNarrow === true && last.guard === "ok" && c.baseline(), JSON.stringify({ narrow: last.stanceNarrow, stance: last.stance, guard: last.guard })); }
check("thresholds: depth 0.45, top 0.12, 3D depth <= 100, top >= 160", SC.T.depth === 0.45 && SC.T.topAt === 0.12 && SC.T.depth3D === 100 && SC.T.top3D === 160);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
