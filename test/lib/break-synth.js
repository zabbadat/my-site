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
  for (const [k, ms] of [["knees", 400], ["collapse", 500], ["stand", 900]]) S.push({ name: "break: " + k, label: "break", onset: B, kinds: ["push", "plank"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE[k], B, ms)(t)) });
  S.push({ name: "break: knees down mid-set (after reps)", label: "break", onset: B, kinds: ["push"], frame: (t) => kpsOf(t < B ? repPose(t) : moveTo(POSE.top, POSE.knees, B, 400)(t)) });
  S.push({ name: "break: knees down, noisy tracking (3 px jitter, 1 in 5 frames dropped)", label: "break", onset: B, kinds: ["push", "plank"], frame: (t) => (t >= B && Math.floor(t / 33) % 5 === 0 ? [] : kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.knees, B, 400)(t), { noise: 3 })) });
  S.push({ name: "break: hips sag", label: "break", onset: B, kinds: ["plank", "pushform"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.sag, B, 400)(t)) });
  S.push({ name: "break: hips pike", label: "break", onset: B, kinds: ["plank", "pushform"], frame: (t) => kpsOf(t < B ? POSE.top : moveTo(POSE.top, POSE.pike, B, 400)(t)) });
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
  return S;
}
module.exports = { scenarios, POSE, kpsOf, lerp, B };
