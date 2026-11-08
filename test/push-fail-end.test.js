// Auto-end on form breaks: knees / collapse / elbows / stood up / break vs first-rep baseline. Phone pickup never ends. A long press and a rested upright or flipped lean do not end the set.
// Run: node test/push-fail-end.test.js
const fs = require("fs"), path = require("path");
const S = require("./lib/push-synth.js"), PC = require("../push-counter.js"), SS = require("../push-session.js"), CH = require("../push-challenge.js"), G = require("../get-set.js");
let pass = 0, fail = 0; const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (extra ? "  " + extra : "")); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const plank = (o) => K(Object.assign({ left_shoulder: [256, 170], right_shoulder: [384, 170], left_wrist: [240, 370], right_wrist: [400, 370], nose: [320, 140] }, o || {}));
const move = (kps, dx, dy) => kps.map((p) => ({ ...p, x: p.x + dx, y: p.y + (dy || 0) }));
const W = 640;
function run(frames, extra) {
  const w = SS.createFailureWatch(); w.reset(0); let out = null, at = null;
  for (const [t, k, ex] of frames) { const r = w.update(k, t, 128, ex || extra || { frameW: W }); if (r && out == null) { out = r; at = t; } }
  return { out, at };
}
const seq = (from, to, f, ex, dt = 33) => { const a = []; for (let t = from; t < to; t += dt) a.push([t, f(t), ex]); return a; };

check("front-facing setup, no prompt to rotate or switch cameras",
  G.COACH.pushups.place === "Lean your phone up in front of you, camera facing you." && G.COACH.tut.place === G.COACH.pushups.place &&
  !/rotate your phone|flip the camera|switch camera|turn the phone/i.test(G.COACH.pushups.place + G.COACH.pushups.criteria + G.COACH.tut.place + G.COACH.tut.criteria));

{ const r = run(seq(0, 500, () => plank()).concat(seq(500, 2200, () => plank({ left_hip: [300, 400], left_knee: [330, 300], left_ankle: [310, 420], right_hip: [340, 400], right_knee: [350, 300], right_ankle: [330, 420] }))));
  check("knees down ends the set", r.out === "knees" && r.at >= 1400 && r.at < 1700, r.out + "@" + r.at); }
{ // hip (200,200) knee (200,320) ankle ~(285,405): about 135°, under the 140° failure angle, over the old 130° flag
  const soft = () => plank({ left_hip: [200, 200], left_knee: [200, 320], left_ankle: [285, 405] });
  const r = run(seq(0, 400, () => plank()).concat(seq(400, 2200, soft)));
  check("softer kneel / collapse (about 135°) ends the set", r.out === "knees", r.out + "@" + r.at); }
{ const straight = () => plank({ left_hip: [230, 330], left_knee: [235, 400], left_ankle: [238, 470], right_hip: [400, 330], right_knee: [405, 400], right_ankle: [408, 470] });
  check("straight legs in a plank do not end the set", run(seq(0, 4000, straight)).out === null); }

const shrunk = () => K({ left_shoulder: [256, 170], right_shoulder: [316, 170], nose: [286, 140], left_wrist: [240, 370], right_wrist: [400, 370] });
check("shoulder shrink at the top (long press) does not end the set", run(seq(0, 400, () => plank()).concat(seq(400, 5000, shrunk)), { frameW: W, atTop: true }).out === null);

{ const up = () => plank({ left_shoulder: [256, 30], right_shoulder: [384, 30], nose: [320, 0] });
  const r = run(seq(0, 500, () => plank()).concat(seq(500, 2500, up)));
  check("stood up (shoulders rise out of the plank, hands stay) ends as standing", r.out === "standing", r.out + "@" + r.at); }
{ const hands = () => plank({ left_wrist: [250, 150], right_wrist: [390, 150] });
  const r = run(seq(0, 500, () => plank()).concat(seq(500, 2500, hands)));
  check("hands leave the floor ends as standing", r.out === "standing", r.out + "@" + r.at); }
{ const dropped = () => plank({ left_shoulder: [256, 420], right_shoulder: [384, 420], nose: [320, 390] });
  const r = run(seq(0, 500, () => plank()).concat(seq(500, 2500, dropped)));
  check("shoulders fall through the hands ends as collapse", r.out === "collapse", r.out + "@" + r.at); }

{ const r = run(seq(0, 600, () => plank()).concat(seq(600, 2000, () => move(plank(), 200, 40))));
  check("picking the phone up (view shifts together) does NOT end the set", r.out === null, String(r.out)); }
{ const r = run(seq(0, 600, () => plank()).concat(seq(600, 900, () => move(plank(), 200, 0)), seq(900, 2500, () => plank())));
  check("a short camera bump (0.3 s) does not end the set", r.out === null); }
{ const tilt = () => plank({ right_shoulder: [384, 170 + 170] });
  const r = run(seq(0, 600, () => plank()).concat(seq(600, 2000, tilt)));
  check("picking the phone up (shoulder line tilts) does NOT end the set", r.out === null, String(r.out)); }

