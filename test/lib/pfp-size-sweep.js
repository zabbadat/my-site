// Logo size sweep (Nov 16): scale k on the base size (headRW, shR) -> coverage margin (ear widths), offset, logo / shoulder width,
// over front (mirrored) and rear cameras, 4:3 / 16:9 / portrait, front / tilted / turned / leaned heads.
const PF = require("../../pfp.js"); const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
const base = { shR: PF.P.shR, headRW: PF.P.headRW };
function poses(vw, vh, mirror) { // realistic frontal head + shoulders scaled to the frame; ear-to-ear ~ 0.40 x shoulder width
  const sc = Math.min(vw, vh) / 480, cx = vw / 2 + 40 * sc, ey = vh * 0.38;
  const P0 = { nose: [cx, ey + 12 * sc], left_eye: [cx + 15 * sc, ey - 5 * sc], right_eye: [cx - 15 * sc, ey - 5 * sc], left_ear: [cx + 30 * sc, ey], right_ear: [cx - 30 * sc, ey], left_shoulder: [cx + 75 * sc, ey + 95 * sc], right_shoulder: [cx - 75 * sc, ey + 95 * sc] };
  const m = (o) => { if (!mirror) return o; const q = {}; for (const [k, [x, y]] of Object.entries(o)) q[k] = [vw - x, y]; return q; };
  const tilt = (o, deg) => { const a = deg * Math.PI / 180, c0 = [cx, ey + 95 * sc], q = {}; for (const [k, [x, y]] of Object.entries(o)) { if (/shoulder/.test(k)) { q[k] = [x, y]; continue; } const dx = x - c0[0], dy = y - c0[1]; q[k] = [c0[0] + dx * Math.cos(a) - dy * Math.sin(a), c0[1] + dx * Math.sin(a) + dy * Math.cos(a)]; } return q; };
  const turn = (o) => { const q = Object.assign({}, o); q.nose = [o.nose[0] + 22 * sc, o.nose[1]]; q.left_eye = [o.left_eye[0] + 14 * sc, o.left_eye[1]]; q.right_eye = [o.right_eye[0] + 14 * sc, o.right_eye[1]]; q.right_ear = [o.right_ear[0] + 20 * sc, o.right_ear[1]]; return q; };
  const lean = (o) => { const q = {}; for (const [k, [x, y]] of Object.entries(o)) q[k] = /shoulder/.test(k) ? [x, y] : [x + 45 * sc, y + 8 * sc]; return q; };
  return { front: m(P0), tilt20: m(tilt(P0, 20)), tiltM25: m(tilt(P0, -25)), turned: m(turn(P0)), leaned: m(lean(P0)) };
}
const cams = [["front 4:3 640x480 mirrored", 640, 480, true], ["front 16:9 1280x720 mirrored", 1280, 720, true], ["front portrait 720x1280 mirrored", 720, 1280, true], ["rear 4:3 640x480", 640, 480, false], ["rear portrait 1080x1920", 1080, 1920, false]];
module.exports = function sweep(k) {
  Object.assign(PF.P, { shR: base.shR * k, headRW: base.headRW * k });
  let minMarginW = Infinity, maxOff = 0, prop = [], topChin = true;
  for (const [, vw, vh, mir] of cams) for (const [, o] of Object.entries(poses(vw, vh, mir))) {
    const h = PF.headCircle(K(o), vw, vh), mid = (o.left_shoulder[0] + o.right_shoulder[0]) / 2, w = Math.max(Math.abs(o.left_ear[0] - o.right_ear[0]), 30 * Math.min(vw, vh) / 480 * PF.P.eyeK);
    const earY = (o.left_ear[1] + o.right_ear[1]) / 2, sw = Math.hypot(o.left_shoulder[0] - o.right_shoulder[0], o.left_shoulder[1] - o.right_shoulder[1]);
    const ew = Math.hypot(o.left_ear[0] - o.right_ear[0], o.left_ear[1] - o.right_ear[1]);
    const pts = ["nose", "left_eye", "right_eye", "left_ear", "right_ear"].map((n) => o[n]);
    const m = Math.min(...pts.map(([x, y]) => h.r - Math.hypot(x - h.x, y - h.y))) / ew;
    minMarginW = Math.min(minMarginW, m);
    minMarginW = Math.min(minMarginW, m); maxOff = Math.max(maxOff, Math.abs(h.x - mid)); prop.push(2 * h.r / sw);
    if (!(h.y - h.r <= earY - ew * PF.P.topUp + 1e-6 && h.y + h.r >= earY + ew * PF.P.chinDn - 1e-6)) topChin = false;
  }
  Object.assign(PF.P, base);
  return { k, minMarginEarW: +minMarginW.toFixed(3), maxOffsetPx: +maxOff.toFixed(6), logoOverShoulder: [+Math.min(...prop).toFixed(2), +Math.max(...prop).toFixed(2)], headTopChinIn: topChin };
};
module.exports.cams = cams; module.exports.poses = poses;
if (require.main === module) for (const k of [0.8, 0.9, 1.0, 1.1, 1.2]) console.log(JSON.stringify(module.exports(k)));
