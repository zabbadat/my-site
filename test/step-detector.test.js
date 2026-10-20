// Synthetic tests for step-detector.js. Run: node test/step-detector.test.js
const { createStepDetector, createVerifier } = require("../step-detector.js");
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

// Build a timeline of segments; each returns per-sample vertical accel + rotation.
// walk(n, hz, amp): n steps at hz steps/s with peak amplitude amp (m/s^2), slight per-step jitter
function sim(segs, { fps = 60, noise = 0.15, gravity = true, tilt = [0.2, 0.6, 0.77] } = {}) {
  const d = createStepDetector(); const dt = 1000 / fps; let t = 0, truth = 0;
  const g = 9.81, n = Math.hypot(...tilt), dir = tilt.map((x) => x / n);
  for (const seg of segs) {
    if (seg.type === "walk") {
      truth += seg.n;
      for (let i = 0; i < seg.n; i++) {
        const per = (1000 / seg.hz) * (1 + 0.08 * gauss());
        for (let u = 0; u < per; u += dt) {
          const ph = u / per, a = seg.amp * (Math.sin(2 * Math.PI * ph) + 0.25 * Math.sin(4 * Math.PI * ph));
          push(a, seg.rot ? 40 * Math.sin(2 * Math.PI * ph) : 10);
        }
      }
    } else if (seg.type === "still") {
      for (let u = 0; u < seg.ms; u += dt) push(0, 2);
    } else if (seg.type === "throw") { // wind-up + release: big accel spike with fast rotation
      for (let u = 0; u < 900; u += dt) {
        const k = u / 900, spike = Math.exp(-((k - 0.55) ** 2) / 0.004);
        push(seg.acc * spike - 2 * Math.exp(-((k - 0.35) ** 2) / 0.01), seg.rotDps * Math.exp(-((k - 0.5) ** 2) / 0.01));
      }
    } else if (seg.type === "bump") { // single knock, no rotation
      for (let u = 0; u < 200; u += dt) push(u < 40 ? 8 : 0, 5);
    }
  }
  function push(aVert, rotDps) {
    const a = aVert + noise * gauss();
    const base = gravity ? g : 0;
    const v = dir.map((c) => c * (base + a) + 0.05 * noise * gauss());
    d.update({ t, x: v[0], y: v[1], z: v[2], gravity, rot: { alpha: rotDps, beta: rotDps * 0.3, gamma: 0 } });
    t += dt;
  }
  for (let u = 0; u < 700; u += dt) push(0, 1); // flush pending
  return { got: d.state().steps, truth };
}
const R = [];
function check(name, segs, opts, tol, expectExact) {
  const { got, truth } = sim(segs, opts || {});
  const exp = expectExact != null ? expectExact : truth;
  const err = exp === 0 ? got : Math.abs(got - exp) / exp;
  const pass = exp === 0 ? got === 0 : err <= tol;
  R.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(52)} expected ${String(exp).padStart(3)}  got ${String(got).padStart(3)}`);
}
const walk = (n, hz, amp, rot) => ({ type: "walk", n, hz, amp, rot });
const still = (ms) => ({ type: "still", ms });
const thr = (acc = 14, rotDps = 450) => ({ type: "throw", acc, rotDps });
const court = (amp, hz, extra = []) => { const s = []; for (let p = 0; p < 6; p++) { s.push(still(4000), thr(), thr(), thr(), still(1500), walk(8, hz, amp), still(2000), ...extra, walk(8, hz, amp)); } return s; };

check("hand: 100 steps @1.8 Hz, amp 1.2", [still(1000), walk(100, 1.8, 1.2)], {}, 0.05);
check("pocket: 100 steps @1.9 Hz, amp 4", [still(1000), walk(100, 1.9, 4, true)], {}, 0.05);
check("slow shuffle: 40 steps @1.1 Hz, amp 0.7", [still(1000), walk(40, 1.1, 0.7)], {}, 0.1);
check("brisk: 60 steps @2.6 Hz, amp 2.5", [still(1000), walk(60, 2.6, 2.5)], {}, 0.05);
check("short 20ft walks: 10 x 8 steps w/ pauses", Array.from({ length: 10 }, () => [still(3000), walk(8, 1.7, 1.5)]).flat(), {}, 0.1);
check("court game: throws + 2 walks per pack (hand)", court(1.3, 1.7), {}, 0.1);
check("court game: throws + walks (pocket)", court(3.5, 1.8), {}, 0.1);
check("throws only (no walking) = 0", [still(2000), ...Array.from({ length: 12 }, () => [thr(), still(2500)]).flat()], {}, 0, 0);
check("phone still 60 s = 0", [still(60000)], {}, 0, 0);
check("phone still, high noise 0.3 = 0", [still(60000)], { noise: 0.3 }, 0, 0);
check("isolated bumps/knocks = 0", Array.from({ length: 15 }, () => [still(2000), { type: "bump" }]).flat(), {}, 0, 0);
check("accel-only device (no gravity): 100 steps", [still(1000), walk(100, 1.8, 1.5)], { gravity: false }, 0.05);
check("noisy hand walk (noise 0.35)", [still(1000), walk(100, 1.8, 1.4)], { noise: 0.35 }, 0.1);
check("30 fps sensor", [still(1000), walk(100, 1.8, 1.4)], { fps: 30 }, 0.05);
check("phone flat (gravity on z)", [still(1000), walk(80, 1.8, 1.4)], { tilt: [0, 0, 1] }, 0.05);

// verifier
const V = (fn) => { const v = createVerifier(); fn(v); return v; };
function vcheck(name, v, steps, ms, expectOk) {
  const r = v.result(steps, ms); const pass = r.verified === expectOk; R.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  verify: ${name.padEnd(44)} ${r.verified ? "verified" : "unverified: " + r.reasons.join("; ")}`);
}
const feed = (v, t0, t1, every = 16) => { for (let t = t0; t < t1; t += every) { v.sample(t); if (t % 500 < every) v.tick(t); } };
vcheck("honest 4-min game, 6 packs, 96 steps", V((v) => { v.resume(0); feed(v, 5, 240000); for (let p = 0; p < 6; p++) { v.scoreTap(p * 40000); v.scoreTap(p * 40000 + 3000); } }), 96, 240000, true);
vcheck("honest game with pause in the middle", V((v) => { v.resume(0); feed(v, 5, 60000); v.pause(60000); v.resume(200000); feed(v, 200005, 300000); v.scoreTap(1000); v.scoreTap(70000 + 200000); }), 40, 160000, true);
vcheck("phone locked 10 s mid-game", V((v) => { v.resume(0); feed(v, 5, 60000); feed(v, 70000, 180000); v.scoreTap(1000); }), 50, 180000, false);
vcheck("page hidden", V((v) => { v.resume(0); feed(v, 5, 180000); v.hidden(); }), 50, 180000, false);
vcheck("permission denied", V((v) => { v.resume(0); v.denied(); }), 0, 180000, false);
vcheck("laptop: no samples ever", V((v) => { v.resume(0); for (let t = 0; t < 180000; t += 500) v.tick(t); }), 0, 180000, false);
vcheck("phone left on table: 3 steps, 6 packs", V((v) => { v.resume(0); feed(v, 5, 240000); for (let p = 0; p < 6; p++) v.scoreTap(p * 40000); }), 3, 240000, false);
vcheck("too short (45 s)", V((v) => { v.resume(0); feed(v, 5, 45000); v.scoreTap(1000); }), 30, 45000, false);
const fails = R.filter((x) => !x).length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
