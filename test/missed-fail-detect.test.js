// Nov 17 2026 (owner, iPhone app): form failures (drop to knees, stand up) were missed mid-set.
// Cause: after fdd8102 / feafd05 / 1d9bbcb, a front-camera Knees down required the hips near hand height.
// A real drop-to-knees plants the knees on the floor while the thighs stay up, so the hips remain well above
// the hands. Apple Vision also often scores those knees / ankles in the 0.3-0.49 band (below kneeMin 0.5),
// so the confident-leg path never saw them. Foreshortened front-camera push-ups (knees high, legs receding)
// must still never end the set; phone pickup must never fail. Run: node test/missed-fail-detect.test.js
const fs = require("fs"), path = require("path");
const SS = require("../push-session.js"), SY = require("./lib/break-synth.js");
const S = require("./lib/push-synth.js"), PC = require("../push-counter.js"), CH = require("../push-challenge.js");
const FX = require(path.join(__dirname, "fixtures", "frontcam-pushup-frames.json"));
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (x != null ? "  [" + x + "]" : "")); };
const K = (o, score) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));

// Drop-to-knees, front camera: hands planted, knees on the hand line, hips ~1 thigh above the hands.
function dropKnees(score) {
  return K({
    left_shoulder: [256, 160], right_shoulder: [384, 160],
    left_elbow: [248, 260], right_elbow: [392, 260],
    left_wrist: [240, 375], right_wrist: [400, 375],
    nose: [320, 130],
    left_hip: [290, 250], right_hip: [350, 250],
    left_knee: [300, 370], right_knee: [340, 370],
    left_ankle: [330, 380], right_ankle: [310, 380]
  }, score);
}
function visionShape(kps) {
  return kps.map((k) => {
    const n = Object.assign({}, k);
    if (/knee$/.test(n.name)) n.score = 0.45;
    else if (/ankle$/.test(n.name)) n.score = 0.38;
    else if (/hip$/.test(n.name)) n.score = 0.62;
    else if (/shoulder$/.test(n.name)) n.score = 0.72;
    else n.score = 0.8;
    return n;
  });
}
function watch(factory, opts, ms) {
  const w = SS.createFailureWatch(); w.reset(0);
  let out = null, at = null;
  const extra = Object.assign({ frameW: 640, atTop: false, reps: 3 }, opts || {});
  for (let t = 0; t < (ms || 3000); t += 33) {
    const r = w.update(factory(t), t, 128, extra);
    if (r && !out) { out = r; at = t; }
  }
  return { out, at, failedAt: w.failedAt() };
}

const ENGINES = {
  ios_vision: (kps) => visionShape(kps),
  android_movenet: (kps) => kps.map((p) => Object.assign({}, p, { score: p.score || 0.85 }))
};

for (const e of Object.keys(ENGINES)) {
  const pose = () => ENGINES[e](dropKnees(0.85));
  const r = watch(pose);
  check(`${e}: front drop-to-knees (knees on the floor, hips still high) ends as knees within 1.5 s`, r.out === "knees" && r.at >= 1000 && r.at < 1500, r.out + "@" + r.at);
  const noAnk = watch(() => ENGINES[e](dropKnees(0.85).filter((k) => !/_ankle$/.test(k.name))));
  check(`${e}: same kneel with ankles missing still ends as knees`, noAnk.out === "knees", noAnk.out + "@" + noAnk.at);
}

// Mid-set: a few counted reps, then a real drop-to-knees — the set ends, the last rep is already counted.
function legsHigh(kps, score) {
  const ls = kps.find((p) => p.name === "left_shoulder"), rs = kps.find((p) => p.name === "right_shoulder"); if (!ls || !rs) return kps;
  const sy = (ls.y + rs.y) / 2;
  const add = (name, x, y) => ({ name, x, y, score });
  return kps.concat([add("left_hip", 290, sy + 50), add("right_hip", 350, sy + 50), add("left_knee", 300, sy + 75), add("right_knee", 340, sy + 75),
    add("left_ankle", 330, sy + 72), add("right_ankle", 312, sy + 72)]);
}
function sim(engine, segs, tail) {
  const c = Object.assign({}, S.BASE), ctr = PC.createCounter(), w = SS.createFailureWatch(); w.reset(0);
  let out = null, reps = 0; const T = S.total(segs) + (tail ? tail.ms : 0);
  const wrap = engine === "ios_vision"
    ? (k) => visionShape(legsHigh(k, 0.45))
    : (k) => legsHigh(k, 0.85);
  for (let t = 0; t <= T; t += 1000 / c.fps) {
    const kps = tail && t > S.total(segs) ? ENGINES[engine](typeof tail.f === "function" ? tail.f() : tail.f) : wrap(S.frameFor(S.fracAt(segs, t), c, t));
    const r = ctr.update(kps, t, c.W);
    if (r.counted && !out) reps += 1;
    const st = ctr.state(), f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop: CH.atTopFrom(st), reps: st.reps });
    if (f && !out) out = f;
  }
  return { out, reps };
}
for (const e of Object.keys(ENGINES)) {
  const clean = sim(e, S.reps(6, 1800));
  check(`${e}: 6 mid-set foreshortened front push-ups count and never end the set`, clean.out === null && clean.reps >= 5, clean.out + ", " + clean.reps + " reps");
  const after = sim(e, S.reps(3, 1800), { ms: 3000, f: dropKnees(0.85) });
  check(`${e}: after 3 counted reps, a high-hip drop-to-knees ends as knees`, after.out === "knees" && after.reps >= 3, after.out + ", " + after.reps + " reps");
}

