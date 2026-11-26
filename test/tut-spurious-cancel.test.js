// Owner report (Nov 17): a TUT set canceled mid-hold during a plank push press at the top, for no apparent reason.
// Cause: createSetEnd's 15 s "stalled" clock treats anything that is not atTopFrom as off the top. atTopFrom uses a tight
// lockout line (~15% of the last-rep range). A real top hold often settles a little below that peak (shoulders a few
// centimeters lower than the last lockout), so after 15 s of a legitimate hold the set ended ("No push-up for a while").
// Fix (TUT / TUT Battle only): that clock runs only when the body is in the lower part of the last-rep range (lying at
// the bottom / sitting back). A settled or noisy top hold, a covered head, and a lost-tracking gap must not end the set.
// Real breaks (knees down, collapse, stand up) still end. Sets keep the tighter rule. Not the plank early-end liveness bug.
// Built on fix/fail-detect (stricter front-cam knees: knees on the hand line fail even with hips high; Vision 0.3-0.49
// knee/ankle scores are trusted). A still plank-push-press top hold must not trip that new knees rule.
// Run: node test/tut-spurious-cancel.test.js
const S = require("./lib/push-synth.js"), PC = require("../push-counter.js"), SS = require("../push-session.js"), CH = require("../push-challenge.js");
const { kpsOf, POSE } = require("./lib/break-synth.js");
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok, info) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (info != null && !ok ? " (" + info + ")" : "")); };

function sim(segs, cfg, counterOpts) {
  S.reseed(11);
  const c = Object.assign({}, S.BASE, cfg || {}), ctr = PC.createCounter(counterOpts || {});
  const end = SS.createSetEnd(), w = SS.createFailureWatch(), hr = SS.createHoldReward();
  end.reset(0); w.reset(0);
  const dt = 1000 / c.fps, T = S.total(segs);
  let stall = null, stallAt = null, form = null, formAt = null, lastRepT = 0, awards = [];
  for (let t = 0; t <= T; t += dt) {
    const kps = S.frameFor(S.fracAt(segs, t), c, t);
    const r = ctr.update(kps, t, c.W), st = ctr.state();
    if (r.counted) lastRepT = t;
    const atTop = CH.atTopFrom(st);
    const stalled = end.update({ mode: "long", reps: st.reps, t, atTop, counter: st, kps });
    if (stalled && !stall) { stall = stalled; stallAt = t; }
    const f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop });
    if (f && !form) { form = f; formAt = t; }
    const h = hr.update(atTop, t, false); if (h.awarded) awards.push(t);
  }
  return { reps: ctr.state().reps, lastRepT, stall, stallAt, form, formAt, awards, rebased: ctr.state().rebased || 0 };
}

