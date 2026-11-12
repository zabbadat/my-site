// Push-up camera, Nov 12 2026: a set ends only on a REAL, sustained, confidently seen break, never on missing or
// low-confidence landmarks; a hood that hides the head (head down) is a valid push-up position.
//  - Apple Vision's 3D request always returns a full skeleton and GUESSES hidden legs (front camera, legs behind the
//    body). Those guessed knees read bent, which ended sets about 1 s after Go ("Set complete." before any push-ups).
//  - Knee landmarks that flicker out or drop to low confidence never count toward a knees-down fail.
//  - Hooded / head down: no head joints at all, or a lone hood "nose": reps count from the shoulders, no fail, not out of frame.
//  - Vision rescue: when Vision loses the body (hood up, head down), MoveNet takes over instead of the set never starting.
// Runs the regular Sets watch and the TUT watch (skipFrame) through the app path (stub ZabbaPose) and MoveNet keypoints.
// Run: node test/camera-dropout-hood.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const SS = require("../push-session.js"), PC = require("../push-counter.js"), V = require("../pose-vision.js"), S = require("./lib/push-synth.js");
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (x != null ? "  [" + x + "]" : "")); };
const W = 640, H = 480, DT = 1000 / 30;
// Legs for a front-camera plank: hips just under the shoulders, knees farther back (foreshortened, close to hip height).
function legs(kps, legScore, kneeScore) {
  const ls = kps.find((k) => k.name === "left_shoulder"), rs = kps.find((k) => k.name === "right_shoulder");
  const sw = Math.abs(rs.x - ls.x), my = (ls.y + rs.y) / 2;
  const out = kps.slice();
  out.push({ name: "left_hip", x: ls.x + 0.15 * sw, y: my + 0.55 * sw, score: legScore }, { name: "right_hip", x: rs.x - 0.15 * sw, y: my + 0.55 * sw, score: legScore });
  out.push({ name: "left_knee", x: ls.x + 0.2 * sw, y: my + 0.65 * sw, score: kneeScore }, { name: "right_knee", x: rs.x - 0.2 * sw, y: my + 0.65 * sw, score: kneeScore });
  return out;
}
// One session: counter (app mode) + failure watch, frames through the Vision bridge (stub plugin) or MoveNet-direct.
async function session(o) {
  const segs = [[1500, 0, 0], ...S.reps(o.reps || 8, 2000), [1500, 0, 0]], cfg = Object.assign({}, S.BASE, o.cfg || {});
  let frame = null;
  const det = await V.createDetector({ plugin: { isAvailable: async () => ({ available: true }), detect: async () => frame }, grab: () => "QUJD" });
  const vid = { videoWidth: W, videoHeight: H, readyState: 4 };
  const ctr = PC.createCounter({ app: true }), watch = SS.createFailureWatch(); watch.reset(0);
  let reps = 0, failed = null, failedT = null, i = 0;
  for (let t = 0; t <= S.total(segs); t += DT, i++) {
    let k = S.frameFor(S.fracAt(segs, t), cfg, t);
    if (o.legs) k = o.legs(k, i, t);
    let kps, extra = { frameW: W, reps, skipFrame: !!o.tut };
    if (o.vision) {
      frame = { keypoints: k.map((p) => ({ name: p.name, x: 1 - p.x / W, y: p.y / H, score: p.score })) }; // unflipped, as the plugin sees it
      if (o.k3) frame.pose3d = { kneeAngleDeg: o.k3(i, t) };
      const poses = await det.estimatePoses(vid, { flipHorizontal: true });
      const pose = poses[0]; kps = pose ? pose.keypoints : [];
      if (pose && pose.knee3D) extra.knee3D = pose.knee3D;
    } else kps = k;
    const st = ctr.state(), r = ctr.update(kps, t, W);
    if (r.counted) reps++;
    extra.reps = reps;
    const f = watch.update(kps, t, st.topSize ? st.topSize * W : 0, extra);
    if (f && !failed) { failed = f; failedT = t; }
  }
  return { reps, failed, failedT };
}
(async () => {
  // 1. Pure failure watch: hidden legs guessed by Vision 3D
  const plank = (extra) => { const k = S.frameFor(0, S.BASE, 0); return legs(k, extra.leg, extra.knee); };
  const runW = (n, f, ex) => { const w = SS.createFailureWatch(); w.reset(0); let out = null, at = null; for (let i = 0; i < n; i++) { const t = i * DT; const r = w.update(f(i), t, 128, Object.assign({ frameW: W }, ex(i))); if (r && !out) { out = r; at = t; } } return { out, at }; };
  { const r = runW(450, () => plank({ leg: 0.2, knee: 0.15 }), () => ({ knee3D: { left: 85, right: 92 } }));
    check("hidden legs (low-confidence 2D knees) + Vision 3D guessing bent knees for 15 s: set does NOT end", r.out === null, r.out + "@" + r.at); }
  { const r = runW(450, (i) => { const k = plank({ leg: 0.9, knee: 0.9 }); return i % 4 === 0 ? k : k.filter((p) => !/knee/.test(p.name)); }, (i) => ({ knee3D: { left: 80, right: 80 } }));
    check("knee landmarks seen only every 4th frame (dropout) with bent 3D guesses: no fail", r.out === null, r.out + "@" + r.at); }
  { const r = runW(450, (i) => plank({ leg: 0.9, knee: i % 3 === 0 ? 0.9 : 0.35 }), () => ({ knee3D: { left: 80, right: 80 } }));
    check("knees flickering to low confidence (0.35) 2 of 3 frames: no fail", r.out === null, r.out + "@" + r.at); }
  { const r = runW(90, () => plank({ leg: 0.9, knee: 0.9 }), (i) => ({ knee3D: i < 3 ? { left: 80, right: 80 } : { left: 172, right: 175 } }));
    check("a 3-frame confident kneel blip (3D straight after): no fail", r.out === null, r.out + "@" + r.at); }
  { const r = runW(90, () => plank({ leg: 0.9, knee: 0.9 }), () => ({ knee3D: { left: 80, right: 82 } }));
    check("a REAL kneel (confident knees + bent 3D, sustained 1 s) still ends the set as knees", r.out === "knees" && r.at >= 1000 && r.at < 1400, r.out + "@" + r.at); }
  { const noHead = () => S.frameFor(0, Object.assign({}, S.BASE, { nose: false }), 0);
    const r = runW(450, noHead, () => ({}));
    check("hood up, head down, NO head joints for 15 s (regular Sets): not out of frame, no fail", r.out === null, r.out + "@" + r.at);
    const r2 = runW(450, noHead, () => ({ skipFrame: true }));
    check("same in a TUT set: no fail", r2.out === null); }
  { const w = SS.createFailureWatch(); w.reset(0); let out = null;
    for (let i = 0; i < 450; i++) { const r = w.update(i < 90 ? S.frameFor(0, S.BASE, 0) : [], i * DT, 128, { frameW: W, skipFrame: true }); if (r && !out) out = r; }
    check("TUT sets still never end on out of frame", out === null); }

  // 2. Full sessions (counter + watch): app path (stub ZabbaPose) and MoveNet keypoints
  const hidLegs = (k) => legs(k, 0.25, 0.2), flick = (k, i) => legs(k, 0.9, i % 4 ? 0.1 : 0.9);
  const bent3D = () => ({ left: 88, right: 95 });
  for (const [label, vision] of [["Apple Vision path", true], ["MoveNet path", false]]) {
    for (const tut of [false, true]) {
      const kind = tut ? "TUT set" : "regular set";
      let r = await session({ vision, tut, legs: hidLegs, k3: vision ? bent3D : null });
      check(`${label}, ${kind}: face visible, legs hidden${vision ? " + 3D bent-knee guesses" : ""}: 8/8 reps, no early end`, r.reps === 8 && r.failed === null, r.reps + " " + r.failed + "@" + r.failedT);
      r = await session({ vision, tut, legs: flick, k3: vision ? bent3D : null });
      check(`${label}, ${kind}: knee dropout frames: 8/8 reps, no early end`, r.reps === 8 && r.failed === null, r.reps + " " + r.failed + "@" + r.failedT);
      r = await session({ vision, tut, cfg: { nose: false }, legs: hidLegs, k3: vision ? bent3D : null });
      check(`${label}, ${kind}: hooded, head down, no head joints: 8/8 reps, no fail`, r.reps === 8 && r.failed === null, r.reps + " " + r.failed + "@" + r.failedT);
      r = await session({ vision, tut, cfg: { nose: true, eyes: false }, legs: hidLegs, k3: vision ? bent3D : null });
      check(`${label}, ${kind}: hood fabric read as a lone "nose" (no eyes): ignored, 8/8 reps, no fail`, r.reps === 8 && r.failed === null, r.reps + " " + r.failed + "@" + r.failedT);
    }
  }

  // 3. Page: Vision rescue (real functions sliced from index.html)
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const line = (start) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf("\n", i)); };
  const block = (start) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf("\n}\n", i) + 2); };
  const src = ["let visionFailed = false;", line("const VISION_RESCUE"), line("let visionSeenT"), block("function shouldersIn(pose)"), block("async function visionRescue(")].join("\n");
  const sh = [{ name: "left_shoulder", x: 250, y: 200, score: 0.8 }, { name: "right_shoulder", x: 390, y: 200, score: 0.8 }];
  const mk = (mnSees) => { const ctx = { console: { info() {} }, mnCalls: 0 }; ctx.ensurePose = async () => ({ estimatePoses: async () => { ctx.mnCalls++; return mnSees ? [{ keypoints: sh }] : []; } });
    vm.createContext(ctx); vm.runInContext(src + "\nthis.api = { visionRescue, get failed() { return visionFailed; } };", ctx); return ctx; };
  { const c = mk(true); let used = null;
    for (let t = 0; t < 1000; t += DT) used = await c.api.visionRescue({ keypoints: sh }, {}, t);
    check("rescue: Vision sees the shoulders -> Vision pose used, MoveNet never run", used.keypoints === sh && c.mnCalls === 0 && !c.api.failed); }
  { const c = mk(true); let used = null, first = null;
    for (let t = 0; t < 2000; t += DT) { used = await c.api.visionRescue(undefined, {}, t); if (used && first == null) first = t; }
    check("rescue: Vision blind (hood up, head down) -> MoveNet pose after 1.5 s and MoveNet takes over", first >= 1500 && first < 1600 && used && used.keypoints === sh && c.api.failed, "first=" + first); }
  { const c = mk(false); for (let t = 0; t < 3000; t += DT) await c.api.visionRescue(undefined, {}, t);
    check("rescue: nobody in frame for either engine -> stays on Vision", !c.api.failed); }
  check("page: push-up poseTick runs the Vision rescue on the Vision engine", /let pose = poses && poses\[0\];\n\s+if \(det && det\.engine === "vision"\) pose = await visionRescue\(pose, vid, tFrame\);/.test(html));
  check("pose-vision detector reports engine 'vision'", /engine: "vision"/.test(fs.readFileSync(path.join(__dirname, "..", "pose-vision.js"), "utf8")));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