// Front-camera stand-up (shoulders rise, hands leave the floor, body vertical) still ends the set.
{
  const plank = () => K({
    left_shoulder: [256, 170], right_shoulder: [384, 170], left_elbow: [248, 270], right_elbow: [392, 270],
    left_wrist: [240, 370], right_wrist: [400, 370], nose: [320, 140],
    left_hip: [230, 220], right_hip: [400, 220], left_knee: [235, 245], right_knee: [405, 245],
    left_ankle: [238, 248], right_ankle: [408, 248]
  }, 0.85);
  const stand = () => K({
    left_shoulder: [280, 80], right_shoulder: [360, 80], left_elbow: [270, 160], right_elbow: [370, 160],
    left_wrist: [265, 230], right_wrist: [375, 230], nose: [320, 40],
    left_hip: [290, 230], right_hip: [350, 230], left_knee: [295, 330], right_knee: [345, 330],
    left_ankle: [298, 430], right_ankle: [348, 430]
  }, 0.85);
  const lerp = (a, b, f) => { const by = {}; b.forEach((k) => { by[k.name] = k; }); return a.map((k) => { const o = by[k.name]; return o ? { name: k.name, x: k.x + (o.x - k.x) * f, y: k.y + (o.y - k.y) * f, score: k.score } : k; }); };
  for (const e of Object.keys(ENGINES)) {
    const r = watch((t) => {
      const f = t < 800 ? 0 : Math.min(1, (t - 800) / 700);
      const k = f === 0 ? plank() : f === 1 ? stand() : lerp(plank(), stand(), f);
      return ENGINES[e](k);
    }, {}, 5000);
    check(`${e}: front-camera stand-up ends as standing`, r.out === "standing", r.out + "@" + r.at);
  }
}

// Side-view kneel (unchanged path) still ends; phone pickup still never does.
{
  const r = watch((t) => SY.kpsOf(t < 400 ? SY.POSE.top : SY.POSE.knees), { frameW: 640, atTop: false, reps: 2 });
  check("side-view kneel still ends as knees", r.out === "knees", r.out + "@" + r.at);
}
{
  const w = SS.createFailureWatch(); w.reset(0); let out = null;
  for (let t = 0; t <= 8000; t += 33) {
    const f = t < 4000 ? 0 : t < 4500 ? (t - 4000) / 500 : t < 6500 ? 1 : t < 7000 ? 1 - (t - 6500) / 500 : 0;
    const r = w.update(SY.kpsOf(SY.POSE.top, { rot: f * 0.52, tx: f * 60, ty: f * -50 }), t, 0, { frameW: 640, atTop: false, reps: 2 });
    if (r && !out) out = r;
  }
  check("phone pickup still never fails the set", out === null, out);
}

// Recorded live clips that used to false-end as Knees down must still pass.
check("recorded iOS Vision push-up frames: no set end", (function () { const w = SS.createFailureWatch(); let r = null; for (const f of FX.ios_vision) { r = w.update(f.kps, f.t, f.tw, f.ex) || r; if (r) break; } return r; })() === null);
check("recorded MoveNet push-up-only clip: no set end", (function () { const w = SS.createFailureWatch(); let r = null; for (const f of FX.movenet_live_run) { r = w.update(f.kps, f.t, f.tw, f.ex) || r; if (r) break; } return r; })() === null);

// Feedback path unchanged: spoken line is still "Set complete." (serial interruptSpeak so iOS does not drop it);
// the camera note still shows "Set ended: <reason>. Camera off."
check("finishPushSet still speaks SET_DONE_LINE through interruptSpeak, then exitPushCam(endedBy)",
  /function finishPushSet\(endedBy\) \{[\s\S]*speakSetDone[\s\S]*exitPushCam\(endedBy\)/.test(html) &&
  /function speakSetDone\(\) \{[\s\S]*interruptSpeak\(GS\.SET_DONE_LINE\)/.test(html) &&
  /camNote"\)\.textContent = why \? "Set ended: " \+ why \+ "\. Camera off\."/.test(html));
check("phone pickup is still ignored (endOn.lifted off)", SS.FAIL.endOn.lifted === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
