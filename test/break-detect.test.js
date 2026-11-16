// Failure / stop detection precision on a labeled synthetic landmark set (test/lib/break-synth.js), every camera view:
// Sets (failure watch), TUT / 3:00 challenge (failure watch, out-of-frame off), TUT Battle (battle judge), plank hold.
// True breaks (knees down, collapse, stand up, hips sag; pike for plank only) must end the set within 2.5 s of onset (push-up chest
// on the floor: 4 s with no press, 6 s window; owner Nov 16); noise / jitter, single-
// frame dropouts and spikes, brief occlusion, head down / hood, hidden legs at low confidence, a brief wobble and a phone pickup
// must NEVER end it. Each scenario runs 12 s at 30 fps over 10 noise seeds. Prints a per-view table.
// TUT Battle has no sag / pike loss by its published rules (allowed loss reasons: standing, knees, frame, stopped, left).
// Run: node test/break-detect.test.js
const fs = require("fs"), path = require("path"), SY = require("./lib/break-synth.js"), SS = require("../push-session.js"), TB = require("../tut-battle.js"), PS = require("../plank-session.js");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const T = 12000, dt = 1000 / 30, WINDOW = 2500, SEEDS = [7, 11, 23, 42, 77, 101, 202, 303, 404, 505];
function viewsFor(SS, TB, PS) {
  return {
    "Sets": { kinds: ["push", "pushform"], make: () => { const w = SS.createFailureWatch(); w.reset(0); return (k, t, s) => w.update(k, t, (s && s.topWidth) || 0, { frameW: (s && s.dims && s.dims.w) || 640, atTop: false, reps: 2 }); } },
    "TUT / 3:00 challenge": { kinds: ["push", "pushform"], make: () => { const w = SS.createFailureWatch(); w.reset(0); return (k, t, s) => w.update(k, t, (s && s.topWidth) || 0, { frameW: (s && s.dims && s.dims.w) || 640, atTop: false, reps: 2, skipFrame: true }); } },
    "TUT Battle": { kinds: ["push"], make: () => { const j = TB.createJudge(SS.createPostureGuard({ holdMs: TB.RULES.postureHoldMs })); j.reset(0); return (k, t, s) => j.update(k, t, (s && s.topWidth) || 0, (s && s.dims && s.dims.w) || 640, false); } },
    "Plank / plank push press": { kinds: ["plank"], make: () => { const h = PS.createPlankHold(); return (k, t, s) => { const r = h.update(k, t, (s && s.dims) || { w: 640, h: 480 }); return r.ended && r.reason !== "stopped" ? r.reason : null; }; } }
  };
}
const VIEWS = viewsFor(SS, TB, PS);
const table = [];
for (const [view, V] of Object.entries(VIEWS)) {
  let tp = 0, fn = 0, fp = 0, tn = 0, early = 0; const lat = [], misses = [], fps = [];
  for (const sd of SEEDS) for (const s of SY.scenarios(sd)) {
    if (!s.kinds.some((k) => V.kinds.includes(k))) continue;
    const f = V.make(); let hit = null;
    for (let t = 0; t <= T; t += dt) { const r = f(s.frame(t), t, s); if (r) { hit = { t, r }; break; } }
    if (s.label === "break") {
      if (hit && hit.t < s.onset) { early++; fps.push(s.name + " (before onset)"); }
      else if (hit && hit.t - s.onset <= (s.window || WINDOW)) { tp++; lat.push(hit.t - s.onset); }
      else { fn++; misses.push(s.name); }
    } else if (hit) { fp++; fps.push(s.name + " -> " + hit.r + " @" + Math.round(hit.t)); } else tn++;
  }
  const prec = tp + fp + early ? tp / (tp + fp + early) : 1, rec = tp + fn ? tp / (tp + fn) : 1;
  table.push({ view, breaks: tp + fn + early, caught: tp, missed: fn, okRuns: tn + fp, falsePositives: fp + early, precision: +prec.toFixed(3), recall: +rec.toFixed(3), medianMs: Math.round(lat.sort((a, b) => a - b)[lat.length >> 1] || 0), maxMs: lat.length ? Math.round(Math.max(...lat)) : null });
  check(`${view}: zero false positives on ${tn + fp} must-not-fail runs (noise, dropouts, spikes, occlusion, hood, hidden legs, wobble, phone pickup)`, fp === 0 && early === 0 || (console.log("   ", [...new Set(fps)].slice(0, 6).join("; ")), false));
  check(`${view}: every true break ends within the allowed window (${tp}/${tp + fn}; max ${table[table.length - 1].maxMs} ms)`, fn === 0 || (console.log("   missed:", [...new Set(misses)].join("; ")), false));
  const minLat = view === "TUT Battle" ? 700 : 900; // battle posture window is 750 ms by rule, others 1 s
  check(`${view}: no instant end, every catch takes at least the debounce (${minLat} ms)`, lat.every((x) => x >= minLat));
}
console.table(table);
// rules that must not move
check("phone pickup never fails (failure watch endOn.lifted off; battle ignores 'lifted')", SS.FAIL.endOn.lifted === false);
check("plank START gate unchanged from 50c1ddf (sag 0.08/0.10, pike 0.10/0.12, maxTilt 50, sideSep 0.5, edgeFrac 0.06, readyMs 1500)", PS.PLANK.sagStart === 0.08 && PS.PLANK.sagKeep === 0.10 && PS.PLANK.pikeStart === 0.10 && PS.PLANK.pikeKeep === 0.12 && PS.PLANK.maxTilt === 50 && PS.PLANK.sideSep === 0.5 && PS.PLANK.edgeFrac === 0.06 && PS.PLANK.readyMs === 1500);
check("debounce windows: 1 s bad form, >= 5 frames, 75% bad, 300 ms dropout tolerance, 150 ms good-frame grace, form hysteresis 0.8", SS.FAIL.badMs === 1000 && SS.FAIL.minFrames === 5 && SS.FAIL.badRatio === 0.75 && SS.FAIL.gapMs === 300 && SS.FAIL.okGraceMs === 150 && SS.FAIL.formKeep === 0.8 && PS.PLANK.badMs === 1000 && PS.PLANK.gapMs === 300 && TB.RULES.gapMs === 300);
{ // the start gate is unchanged (a flat body still passes it), but lying on the floor is no longer timed as a plank
  const h = PS.createPlankHold(); let r; for (let t = 0; t < 6000 && !(r && r.ended); t += dt) r = h.update(SY.kpsOf(SY.POSE.collapse), t, { w: 640, h: 480 });
  check(`plank: lying flat on the floor is never credited as a hold (ends as collapse, ${r.ms} ms credited)`, r.ended && r.reason === "collapse" && r.ms <= 100 && PS.reasonText("collapse") === "Collapsed to the floor");
}

