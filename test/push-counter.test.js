// Synthetic tests for push-counter.js. Run: node test/push-counter.test.js
// A pinhole camera lies face-up under the chest; going down shrinks distance D,
// so the shoulders look wider. Keypoints are projected from a simple 3D body.
const { createCounter } = require("../push-counter.js");
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

// depth profile: list of segments [durationMs, fromFrac, toFrac], frac 0=top 1=bottom
function full(ms) { return [[ms * 0.45, 0, 1], [ms * 0.1, 1, 1], [ms * 0.45, 1, 0]]; }
function half(ms, f) { return [[ms * 0.45, 0, f], [ms * 0.1, f, f], [ms * 0.45, f, 0]]; }
function hold(ms) { return [[ms, 0, 0]]; }

function run(name, segs, expected, cfg = {}) {
  const c = Object.assign({ W: 640, H: 480, f: 0.5, Dtop: 0.6, Dbot: 0.3, cx: 0, cy: 0, fps: 30, noise: 0,
    drop: 0, elbowTop: 165, elbowBot: 85, arms: 2, nose: true, glitchAt: null, gone: null, drift: 0 }, cfg);
  const ctr = createCounter(); const dt = 1000 / c.fps; let t = 0, statuses = new Set(), total = 0;
  for (const [dur, a, b] of segs) total += dur;
  let segIdx = 0, segT = 0;
  for (t = 0; t <= total; t += dt) {
    // locate depth fraction
    let acc = 0, frac = 0;
    for (const [dur, a, b] of segs) { if (t <= acc + dur) { frac = a + (b - a) * ((t - acc) / dur); break; } acc += dur; }
    const drift = 1 + c.drift * (t / total);
    const D = (c.Dtop + (c.Dbot - c.Dtop) * frac) * drift;
    const fpx = c.f * c.W;
    const proj = (X, Y) => ({ x: c.W / 2 + fpx * (X + c.cx) / D, y: c.H / 2 + fpx * (Y + c.cy) / D });
    const jit = (p) => ({ x: p.x + gauss() * c.noise * c.W, y: p.y + gauss() * c.noise * c.W });
    const sc = () => (rnd() < c.drop ? 0.15 : 0.6 + 0.3 * rnd());
    const ls = jit(proj(-0.2, 0)), rs = jit(proj(0.2, 0));
    const kps = [{ name: "left_shoulder", ...ls, score: sc() }, { name: "right_shoulder", ...rs, score: sc() }];
    if (c.nose) kps.push({ name: "nose", ...jit(proj(0, -0.22)), score: sc() });
    const eb = c.elbowBotAfter != null && t > c.elbowBotAfter ? c.elbowTop - 10 : c.elbowBot;
    const ang = (c.elbowTop + (eb - c.elbowTop) * frac) * Math.PI / 180;
    ["left", "right"].slice(0, c.arms).forEach((side, i) => {
      const sh = i === 0 ? ls : rs, sgn = i === 0 ? -1 : 1, L = 60 * 0.6 / D;
      const e = { x: sh.x + sgn * L, y: sh.y + L * 0.3 };
      const dir = Math.atan2(sh.y - e.y, sh.x - e.x) + sgn * ang; // rotate from upper arm
      const w = { x: e.x + L * Math.cos(dir), y: e.y + L * Math.sin(dir) };
      kps.push({ name: side + "_elbow", ...e, score: sc() }, { name: side + "_wrist", ...w, score: sc() });
    });
    let frame = kps;
    if (c.glitchAt != null && Math.abs(t - c.glitchAt) < dt / 2) frame = kps.map((k) => k.name === "right_shoulder" ? { ...k, x: k.x + 0.9 * c.W } : k);
    if (c.gone && t >= c.gone[0] && t < c.gone[1]) frame = [];
    const r = ctr.update(frame, t, c.W);
    statuses.add(r.status.replace(/\d+/g, "N"));
  }
  const got = ctr.state().reps, pass = got === expected;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(48)} expected ${String(expected).padStart(2)}  got ${String(got).padStart(2)}`);
  return { pass, statuses };
}
const reps = (n, ms) => Array.from({ length: n }, () => full(ms)).flat();
const cal = hold(1600);
const R = [];
R.push(run("baseline: 10 reps @1.5s", [...cal, ...reps(10, 1500), ...hold(500)], 10));
R.push(run("far phone, 480px frame, offset placement", [...cal, ...reps(10, 1500), ...hold(500)], 10, { W: 480, H: 640, Dtop: 0.8, Dbot: 0.45, cx: 0.12, cy: 0.1 }));
R.push(run("close phone, shallow-ish ROM (0.45->0.32m)", [...cal, ...reps(10, 1500), ...hold(500)], 10, { Dtop: 0.45, Dbot: 0.32 }));
R.push(run("keypoint noise 0.4% + 10% low-score frames", [...cal, ...reps(10, 1500), ...hold(500)], 10, { noise: 0.004, drop: 0.1 }));
R.push(run("single glitch frame at the top", [...cal, ...reps(4, 1500), ...hold(800), ...reps(6, 1500), ...hold(500)], 10, { glitchAt: 1600 + 6000 + 400 }));
R.push(run("fast reps 0.6s", [...cal, ...reps(10, 600), ...hold(500)], 10));
R.push(run("half reps (40% depth) ignored", [...cal, ...reps(3, 1500), ...Array.from({ length: 5 }, () => half(1500, 0.4)).flat(), ...reps(2, 1500), ...hold(500)], 5));
R.push(run("near-miss half reps (60% depth) ignored", [...cal, ...reps(3, 1500), ...Array.from({ length: 4 }, () => half(1200, 0.6)).flat(), ...hold(500)], 3));
R.push(run("no elbows visible (size only)", [...cal, ...reps(10, 1500), ...hold(500)], 10, { arms: 0 }));
R.push(run("one arm visible", [...cal, ...reps(10, 1500), ...hold(500)], 10, { arms: 1 }));
R.push(run("no nose (shoulders only)", [...cal, ...reps(10, 1500), ...hold(500)], 10, { nose: false }));
R.push(run("low frame rate 12 fps", [...cal, ...reps(10, 1500), ...hold(500)], 10, { fps: 12 }));
R.push(run("too-slow rep (10s) not counted", [...cal, ...reps(2, 1500), ...full(10000), ...reps(1, 1500), ...hold(500)], 3));
R.push(run("small bounces at top (15% depth) = 0 after calib", [...cal, ...reps(1, 1500), ...Array.from({ length: 8 }, () => half(700, 0.15)).flat(), ...hold(500)], 1));
R.push(run("slow drift of phone/body 15% over set", [...cal, ...reps(10, 1500), ...hold(500)], 10, { drift: 0.15 }));
const gone = run("shoulders out of view 1.5s mid-set", [...cal, ...reps(5, 1500), ...hold(2500), ...reps(5, 1500), ...hold(500)], 10, { gone: [1600 + 7500 + 300, 1600 + 7500 + 1800] });
R.push(gone);
console.log("  status shown when out of view:", gone.statuses.has("Move so shoulders are in view") ? "yes" : "NO");
R.push(run("never steady (no calibration) = 0", Array.from({ length: 10 }, () => half(900, 0.5)).flat(), 0));
R.push(run("heavier noise 1% + 20% low-score frames", [...cal, ...reps(10, 1500), ...hold(500)], 10, { noise: 0.01, drop: 0.2 }));
// head/chest dip with straight arms: first rep normal, then elbows stay straight
{ const segs = [...cal, ...reps(1, 1500), ...reps(5, 1500), ...hold(500)];
  R.push(run("dips with straight arms after calib rep: elbow check", segs, 1, { elbowBotAfter: 1600 + 1500 })); }
const fails = R.filter((r) => !r.pass).length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
