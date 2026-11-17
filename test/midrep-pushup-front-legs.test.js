// Nov 17 2026 (owner, real iPhone, then uniform on Android / browser): a normal mid-set push-up ended the set as "Knees down"
// and that rep never counted. Front camera: straight legs running away from the lens read bent in 2D (knee and ankle at the
// same height) while the hips stay well above the hands. Real counter + failure watch over descend / bottom / ascend frames
// with those foreshortened legs, in the iOS Vision engine shape (normalized Vision points scaled to pixels, Vision-like
// scores) and the Android / browser MoveNet shape, plus the MoveNet frames recorded on the push-up-only clip.
// A real kneel (hips dropped to hand height) must still end the set. Run: node test/midrep-pushup-front-legs.test.js
const path = require("path");
const S = require("./lib/push-synth.js"), PC = require("../push-counter.js"), SS = require("../push-session.js"), CH = require("../push-challenge.js");
const FX = require(path.join(__dirname, "fixtures", "frontcam-pushup-frames.json"));
let pass = 0, fail = 0; const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (x != null ? "  [" + x + "]" : "")); };

// Foreshortened front-camera legs hung off the synthetic shoulders: hips just behind the shoulders, knee further back,
// ankle at the knee's height (2D angle ~100°, well under the 130° knee rule). Hips stay far above the wrist line.
function legs(kps, score, jit) {
  const ls = kps.find((p) => p.name === "left_shoulder"), rs = kps.find((p) => p.name === "right_shoulder"); if (!ls || !rs) return kps;
  const sy = (ls.y + rs.y) / 2, j = (k) => (jit ? Math.sin(k) * jit : 0);
  const add = (name, x, y) => ({ name, x: x + j(x), y: y + j(y), score });
  return kps.concat([add("left_hip", 290, sy + 50), add("right_hip", 350, sy + 50), add("left_knee", 300, sy + 75), add("right_knee", 340, sy + 75),
    add("left_ankle", 330, sy + 72), add("right_ankle", 312, sy + 72)]);
}
const ENGINES = {
  ios_vision: (k) => legs(k.map((p) => Object.assign({}, p, { score: 0.62 })), 0.58, 1.5), // Vision confidences run lower
  android_movenet: (k) => legs(k, 0.85, 0),
};
function sim(engine, segs, tail) {
  const c = Object.assign({}, S.BASE), ctr = PC.createCounter(), w = SS.createFailureWatch(); w.reset(0);
  let out = null, reps = 0; const T = S.total(segs) + (tail ? tail.ms : 0);
  for (let t = 0; t <= T; t += 1000 / c.fps) {
    const kps = tail && t > S.total(segs) ? tail.f(t) : ENGINES[engine](S.frameFor(S.fracAt(segs, t), c, t));
    const r = ctr.update(kps, t, c.W);
    if (r.counted && !out) reps += 1; // the page counts the rep before the form check on the same frame
    const st = ctr.state(), f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop: CH.atTopFrom(st) });
    if (f && !out) out = f;
  }
  return { out, reps };
}
for (const e of Object.keys(ENGINES)) {
  const x = sim(e, S.reps(6, 1800));
  check(`${e}: 6 mid-set push-ups with foreshortened front legs count and never end the set`, x.out === null && x.reps >= 5, x.out + ", " + x.reps + " reps");
  const one = sim(e, [...S.reps(1, 1800), [600, 0, 0], [700, 0, 1], [500, 1, 1], [700, 1, 0]]); // a slow rep: descend, bottom pause, ascend
  check(`${e}: slow rep (descend / bottom pause / ascend) counts, set keeps going`, one.out === null && one.reps >= 2, one.out + ", " + one.reps + " reps");
}
// Real kneel after the reps (hips dropped to hand height, wrists 375): still ends as knees on both engines.
const kneel = () => [["left_shoulder", 256, 170], ["right_shoulder", 384, 170], ["left_wrist", 243, 375], ["right_wrist", 397, 375], ["nose", 320, 138],
  ["left_hip", 300, 350], ["right_hip", 340, 350], ["left_knee", 305, 368], ["right_knee", 345, 368], ["left_ankle", 335, 362], ["right_ankle", 315, 362]].map(([name, x, y]) => ({ name, x, y, score: 0.8 }));
for (const e of Object.keys(ENGINES)) { const x = sim(e, S.reps(3, 1800), { ms: 3000, f: kneel }); check(`${e}: real kneel (hips at hand height) after reps still ends as knees`, x.out === "knees", x.out); }
// Recorded MoveNet frames (push-up-only clip, browser / Android path) that ended "Knees down" before the fix.
{ const w = SS.createFailureWatch(); let r = null; for (const f of FX.movenet_live_run) { r = w.update(f.kps, f.t, f.tw, f.ex) || r; if (r) break; }
  check("recorded MoveNet push-up-only clip run: no set end", r === null, r); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
