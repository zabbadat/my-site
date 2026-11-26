// Shared give-up / exit detection across EVERY camera-tracked movement and mode:
//   1. Shared detector (push-session.js createGiveUpWatch)
//   2. Push-up Sets (0 reps + >=1 reps)
//   3. TUT / One long set
//   4. Two-minute challenge
//   5. TUT Battles (tut-battle.js createJudge)
//   6. Plank / Plank House / Plank Push Press (plank-session.js createPlankHold)
//   7. Gyatt Squats (squat-session.js createSquatSet)
// Per mode: kneel-down (including lifted hands / weak hips), walk-out, kneel->stand->walk-out chain, and no false end.
// Run: node test/giveup-exit-all-modes.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const SS = require("../push-session.js");
const PC = require("../push-counter.js");
const CH = require("../push-challenge.js");
const TB = require("../tut-battle.js");
const PS = require("../plank-session.js");
const SC = require("../squat-counter.js");
const SQS = require("../squat-session.js");
const SY = require("./lib/break-synth.js");
const PSYN = require("./lib/push-synth.js");
const SQSYN = require("./lib/squat-synth.js");
const runHarness = require("./lib/push-flow-harness.js");

const HTML = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML, "utf8");

let pass = 0, fail = 0;
const check = (name, ok, info) => {
  ok ? pass++ : fail++;
  console.log((ok ? "PASS " : "FAIL ") + name + (!ok && info != null ? "  [" + info + "]" : ""));
};

const DT = 1000 / 30;
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));

// Front-view kneel with hands lifted off the floor (no wrists in view) — used to bypass front-view kneel detection.
const frontKneelLiftedHands = (hipScore = 0.9) => [
  { name: "nose", x: 320, y: 120, score: 0.9 },
  { name: "left_shoulder", x: 256, y: 160, score: 0.9 },
  { name: "right_shoulder", x: 384, y: 160, score: 0.9 },
  { name: "left_hip", x: 290, y: 260, score: hipScore },
  { name: "right_hip", x: 350, y: 260, score: hipScore },
  { name: "left_knee", x: 298, y: 380, score: 0.85 },
  { name: "right_knee", x: 342, y: 380, score: 0.85 },
  { name: "left_ankle", x: 325, y: 365, score: 0.85 },
  { name: "right_ankle", x: 315, y: 365, score: 0.85 }
];

// Front-view stand-up (both shoulders & hands rise straight up together, no camera tilt).
const frontPlankWithHands = () => K({
  nose: [320, 140], left_shoulder: [256, 170], right_shoulder: [384, 170],
  left_wrist: [240, 370], right_wrist: [400, 370],
  left_hip: [280, 220], right_hip: [360, 220],
  left_knee: [285, 245], right_knee: [355, 245],
  left_ankle: [290, 248], right_ankle: [350, 248]
});
const frontStandStraightUp = () => K({
  nose: [320, 40], left_shoulder: [275, 70], right_shoulder: [365, 70],
  left_wrist: [260, 230], right_wrist: [380, 230],
  left_hip: [290, 220], right_hip: [350, 220],
  left_knee: [292, 320], right_knee: [348, 320],
  left_ankle: [294, 420], right_ankle: [346, 420]
});

// ---- 1. Shared detector (createGiveUpWatch) ----
{
  const g = SS.createGiveUpWatch(); g.reset(0);
  let out = null;
  // Never seen at start: 3 s wait does NOT instant-end before user gets in view
  for (let t = 0; t < 3000; t += 33) out = out || g.update({ t, seen: false });
  check("shared detector: no instant end before person enters frame (start grace)", out === null);
  // Enter frame, then kneel (0.5s) -> stand (0.4s) -> walk out (0.6s)
  for (let t = 3000; t < 4000; t += 33) out = out || g.update({ t, seen: true, kneel: false, stand: false });
  for (let t = 4000; t < 4500; t += 33) out = out || g.update({ t, seen: true, kneel: true, stand: false });
  for (let t = 4500; t < 4900; t += 33) out = out || g.update({ t, seen: true, kneel: false, stand: true });
  for (let t = 4900; t < 6000 && !out; t += 33) out = out || g.update({ t, seen: false });
  check("shared detector: kneel -> stand -> walk-out chain ends as knees with failedAt at kneel start", out === "knees" && g.failedAt() >= 3990 && g.failedAt() <= 4040, out + "@" + g.failedAt());

  // 1-frame spike + 600ms occlusion -> no false end
  const g2 = SS.createGiveUpWatch(); g2.reset(0);
  let o2 = null;
  for (let t = 0; t < 2000; t += 33) o2 = o2 || g2.update({ t, seen: true });
  o2 = o2 || g2.update({ t: 2000, seen: true, kneel: true });
  for (let t = 2033; t < 2633; t += 33) o2 = o2 || g2.update({ t, seen: false });
  for (let t = 2633; t < 4000; t += 33) o2 = o2 || g2.update({ t, seen: true });
  check("shared detector: 1-frame kneel spike + 600ms occlusion does not false-end", o2 === null);
}

