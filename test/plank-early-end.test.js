// Plank early end (owner Nov 17): a hold must last the full intended duration — until a real form break,
// leaving the frame for 1 s, or End set / Stop. There is no time cap (60 s is the 1 ZAB payout mark only).
// A still live plank (integer / Vision-like keypoints, sub-pixel-still, occasional 1 px flicker, hooded
// head, side-view noise, brief occlusion) must not end at the ~8 s liveness window as frozen/repeat.
// Real breaks (knees down, collapse, stand up, sag, pike, left_frame) still end the set.
// Run: node test/plank-early-end.test.js
const P = require("../plank-session.js");
const G = require("../get-set.js");
const SY = require("./lib/break-synth.js");
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const seq = (from, to, f, dt = 33) => { const a = []; for (let t = from; t < to; t += dt) a.push([t, f(t)]); return a; };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const pose = (j = 0, hipDy = 0) => K({
  left_shoulder: [100 + j, 300], left_elbow: [105, 360], left_wrist: [110, 400],
  left_hip: [300 - j, 310 + hipDy], left_knee: [400, 315 + hipDy / 2], left_ankle: [500 + j, 320]
});
const sag = pose(0, 60), pike = pose(0, -70);
const knees = K({ left_shoulder: [100, 300], left_hip: [300, 310], left_knee: [330, 400], left_ankle: [450, 400] });
const stand = K({ left_shoulder: [300, 50], left_hip: [300, 250], left_knee: [302, 350], left_ankle: [304, 450] });
const jitter = (t) => pose(Math.sin(t / 37) * 1.5 + Math.cos(t / 91));
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

function run(frames, opts, dims) {
  const h = P.createPlankHold(opts || {});
  let r, ended = null, firstHold = null;
  for (const [t, k] of frames) {
    r = h.update(k, t, dims || { w: 640, h: 480 });
    if (r.phase === "holding" && firstHold == null) firstHold = t;
    if (r.ended && !ended) ended = { t, ms: r.ms, reason: r.reason, frame: r.frame };
  }
  return { h, r, ended, firstHold };
}

// ---- intended duration: no cap; 60 s is pay-only
check("no 60 s / fixed-time end in the hold or plankTick; 60 s only speaks the once-per-set ZAB line",
  !/PLANK_SET_MS|Minute set done/.test(html)
  && !/r\.ms\s*>=\s*\d+[^\n;]*(plankEnded|\.end\(|\.stop\()/.test(html.slice(html.indexOf("async function plankTick"), html.indexOf("function newPlankHold")))
  && /!plankSaved && r\.ms >= 60000 && currentUser\) speakPlankZabOnce\(\)/.test(html)
  && P.PLANK.liveWindowMs === 8000);
check("get-set: plank time voice has no end cap (marks past 60 s / 60 min)", G.PLANK_TIME_EVERY_MS === 15000 && G.plankTimeCallout(75) === "One minute fifteen" && G.plankTimeCallout(3600) === "One hour");

// ---- failing early-end reproductions (still live holds must last past 8 s and past 60 s)
{
  const { r, ended, firstHold } = run(seq(0, 90000, () => pose()));
  check("identical still frames (photo-like / Vision integer-stable): still holding at 90 s, not ended as frozen at ~8 s",
    !ended && r.phase === "holding" && r.ms > 85000 && firstHold != null && firstHold < 2000);
}
{
  const { r, ended } = run(seq(0, 90000, () => pose(0).map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) }))));
  check("integer-quantized still keypoints (Apple Vision-like): still holding at 90 s", !ended && r.phase === "holding" && r.ms > 85000);
}
{
  seed = 3;
  const { r, ended } = run(seq(0, 90000, () => pose(0).map((p) => ({ ...p, x: p.x + rnd() * 0.1, y: p.y + rnd() * 0.1 }))));
  check("sub-pixel-still (±0.05 px, below frozenTol * body length): still holding at 90 s, not frozen",
    !ended && r.phase === "holding" && r.ms > 85000);
}
{
  const { r, ended } = run(seq(0, 90000, (t) => pose(Math.floor(t / 33) % 10 === 0 ? 1 : 0)));
  check("mostly-still hold with a 1 px flicker every 10th frame: still holding at 90 s, not repeat",
    !ended && r.phase === "holding" && r.ms > 85000);
}
{
  const { r, ended } = run(seq(0, 90000, (t) => SY.kpsOf(SY.POSE.top, { hood: true })));
  check("side-view hold, head covered / hood (no face points), 1.5 px noise: still holding at 90 s",
    !ended && r.phase === "holding" && r.ms > 85000);
}
{
  const { r, ended } = run(seq(0, 90000, (t) => SY.kpsOf(SY.POSE.top, { noise: 2 })));
  check("side-view hold with 2 px tracking noise: still holding at 90 s", !ended && r.phase === "holding" && r.ms > 85000);
}
{
  const B = 20000;
  const { r, ended } = run(seq(0, 90000, (t) => (t >= B && t < B + 800 ? [] : jitter(t))));
  check("partial occlusion (800 ms dropout mid-hold) does not end the set; still holding at 90 s",
    !ended && r.phase === "holding" && r.ms > 85000);
}
{
  const B = 4000;
  const { r, ended } = run(seq(0, 30000, (t) => {
    const f = t < B ? 0 : t < B + 500 ? (t - B) / 500 : t < B + 2500 ? 1 : t < B + 3000 ? 1 - (t - B - 2500) / 500 : 0;
    return SY.kpsOf(SY.POSE.top, { rot: f * 0.52, tx: f * 60, ty: f * -50 });
  }));
  check("phone pickup mid-hold never ends the set", !ended && r.phase === "holding");
}

