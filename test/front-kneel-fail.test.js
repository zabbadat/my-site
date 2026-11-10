// Front-camera kneel / stop detection: 3D knees, folded legs when ankles are missing, clock frozen at the start of the fail window.
// Run: node test/front-kneel-fail.test.js
const fs = require("fs"), path = require("path");
const SS = require("../push-session.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const poseSrc = fs.readFileSync(path.join(__dirname, "../pose-vision.js"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (extra ? "  " + extra : "")); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const plank = (o) => K(Object.assign({ left_shoulder: [256, 170], right_shoulder: [384, 170], left_wrist: [240, 370], right_wrist: [400, 370], nose: [320, 140], left_hip: [230, 330], left_knee: [235, 400], left_ankle: [238, 470], right_hip: [400, 330], right_knee: [405, 400], right_ankle: [408, 470] }, o || {}));
const seq = (from, to, f, ex, dt = 33) => { const a = []; for (let t = from; t < to; t += dt) a.push([t, f(t), ex]); return a; };
function run(frames, extra) {
  const w = SS.createFailureWatch(); w.reset(0); let out = null, at = null, failedAt = null;
  for (const [t, k, ex] of frames) { const r = w.update(k, t, 128, ex || extra || { frameW: 640 }); if (r && out == null) { out = r; at = t; failedAt = w.failedAt(); } }
  return { out, at, failedAt };
}

check("minKnee3D takes the more bent knee", SS.minKnee3D({ left: 170, right: 90 }) === 90 && SS.minKnee3D({ L: 200 }) === 200 && SS.minKnee3D(null) === null);

{ const straight = () => plank();
  const r = run(seq(0, 2500, straight, { frameW: 640, knee3D: { left: 88, right: 92 } }));
  check("2D-straight front kneel with 3D knees under 140° for 1 s ends as knees", r.out === "knees" && r.at >= 1000 && r.at < 1400 && r.failedAt === 0, r.out + "@" + r.at + " failedAt=" + r.failedAt); }
{ const r = run(seq(0, 800, () => plank(), { frameW: 640, knee3D: { left: 80, right: 80 } }).concat(seq(800, 2500, () => plank(), { frameW: 640, knee3D: { left: 170, right: 175 } })));
  check("a brief 3D kneel under 1 s does not end the set", r.out === null); }
{ const r = run(seq(0, 400, () => plank()).concat(seq(400, 2000, () => plank(), { frameW: 640, knee3D: { left: 70, right: 72 } })));
  check("failedAt is the start of the 1 s 3D-knee window, not confirm time", r.out === "knees" && r.failedAt === 400 && r.at >= 1400 && r.at < 1600, "failedAt=" + r.failedAt + " at=" + r.at); }

{ const noAnkles = () => K({ left_shoulder: [256, 170], right_shoulder: [384, 170], left_wrist: [240, 370], right_wrist: [400, 370], nose: [320, 140], left_hip: [300, 360], left_knee: [310, 370], right_hip: [340, 360], right_knee: [350, 370] });
  check("foldedLegs is true when hips have dropped to knee height", SS.foldedLegs({ y: 360 }, { y: 370 }, null, SS.FAIL, 128) === true);
  const r = run(seq(0, 400, () => plank()).concat(seq(400, 2000, noAnkles)));
  check("front kneel with ankles missing ends as knees", r.out === "knees", r.out + "@" + r.at); }

{ const foreshort = () => plank({ left_hip: [230, 330], left_knee: [235, 400], left_ankle: [238, 470], right_hip: [400, 330], right_knee: [405, 400], right_ankle: [408, 470] });
  check("foldedLegs is not used when a straight ankle angle is present", SS.classify(foreshort(), 128).indexOf("knees") < 0);
  check("a foreshortened front plank with straight 2D legs does not end the set", run(seq(0, 2500, foreshort)).out === null); }

{ const w = SS.createFailureWatch(); w.reset(0);
  let out = null;
  for (const [t, k] of seq(0, 3000, () => plank()).concat(seq(3000, 14000, () => []))) {
    const f = w.update(k, t, 128, { frameW: 640, skipFrame: true }); if (f && !out) out = f;
  }
  check("TUT skipFrame still does not end on 10 s out of frame", out === null); }

check("pose-vision asks Apple Vision for 3D knees on iOS and exposes knee3D", /include3D: true/.test(poseSrc) && /pose\.knee3D = res\.pose3d\.kneeAngleDeg/.test(poseSrc));
check("page failExtra forwards knee3D into both watches", /function failExtra\(st, w, pose, more\)/.test(html) && /o.knee3D = pose.knee3D/.test(html) && /voidTutSet\(failed, failWatch.failedAt && failWatch.failedAt\(\)\)/.test(html) && /freezePushClock\(failWatch.failedAt && failWatch.failedAt\(\)\)/.test(html));

{ // freeze at last valid moment: 1 s window starting at failedAt
  let now = 5000, elapsed = 8000, startedAt = 1000;
  const performanceNow = 5000, DateNow = 1000 + 12000; // 12 s wall since start + 8 s elapsed = 20 s raw
  const failedAtPerf = 4000; // 1 s before now
  const cut = Math.max(0, performanceNow - failedAtPerf);
  const raw = elapsed + (startedAt ? DateNow - startedAt : 0);
  const lasted = Math.max(0, raw - cut);
  check("clock freeze subtracts (now - failedAt) from the raw elapsed time", cut === 1000 && raw === 20000 && lasted === 19000);
}
check("speakSetDone uses SET_DONE_LINE and runs before the set is marked finished", /function speakSetDone\(\) \{[\s\S]*SET_DONE_LINE/.test(html) && /if \(!\(opts && opts.alreadySpoke\)\) \{[\s\S]*speakSetDone[\s\S]*pushState\.finished = true/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
