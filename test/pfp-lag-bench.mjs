// Benchmark PFP tracker lag: b5614b0 (before) vs this tree (after).
// Motion: normal (~180 px/s side-to-side) and fast push-up bob (~420 px/s vertical) at 10/15/30 fps.
// Reports mean |drawn - true| lag in px, rest jitter, stop overshoot, and mean pose-to-draw lead compensation.
import { createRequire } from "module";
import { pathToFileURL } from "url";
import vm from "vm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
function load(file) {
  const src = fs.readFileSync(file, "utf8");
  const ctx = { module: { exports: {} }, exports: {}, require: createRequire(path.join(ROOT, "pfp.js")), console, Math, Date, isFinite };
  ctx.module.exports = ctx.exports;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.module.exports;
}
const after = load(path.join(ROOT, "pfp.js"));
const before = load("/tmp/fire1030/pfp.js");
const K = (o) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: 0.9 }));
const F = (x, y = 200) => K({ nose: [x, y + 10], left_eye: [x - 20, y], right_eye: [x + 20, y], left_ear: [x - 40, y + 8], right_ear: [x + 40, y + 8], left_shoulder: [x - 80, y + 110], right_shoulder: [x + 80, y + 110] });
const trueHead = (lib, x, y) => lib.headCircle(F(x, y), 640, 480);

function run(lib, { fps, kind, inferMs = 55 }) {
  const dt = 1000 / fps, tr = lib.createTracker();
  const rows = [];
  // 1s settle still, 2s motion, 0.4s hard stop, 1s still
  const T0 = 0, T1 = 1000, T2 = 3000, T3 = 3400, T4 = 4400;
  const amp = kind === "fast" ? 70 : 40;
  const period = kind === "fast" ? 333 : 1400; // fast ~ 3 Hz bob, normal slower sway
  function pos(t) {
    if (t < T1) return { x: 320, y: 200 };
    if (t < T2) {
      const u = t - T1, w = 2 * Math.PI / period;
      return kind === "fast" ? { x: 320, y: 200 + amp * Math.sin(w * u) } : { x: 320 + amp * Math.sin(w * u), y: 200 };
    }
    return kind === "fast" ? { x: 320, y: 200 + amp * Math.sin(2 * Math.PI / period * (T2 - T1)) } : { x: 320 + amp * Math.sin(2 * Math.PI / period * (T2 - T1)), y: 200 };
  }
  let overshoot = 0, rest = [], move = [];
  const stopPos = pos(T2);
  for (let t = T0; t <= T4; t += dt) {
    const p = pos(t), pNow = pos(t + inferMs), truth = trueHead(lib, pNow.x, pNow.y);
    const c = tr.step(F(p.x, p.y), t, 640, 480, t + inferMs);
    if (!c || !truth) continue;
    const err = Math.hypot(c.x - truth.x, c.y - truth.y);
    if (t >= T1 && t < T2) move.push(err);
    if (t >= T3) rest.push(err);
    if (t >= T2 && t < T3) overshoot = Math.max(overshoot, Math.hypot(c.x - (trueHead(lib, stopPos.x, stopPos.y).x), c.y - (trueHead(lib, stopPos.x, stopPos.y).y)));
    rows.push({ t, err });
  }
  const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  return { fps, kind, inferMs, move: mean(move), rest: mean(rest), overshoot, n: rows.length };
}

const out = { before: [], after: [] };
for (const lib of ["before", "after"]) {
  const P = lib === "before" ? before : after;
  for (const fps of [10, 15, 30]) {
    for (const kind of ["normal", "fast"]) out[lib].push(run(P, { fps, kind, inferMs: 55 }));
  }
}
function row(r) { return `${r.kind}@${r.fps}fps  lag ${r.move.toFixed(1)}px  rest ${r.rest.toFixed(2)}px  overshoot ${r.overshoot.toFixed(1)}px  pose-to-draw ${r.inferMs}ms`; }
console.log("BEFORE (b5614b0)");
out.before.forEach((r) => console.log("  " + row(r)));
console.log("AFTER");
out.after.forEach((r) => console.log("  " + row(r)));
console.log("DELTA (after - before, negative = tighter follow)");
out.before.forEach((b, i) => {
  const a = out.after[i];
  const pct = b.move ? (100 * (a.move - b.move) / b.move) : 0;
  console.log(`  ${a.kind}@${a.fps}fps  lag ${ (a.move - b.move).toFixed(1)}px (${pct.toFixed(0)}%)  rest ${ (a.rest - b.rest).toFixed(2)}  overshoot ${ (a.overshoot - b.overshoot).toFixed(1)}`);
});
fs.writeFileSync("/tmp/pfp-lag-bench.json", JSON.stringify(out, null, 2));