// ---- auto-end is primary: the suite never taps End set, and the button is not part of the detectors ----
check("auto-end works without any End set tap (this suite never calls endSetNow / plankEndSetNow / tbEndSetNow)", true);
check("failure detectors do not mention End set buttons", !/camEndBtn|plankEndBtn|tbEndBtn|endSetNow/.test(fs.readFileSync(path.join(__dirname, "../push-session.js"), "utf8") + fs.readFileSync(path.join(__dirname, "../plank-session.js"), "utf8") + fs.readFileSync(path.join(__dirname, "../tut-battle.js"), "utf8")));

// ---- before (b5614b0) vs after, same labeled set ----
function evaluate(SS, TB, PS) {
  const VIEWS = viewsFor(SS, TB, PS);
  const out = [];
  for (const [view, V] of Object.entries(VIEWS)) {
    let tp = 0, fn = 0, fp = 0, tn = 0, early = 0; const lat = [], misses = [];
    for (const sd of SEEDS) for (const s of SY.scenarios(sd)) {
      if (!s.kinds.some((k) => V.kinds.includes(k))) continue;
      const f = V.make(); let hit = null;
      for (let t = 0; t <= T; t += dt) { const r = f(s.frame(t), t, s); if (r) { hit = { t, r }; break; } }
      if (s.label === "break") {
        if (hit && hit.t < s.onset) { early++; }
        else if (hit && hit.t - s.onset <= (s.window || WINDOW)) { tp++; lat.push(hit.t - s.onset); }
        else { fn++; misses.push(s.name); }
      } else if (hit) { fp++; } else tn++;
    }
    const prec = tp + fp + early ? tp / (tp + fp + early) : 1, rec = tp + fn ? tp / (tp + fn) : 1;
    out.push({ view, breaks: tp + fn + early, caught: tp, missed: fn, okRuns: tn + fp, falsePositives: fp + early, precision: +prec.toFixed(3), recall: +rec.toFixed(3), medianMs: Math.round(lat.sort((a, b) => a - b)[lat.length >> 1] || 0), maxMs: lat.length ? Math.round(Math.max(...lat)) : null, misses: [...new Set(misses)] });
  }
  return out;
}
function loadRev(rev) {
  const { execSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "break-" + rev.slice(0, 7) + "-"));
  const root = path.join(__dirname, "..");
  for (const f of ["push-session.js", "plank-session.js", "tut-battle.js", "push-counter.js", "battle-presence.js"]) {
    fs.writeFileSync(path.join(dir, f), execSync("git show " + rev + ":" + f, { encoding: "utf8", cwd: root }));
  }
  return { SS: require(path.join(dir, "push-session.js")), PS: require(path.join(dir, "plank-session.js")), TB: require(path.join(dir, "tut-battle.js")) };
}
try {
  const beforeMods = loadRev("b5614b0");
  const before = evaluate(beforeMods.SS, beforeMods.TB, beforeMods.PS);
  const after = evaluate(SS, TB, PS);
  console.log("\nBefore (b5614b0):"); console.table(before.map(({ misses, ...r }) => r));
  console.log("After:"); console.table(after.map(({ misses, ...r }) => r));
  for (let i = 0; i < after.length; i++) {
    const b = before[i], a = after[i];
    check(`${a.view}: after has zero false positives (before ${b.falsePositives})`, a.falsePositives === 0);
    check(`${a.view}: after catches every break (${a.caught}/${a.breaks}, recall ${a.recall}; before ${b.caught}/${b.breaks}, recall ${b.recall})`, a.missed === 0 || (console.log("   missed after:", a.misses.join("; ")), false));
  }
} catch (e) {
  check("before/after vs b5614b0 ran", (console.log("   skip/fail:", e && e.message), false));
}

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
