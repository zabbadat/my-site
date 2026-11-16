// PFP smoothness + first-lock bench (Nov 16): live 70786fd pfp.js (BEFORE, /tmp/fire1150) vs this tree (AFTER).
// Simulates a phone: pose results at 12 / 15 / 30 fps arriving ~60 ms after the frame, the logo redrawn every 60 Hz screen
// refresh from tracker.at(now) (exactly what pfp.js refreshLoop does), keypoint noise, ear visibility flicker (changes the
// face circle formula), 4% single-frame dropouts and one 500 ms face loss (reacquire).
// Metrics: rest jitter (px RMS of the drawn centre, and of the radius), lag under motion (mean px from the true head NOW),
// max screen-refresh-to-refresh jump (px, rest+motion, excluding the reacquire), reacquire jump, centring offset at rest,
// first lock (pose frames / ms from the first face frame to a drawn logo).
// Run: node test/pfp-smooth-bench.mjs [beforePath]
import { createRequire } from "module"; import vm from "vm"; import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function load(file) { const ctx = { module: { exports: {} }, require: createRequire(path.join(ROOT, "pfp.js")), console, Math, Date, isFinite }; ctx.exports = ctx.module.exports; vm.createContext(ctx); vm.runInContext(fs.readFileSync(file, "utf8"), ctx); return ctx.module.exports; }
const AFTER = load(path.join(ROOT, "pfp.js")), BEFORE = load(process.argv[2] || "/tmp/fire1150/pfp.js");
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const K = (o, noise, earsOn) => Object.entries(o).map(([name, [x, y]]) => ({ name, x: x + gauss() * noise, y: y + gauss() * noise, score: /ear/.test(name) && !earsOn ? 0.1 : 0.9 }));
const F = (x, y) => ({ nose: [x, y + 10], left_eye: [x - 20, y], right_eye: [x + 20, y], left_ear: [x - 40, y + 8], right_ear: [x + 40, y + 8], left_shoulder: [x - 80, y + 110], right_shoulder: [x + 80, y + 110] });
function pos(t, kind) { // 0-1.5 s still, 1.5-4.5 s motion, 4.5-6 s still, 6-6.5 s face lost, 6.5-8 s still
  const u = Math.max(0, Math.min(t, 4500) - 1500); // continuous: still at the start / end of the motion
  return kind === "bob" ? { x: 320, y: 200 + 60 * Math.sin(2 * Math.PI * u / 700) } : { x: 320 + 50 * Math.sin(2 * Math.PI * u / 1400), y: 200 };
}
function run(lib, fps, kind) {
  seed = 11 + fps; const tr = lib.createTracker(lib === AFTER && process.env.OPTS ? JSON.parse(process.env.OPTS) : undefined), dtP = 1000 / fps, inf = 60, T = 8000;
  const truth = (t) => { const p = pos(t, kind); return lib.headCircle(K(F(p.x, p.y), 0, true), 640, 480); };
  // pose frames: stamped at tf, result lands at tf + inf
  const arrivals = []; for (let tf = 300; tf < T; tf += dtP) arrivals.push(tf);
  let prevS = null, ai = 0, drawn = null, prev = null, firstFace = null, firstLock = null, firstLockFrames = null, nFrames = 0;
  const rest = [], restR = [], move = [], jumps = [], reacq = [], shim = [];
  for (let now = 0; now <= T; now += 1000 / 60) {
    while (ai < arrivals.length && arrivals[ai] + inf <= now) {
      const tf = arrivals[ai++], lost = tf >= 6000 && tf < 6500, drop = rnd() < 0.04, p = pos(tf, kind);
      const kps = lost || drop ? [] : K(F(p.x, p.y), 2.5, rnd() < (process.env.EARP ? Number(process.env.EARP) : 0.85));
      if (kps.length && firstFace == null) { firstFace = tf + inf; nFrames = 0; }
      if (firstFace != null && firstLock == null) nFrames++;
      const c = tr.step(kps, tf, 640, 480, tf + inf);
      if (c && firstLock == null) { firstLock = tf + inf; firstLockFrames = nFrames - 1; }
      if (c) drawn = c;
    }
    const a = tr.at(now); // refreshLoop: redraw at the predicted spot every screen refresh
    if (a && (!drawn || Math.hypot(a.x - drawn.x, a.y - drawn.y) >= 0.25 || Math.abs(a.r - drawn.r) >= 0.25)) drawn = a;
    if (!drawn) continue;
    const tc = truth(now), e = Math.hypot(drawn.x - tc.x, drawn.y - tc.y);
    if (prev) { const j = Math.hypot(drawn.x - prev.x, drawn.y - prev.y); if (now >= 6500 && now < 6900) reacq.push(j); else if (now > 500) { jumps.push(j); if (process.env.DBG && j > 15) console.log(kind, fps, Math.round(now), j.toFixed(1)); } }
    prev = { x: drawn.x, y: drawn.y };
    if ((now >= 800 && now < 1500) || (now >= 5000 && now < 6000) || now >= 7200) { if (prevS) shim.push(Math.hypot(drawn.x - prevS.x, drawn.y - prevS.y)); rest.push({ x: drawn.x - tc.x, y: drawn.y - tc.y }); restR.push(drawn.r - tc.r); }
    prevS = { x: drawn.x, y: drawn.y };
    if (now >= 1800 && now < 4500) move.push(e);
  }
  const mx = rest.reduce((s, v) => s + v.x, 0) / rest.length, my = rest.reduce((s, v) => s + v.y, 0) / rest.length;
  const rms = Math.sqrt(rest.reduce((s, v) => s + (v.x - mx) ** 2 + (v.y - my) ** 2, 0) / rest.length);
  const rmr = restR.reduce((s, v) => s + v, 0) / restR.length, rmsR = Math.sqrt(restR.reduce((s, v) => s + (v - rmr) ** 2, 0) / restR.length);
  return { fps, kind, shimmer: Math.sqrt(shim.reduce((s, v) => s + v * v, 0) / shim.length) * 60, jitter: rms, rJitter: rmsR, lag: move.reduce((s, v) => s + v, 0) / move.length, maxJump: Math.max(...jumps), reacqJump: Math.max(0, ...reacq), centre: Math.hypot(mx, my), firstLockFrames, firstLockMs: firstLock - firstFace };
}
const rows = [];
for (const fps of [12, 15, 30]) for (const kind of ["sway", "bob"]) rows.push({ b: run(BEFORE, fps, kind), a: run(AFTER, fps, kind) });
const f = (v) => v.toFixed(2).padStart(6);
console.log("case        | rest shimmer px/s RMS | rest jitter px RMS | radius jitter | lag px (motion) | max jump/refresh | reacquire jump | centre offset | first lock");
for (const { b, a } of rows) console.log(`${(a.kind + "@" + a.fps).padEnd(11)} | ${f(b.shimmer)} -> ${f(a.shimmer)}      | ${f(b.jitter)} -> ${f(a.jitter)}   | ${f(b.rJitter)} -> ${f(a.rJitter)} | ${f(b.lag)} -> ${f(a.lag)} | ${f(b.maxJump)} -> ${f(a.maxJump)}  | ${f(b.reacqJump)} -> ${f(a.reacqJump)} | ${f(b.centre)} -> ${f(a.centre)} | ${b.firstLockFrames}f/${b.firstLockMs}ms -> ${a.firstLockFrames}f/${a.firstLockMs}ms`);
const avg = (k, w) => rows.reduce((s, r) => s + r[w][k], 0) / rows.length;
console.log(`MEAN        | ${f(avg("shimmer", "b"))} -> ${f(avg("shimmer", "a"))}      | ${f(avg("jitter", "b"))} -> ${f(avg("jitter", "a"))}   | ${f(avg("rJitter", "b"))} -> ${f(avg("rJitter", "a"))} | ${f(avg("lag", "b"))} -> ${f(avg("lag", "a"))} | ${f(avg("maxJump", "b"))} -> ${f(avg("maxJump", "a"))}  | ${f(avg("reacqJump", "b"))} -> ${f(avg("reacqJump", "a"))} | ${f(avg("centre", "b"))} -> ${f(avg("centre", "a"))} |`);
fs.writeFileSync("/tmp/pfp-smooth-bench.json", JSON.stringify(rows, null, 1));
