// Synthetic FRONT-view squat poses (640x480 picture, y down). d = hip drop as a fraction of the standing thigh (90 px).
// opts: scale (distance; 1 = baseline, about the feet), dx (sideways shift), kneeOut (px the knees track outward per unit d),
// lean (torso shortening per unit d, forward lean seen from the front), bend (0..1 shoulders drop toward hips = bending over),
// wrists ("hips" | "floor"), noise (px), drop (array of names to omit), score.
function pose(d, o) {
  o = o || {};
  const s = o.scale || 1, dx = o.dx || 0, kneeOut = o.kneeOut == null ? 14 : o.kneeOut, lean = o.lean == null ? 0.15 : o.lean;
  const ankY = 420, cx = 320 + dx;
  const P = (x, y) => ({ x: cx + (x - 320) * s, y: ankY + (y - ankY) * s });
  const hipY = 240 + d * 90, torso = 120 * (1 - lean * Math.min(d, 1.2)) * (1 - (o.bend || 0) * 0.75), shY = hipY - torso;
  const ko = kneeOut * d;
  const wristY = o.wrists === "floor" ? 430 : o.wrists === "hips" ? hipY + 10 : shY + 40; // default: hands at the chest
  const n = () => (o.noise ? (Math.random() * 2 - 1) * o.noise : 0);
  const pts = {
    nose: P(320, shY - 45), left_eye: P(312, shY - 52), right_eye: P(328, shY - 52), left_ear: P(304, shY - 48), right_ear: P(336, shY - 48),
    left_shoulder: P(290, shY), right_shoulder: P(350, shY), left_elbow: P(285, shY + 55), right_elbow: P(355, shY + 55),
    left_wrist: P(288, wristY), right_wrist: P(352, wristY),
    left_hip: P(300, hipY), right_hip: P(340, hipY), left_knee: P(300 - ko, 330), right_knee: P(340 + ko, 330),
    left_ankle: P(298, 420), right_ankle: P(342, 420)
  };
  return Object.keys(pts).filter((k) => !(o.drop || []).includes(k)).map((k) => ({ name: k, x: pts[k].x + n(), y: pts[k].y + n(), score: o.score == null ? 0.9 : o.score }));
}
// cadence-style rep profile: 3 s down, holdMs at the bottom, 5 s up, then topMs standing. Returns [{t, d}] at fps.
function repProfile(depth, o) {
  o = o || {};
  const down = o.downMs == null ? 3000 : o.downMs, hold = o.holdMs == null ? 4000 : o.holdMs, up = o.upMs == null ? 5000 : o.upMs, top = o.topMs == null ? 500 : o.topMs;
  const total = down + hold + up + top, step = 1000 / (o.fps || 30), out = [];
  for (let t = 0; t < total; t += step) {
    let d;
    if (t < down) d = depth * (t / down);
    else if (t < down + hold) d = depth;
    else if (t < down + hold + up) d = depth * (1 - (t - down - hold) / up);
    else d = 0;
    out.push({ t, d });
  }
  return out;
}
module.exports = { pose, repProfile };