// ---- 2 & 3. Push-up Sets & TUT / One long set ----
for (const mode of ["sets", "long"]) {
  const simWatch = (frameFn, totalMs) => {
    const w = SS.createFailureWatch(); w.reset(0);
    let out = null, at = null;
    for (let t = 0; t <= totalMs; t += DT) {
      const f = w.update(frameFn(t), t, 128, { frameW: 640, atTop: false, reps: 3 });
      if (f && !out) { out = f; at = t; break; }
    }
    return { out, at, failedAt: w.failedAt() };
  };

  // Kneel-down with lifted hands (no wrists) & weak hip score (0.38)
  const rKneel = simWatch((t) => (t < 2000 ? frontPlankWithHands() : frontKneelLiftedHands(0.38)), 5000);
  check(`${mode}: kneel with lifted hands and weak hip score (0.38) ends as knees`, rKneel.out === "knees" && rKneel.at < 3500, JSON.stringify(rKneel));

  // Walk-out -> ends as frame in ~2.5 s, failedAt frozen at departure
  const rWalk = simWatch((t) => (t < 2000 ? frontPlankWithHands() : []), 6000);
  check(`${mode}: walk-out ends as frame at ~2.5 s with failedAt frozen at departure`, rWalk.out === "frame" && rWalk.at >= 4450 && rWalk.at <= 4600 && rWalk.failedAt >= 1980 && rWalk.failedAt <= 2040, JSON.stringify(rWalk));

  // Kneel (0.5s) -> stand straight up (0.5s) -> walk out
  const rChain = simWatch((t) => (t < 2000 ? frontPlankWithHands() : t < 2500 ? frontKneelLiftedHands(0.85) : t < 3000 ? frontStandStraightUp() : []), 6000);
  check(`${mode}: kneel -> stand straight up -> walk out ends quickly as knees (no lifted false-positive, no timer reset)`, rChain.out === "knees" && rChain.at < 3500 && rChain.failedAt >= 1980 && rChain.failedAt <= 2040, JSON.stringify(rChain));

  // No false end: clean reps + 1.5s Vision hood rescue gap
  const rOk = simWatch((t) => (t >= 3000 && t < 4500 ? [] : PSYN.frameFor(PSYN.fracAt(PSYN.reps(6, 1800), t % 10800), PSYN.BASE, t)), 12000);
  check(`${mode}: clean reps + 1.5 s dropout does not end`, rOk.out === null, JSON.stringify(rOk));
}

// ---- 4. Two-minute challenge ----
{
  const simChal = (frameFn, totalMs) => {
    const w = SS.createFailureWatch(CH.HOLD_FAIL_OPTS); w.reset(0);
    let out = null, at = null;
    for (let t = 0; t <= totalMs; t += DT) {
      const f = w.update(frameFn(t), t, 128, { frameW: 640, atTop: t < 1500, reps: t < 1500 ? 1 : 2 });
      if (f && !out) { out = f; at = t; break; }
    }
    return { out, at, failedAt: w.failedAt() };
  };
  const rK = simChal((t) => (t < 2000 ? SY.kpsOf(SY.POSE.top) : SY.kpsOf(SY.POSE.knees)), 5000);
  check("challenge: kneel-down ends as knees", rK.out === "knees" && rK.at < 3500, JSON.stringify(rK));
  const rW = simChal((t) => (t < 2000 ? SY.kpsOf(SY.POSE.top) : []), 6000);
  check("challenge: walk-out ends as frame", rW.out === "frame" && rW.at >= 4450 && rW.at <= 4600, JSON.stringify(rW));
  const rC = simChal((t) => (t < 2000 ? frontPlankWithHands() : t < 2500 ? frontKneelLiftedHands(0.85) : t < 3000 ? frontStandStraightUp() : []), 6000);
  check("challenge: kneel -> stand -> walk-out chain ends as knees", rC.out === "knees" && rC.at < 3500, JSON.stringify(rC));
  const rOk = simChal((t) => (t >= 3000 && t < 4500 ? [] : SY.kpsOf(SY.POSE.top, { hood: true })), 10000);
  check("challenge: hood + 1.5 s dropout does not end", rOk.out === null, JSON.stringify(rOk));
}