check("rested upright lean (stable) is not a pickup", run(seq(0, 8000, () => plank())).out === null);
{ const flipped = () => K({ left_shoulder: [384, 300], right_shoulder: [256, 300], left_wrist: [400, 500], right_wrist: [240, 500], nose: [320, 340] });
  check("rested flipped lean (stable, shoulders still level) is not a pickup", run(seq(0, 8000, flipped)).out === null);
  const tilted = () => K({ left_shoulder: [384, 300], right_shoulder: [256, 460], left_wrist: [400, 500], right_wrist: [240, 500], nose: [320, 360] });
  const r = run(seq(0, 800, flipped).concat(seq(800, 2500, tilted)));
  check("flipped lean, then the phone is tilted up, does NOT end the set", r.out === null, String(r.out)); }

{ const upright = () => K({ left_shoulder: [300, 80], right_shoulder: [360, 80], left_hip: [300, 250], left_knee: [302, 350], left_ankle: [304, 450], left_wrist: [280, 200], right_wrist: [380, 200] });
  check("upright body while held at the top does not end the set (press is not a stand-up)", run(seq(0, 4000, upright), { frameW: W, atTop: true }).out === null);
  const r = run(seq(0, 4000, upright), { frameW: W, atTop: false });
  check("upright body when not at the top ends as standing", r.out === "standing", r.out); }

// Reps, a long press, then more reps: the counter path, same as a real set.
{ const segs = [...S.reps(6, 1500), [20000, 0, 0], ...S.reps(4, 1500)];
  const c = Object.assign({}, S.BASE), ctr = PC.createCounter(), w = SS.createFailureWatch(); w.reset(0); let out = null;
  for (let t = 0; t <= S.total(segs); t += 1000 / c.fps) {
    const kps = S.frameFor(S.fracAt(segs, t), c, t); ctr.update(kps, t, c.W); const st = ctr.state();
    const f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop: CH.atTopFrom(st) }); if (f && !out) out = f;
  }
  check("reps and a 20 s press keep going (" + ctr.state().reps + " reps)", out === null && ctr.state().reps >= 8, out); }

check("pickup is off: endOn.lifted false, no Phone picked up text", SS.FAIL.endOn.lifted === false && !/picked up/i.test(JSON.stringify(SS.FAIL_TEXT)) && SS.FAIL_TEXT.elbows === "Elbows down");
{ // elbows: forearms flat, elbows at wrist height
  const el = (ey) => plank({ left_elbow: [200, ey], right_elbow: [440, ey] });
  const flat = () => plank({ left_shoulder: [256, 330], right_shoulder: [384, 330], left_elbow: [190, 368], right_elbow: [450, 368], nose: [320, 310] });
  let r = run(seq(0, 500, () => el(270)).concat(seq(500, 2500, flat)));
  check("elbows down (forearms flat) ends as elbows", r.out === "elbows" && r.at >= 1400, r.out + "@" + r.at);
  const bent = () => plank({ left_shoulder: [256, 300], right_shoulder: [384, 300], left_elbow: [180, 300], right_elbow: [460, 300], nose: [320, 280] });
  r = run(seq(0, 500, () => el(270)).concat(seq(500, 4000, bent)));
  check("normal deep descent (elbows above hands) does not end", r.out === null, String(r.out));
  r = run(seq(0, 500, () => el(270)).concat(seq(500, 2500, flat)), { frameW: W, atTop: true });
  check("elbow check never fires at the top", r.out === null, String(r.out)); }
{ // first-rep baseline: straight body line; later sag ends as form; matching later reps do not
  const legs = (hy) => ({ left_hip: [260, hy], left_knee: [262, 420], left_ankle: [264, 470], right_hip: [380, hy], right_knee: [378, 420], right_ankle: [376, 470] });
  const good = () => plank(legs(320)), sag = () => plank({ left_hip: [200, 330], right_hip: [440, 330], left_knee: [232, 400], right_knee: [408, 400], left_ankle: [264, 470], right_ankle: [376, 470] });
  const w = SS.createFailureWatch(); w.reset(0); let out = null;
  for (let t = 0; t < 3000; t += 33) { const f = w.update(good(), t, 128, { frameW: W, atTop: true, reps: t < 1000 ? 0 : 1 }); if (f) out = f; }
  const b = w.baseline();
  check("first-rep baseline is captured", !!b && b.line != null && out === null, JSON.stringify(b));
  for (let t = 3000; t < 8000; t += 33) { const f = w.update(good(), t, 128, { frameW: W, atTop: (t % 2000) < 1000, reps: 1 + Math.floor((t - 3000) / 2000) }); if (f) out = f; }
  check("later reps matching the baseline keep going", out === null, String(out));
  let at = null; for (let t = 8000; t < 10500; t += 33) { const f = w.update(sag(), t, 128, { frameW: W, atTop: true, reps: 4 }); if (f && !out) { out = f; at = t; } }
  check("later-rep break vs baseline (hips out of line) ends as form", out === "form" && at - 8000 >= 950, out + "@" + at); }

check("page passes the rested-lean options into both failure watches and the battle judge", (() => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  return /function pwOpt\(st, w\)/.test(html) && html.split("pwOpt(st, w)").length === 4 && /tbJudge\.update\(kps, now, st\.topSize \? st\.topSize \* w : 0, w\)/.test(html);
})());
const fails = fail; console.log(`\n${pass} passed, ${fail} failed`); process.exit(fails ? 1 : 0);
