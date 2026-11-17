// PFP smoothness (Nov 17): small keypoint noise must not twitch the cover; a fast head move must stay under the logo
// every frame. Run: node test/pfp-smooth.test.js
const PF = require("../pfp.js");
const R = []; const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
const F = (x, y, n = () => 0) => K({
  nose: [x + n(), y + 10 + n()], left_eye: [x - 20 + n(), y + n()], right_eye: [x + 20 + n(), y + n()],
  left_ear: [x - 40 + n(), y + 8 + n()], right_ear: [x + 40 + n(), y + 8 + n()],
  left_shoulder: [x - 80 + n(), y + 110 + n()], right_shoulder: [x + 80 + n(), y + 110 + n()]
});
let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

check("params: dead-zone, lost-frame hysteresis, size rate limits; locked / opening sizes unchanged",
  PF.P.deadPos >= 0.02 && PF.P.deadPos <= 0.08 && PF.P.deadR >= 0.05 && PF.P.deadR <= 0.08 &&
  PF.P.lostFrames >= 3 && PF.P.lockFrames >= 2 && PF.P.rMaxShrink > 0 && PF.P.rMaxGrow > 0 &&
  PF.P.coverPad === 0.25 && PF.P.headRW === 0.5 && PF.P.shR === 0.25 && PF.P.blankR === 0.16 && PF.P.blankY === 0.3);

// Jitter: still subject, ±2.5 px keypoint noise at 15 fps, 60 Hz redraw. Mean frame-to-frame logo centre move is small.
{
  sd = 11;
  const tr = PF.createTracker();
  const noise = () => gauss() * 2.5;
  const jumps = [], rs = [];
  let prev = null, t = 0;
  for (; t < 4000; t += 66.7) {
    tr.step(F(320, 200, noise), t, 640, 480, t);
    for (let now = t; now < t + 66.7; now += 1000 / 60) {
      const c = tr.at(now); if (!c) continue;
      if (t > 800 && prev) jumps.push(Math.hypot(c.x - prev.x, c.y - prev.y));
      if (t > 800) rs.push(c.r);
      prev = { x: c.x, y: c.y };
    }
  }
  const mean = jumps.reduce((a, b) => a + b, 0) / jumps.length;
  const max = Math.max(...jumps);
  check(`jitter: mean frame-to-frame logo centre ${mean.toFixed(3)} px (< 0.45), max ${max.toFixed(3)} px (< 2.5)`, mean < 0.45 && max < 2.5, { mean, max, n: jumps.length });
}

// Fast move: head travels 400 px/s sideways; every 60 Hz sample, the drawn circle contains the raw head circle.
{
  const tr = PF.createTracker();
  let uncovered = 0, frames = 0, t = 0;
  // settle
  for (; t < 500; t += 33) tr.step(F(200, 200), t, 640, 480, t);
  for (; t <= 2000; t += 33) {
    const x = 200 + (t - 500) * 0.4; // 400 px/s
    const kps = F(x, 200);
    tr.step(kps, t, 640, 480, t);
    const raw = PF.headCircle(kps, 640, 480);
    for (let now = t; now < t + 33; now += 1000 / 60) {
      const c = tr.at(now); if (!c || !raw) continue;
      frames++;
      const slack = c.r - (Math.hypot(raw.x - c.x, raw.y - c.y) + raw.r);
      if (slack < -1e-6) uncovered++;
    }
  }
  check(`fast-move: cover contains the raw head on every screen refresh (${uncovered}/${frames} uncovered)`, uncovered === 0 && frames > 50, { uncovered, frames });
}

// One-frame confidence dip must not drop the tracker lock (hysteresis lives on the shield; tracker holds).
{
  const tr = PF.createTracker();
  tr.step(F(320, 200), 0, 640, 480, 0);
  tr.step(F(320, 200), 66, 640, 480, 66);
  const h = tr.step([], 132, 640, 480, 132);
  check("tracker: a single missed pose holds the last spot (no jump, no clear)", h && h.held && Math.abs(h.x - tr.at(66).x) < 3);
}

const ok = R.filter(Boolean).length;
console.log(`\n${ok}/${R.length} passed`);
if (ok !== R.length) process.exit(1);