// Reasons that can end a TUT set (One long set). Challenge is a separate clock; this list is the TUT path.
const TUT_FORM = ["knees", "collapse", "standing"];
check("TUT set-end reasons: form breaks (knees, collapse, standing, frame), 15 s stall when parked low, End set, camera stop; no elbows / pickup / frozen-liveness end",
  TUT_FORM.every((k) => SS.FAIL_TEXT[k]) && SS.FAIL_TEXT.frame && SS.FAIL_TEXT.stalled && SS.FAIL_TEXT.ended &&
  SS.FAIL.endOn.knees && SS.FAIL.endOn.sag && SS.FAIL.endOn.left &&
  SS.FAIL.endOn.frame && !SS.FAIL.endOn.elbows && !SS.FAIL.endOn.lifted && !SS.FAIL.endOn.form &&
  SS.SET_END.stallMs === 15000 && /createLiveness/.test(fs.readFileSync(path.join(__dirname, "../plank-session.js"), "utf8")) &&
  !/createLiveness/.test(fs.readFileSync(path.join(__dirname, "../push-session.js"), "utf8")) &&
  /voidTutSet\(kind \|\| "stalled"/.test(html) && /function endSetNow/.test(html) && /function endPushOnCameraStop/.test(html) &&
  /finishPushSet\("Camera stopped"\)/.test(html));

{
  const x = sim([...S.reps(5, 1800), ...S.hold(60000)]);
  check(`exact 60 s top hold after 5 reps never ends (stall=${x.stall}, form=${x.form}, reps=${x.reps})`, x.stall === null && x.form === null && x.reps >= 5);
}
{
  const x = sim([...S.reps(5, 1800), [60000, 0.18, 0.18]]);
  check(`settled plank-push-press hold (18% of last-rep range, 60 s) never stalls — this was the mid-hold cancel (stall=${x.stall} at ${x.stallAt && Math.round(x.stallAt)})`, x.stall === null && x.form === null && x.reps >= 5, JSON.stringify({ stall: x.stall, stallAt: x.stallAt }));
}
{
  const x = sim([...S.reps(5, 1800), [60000, 0.25, 0.25]]);
  check("settled top hold at 25% of range for 60 s never stalls", x.stall === null && x.form === null && x.reps >= 5, JSON.stringify({ stall: x.stall, stallAt: x.stallAt }));
}
{
  const x = sim([...S.reps(5, 1800), ...S.hold(60000)], { noise: 0.008, drop: 0.1 });
  check("noisy 60 s top hold (tracking jitter, dropped points) never ends", x.stall === null && x.form === null && x.reps >= 5, JSON.stringify({ stall: x.stall, form: x.form }));
}
{
  const x = sim([...S.reps(5, 1800), ...S.hold(60000)], { nose: false });
  check("60 s top hold with the head covered (no nose / face points; shoulders still seen) never ends", x.stall === null && x.form === null && x.reps >= 5);
}
{
  const x = sim([...S.reps(5, 1800), ...S.hold(60000)], { noise: 0.01, drop: 0.15 }, { app: true });
  check("app-mode (iOS Vision / Android) noisy 60 s top hold never ends", x.stall === null && x.form === null && x.reps >= 5, JSON.stringify({ stall: x.stall, form: x.form, reps: x.reps }));
}
{
  const segs = [...S.reps(5, 1800), [15000, 0, 0.2], [15000, 0.2, 0], [15000, 0, 0.15], [15000, 0.15, 0]];
  const x = sim(segs, { noise: 0.004 });
  check("60 s top hold that bobs slightly never stalls", x.stall === null && x.form === null && x.reps >= 5);
}
{
  const x = sim([...S.reps(5, 1800), [60000, 0.85, 0.85]]);
  // Nov 20 (owner): parked low with no movement is a set that is over by failure: "failed" ~3.5 s after it stops moving (was the 15 s stall).
  check(`TUT: parked at the bottom ends as failed (could not push back up) within ~3.5-5 s of the last rep (at ${x.stallAt && Math.round(x.stallAt)})`, x.stall === "failed" && x.stallAt - x.lastRepT >= 3500 && x.stallAt - x.lastRepT <= 5000, JSON.stringify({ stall: x.stall, stallAt: x.stallAt, lastRepT: x.lastRepT }));
}

// Real form breaks still end a TUT set (failure watch, same path as the live long-mode camera loop).
{
  const kneel = () => [
    { name: "left_shoulder", x: 256, y: 170, score: 0.9 }, { name: "right_shoulder", x: 384, y: 170, score: 0.9 },
    { name: "left_wrist", x: 240, y: 370, score: 0.9 }, { name: "right_wrist", x: 400, y: 370, score: 0.9 },
    { name: "left_hip", x: 300, y: 400, score: 0.9 }, { name: "right_hip", x: 340, y: 400, score: 0.9 },
    { name: "left_knee", x: 330, y: 300, score: 0.9 }, { name: "right_knee", x: 350, y: 300, score: 0.9 },
    { name: "left_ankle", x: 310, y: 420, score: 0.9 }, { name: "right_ankle", x: 330, y: 420, score: 0.9 }
  ];
  S.reseed(11);
  const c = Object.assign({}, S.BASE), segs = [...S.reps(3, 1800), [3000, 0, 0]], T0 = S.total(segs);
  const ctr = PC.createCounter(), end = SS.createSetEnd(), w = SS.createFailureWatch();
  end.reset(0); w.reset(0);
  let form = null;
  for (let t = 0; t <= T0 + 3000; t += 1000 / c.fps) {
    const kps = t > T0 ? kneel() : S.frameFor(S.fracAt(segs, t), c, t);
    const r = ctr.update(t > T0 ? kps : kps, t, c.W), st = ctr.state(), atTop = CH.atTopFrom(st);
    const f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop });
    if (f) { form = f; break; }
    if (end.update({ mode: "long", reps: st.reps, t, atTop, counter: st, kps })) { form = "stalled"; break; }
  }
  check(`knees down during a TUT set still ends as knees (${form})`, form === "knees");
}
{
  const ctr = PC.createCounter(), end = SS.createSetEnd(), w = SS.createFailureWatch();
  end.reset(0); w.reset(0);
  const c = Object.assign({}, S.BASE); S.reseed(11);
  const segs = S.reps(3, 1800); let form = null, formAt = null;
  const T0 = S.total(segs);
  for (let t = 0; t <= T0 + 8000; t += 33) {
    const kps = t > T0 ? kpsOf(POSE.stand) : S.frameFor(S.fracAt(segs, Math.min(t, T0)), c, t);
    const r = ctr.update(kps, t, c.W), st = ctr.state(), atTop = t > T0 ? false : CH.atTopFrom(st);
    const f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop });
    if (f) { form = f; formAt = t; break; }
    if (end.update({ mode: "long", reps: Math.max(st.reps, 3), t, atTop, counter: st, kps })) { form = "stalled"; formAt = t; break; }
  }
  check(`standing up during a TUT set still ends as standing (${form})`, form === "standing", form);
}
{
  // Out of frame / phone pickup: losing tracking pauses, never ends (owner rule).
  const x = sim([...S.reps(3, 1800), ...S.hold(3000)], { gone: [6000, 20000] });
  // gone during hold may shrink the hold window; drive a dedicated loop to be sure
  S.reseed(11);
  const c = Object.assign({}, S.BASE), segs = [...S.reps(3, 1800), ...S.hold(20000)];
  const ctr = PC.createCounter(), end = SS.createSetEnd(), w = SS.createFailureWatch();
  end.reset(0); w.reset(0);
  let form = null, stall = null;
  for (let t = 0; t <= S.total(segs); t += 1000 / c.fps) {
    const kps = (t >= 8000 && t < 9500 ? [] : S.frameFor(S.fracAt(segs, t), c, t));
    const r = ctr.update(kps, t, c.W), st = ctr.state(), atTop = CH.atTopFrom(st);
    const f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop });
    if (f && !form) form = f;
    const s = end.update({ mode: "long", reps: st.reps, t, atTop, counter: st, kps });
    if (s && !stall) stall = s;
  }
  check("brief 1.5 s dropout mid-TUT never ends the set", form === null && stall === null, JSON.stringify({ form, stall }));
}