// ---- 5. TUT Battles ----
{
  const runTb = (frameFn, totalMs) => {
    const j = TB.createJudge(SS.createPostureGuard({ holdMs: TB.RULES.postureHoldMs })); j.reset(0);
    let out = null, at = null;
    for (let t = 0; t <= totalMs; t += 33) {
      const f = j.update(frameFn(t), t, 128, 640, false);
      if (f && !out) { out = f; at = t; break; }
    }
    return { out, at };
  };
  const rK = runTb((t) => (t < 2000 ? frontPlankWithHands() : frontKneelLiftedHands(0.85)), 5000);
  check("TUT Battle: kneel with lifted hands ends as knees", rK.out === "knees" && rK.at < 3200, JSON.stringify(rK));
  const rW = runTb((t) => (t < 2000 ? frontPlankWithHands() : []), 6000);
  check("TUT Battle: walk-out ends as frame at ~2.5 s", rW.out === "frame" && rW.at >= 4450 && rW.at <= 4600, JSON.stringify(rW));
  const rC = runTb((t) => (t < 2000 ? frontPlankWithHands() : t < 2450 ? frontKneelLiftedHands(0.85) : t < 2800 ? frontStandStraightUp() : []), 6000);
  check("TUT Battle: kneel -> stand -> walk-out chain ends as knees", rC.out === "knees" && rC.at < 3600, JSON.stringify(rC));
  const rOk = runTb((t) => (t >= 3000 && t < 4500 ? [] : frontPlankWithHands()), 10000);
  check("TUT Battle: 1.5 s dropout does not end", rOk.out === null, JSON.stringify(rOk));
}

// ---- 6. Plank / Plank House / Plank Push Press ----
{
  const pTop = (t) => SY.kpsOf(SY.POSE.top, { noise: 0 });
  const pKneel = () => SY.kpsOf(SY.POSE.knees, { noise: 0 });
  const pStand = () => SY.kpsOf(SY.POSE.stand, { noise: 0 });
  const runPlank = (frameFn, totalMs, dims) => {
    const h = PS.createPlankHold();
    let ended = null;
    for (let t = 0; t <= totalMs; t += 33) {
      const r = h.update(frameFn(t), t, dims || { w: 640, h: 480 });
      if (r.ended && !ended) { ended = Object.assign({ t }, r); break; }
    }
    return ended;
  };
  const rK = runPlank((t) => (t < 3000 ? pTop(t) : pKneel()), 6000);
  check("plank: kneel-down ends as knees", rK && rK.reason === "knees" && rK.t < 4500, JSON.stringify(rK));
  const rW = runPlank((t) => (t < 3000 ? pTop(t) : []), 6000);
  check("plank: walk-out ends as left_frame", rW && rW.reason === "left_frame" && rW.t < 4500, JSON.stringify(rW));
  const rC = runPlank((t) => (t < 3000 ? pTop(t) : t < 3550 ? pKneel() : t < 3950 ? pStand() : []), 6000);
  check("plank: kneel -> stand -> walk-out chain ends as knees (no timer reset)", rC && rC.reason === "knees" && rC.t < 4600, JSON.stringify(rC));
  // Portrait plank with missing ankles: kneel drops knee to wrist line -> knees
  const portPlank = K({ left_shoulder: [80, 320], left_hip: [240, 325], left_knee: [360, 330], left_wrist: [110, 410] });
  const portKneel = K({ left_shoulder: [80, 320], left_hip: [240, 330], left_knee: [280, 405], left_wrist: [110, 410] });
  const rPort = runPlank((t) => (t < 3000 ? portPlank : portKneel), 6000, { w: 480, h: 640 });
  check("plank portrait (no ankles): kneel to wrist line ends as knees", rPort && rPort.reason === "knees", JSON.stringify(rPort));
  const rOk = runPlank((t) => (t >= 3000 && t < 3700 ? [] : pTop(t)), 8000);
  check("plank: 700 ms occlusion does not end", rOk === null, JSON.stringify(rOk));
}

