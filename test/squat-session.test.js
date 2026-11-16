// Gyatt Squats set end: 15 s stall at the bottom, 45 s no rep, sit-and-stay vs a normal 4 s bottom, hands down,
// left frame, End set; wobbles / brief loss / moving never end a set.
const SC = require("../squat-counter.js"), SS = require("../squat-session.js");
const { pose, repProfile } = require("./lib/squat-synth.js");
let pass = 0, fail = 0;
const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || why == null ? "" : " :: " + why}`); ok ? pass++ : fail++; };
function newSet() { const c = SC.createCounter(); for (let t = 0; t < 900; t += 33) c.calibrate(pose(0), t); const s = SS.createSquatSet({ counter: c }); s.start(1000); return s; }
function run(s, t0, frames, o) { let r, t = t0; for (const f of frames) { t = t0 + f.t; r = s.update(pose(f.d, Object.assign({}, o, f.o)), t, f.x); if (r.ended) break; } return { r, t }; }
const hold = (d, ms, o) => { const a = []; for (let t = 0; t < ms; t += 33) a.push({ t, d, o }); return a; };

{ const s = newSet(); let t = 1000, r; for (let i = 0; i < 10; i++) { ({ r, t } = run(s, t + 33, repProfile(1.0))); }
  check("10 cadence reps (12.5 s each, 4 s still at the bottom): no end, 10 reps", !r.ended && r.reps === 10, JSON.stringify([r.ended, r.reps, r.reason])); }
{ const s = newSet(); const { r } = run(s, 1000, [...repProfile(1.0, { holdMs: 0, upMs: 0, topMs: 0 }), ...hold(0.7, 20000).map((f) => ({ t: f.t + 3000, d: 0.7 + (Math.floor(f.t / 500) % 2 ? 0.08 : -0.08) }))]);
  check("15 s stalled at the bottom (moving a little, no rep) ends 'stall_bottom' at ~15 s", r.ended && r.reason === "stall_bottom" && r.ms >= 15000 && r.ms < 18500, JSON.stringify([r.reason, r.ms])); }
{ const s = newSet(); const { r } = run(s, 1000, hold(0, 50000, { noise: 2 }));
  check("45 s standing with no rep ends 'no_rep' at 45 s", r.ended && r.reason === "no_rep" && Math.abs(r.ms - 45000) < 100, JSON.stringify([r.reason, r.ms])); }
{ const s = newSet(); let t = 1000, r; ({ r, t } = run(s, t, repProfile(1.0)));
  ({ r } = run(s, t + 33, hold(0, 50000)));
  check("45 s timer restarts at each rep (ends 45 s after the last rep)", r.reason === "no_rep" && r.reps === 1 && r.ms > 50000, JSON.stringify([r.reason, r.ms])); }
{ const s = newSet(); const { r } = run(s, 1000, [...repProfile(1.0, { holdMs: 0, upMs: 0, topMs: 0 }), ...hold(1.0, 12000).map((f) => ({ t: f.t + 3000, d: 1.0 }))]);
  check("sat down and stayed down (hips at parallel, still) ends 'sat' after 8 s, before the 15 s stall", r.ended && r.reason === "sat" && r.ms >= 11000 && r.ms < 12500, JSON.stringify([r.reason, r.ms])); }
{ const s = newSet(); let t = 1000, r; ({ r, t } = run(s, t, repProfile(1.0, { holdMs: 4000 })));
  ({ r, t } = run(s, t + 33, repProfile(1.2, { holdMs: 6000 })));
  check("a normal still bottom (4 s, and even 6 s) is NOT sitting: no end, reps count", !r.ended && r.reps === 2, JSON.stringify([r.ended, r.reason, r.reps])); }
{ const s = newSet(); const fr = repProfile(1.8, { holdMs: 3000, upMs: 0, topMs: 0 });
  const { r } = run(s, 1000, fr);
  check("dropped to the floor (hips far below the knees 1.5 s) ends 'sat'", r.ended && r.reason === "sat", JSON.stringify([r.reason, r.ms])); }
{ const s = newSet(); const fr = repProfile(1.0, { holdMs: 3000, upMs: 0, topMs: 0 }).map((f) => ({ t: f.t, d: f.d, o: f.t > 3000 ? { wrists: "floor" } : {} }));
  const { r } = run(s, 1000, fr);
  check("hands down on the floor for 1 s while down ends 'hands_down'", r.ended && r.reason === "hands_down", JSON.stringify([r.reason, r.ms])); }
{ const s = newSet(); const short = repProfile(1.0, { holdMs: 3000, upMs: 0, topMs: 0 }).map((f) => ({ t: f.t, d: f.d, o: f.t > 3000 && f.t < 3500 ? { wrists: "floor" } : {} }));
  const { r } = run(s, 1000, short);
  check("a brief hand touch (0.5 s) does not end the set", !r.ended); }
{ const s = newSet(); let t = 1000, r; ({ r, t } = run(s, t, repProfile(1.0)));
  ({ r } = run(s, t + 33, hold(0, 4000, { drop: ["left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"] })));
  check("out of frame for 3 s ends 'left_frame'", r.ended && r.reason === "left_frame" && r.reps === 1); }
{ const s = newSet(); let t = 1000, r; ({ r, t } = run(s, t, repProfile(1.0).filter((f) => f.t < 6000)));
  ({ r, t } = run(s, t + 33, hold(1.0, 2000, { drop: ["left_ankle", "right_ankle"] })));
  check("brief tracking loss (2 s) mid-rep never ends the set", !r.ended);
  ({ r, t } = run(s, t + 33, repProfile(1.0).filter((f) => f.t >= 6000).map((f) => ({ t: f.t - 6000, d: f.d }))));
  check("... and the rep still counts after", !r.ended && r.reps === 1, JSON.stringify([r.ended, r.reps])); }
{ const s = newSet(); let t = 1000, r; for (let i = 0; i < 3; i++) ({ r, t } = run(s, t + 33, repProfile(1.0, {}), { noise: 3 }));
  check("±3 px wobble on every frame through 3 reps: no end, 3 reps (mid-set no false end)", !r.ended && r.reps === 3, JSON.stringify([r.ended, r.reason, r.reps])); }
{ const s = newSet(); let t = 1000, r; ({ r, t } = run(s, t, repProfile(1.0)));
  ({ r, t } = run(s, t + 33, hold(0, 3000).map((f) => ({ t: f.t, d: 0, o: { scale: 1 + 0.3 * f.t / 3000 } }))));
  check("walking to a new spot mid-set never ends it", !r.ended);
  ({ r, t } = run(s, t + 33, hold(0, 3000).map((f) => ({ t: f.t, d: 0.2 * Math.sin(f.t / 500), o: { bend: 0.9 } }))));
  check("bending over mid-set never ends it", !r.ended); }
{ const s = newSet(); let t = 1000, r; ({ r, t } = run(s, t, repProfile(1.0)));
  const e = s.stop(t + 500);
  check("End set: ends 'stopped' with the reps so far", e.ended && e.reason === "stopped" && e.reps === 1 && e.ms === Math.round(t + 500 - 1000));
  check("after the end, frames change nothing", s.update(pose(0), t + 2000).reason === "stopped" && s.update(pose(0), t + 2000).reps === 1); }
check("limits: 15 s stall, 45 s no rep, 8 s sit, 3 s out of frame, 1000 reps max", SS.L.stallBottomMs === 15000 && SS.L.noRepMs === 45000 && SS.L.sitStillMs === 8000 && SS.L.missingMs === 3000 && SS.L.maxReps === 1000);
check("reason text", SS.reasonText("sat") === "sat down" && SS.reasonText("stopped") === "End set");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