// createLiveness still recognises a photo / a looping clip (detector only; the hold ignores it)
{
  const lv = P.createLiveness(); let hit = null;
  for (const [t, k] of seq(0, 20000, () => pose())) { const v = lv.update(k, t, 400); if (v && !hit) hit = v; }
  check("createLiveness still flags identical frames as frozen (detector only)", hit === "frozen");
}
{
  const loop = seq(0, 1000, jitter).map((x) => x[1]);
  const lv = P.createLiveness(); let hit = null;
  for (const [t, k] of seq(0, 20000, (t) => loop[Math.floor(t / 33) % loop.length])) { const v = lv.update(k, t, 400); if (v && !hit) hit = v; }
  check("createLiveness still flags an exactly repeating raw loop as repeat (detector only)", hit === "repeat");
}

// ---- real breaks still end the set (credit rolled back to the start of the bad stretch)
function breakCase(name, after, reason) {
  const { ended } = run(seq(0, 5000, jitter).concat(seq(5000, 7000, after)));
  check(`${name} >1 s still ends the hold (reason ${reason})`, ended && ended.reason === reason && ended.ms > 3300 && ended.ms < 5100);
}
breakCase("knees down", () => knees, "knees");
breakCase("collapse (flat on the floor)", () => SY.kpsOf(SY.POSE.collapse, { noise: 0 }), "collapse");
breakCase("stood up", () => stand, "standing");
breakCase("hips sag", () => sag, "sag");
breakCase("hips pike", () => pike, "pike");
breakCase("body left the frame", () => [], "left_frame");
{
  const { r, ended } = run(seq(0, 5000, jitter).concat(seq(5000, 5700, () => sag), seq(5700, 9000, jitter)));
  check("a brief real sag (<1 s) that is fixed does not end the set", !ended && r.phase === "holding");
}
{
  const h = P.createPlankHold();
  for (const [t, k] of seq(0, 4000, jitter)) h.update(k, t);
  const s = h.stop(4000);
  check("End set / Stop still ends the hold with reason stopped and time credited", s.ended && s.reason === "stopped" && s.ms > 2000);
}

// page: the hold is not ended for frozen/repeat; pose still runs on the PFP raw snapshot (not the painted shield)
{
  const tick = html.slice(html.indexOf("async function plankTick"), html.indexOf("function newPlankHold"));
  const src = fs.readFileSync(path.join(__dirname, "../plank-session.js"), "utf8");
  check("hold source: liveness is not used to end the hold",
    /live\.update\(raw, t, bodyLen\(raw\)\)/.test(src) && !/if \(lv\) \{ end\(t, lv\)/.test(src) && !/end\(t, "frozen"/.test(src) && !/end\(t, "repeat"/.test(src));
  check("page: plank pose still goes through ZabPfp.input (raw snapshot) then plankHold.update",
    /ZabPfp\.input\s*\?\s*window\.ZabPfp\.input\(vid, det\)\s*:\s*vid/.test(tick) && /plankHold\.update\(poses/.test(tick));
}

const fails = R.filter((x) => !x).length;
console.log(`\n${R.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