// ---- 7. Gyatt Squats ----
{
  const newSq = () => {
    const c = SC.createCounter();
    for (let t = 0; t < 900; t += 33) c.calibrate(SQSYN.pose(0), t);
    const s = SQS.createSquatSet({ counter: c }); s.start(1000);
    return s;
  };
  const sqKneel = (dx = 0) => K({
    nose: [320 + dx, 130], left_shoulder: [290 + dx, 175], right_shoulder: [350 + dx, 175],
    left_hip: [300 + dx, 290], right_hip: [340 + dx, 290],
    left_knee: [295 + dx, 410], right_knee: [345 + dx, 410],
    left_ankle: [298 + dx, 420], right_ankle: [342 + dx, 420]
  });
  const runSq = (frameFn, totalMs) => {
    const s = newSq(); let r;
    for (let t = 1000; t <= totalMs; t += 33) {
      r = s.update(frameFn(t), t);
      if (r.ended) return { ended: r, t };
    }
    return { ended: null, r };
  };
  const rK = runSq((t) => (t < 2000 ? SQSYN.pose(0) : sqKneel(0)), 5000);
  check("squats: kneel-down ends as knees within ~1 s", rK.ended && rK.ended.reason === "knees" && rK.t < 3300, JSON.stringify(rK));
  const rKm = runSq((t) => (t < 2000 ? SQSYN.pose(0) : sqKneel(80)), 5000);
  check("squats: kneel-down while shifted (guard=moved) still ends as knees", rKm.ended && rKm.ended.reason === "knees" && rKm.t < 3300, JSON.stringify(rKm));
  const rW = runSq((t) => (t < 2000 ? SQSYN.pose(0) : []), 6000);
  check("squats: walk-out ends as left_frame at 3 s", rW.ended && rW.ended.reason === "left_frame" && rW.t >= 4900 && rW.t <= 5100, JSON.stringify(rW));
  const rC = runSq((t) => (t < 2000 ? SQSYN.pose(0) : t < 2450 ? sqKneel(40) : []), 6000);
  check("squats: kneel (0.45 s) -> walk-out chain ends quickly as knees", rC.ended && rC.ended.reason === "knees" && rC.t < 4000, JSON.stringify(rC));
  const rOk = runSq((t) => (t >= 2000 && t < 3800 ? [] : SQSYN.pose(0.8 * Math.max(0, Math.sin((t - 1000) / 800)))), 8000);
  check("squats: clean movement + 1.8 s dropout does not end", rOk.ended === null, JSON.stringify(rOk));
}

// ---- 8. Page flow (index.html through push-flow-harness): Sets (0-rep & >=1 rep), TUT ----
(async () => {
  const makeSetup = (outLog) => (c) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "push-session.js"), "utf8"), c);
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "push-challenge.js"), "utf8"), c);
    c.myLog = outLog;
    const between = (a, b) => { const idx = html.indexOf(a); return html.slice(idx, html.indexOf(b, idx)); };
    vm.runInContext(
      `function finishPushSet(w) { myLog.push("finish:" + w + ":" + pushState.reps); pushState.running = false; pushState.finished = true; exitPushCam(w); }
       function freezePushClock(p) { myLog.push("freeze:" + (p != null)); return 0; }
       function failExtra(st, w, pose, more) { return Object.assign({ frameW: w }, more || {}); }
       function stopCam() { myLog.push("stopCam"); poseLoopOn = false; poseLoopId += 1; camOn = false; camStream = null; }
       function exitPushCam(w) { myLog.push("exit:" + w); stopCam(); }
       function freshPushSet() { myLog.push("fresh"); pushState.reps = 0; pushState.elapsed = 0; pushState.startedAt = 0; }
       const failWatch = window.ZabbadatSession.createFailureWatch(); const twoMinWatch = window.ZabbadatSession.createFailureWatch(window.ZabbadatChallenge.HOLD_FAIL_OPTS); const modeWatch = () => (pushMode === "challenge" ? twoMinWatch : failWatch);
       function formatTime(ms) { return Math.round((ms || 0) / 1000) + "s"; } function camFs() {} var HOLD_CAPPED_TEXT = "capped";\n` +
      between("function discardZeroRepSet(", "function voidTutSet(") +
      between("function voidTutSet(", "function finishChallenge("),
      c
    );
  };

  // Sets with 0 reps + walk-out: stops clock, nothing posted, exits camera, does NOT say "Set complete." at t=0
  {
    const L = [];
    const r = await runHarness(HTML, {
      mode: "sets",
      frames: (t) => (t < 11500 ? PSYN.frameFor(0, PSYN.BASE, t) : []),
      ms: 17000,
      setup: makeSetup(L)
    });
    check("page Sets (0 reps, walk-out): stops without posting, clears set, exits camera", !L.some((x) => /^finish:/.test(x)) && L.includes("exit:Out of frame") && L.includes("stopCam") && r.reps === 0 && r.startedAt === 0 && r.running === false, JSON.stringify(L));
  }

  // TUT (One long set) with >=1 rep + kneel->walk-out: posts reps & stops counting
  {
    const L = [];
    const frames = (t) => {
      if (t < 10500) return PSYN.frameFor(0, PSYN.BASE, t);
      if (t < 15500) {
        const p = ((t - 10500) % 2000) / 2000;
        return PSYN.frameFor(p < 0.5 ? p * 2 : (1 - p) * 2, PSYN.BASE, t);
      }
      if (t < 16000) return frontKneelLiftedHands(0.85);
      return [];
    };
    const r = await runHarness(HTML, { mode: "long", frames, ms: 20000, setup: makeSetup(L) });
    check("page TUT (>=1 rep, kneel->walk-out): posts via finishPushSet, freezes clock, exits camera", L.some((x) => /^finish:Knees down:/.test(x)) && L.includes("freeze:true") && L.includes("stopCam") && r.running === false && r.reps >= 1, JSON.stringify({ L, reps: r.reps }));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
