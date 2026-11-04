// Shoulders-only fallback (hats, hoods, face down) in push-counter.js measure().
// (1) face visible: identical outputs to origin/main's counter; (2) occlusion still counts full reps, rejects shallow;
// (3) face returns mid-set. Run: node test/push-hat-fallback.test.js
const fs = require("fs"), path = require("path"), cp = require("child_process");
const NEW = require("../push-counter.js"), S = require("./lib/push-synth.js");
const oldSrc = path.join(require("os").tmpdir(), "push-counter-origin-main.js");
let OLD = null;
try { fs.writeFileSync(oldSrc, cp.execSync("git show origin/main:push-counter.js", { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "ignore"] })); OLD = require(oldSrc); } catch (e) {}
const R = []; function check(name, ok, extra) { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); R.push(!!ok); }
const { full, half, hold, reps } = S, cal = hold(1200), end = hold(500);
// Drive a counter frame by frame; mod(kps, t, frac) may alter keypoints.
function drive(create, segs, cfg, mod) {
  S.reseed(7); const c = Object.assign({}, S.BASE, cfg || {}), ctr = create(), out = [];
  for (let t = 0; t <= S.total(segs); t += 1000 / c.fps) { const f = S.fracAt(segs, t); let k = S.frameFor(f, c, t); if (mod) k = mod(k, t, f); out.push(JSON.stringify(ctr.update(k, t, c.W))); }
  return { reps: ctr.state().reps, out };
}
// (1) equivalence, face visible (nose score >= 0.5 every frame; synth scores are 0.6-0.9 when drop = 0)
if (!OLD) check("equivalence: origin/main push-counter.js available", false);
else {
  const cases = [["10 reps", [...cal, ...reps(10, 1500), ...end], {}], ["noise 0.3%", [...cal, ...reps(10, 1500), ...end], { noise: 0.003 }],
    ["noise 0.6%", [...cal, ...reps(8, 1200), ...end], { noise: 0.006 }], ["fast 0.6s", [...cal, ...reps(10, 600), ...end], {}],
    ["half reps mixed", [...cal, ...reps(3, 1500), ...half(1500, 0.4), ...half(1200, 0.6), ...reps(2, 1500), ...end], {}],
    ["drift", [...cal, ...reps(10, 1500), ...end], { driftY: 38 }], ["12 fps", [...cal, ...reps(6, 1500), ...end], { fps: 12 }],
    ["no wrists", [...cal, ...reps(6, 1500), ...end], { wrists: 0 }], ["far phone", [...cal, ...reps(6, 1500), ...end], { sw: 0.12, topY: 200 }]];
  for (const [n, segs, cfg] of cases) { const a = drive(OLD.createCounter, segs, cfg), b = drive(NEW.createCounter, segs, cfg);
    const same = a.out.length === b.out.length && a.out.every((x, i) => x === b.out[i]);
    check(`equivalence (face visible): ${n}`, same && a.reps === b.reps, `reps ${a.reps}/${b.reps}`); }
}
// (2) occlusion
const noNose = (k) => k.filter((p) => p.name !== "nose");
const lowNose = (k) => k.map((p) => (p.name === "nose" ? { ...p, score: 0.35 } : p)); // the old 0.3 bar would have used it
const set = [...cal, ...reps(10, 1500), ...end];
check("hat: nose gone from rep 4 on", drive(NEW.createCounter, set, {}, (k, t) => (t > 1200 + 4500 ? noNose(k) : k)).reps === 10);
check("hat: nose gone only near the bottom (frac > 0.6)", drive(NEW.createCounter, set, {}, (k, t, f) => (f > 0.6 ? noNose(k) : k)).reps === 10);
check("hat: nose flickers every other frame", drive(NEW.createCounter, set, {}, (k, t) => (Math.floor(t / 33) % 2 ? noNose(k) : k)).reps === 10);
check("hat: nose flickers in 200 ms bursts", drive(NEW.createCounter, set, {}, (k, t) => (Math.floor(t / 200) % 2 ? noNose(k) : k)).reps === 10);
check("hat: low-confidence nose (0.35) all set", drive(NEW.createCounter, set, {}, lowNose).reps === 10);
const brim = (k, t, f) => (f > 0.5 ? k.map((p) => (p.name === "nose" ? { ...p, y: p.y - 0.9 * 128, score: 0.8 } : p)) : k);
check("brim misread as the nose (jumps up near the bottom)", drive(NEW.createCounter, set, {}, brim).reps === 10);
check("hood / face down: no nose the whole set", drive(NEW.createCounter, set, { nose: false }).reps === 10);
check("hood + noise 0.3% + 10% low-score frames", drive(NEW.createCounter, set, { noise: 0.003, drop: 0.1 }, (k, t) => (t > 3000 ? noNose(k) : k)).reps === 10);
const shallow = [...cal, ...reps(3, 1500), ...Array.from({ length: 5 }, () => half(1500, 0.4)).flat(), ...reps(2, 1500), ...end];
check("hat: shallow 40% reps still rejected (nose gone after rep 2)", drive(NEW.createCounter, shallow, {}, (k, t) => (t > 1200 + 3000 ? noNose(k) : k)).reps === 5);
check("hood: shallow 40% reps rejected (no nose at all)", drive(NEW.createCounter, shallow, { nose: false }).reps === 5);
const near = [...cal, ...reps(3, 1500), ...Array.from({ length: 4 }, () => half(1200, 0.6)).flat(), ...end];
check("hat: near-miss 60% reps rejected (nose gone after rep 2)", drive(NEW.createCounter, near, {}, (k, t) => (t > 1200 + 3000 ? noNose(k) : k)).reps === 3);
// (3) face returns mid-set
check("hood off mid-set (no nose for reps 1-5, then face)", drive(NEW.createCounter, set, {}, (k, t) => (t < 1200 + 7500 ? noNose(k) : k)).reps === 10);
check("hat on then off then on (3 s stretches)", drive(NEW.createCounter, set, {}, (k, t) => (Math.floor(t / 3000) % 2 ? noNose(k) : k)).reps === 10);
const fails = R.filter((x) => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);
