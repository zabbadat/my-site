// Washers tripod facing out (Nov 19, owner): drop the room-mirror idea. The pfp.js shield must lock on
// the body tracker when the back of the head is in view (no face cluster), stay locked through a turn
// toward the camera, and hold through a bend-to-pick-up-a-washer, without falling back to the opening
// logo or exposing the head. Locked size rule unchanged (r >= shTop x shoulder width); opening logo unchanged.
// Run: node test/pfp-tripod-back.test.js
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const PF = require("../pfp.js");
const pfpSrc = fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8");
const recSrc = fs.readFileSync(path.join(ROOT, "rec.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); if (ok) pass++; else fail++; };
const K = (o) => Object.entries(o).map(([name, v]) => {
  const x = Array.isArray(v) ? v[0] : v.x, y = Array.isArray(v) ? v[1] : v.y;
  const score = Array.isArray(v) ? (v[2] == null ? 0.9 : v[2]) : (v.score == null ? 0.9 : v.score);
  return { name, x, y, score };
});
const FW = 640, FH = 480, minS = PF.P.minScore;
const inside = (c, x, y, pad = 0) => c && Math.hypot(x - c.x, y - c.y) + pad <= c.r + 1e-6;
const mid = (a, b) => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Shield lock state (same rules as pfp.js shieldPose: lockFrames, lostFrames, hips-hold while already locked).
function freshShield() { return { lockT: 0, good: 0, bad: 0, circle: null, live: false, opening: true, held: false }; }
function stepShield(s, kps) {
  let raw = PF.coverFromPose(kps, FW, FH);
  let held = false;
  if (!raw && s.lockT && PF.hipsVisible(kps) && s.circle) { raw = { x: s.circle.x, y: s.circle.y, r: s.circle.r, src: s.circle.src || "hold" }; held = true; }
  if (!raw) {
    s.bad += 1; s.good = 0; s.held = false;
    if (s.bad >= PF.P.lostFrames) { s.lockT = 0; s.live = false; s.opening = true; s.circle = null; }
    return s;
  }
  s.bad = 0; s.good += 1; s.circle = raw; s.held = held;
  if (!s.lockT && s.good >= PF.P.lockFrames) { s.lockT = 1; s.live = true; s.opening = false; }
  s.live = !!s.lockT;
  return s;
}

function standingBack(extra) {
  return Object.assign({
    left_shoulder: [250, 260, 0.92], right_shoulder: [390, 260, 0.92],
    left_hip: [280, 420, 0.9], right_hip: [360, 420, 0.9],
    left_elbow: [230, 340, 0.85], right_elbow: [410, 340, 0.85],
    left_knee: [285, 500, 0.8], right_knee: [355, 500, 0.8],
    nose: [320, 195, 0.12], left_eye: [300, 185, 0.1], right_eye: [340, 185, 0.1],
    left_ear: [290, 198, 0.22], right_ear: [350, 198, 0.22]
  }, extra || {});
}

// ---- source / size contracts ----
check("shieldPose locks through coverFromPose (not faceCircle alone)", /var raw = coverFromPose\(kps, vw, vh, where\)/.test(pfpSrc));
check("already-locked hips hold keeps a deep bend from dropping to the opening logo", /if \(!raw && s\.lockT && hipsVisible\(kps\) && s\.circle\)/.test(pfpSrc));
check("opening logo size unchanged (blankR 0.48, blankY 0.38); no openMask / full-frame dark cover in pfp.js or rec.js",
  PF.P.blankR === 0.48 && PF.P.blankY === 0.38 && !/P\.openMask/.test(pfpSrc) &&
  !/x\.fillStyle = P\.coverBack; x\.fillRect\(0, 0, g\.bw, g\.bh\)/.test(pfpSrc) &&
  !/Math\.hypot\(fw, fh\) \/ 2/.test(recSrc) && !/imageSmoothingEnabled = false/.test(recSrc));
check("locked size rule unchanged: shTop 0.72, shR 0.55 (r >= 0.72 x shoulder width)", PF.P.shTop === 0.72 && PF.P.shR === 0.55);
check("page note: tripod facing out, not a room-mirror setup", /tripod facing out/.test(html));

// ---- back view locks on shoulders ----
{
  const k = K(standingBack());
  check("back view: no face cluster (eyes/nose below 0.35, ears alone are not a face)", PF.faceCircle(k) == null);
  const c = PF.coverFromPose(k, FW, FH);
  const shy = 260, sw = 140, headY = shy - sw * PF.P.shUp, headR = sw * 0.28;
  check(`back view: shield cover locks on shoulders (src ${c && c.src}, y ${c && c.y.toFixed(0)}, r ${c && c.r.toFixed(0)})`,
    c && c.src === "shoulders" && c.r >= sw * PF.P.shTop - 1e-9 && c.x === 320);
  check("back view: logo covers the estimated back of the head (and a head-radius margin)",
    inside(c, 320, headY, headR));
  const sh = freshShield();
  stepShield(sh, k); stepShield(sh, k);
  check("back view: after lockFrames the shield is locked, not the opening logo", sh.live && sh.lockT && !sh.opening && sh.circle && sh.circle.src === "shoulders");
}

// ears + shoulders, still no eyes: shoulders path, not face
{
  const k = K(standingBack({ left_ear: [290, 198, 0.9], right_ear: [350, 198, 0.9] }));
  check("back view with confident ears but no eyes: still no face cluster; cover is shoulders",
    PF.faceCircle(k) == null && PF.coverFromPose(k, FW, FH) && PF.coverFromPose(k, FW, FH).src === "shoulders");
}

// implausible standing "head on chest" still refused
{
  const front = {
    nose: [420, 210], left_eye: [405, 195], right_eye: [435, 195], left_ear: [390, 200], right_ear: [450, 200],
    left_shoulder: [345, 295], right_shoulder: [495, 295], left_hip: [360, 470], right_hip: [480, 470]
  };
  const chest = Object.fromEntries(Object.entries(front).map(([n, v]) => [n, /nose|eye|ear/.test(n) ? [v[0], v[1] + 170] : v]));
  const wall = Object.fromEntries(Object.entries(front).map(([n, v]) => [n, /nose|eye|ear/.test(n) ? [v[0] - 300, v[1] - 150] : v]));
  check("regression: standing head on the chest is still not a cover", PF.coverFromPose(K(chest), FW, FH) == null && !PF.bentOver(K(chest)));
  check("regression: head 300 px off the shoulders (wall) is still not a cover", PF.coverFromPose(K(wall), FW, FH) == null);
  check("regression: a normal front face still locks on the face path", PF.coverFromPose(K(front), FW, FH) && PF.coverFromPose(K(front), FW, FH).src === "face");
}

// side push-up / plank (no regression)
{
  const side = K({ left_shoulder: [200, 250], right_shoulder: [205, 252], left_hip: [380, 270], right_hip: [383, 271] });
  const c = PF.coverFromPose(side, FW, FH);
  check(`regression: side-on, no face, still the side cover (src ${c && c.src})`, c && c.src === "side" && c.x < 200);
  const plank = PF.coverFromPose(side, FW, FH, PF.plankHead);
  check("regression: plankHead on a side-on body still returns the plank/side cover", plank && (plank.src === "plank" || plank.src === "side"));
  const headDown = K({ left_shoulder: [240, 300], right_shoulder: [400, 300], left_hip: [260, 480], right_hip: [380, 480] });
  const hd = PF.coverFromPose(headDown, FW, FH);
  check("head down / hooded: shield now locks on shoulders (was opening-logo only, because faceCircle was empty)",
    PF.faceCircle(headDown) == null && hd && hd.src === "shoulders");
}

// ---- turn: back -> profile -> face, no exposure gap ----
function turnPose(u) { // u: 0 back, 0.5 profile, 1 face-on
  const sw0 = 140, sw = sw0 * (0.25 + 0.75 * Math.abs(1 - 2 * Math.min(1, Math.max(0, u)))); // narrows at profile, widens again
  const shY = 260, hipY = 420;
  const ls = [320 - sw / 2, shY, 0.9], rs = [320 + sw / 2, shY, 0.9];
  const lh = [320 - 40, hipY, 0.9], rh = [320 + 40, hipY, 0.9];
  const faceOn = u > 0.35;
  const scF = faceOn ? Math.min(0.95, 0.15 + (u - 0.35) / 0.3) : 0.12;
  const earSc = u < 0.2 ? 0.22 : 0.9;
  const eyeSc = faceOn ? scF : 0.1;
  const headY = 198, headW = 60;
  return K({
    left_shoulder: ls, right_shoulder: rs, left_hip: lh, right_hip: rh,
    left_elbow: [ls[0] - 20, 340, 0.85], right_elbow: [rs[0] + 20, 340, 0.85],
    nose: [320 + (1 - u) * 10, headY + 5, eyeSc],
    left_eye: [320 - 20, headY - 8, eyeSc], right_eye: [320 + 20, headY - 8, eyeSc],
    left_ear: [320 - headW / 2, headY, earSc], right_ear: [320 + headW / 2, headY, earSc]
  });
}
{
  const sh = freshShield();
  const tr = PF.createTracker();
  const log = [];
  let exposed = 0, openedAfterLock = 0, nullsAfterLock = 0, lockedAt = -1;
  const N = 25;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const k = turnPose(u);
    stepShield(sh, k);
    const t = tr.step(k, i * 66, FW, FH, i * 66);
    const c = sh.circle;
    const head = { x: 320, y: 198, r: 28 };
    const covered = c && inside(c, head.x, head.y, head.r);
    if (sh.live && lockedAt < 0) lockedAt = i;
    if (lockedAt >= 0 && sh.opening) openedAfterLock++;
    if (lockedAt >= 0 && !c) nullsAfterLock++;
    if (sh.live && !covered) exposed++;
    log.push({ i, u: +u.toFixed(2), src: c && c.src, live: !!sh.live, opening: !!sh.opening, held: !!sh.held, openFlag: !!(t && t.open), covered: !!covered });
  }
  check(`turn back→face: locked by frame ${lockedAt} (need >= 0, after ${PF.P.lockFrames} frames)`, lockedAt >= 0 && lockedAt <= PF.P.lockFrames);
  check(`turn: never returns to the opening logo after lock (${openedAfterLock} openings, ${nullsAfterLock} gaps)`, openedAfterLock === 0 && nullsAfterLock === 0);
  check(`turn: logo covers the head on every locked frame (exposed ${exposed})`, exposed === 0);
  const srcs = log.filter((r) => r.live).map((r) => r.src);
  check(`turn: hands off from a body cover to face (sources: ${srcs.join("→")})`,
    srcs.includes("shoulders") || srcs[0] === "side" ? srcs[srcs.length - 1] === "face" && (srcs.includes("shoulders") || srcs.includes("side")) : srcs[srcs.length - 1] === "face");
  check("turn: tracker never flashes the opening spot once locked", log.every((r) => !r.openFlag || !r.live));
}

// ---- bend to pick up a washer ----
// phase 0 = standing, 1 = fully bent; head drops past the shoulders toward / past the hips.
// At phase >= 0.9 from behind, shoulders leave the bottom of the frame; hips stay.
function bendPose({ face, phase, dropShoulders }) {
  const p = Math.max(0, Math.min(1, phase));
  const hipY = 400 + p * 8, sw = 140 - p * 24, shY = 250 + p * 175; // 250 -> 425
  const headStand = 250 - 140 * PF.P.shUp; // ~173
  const headY = headStand + p * (455 - headStand); // drops to ~455
  const inFrame = (y) => y >= 0 && y <= FH;
  const shScore = dropShoulders && p >= 0.9 ? 0.2 : 0.92;
  const shYuse = dropShoulders && p >= 0.9 ? 510 : shY; // below the frame
  const faceSc = face ? (p >= 0.9 && dropShoulders ? 0.1 : 0.9) : 0.1;
  const earSc = face ? 0.9 : (p >= 0.9 ? 0.15 : 0.22);
  return {
    kps: K({
      left_shoulder: [320 - sw / 2, shYuse, shScore], right_shoulder: [320 + sw / 2, shYuse, shScore],
      left_hip: [290, hipY, 0.9], right_hip: [350, hipY, 0.9],
      left_elbow: [300, Math.min(470, shYuse + 60), 0.8], right_elbow: [340, Math.min(470, shYuse + 60), 0.8],
      left_knee: [295, 520, 0.7], right_knee: [345, 520, 0.7],
      nose: [320, headY + 6, faceSc], left_eye: [305, headY - 6, faceSc], right_eye: [335, headY - 6, faceSc],
      left_ear: [300, headY, earSc], right_ear: [340, headY, earSc]
    }),
    head: { x: 320, y: headY, r: Math.max(16, (140 - p * 24) * 0.26) },
    headInFrame: inFrame(headY),
    phase: p,
    shY: shYuse,
    hipY
  };
}

function runBend(label, { face }) {
  const sh = freshShield();
  const frames = [];
  // standing 6, bending 8, fully bent 6, shoulders-out 6 (behind only), rising 8, standing 6
  const plan = [];
  for (let i = 0; i < 6; i++) plan.push({ phase: 0, dropShoulders: false, name: "standing" });
  for (let i = 1; i <= 8; i++) plan.push({ phase: i / 8 * 0.85, dropShoulders: false, name: "bending" });
  for (let i = 0; i < 6; i++) plan.push({ phase: 1, dropShoulders: false, name: "fully bent" });
  if (!face) for (let i = 0; i < 6; i++) plan.push({ phase: 1, dropShoulders: true, name: "shoulders out, hips stay" });
  for (let i = 7; i >= 0; i--) plan.push({ phase: i / 8 * 0.85, dropShoulders: false, name: "rising" });
  for (let i = 0; i < 6; i++) plan.push({ phase: 0, dropShoulders: false, name: "standing" });

  let exposed = 0, openedAfterLock = 0, lockedAt = -1;
  plan.forEach((step, i) => {
    const b = bendPose({ face, phase: step.phase, dropShoulders: step.dropShoulders });
    stepShield(sh, b.kps);
    if (sh.live && lockedAt < 0) lockedAt = i;
    const c = sh.circle;
    const covered = !b.headInFrame || (c && inside(c, b.head.x, b.head.y, b.head.r));
    if (lockedAt >= 0 && sh.opening) openedAfterLock++;
    if (sh.live && b.headInFrame && !covered) exposed++;
    frames.push({
      i, phase: step.name, t: +step.phase.toFixed(2),
      src: c && c.src, live: !!sh.live, opening: !!sh.opening, held: !!sh.held,
      headY: +b.head.y.toFixed(0), headInFrame: b.headInFrame, covered, r: c && +c.r.toFixed(0)
    });
  });
  console.log(`\n--- ${label}: frame-by-frame shield ---`);
  for (const f of frames) {
    const state = f.opening && !f.live ? "OPENING LOGO" : f.held ? "LOCKED (held last, hips still in view)" : f.live ? `LOCKED (${f.src}, r=${f.r})` : "not yet locked";
    const cov = !f.headInFrame ? "head out of frame (nothing to expose)" : f.covered ? "head covered" : "EXPOSED";
    console.log(`  f${String(f.i).padStart(2, "0")} ${f.phase.padEnd(28)} headY=${f.headY}  ${state}  ${cov}`);
  }
  return { frames, exposed, openedAfterLock, lockedAt, last: frames[frames.length - 1] };
}

{
  const rear = runBend("FROM BEHIND (tripod facing out, no face cluster)", { face: false });
  check(`bend from behind: locks on standing back view (frame ${rear.lockedAt})`, rear.lockedAt >= 0 && rear.lockedAt <= PF.P.lockFrames);
  check(`bend from behind: never falls back to the opening logo after lock (${rear.openedAfterLock} times)`, rear.openedAfterLock === 0);
  check(`bend from behind: 0 face/head exposure on in-frame heads (${rear.exposed} exposed)`, rear.exposed === 0);
  const out = rear.frames.filter((f) => f.phase === "shoulders out, hips stay");
  check("bend from behind: when shoulders leave the frame and hips stay, the last lock is held (not opening)",
    out.length > 0 && out.every((f) => f.live && !f.opening && f.held));
  const bent = rear.frames.filter((f) => f.phase === "fully bent" && f.live);
  check("bend from behind: fully bent, logo stays over the dropped head (not above the empty back)",
    bent.length > 0 && bent.every((f) => f.covered));

  const front = runBend("FACING THE CAMERA", { face: true });
  check(`bend facing camera: locks on the face (frame ${front.lockedAt})`, front.lockedAt >= 0 && front.lockedAt <= PF.P.lockFrames);
  check(`bend facing camera: never falls back to the opening logo after lock (${front.openedAfterLock} times)`, front.openedAfterLock === 0);
  check(`bend facing camera: 0 face exposure through the pickup (${front.exposed} exposed)`, front.exposed === 0);
  const mid = front.frames.filter((f) => f.phase === "fully bent");
  check("bend facing camera: a face near the hips is accepted as a folded-over pickup, not 'head on the chest'",
    mid.length > 0 && mid.every((f) => f.live && !f.opening && f.covered));
}

// ---- rear camera is unmirrored (tripod default) ----
{
  const cam = fs.readFileSync(path.join(ROOT, "match-pfp-cam.js"), "utf8");
  check("Live Match default facing is the rear camera, unmirrored; only the front camera is flipped",
    /facing = "environment"/.test(cam) && /vid\.style\.transform = facing === "user" \? "scaleX\(-1\)" : "none"/.test(cam) &&
    /var flip = facing === "user"/.test(cam));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exitCode = 1;
