// Synthetic MoveNet-style keypoints for the push-up counter tests. Camera only, no sensors.
// Phone leaned up in front of the user, camera facing them. Shoulders and head sink in the frame, the hands stay
// planted, so wrist-to-shoulder distance shrinks. Apparent size grows only a little.
// A depth profile is a list of segments [durationMs, fromFrac, toFrac], frac 0 = top, 1 = bottom.
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const reseed = (n) => { seed = n || 11; };
const full = (ms) => [[ms * 0.45, 0, 1], [ms * 0.1, 1, 1], [ms * 0.45, 1, 0]];
const half = (ms, f) => [[ms * 0.45, 0, f], [ms * 0.1, f, f], [ms * 0.45, f, 0]];
const hold = (ms) => [[ms, 0, 0]];
const reps = (n, ms) => Array.from({ length: n }, () => full(ms)).flat();
// smooth (cosine) rep for latency work: frac = 0.5 - 0.5 cos
const cosReps = (n, ms, stepMs) => { const out = []; const k = Math.round(ms / stepMs); for (let r = 0; r < n; r++) for (let i = 0; i < k; i++) out.push([stepMs, 0.5 - 0.5 * Math.cos(2 * Math.PI * i / k), 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / k)]); return out; };
function fracAt(segs, t) { let acc = 0; for (const [d, a, b] of segs) { if (t <= acc + d) return a + (b - a) * ((t - acc) / d); acc += d; } return 0; }
const total = (segs) => segs.reduce((a, s) => a + s[0], 0);

function frameFor(frac, c, t) {
  const W = c.W, jit = (p) => ({ x: p.x + gauss() * c.noise * W, y: p.y + gauss() * c.noise * W });
  const sc = () => (rnd() < c.drop ? 0.15 : 0.6 + 0.3 * rnd());
  const sw = c.sw * W * (1 + c.sizeGrow * frac), top = c.topY, drop = c.travel * c.sw * W * frac;
  const shift = c.shiftAt && t >= c.shiftAt[0] ? c.shiftAt[1] * sw : 0;
  const midY = top + drop + c.driftY + shift, cx = W / 2 + c.cx;
  const ls = { x: cx - sw / 2, y: midY }, rs = { x: cx + sw / 2, y: midY };
  const nose = { x: cx, y: midY - 0.25 * sw + 0.25 * drop };
  const follow = c.followAfter != null && t >= c.followAfter, wy = follow ? midY + c.armLen * c.sw * W : top + c.armLen * c.sw * W + shift; // hands planted (unless 'follow')
  const wl = { x: ls.x - 0.1 * sw, y: wy }, wr = { x: rs.x + 0.1 * sw, y: wy };
  const kps = [{ name: "left_shoulder", ...jit(ls), score: sc() }, { name: "right_shoulder", ...jit(rs), score: sc() }];
  if (c.nose) kps.push({ name: "nose", ...jit(nose), score: sc() });
  if (c.wrists >= 1) kps.push({ name: "left_wrist", ...jit(wl), score: sc() });
  if (c.wrists >= 2) kps.push({ name: "right_wrist", ...jit(wr), score: sc() });
  return kps;
}
const BASE = { W: 640, H: 480, fps: 30, noise: 0, drop: 0, nose: true, wrists: 2, cx: 0,
  sw: 0.2, topY: 170, travel: 0.55, armLen: 1.6, sizeGrow: 0.04, driftY: 0 };
// Run a counter over a profile. Returns { reps, countTimes, state }.
function run(createCounter, segs, cfg, counterOpts, pre) {
  const c = Object.assign({}, BASE, cfg || {}), ctr = createCounter(counterOpts), dt = 1000 / c.fps, T = total(segs), countTimes = [];
  let pk = null; // optional pre-smoothing of keypoints (emulates a camera library's own smoothing)
  for (let t = 0; t <= T; t += dt) {
    let kps = frameFor(fracAt(segs, t), c, t);
    if (pre) { const a = 1 - Math.exp(-dt / pre); pk = !pk ? kps : kps.map((k, i) => ({ ...k, x: pk[i] && pk[i].name === k.name ? pk[i].x + a * (k.x - pk[i].x) : k.x, y: pk[i] && pk[i].name === k.name ? pk[i].y + a * (k.y - pk[i].y) : k.y })); kps = pk; }
    const r = ctr.update(c.gone && t >= c.gone[0] && t < c.gone[1] ? [] : kps, t, c.W);
    if (r.counted) countTimes.push(t);
  }
  return { reps: ctr.state().reps, countTimes, state: ctr.state() };
}
// Times (ms) when the TRUE depth falls back through `level` on the way up, one per rep after tStart.
function trueReturns(segs, level, stepMs) {
  const out = []; let prev = fracAt(segs, 0), T = total(segs), wasDown = false;
  for (let t = 0; t <= T; t += stepMs || 5) { const f = fracAt(segs, t); if (f > 0.7) wasDown = true; if (wasDown && f < level && prev >= level) { out.push(t); wasDown = false; } prev = f; }
  return out;
}
module.exports = { full, half, hold, reps, cosReps, fracAt, total, frameFor, BASE, run, trueReturns, reseed };
