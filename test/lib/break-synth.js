// Labeled synthetic landmark scenarios for failure / stop detection (Nov 16). Side-on camera on the floor, MoveNet-style
// named keypoints with scores, 30 fps. Each scenario: { name, label: "break" | "ok", onset (ms, breaks only), frame(t) -> kps }.
// Poses are hand-placed joint sets (px, 640x480), interpolated, with seeded Gaussian jitter. Used by test/break-detect.test.js.
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const J = ["nose", "shoulder", "elbow", "wrist", "hip", "knee", "ankle"];
// one side's joints; the far side is the same shifted 6 px (both sides tracked, as MoveNet reports them)
const POSE = {
  top:    { nose: [165, 248], shoulder: [200, 250], elbow: [201, 295], wrist: [200, 340], hip: [345, 263], knee: [440, 273], ankle: [535, 283] },
  bottom: { nose: [168, 300], shoulder: [205, 305], elbow: [245, 300], wrist: [200, 340], hip: [345, 292], knee: [440, 288], ankle: [535, 285] },
  knees:  { nose: [165, 250], shoulder: [200, 255], elbow: [201, 297], wrist: [200, 340], hip: [360, 255], knee: [405, 335], ankle: [505, 338] },
  collapse: { nose: [165, 345], shoulder: [205, 348], elbow: [250, 341], wrist: [200, 340], hip: [345, 335], knee: [440, 330], ankle: [535, 330] },
  stand:  { nose: [300, 70], shoulder: [300, 100], elbow: [300, 165], wrist: [300, 225], hip: [300, 230], knee: [302, 320], ankle: [303, 420] },
  sag:    { nose: [165, 248], shoulder: [200, 250], elbow: [201, 295], wrist: [200, 340], hip: [345, 325], knee: [440, 300], ankle: [535, 283] },
  pike:   { nose: [165, 248], shoulder: [200, 250], elbow: [201, 295], wrist: [200, 340], hip: [345, 175], knee: [440, 235], ankle: [535, 283] }
};
const lerp = (a, b, f) => { const o = {}; for (const j of J) o[j] = [a[j][0] + (b[j][0] - a[j][0]) * f, a[j][1] + (b[j][1] - a[j][1]) * f]; return o; };
function kpsOf(p, o) {
  o = o || {}; const n = o.noise == null ? 1.5 : o.noise, out = [];
  for (const side of ["left", "right"]) for (const j of J) {
    if (j === "nose" && side === "right") continue;
    if (o.hood && (j === "nose")) continue;
    const [x, y] = p[j], dx = side === "right" ? 6 : 0;
    let s = 0.6 + 0.3 * rnd(); if (o.lowLegs && /hip|knee|ankle/.test(j)) s = 0.2;
    out.push({ name: j === "nose" ? "nose" : side + "_" + j, x: x + dx + gauss() * n, y: y + gauss() * n, score: s });
  }
  if (o.hood) for (const k of out) if (k.name === "nose") k.score = 0;
  if (o.rot) { const c = Math.cos(o.rot), s = Math.sin(o.rot), cx = 320 + (o.tx || 0), cy = 240 + (o.ty || 0); for (const k of out) { const x = k.x - 320, y = k.y - 240; k.x = cx + c * x - s * y; k.y = cy + s * x + c * y; } }
  return out;
}
// push-up reps: 2 s per rep (top -> bottom -> top)
const repPose = (t) => { const p = (t % 2000) / 2000, f = p < 0.45 ? p / 0.45 : p < 0.55 ? 1 : (1 - p) / 0.45; return lerp(POSE.top, POSE.bottom, Math.max(0, Math.min(1, f))); };
const moveTo = (from, to, t0, ms) => (t) => lerp(from, to, Math.max(0, Math.min(1, (t - t0) / ms)));
const B = 4000; // break onset (after 4 s of clean plank / reps)
function scenarios(sd) {
  seed = sd || 7;
  const S = [];
  const pre = (t) => (t < B ? POSE.top : null);
  // ---- true breaks (must fail) ----
  // push-up chest-on-floor collapse (owner, Nov 16) needs the chest to stay down 4 s with no press: 6 s window; plank keeps its own rule
  S.push({ name: "break: collapse (chest stays on the floor, no press)", label: "break", onset: B, window: 6000, kinds: ["push"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.collapse, B, 500)(t)) });
  S.push({ name: "break: collapse", label: "break", onset: B, kinds: ["plank"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.collapse, B, 500)(t)) });
  for (const [k, ms] of [["knees", 400], ["stand", 900]]) S.push({ name: "break: " + k, label: "break", onset: B, kinds: ["push", "plank"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE[k], B, ms)(t)) });
  S.push({ name: "break: knees down mid-set (after reps)", label: "break", onset: B, kinds: ["push"], frame: (t) => kpsOf(t < B ? repPose(t) : moveTo(POSE.top, POSE.knees, B, 400)(t)) });
  S.push({ name: "break: knees down, noisy tracking (3 px jitter, 1 in 5 frames dropped)", label: "break", onset: B, kinds: ["push", "plank"], frame: (t) => (t >= B && Math.floor(t / 33) % 5 === 0 ? [] : kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.knees, B, 400)(t), { noise: 3 })) });
  S.push({ name: "break: hips sag", label: "break", onset: B, kinds: ["plank", "pushform"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.sag, B, 400)(t)) });
  S.push({ name: "ok: hips pike (push-ups: a pike never ends a set, owner Nov 16)", label: "ok", kinds: ["pushform"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.pike, B, 400)(t)) });
  S.push({ name: "break: hips pike", label: "break", onset: B, kinds: ["plank"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.pike, B, 400)(t)) });
  // ---- must NOT fail ----
  S.push({ name: "ok: clean top hold, 1.5 px jitter", label: "ok", kinds: ["push", "plank"], frame: (t) => kpsOf(POSE.top) });
  S.push({ name: "ok: clean top hold, heavy 4 px jitter", label: "ok", kinds: ["push", "plank"], frame: (t) => kpsOf(POSE.top, { noise: 4 }) });
  S.push({ name: "ok: clean reps", label: "ok", kinds: ["push"], frame: (t) => kpsOf(repPose(t)) });
  S.push({ name: "ok: clean reps, heavy 4 px jitter + 1 in 6 frames dropped", label: "ok", kinds: ["push"], frame: (t) => (Math.floor(t / 33) % 6 === 0 ? [] : kpsOf(repPose(t), { noise: 4 })) });
  S.push({ name: "ok: single-frame dropouts (every 8th frame empty)", label: "ok", kinds: ["push", "plank"], frame: (t) => (Math.floor(t / 33) % 8 === 0 ? [] : kpsOf(POSE.top)) });
  S.push({ name: "ok: single-frame spikes (one bad frame every 0.5 s: knees / stand / sag)", label: "ok", kinds: ["push", "plank"], frame: (t) => { const i = Math.floor(t / 33); return kpsOf(i % 15 === 7 ? POSE[["knees", "stand", "sag", "collapse"][(i / 15 | 0) % 4]] : POSE.top); } });
  S.push({ name: "ok: two-frame glitch bursts (2 bad frames every 0.7 s)", label: "ok", kinds: ["push", "plank"], frame: (t) => { const i = Math.floor(t / 33); return kpsOf(i % 21 === 3 || i % 21 === 4 ? POSE.knees : POSE.top); } });
  S.push({ name: "ok: brief occlusion (600 ms nothing seen)", label: "ok", kinds: ["push", "plank"], frame: (t) => (t >= B && t < B + 600 ? [] : kpsOf(POSE.top)) });
  S.push({ name: "ok: head down / hood (no face points)", label: "ok", kinds: ["push", "plank"], frame: (t) => kpsOf(t < B ? POSE.top : repPose(t), { hood: true }) });
  S.push({ name: "ok: hidden legs guessed bent at low confidence (0.2)", label: "ok", kinds: ["push"], frame: (t) => kpsOf(t < B ? POSE.top : POSE.knees, { lowLegs: true }) });
  S.push({ name: "ok: brief 300 ms hip wobble then back", label: "ok", kinds: ["push", "plank"], frame: (t) => kpsOf(t >= B && t < B + 300 ? POSE.sag : POSE.top) });
  S.push({ name: "ok: phone pickup (whole picture moves + tilts 30 deg, then set down)", label: "ok", kinds: ["push", "plank"], frame: (t) => { const f = t < B ? 0 : t < B + 500 ? (t - B) / 500 : t < B + 2500 ? 1 : t < B + 3000 ? 1 - (t - B - 2500) / 500 : 0; return kpsOf(POSE.top, { rot: f * 0.52, tx: f * 60, ty: f * -50 }); } });
  // ---- harder knee-down cases (must fail); front-facing is push-up only (plank is side-view) ----
  S.push({ name: "break: knees down, knees occluded (landmarks removed)", label: "break", onset: B, kinds: ["push", "plank"], frame: (t) => { const k = kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.knees, B, 400)(t)); return t < B ? k : dropJoints(k, /_knee$/); } });
  S.push({ name: "break: knees down, low-confidence knees (0.32)", label: "break", onset: B, kinds: ["push", "plank"], frame: (t) => { const k = kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.knees, B, 400)(t)); return t < B ? k : setScore(k, /_knee$/, 0.32); } });
  S.push({ name: "break: knees down, low-confidence knees (0.28)", label: "break", onset: B, kinds: ["push", "plank"], frame: (t) => { const k = kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.knees, B, 400)(t)); return t < B ? k : setScore(k, /_knee$/, 0.28); } });
  S.push({ name: "break: front-facing kneel", label: "break", onset: B, kinds: ["push"], topWidth: 128, frame: (t) => frontKps(t >= B) });
  S.push({ name: "break: front-facing kneel, knees occluded", label: "break", onset: B, kinds: ["push"], topWidth: 128, frame: (t) => frontKps(t >= B, { noKnee: true }) });
  S.push({ name: "break: front-facing kneel, low-confidence knees (0.32)", label: "break", onset: B, kinds: ["push"], topWidth: 128, frame: (t) => frontKps(t >= B, { lowKnee: 0.32 }) });
  // Nov 17 (owner, iPhone): a real drop-to-knees plants the knees on the floor while the hips stay well above the hands
  // (thighs more vertical). This must end the set; hips-at-hand-height is no longer required.
  S.push({ name: "break: front-facing drop-to-knees (hips still high)", label: "break", onset: B, kinds: ["push"], topWidth: 128, frame: (t) => frontKps(t >= B, { hipsHigh: true }) });
  S.push({ name: "break: front-facing drop-to-knees, Vision-like scores (knee 0.45, ankle 0.38)", label: "break", onset: B, kinds: ["push"], topWidth: 128, frame: (t) => frontKps(t >= B, { hipsHigh: true, lowKnee: 0.45, lowAnkle: 0.38 }) });
  S.push({ name: "break: knees down, portrait frame (phone upright, body still side-on)", label: "break", onset: B, kinds: ["push", "plank"], dims: { w: 480, h: 640 }, frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.knees, B, 400)(t)) });
  S.push({ name: "break: knees down, slow sink (2.5 s)", label: "break", onset: B, window: 3500, kinds: ["push", "plank"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.knees, B, 2500)(t)) });
  S.push({ name: "break: knees down, fast drop (120 ms)", label: "break", onset: B, kinds: ["push", "plank"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.knees, B, 120)(t)) });
  S.push({ name: "break: partial left-knee rest", label: "break", onset: B, kinds: ["push", "plank"], frame: (t) => oneSideKnees(t, "left") });
  S.push({ name: "ok: front-facing plank (foreshorened, straight legs)", label: "ok", kinds: ["push"], topWidth: 128, frame: (t) => frontKps(false) });
  return S;
}
function setScore(kps, re, score) { return kps.map((k) => re.test(k.name) ? Object.assign({}, k, { score: score }) : k); }
function dropJoints(kps, re) { return kps.filter((k) => !re.test(k.name)); }
function frontKps(kneel, opt) {
  opt = opt || {};
  const plank = { left_shoulder: [256, 170], right_shoulder: [384, 170], left_elbow: [248, 270], right_elbow: [392, 270], left_wrist: [240, 370], right_wrist: [400, 370], nose: [320, 140], left_hip: [230, 330], left_knee: [235, 400], left_ankle: [238, 470], right_hip: [400, 330], right_knee: [405, 400], right_ankle: [408, 470] };
  const down = { left_shoulder: [256, 210], right_shoulder: [384, 210], left_elbow: [248, 300], right_elbow: [392, 300], left_wrist: [240, 370], right_wrist: [400, 370], nose: [320, 180], left_hip: [300, 360], left_knee: [310, 370], left_ankle: [300, 430], right_hip: [340, 360], right_knee: [350, 370], right_ankle: [348, 430] };
  // Drop to knees with thighs nearly vertical: knees on the hand line, hips still ~1 thigh above the hands.
  const downHigh = { left_shoulder: [256, 160], right_shoulder: [384, 160], left_elbow: [248, 260], right_elbow: [392, 260], left_wrist: [240, 370], right_wrist: [400, 370], nose: [320, 130], left_hip: [290, 250], left_knee: [300, 365], left_ankle: [330, 378], right_hip: [350, 250], right_knee: [340, 365], right_ankle: [310, 378] };
  const src = !kneel ? plank : opt.hipsHigh ? downHigh : down, out = [];
  for (const n of Object.keys(src)) out.push({ name: n, x: src[n][0], y: src[n][1], score: 0.85 });
  if (opt.noKnee) return out.filter((k) => !/_knee$/.test(k.name));
  if (opt.lowKnee) out.forEach((k) => { if (/_knee$/.test(k.name)) k.score = opt.lowKnee; });
  if (opt.lowAnkle) out.forEach((k) => { if (/_ankle$/.test(k.name)) k.score = opt.lowAnkle; });
  return out;
}
function oneSideKnees(t, side) {
  const p = t < B ? POSE.top : moveTo(POSE.top, POSE.knees, B, 400)(t);
  const kps = kpsOf(p);
  const other = side === "left" ? "right" : "left";
  const keep = kpsOf(POSE.top);
  return kps.map((k) => k.name.startsWith(other + "_") ? (keep.find((x) => x.name === k.name) || k) : k);
}
module.exports = { scenarios, POSE, kpsOf, lerp, B, setScore, dropJoints, frontKps, oneSideKnees };
