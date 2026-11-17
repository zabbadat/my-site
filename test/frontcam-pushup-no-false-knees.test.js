// Nov 17 2026 (owner, real iPhone): a normal mid-set push-up ended the set as "Knees down" and the rep never counted.
// Cause: front / three-quarter camera, ankles below kneeMin, so the guard used the ankle-less "folded legs" cue (knee at
// about hip height). Straight plank legs running away from the lens project exactly like that while the hips stay high
// above the planted hands. Fixture: the failure-watch input recorded on live 75fccdb with a push-up-only clip, through the
// iOS Vision stand-in and through plain MoveNet (both ended "Knees down" mid push-up). A real kneel (hips dropped to the
// hand line) still ends the set. Run: node test/frontcam-pushup-no-false-knees.test.js
const path = require("path");
const SS = require("../push-session.js");
const FX = require(path.join(__dirname, "fixtures", "frontcam-pushup-frames.json"));
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (x != null ? "  [" + x + "]" : "")); };
function replay(frames) { const w = SS.createFailureWatch(); let r = null; for (const f of frames) { r = w.update(f.kps, f.t, f.tw, f.ex) || r; if (r) break; } return r; }
check("recorded iOS Vision push-up frames: no set end", replay(FX.ios_vision) === null, replay(FX.ios_vision));
check("recorded MoveNet push-up frames: no set end", replay(FX.movenet) === null, replay(FX.movenet));
// the same push-up held 3 s more (top frames repeated at 30 fps): still no end
{ const base = FX.ios_vision; const last = base[base.length - 1]; const more = base.slice(); for (let i = 1; i <= 90; i++) more.push(Object.assign({}, base[i % base.length], { t: last.t + i * 33 }));
  check("push-up frames looped for 3 s: no set end", replay(more) === null, replay(more)); }
// real kneel, ankles hidden: hips drop to the hand line -> still "knees"
{ const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
  const kneel = () => K({ left_shoulder: [256, 170], right_shoulder: [384, 170], left_wrist: [240, 370], right_wrist: [400, 370], nose: [320, 140], left_hip: [300, 345], left_knee: [310, 362], right_hip: [340, 345], right_knee: [350, 362] });
  const w = SS.createFailureWatch(); w.reset(0); let r = null; for (let t = 0; t < 2500; t += 33) r = w.update(kneel(), t, 128, { frameW: 640 }) || r;
  check("real front kneel (hips at hand height, no ankles): still ends as knees", r === "knees", r); }
// plank-high hips, knees at hip height, no ankles, no wrists (no floor line): never a fail
{ const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
  const f = () => K({ left_shoulder: [270, 150], right_shoulder: [370, 150], left_hip: [290, 205], left_knee: [295, 240], right_hip: [350, 210], right_knee: [345, 245] });
  const w = SS.createFailureWatch(); w.reset(0); let r = null; for (let t = 0; t < 3000; t += 33) r = w.update(f(), t, 120, { frameW: 640 }) || r;
  check("knee at hip height, no ankles, no wrists: no set end", r === null, r); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