// --- Built on fix/fail-detect: a still plank-push-press top hold with a full body (hips + knees + ankles)
// must not cancel under the stricter front-cam knees rule, while a real drop-to-knees still ends the set.
function Kpts(o, score) {
  return Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: score == null ? 0.85 : score }));
}
function frontTopHold() {
  // Front plank / push-press lockout: hands planted, hips high, knees well above the hand line (foreshortened legs).
  return Kpts({
    left_shoulder: [256, 170], right_shoulder: [384, 170],
    left_elbow: [248, 270], right_elbow: [392, 270],
    left_wrist: [240, 370], right_wrist: [400, 370], nose: [320, 140],
    left_hip: [230, 220], right_hip: [400, 220],
    left_knee: [235, 245], right_knee: [405, 245],
    left_ankle: [238, 248], right_ankle: [408, 248]
  });
}
function visionScores(kps) {
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
function dropKneesHighHips() {
  // Real front drop-to-knees: knees on the planted-hand line, hips still well above the hands.
  return Kpts({
    left_shoulder: [256, 160], right_shoulder: [384, 160],
    left_elbow: [248, 260], right_elbow: [392, 260],
    left_wrist: [240, 375], right_wrist: [400, 375], nose: [320, 130],
    left_hip: [290, 250], right_hip: [350, 250],
    left_knee: [300, 370], right_knee: [340, 370],
    left_ankle: [330, 380], right_ankle: [310, 380]
  });
}
function simTail(segs, tail, tailMs, wrap) {
  S.reseed(11);
  const c = Object.assign({}, S.BASE), ctr = PC.createCounter(), end = SS.createSetEnd(), w = SS.createFailureWatch();
  end.reset(0); w.reset(0);
  const dt = 1000 / c.fps, T0 = S.total(segs), T = T0 + tailMs;
  let stall = null, stallAt = null, form = null, formAt = null, reps = 0;
  const paint = (kps) => (wrap ? wrap(kps) : kps);
  for (let t = 0; t <= T; t += dt) {
    const kps = paint(t > T0 ? tail() : S.frameFor(S.fracAt(segs, t), c, t));
    const r = ctr.update(kps, t, c.W), st = ctr.state();
    if (r.counted) reps = st.reps;
    const atTop = CH.atTopFrom(st);
    const s = end.update({ mode: "long", reps: st.reps, t, atTop, counter: st, kps });
    if (s && !stall) { stall = s; stallAt = t; }
    const f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop });
    if (f && !form) { form = f; formAt = t; }
  }
  return { reps, stall, stallAt, form, formAt };
}
{
  const x = simTail(S.reps(5, 1800), frontTopHold, 60000);
  check(`still front-camera plank push press top hold (full body, hips high, 60 s) never ends under the stricter knees rule (form=${x.form}, stall=${x.stall})`, x.form === null && x.stall === null && x.reps >= 5, JSON.stringify(x));
}
{
  const x = simTail(S.reps(5, 1800), frontTopHold, 60000, visionScores);
  check(`same still top hold with Vision 0.3-0.49 knee/ankle scores never ends (form=${x.form}, stall=${x.stall})`, x.form === null && x.stall === null && x.reps >= 5, JSON.stringify(x));
}
{
  // Same coordinate system throughout: side-view reps, then a still top hold (POSE.top).
  const { lerp } = require("./lib/break-synth.js");
  const sideRep = (t) => { const p = (t % 2000) / 2000, f = p < 0.45 ? p / 0.45 : p < 0.55 ? 1 : (1 - p) / 0.45; return lerp(POSE.top, POSE.bottom, Math.max(0, Math.min(1, f))); };
  const ctr = PC.createCounter(), end = SS.createSetEnd(), w = SS.createFailureWatch();
  end.reset(0); w.reset(0);
  let stall = null, form = null, reps = 0;
  const T0 = 5 * 2000, T = T0 + 60000;
  for (let t = 0; t <= T; t += 33) {
    const kps = kpsOf(t < T0 ? sideRep(t) : POSE.top, { noise: 1.5 });
    const r = ctr.update(kps, t, 640), st = ctr.state();
    if (r.counted) reps = st.reps;
    const atTop = CH.atTopFrom(st);
    const s = end.update({ mode: "long", reps: st.reps, t, atTop, counter: st, kps });
    if (s && !stall) stall = s;
    const f = w.update(kps, t, st.topSize ? st.topSize * 640 : 0, { frameW: 640, atTop });
    if (f && !form) form = f;
  }
  check(`still side-view plank push press top hold 60 s after side-view reps never ends (form=${form}, stall=${stall}, reps=${reps})`, form === null && stall === null && reps >= 1, JSON.stringify({ form, stall, reps }));
}
{
  const x = simTail(S.reps(3, 1800), dropKneesHighHips, 3000);
  check(`real front drop-to-knees (knees on the hand line, hips still high) still ends as knees (${x.form})`, x.form === "knees" && x.reps >= 3, JSON.stringify(x));
}
{
  const x = simTail(S.reps(3, 1800), dropKneesHighHips, 3000, visionScores);
  check(`same high-hip drop-to-knees with Vision weak knee/ankle scores still ends as knees (${x.form})`, x.form === "knees" && x.reps >= 3, JSON.stringify(x));
}

// Live wiring: TUT (mode long) uses createSetEnd with the counter and atTopFrom, same as the page, and still posts a stall
// only through voidTutSet; sign-in buttons are not part of this change.
check("live TUT loop still feeds createSetEnd the counter and atTopFrom, and auto-ends a stall through voidTutSet",
  /pushSetEnd\.update\(\{ mode: pushMode, reps: pushState\.reps, t: performance\.now\(\), atTop: !!\(C && C\.atTopFrom && C\.atTopFrom\(stE\)\), counter: stE/.test(html) &&
  /voidTutSet\(kind \|\| "stalled"/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
