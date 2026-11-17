// Plank set-start: a proper forearm or straight-arm plank, side-on or angled, must arm the set.
// Standing and kneeling must not. Run: node test/plank-start-views.test.js
const P = require("../plank-session.js");
const G = require("../get-set.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, score = 0.85) => Object.entries(o).filter(([, v]) => v).map(([name, [x, y]]) => ({ name, x, y, score }));

function rot(x, y, cx, cy, deg) {
  const a = deg * Math.PI / 180, dx = x - cx, dy = y - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

// style: "straight" (high plank) or "forearm". yaw is degrees off a pure side view (0 = profile, 45 = 3/4).
// tilt is the apparent shoulder-ankle rise in the camera (floor-propped phones often show ~20-40°).
function plank(opts = {}) {
  const style = opts.style || "straight", yaw = (opts.yaw || 0) * Math.PI / 180;
  const x0 = opts.x0 == null ? 120 : opts.x0, y0 = opts.y0 == null ? 220 : opts.y0, L = opts.L || 380;
  const hipDy = opts.hipDy || 0, j = opts.j || 0;
  const run = L * Math.cos(yaw);
  // shoulder / hip width projected as the view turns toward the camera
  const shW = 80 * Math.sin(yaw), hipW = 70 * Math.sin(yaw);
  const pts = {
    left_shoulder: [x0 + j, y0],
    left_hip: [x0 + 0.45 * run, y0 + 8 + hipDy],
    left_knee: [x0 + 0.75 * run, y0 + 12],
    left_ankle: [x0 + run, y0 + 15]
  };
  if (style === "forearm") {
    pts.left_elbow = [x0 + 5, y0 + 90];
    pts.left_wrist = [x0 + 70, y0 + 92];
  } else {
    pts.left_elbow = [x0 + 10, y0 + 70];
    pts.left_wrist = [x0 + 5, y0 + 95];
  }
  if (yaw > 0) {
    pts.right_shoulder = [x0 + shW, y0 - 6];
    pts.right_hip = [x0 + 0.45 * run + hipW, y0 + 2];
    pts.right_knee = [x0 + 0.75 * run + hipW * 0.6, y0 + 8];
    pts.right_ankle = [x0 + run + hipW * 0.3, y0 + 12];
    pts.right_elbow = style === "forearm" ? [x0 + shW + 5, y0 + 86] : [x0 + shW + 8, y0 + 66];
    pts.right_wrist = style === "forearm" ? [x0 + shW + 60, y0 + 90] : [x0 + shW + 4, y0 + 92];
  }
  if (opts.tilt) {
    const cx = x0 + run / 2, cy = y0;
    for (const k of Object.keys(pts)) pts[k] = rot(pts[k][0], pts[k][1], cx, cy, opts.tilt);
  }
  return K(pts, opts.score == null ? 0.85 : opts.score);
}

function standing() {
  return K({ left_shoulder: [300, 50], left_hip: [300, 250], left_knee: [302, 350], left_ankle: [304, 450],
    right_shoulder: [380, 52], right_hip: [370, 252], right_knee: [368, 352], right_ankle: [366, 452] });
}
function kneesDown() {
  return K({ left_shoulder: [120, 240], left_hip: [300, 250], left_knee: [330, 360], left_ankle: [470, 365],
    left_elbow: [125, 320], left_wrist: [130, 360] });
}

const LAND = { w: 640, h: 480 }, PORT = { w: 480, h: 640 };
const seq = (a, b, f, dt = 33) => { const r = []; for (let t = a; t < b; t += dt) r.push([t, f(t)]); return r; };
const jit = (base) => (t) => {
  const j = Math.sin(t / 37) * 1.5 + Math.cos(t / 91);
  return base().map((p) => ({ ...p, x: p.x + j, y: p.y + Math.cos(t / 53) }));
};
function run(frames, dims, opts) {
  const h = P.createPlankHold(opts || { cue: true });
  let r, lock = null;
  for (const [t, k] of frames) {
    r = h.update(k, t, dims);
    if ((r.phase === "cue" || r.phase === "holding") && lock == null) lock = t;
  }
  return { r, lock, h };
}

const cases = [
  ["straight-arm side, landscape", () => plank({ style: "straight" }), LAND],
  ["forearm side, landscape", () => plank({ style: "forearm" }), LAND],
  ["straight-arm angled 35°, landscape", () => plank({ style: "straight", yaw: 35 }), LAND],
  ["forearm angled 35°, landscape", () => plank({ style: "forearm", yaw: 35 }), LAND],
  ["straight-arm side, 40° camera tilt", () => plank({ style: "straight", tilt: 40 }), LAND],
  ["forearm angled 30° with 25° tilt", () => plank({ style: "forearm", yaw: 30, tilt: 25 }), LAND],
  ["straight-arm side, portrait", () => plank({ style: "straight", x0: 50, y0: 320, L: 360 }), PORT],
  ["forearm angled 35°, portrait", () => plank({ style: "forearm", yaw: 35, x0: 50, y0: 320, L: 360 }), PORT],
  ["mild 6% hip rise (forearm, side)", () => plank({ style: "forearm", hipDy: -0.06 * 380 }), LAND],
  ["ankles near the frame edge", () => plank({ style: "straight", x0: 50, L: 560 }), LAND]
];

for (const [name, pose, dims] of cases) {
  const { r, lock } = run(seq(0, 4000, jit(pose)), dims, { cue: true });
  check(`${name}: set starts (cue after ~1.5 s proper plank)`, r.phase === "cue" && lock != null && lock >= 1500 && lock < 2000 && r.ms === 0);
  const c = P.classifyPlank(pose()), g = P.frameGuide(pose(), dims);
  check(`${name}: form ok and framing ok`, c.frame === "ok" && g.ok);
}

for (const [name, pose, dims] of [
  ["standing upright", standing, LAND],
  ["kneeling / knees down", kneesDown, LAND]
]) {
  const { r, lock } = run(seq(0, 5000, jit(pose)), dims, { cue: true });
  check(`${name}: set does not start`, r.phase === "ready" && lock == null && r.ms === 0);
  const c = P.classifyPlank(pose());
  check(`${name}: classified as a fail, not ok`, c.frame !== "ok");
}

// Default (no cue): clock starts after 1.5 s on a good forearm plank, not on standing.
{
  const { r } = run(seq(0, 4000, jit(() => plank({ style: "forearm", yaw: 35, tilt: 20 }))), LAND, {});
  check("no-cue hold: angled forearm plank starts the clock", r.phase === "holding" && r.ms > 2000);
  const { r: s } = run(seq(0, 4000, jit(standing)), LAND, {});
  check("no-cue hold: standing never starts the clock", s.phase === "ready" && s.ms === 0);
}

// Later utterances (the lock-in One / two / three / Hold) resume a paused speechSynthesis (Safari).
{
  const calls = [];
  global.window = { speechSynthesis: { speaking: false, pending: false, resume() { calls.push("resume"); }, speak(u) { calls.push("speak:" + u.text); } }, SpeechSynthesisUtterance: function (t) { this.text = t; } };
  G.plankSpeak("One");
  check("plankSpeak resumes speechSynthesis before speaking (so the count is not swallowed after 'go on three')", calls[0] === "resume" && calls[1] === "speak:One");
  delete global.window;
}

const fail = R.filter((x) => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed`);
process.exit(fail ? 1 : 0);
