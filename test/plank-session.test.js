// Tests for plank-session.js. Run: node test/plank-session.test.js
const P = require("../plank-session.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
// side view: shoulder left, ankle right, y down
const pose = (hipDy = 0, kneeDy = 0, j = 0) => K({
  left_shoulder: [100 + j, 300], left_elbow: [105, 360], left_wrist: [110, 400],
  left_hip: [300 - j, 310 + hipDy], left_knee: [400, 315 + kneeDy + hipDy / 2], left_ankle: [500 + j, 320]
});
const good = pose(), sag = pose(60), pike = pose(-70);
const knees = K({ left_shoulder: [100, 300], left_hip: [300, 310], left_knee: [330, 400], left_ankle: [450, 400] });
const stand = K({ left_shoulder: [300, 50], left_hip: [300, 250], left_knee: [302, 350], left_ankle: [304, 450] });
const jitter = (t) => pose(0, 0, Math.sin(t / 37) * 1.5 + Math.cos(t / 91));

check("good plank = ok", P.classifyPlank(good).frame === "ok");
check("sag detected", P.classifyPlank(sag).frame === "sag");
check("pike detected", P.classifyPlank(pike).frame === "pike");
check("knees detected", P.classifyPlank(knees).frame === "knees");
check("standing detected", P.classifyPlank(stand).frame === "standing");
check("missing/low conf", P.classifyPlank([]).frame === "missing" && P.classifyPlank(K({ left_shoulder: [1, 1], left_hip: [2, 2], left_ankle: [3, 3] }, 0.1)).frame === "missing");
check("slight bend (165deg) still ok", P.classifyPlank(pose(12)).frame === "ok");

function run(frames) { const h = P.createPlankHold(); let r; for (const [t, k] of frames) r = h.update(k, t); return r; }
const seq = (from, to, f, dt = 33) => { const a = []; for (let t = from; t < to; t += dt) a.push([t, f(t)]); return a; };

let r = run(seq(0, 1400, jitter));
check("ready check: no clock before 1.5s", r.phase === "ready" && r.ms === 0 && r.countdownMs > 0);
r = run(seq(0, 1000, jitter).concat([[1033, sag]], seq(1066, 2400, jitter)));
check("ready check restarts on bad frame", r.phase === "ready");
r = run(seq(0, 20000, jitter));
check("good hold runs ~18.5s", r.phase === "holding" && Math.abs(r.ms - 18500) < 100);
r = run(seq(0, 5000, jitter).concat(seq(5000, 5800, () => sag), seq(5800, 9000, jitter)));
check("brief sag (<1s) neither pauses nor ends", r.phase === "holding" && r.ms > 7400);
r = run(seq(0, 5000, jitter).concat(seq(5000, 5500, () => []), seq(5500, 8000, jitter)));
check("brief dropout (<1s) ignored", r.phase === "holding");
r = run(seq(0, 5000, jitter).concat(seq(5000, 6500, () => sag)));
check("sag >1s ends hold, reason sag", r.ended && r.reason === "sag" && Math.abs(r.ms - 3500) < 60);
r = run(seq(0, 5000, jitter).concat(seq(5000, 6500, () => pike)));
check("pike >1s ends hold", r.ended && r.reason === "pike");
r = run(seq(0, 5000, jitter).concat(seq(5000, 6500, () => knees)));
check("knees >1s ends hold", r.ended && r.reason === "knees");
r = run(seq(0, 5000, jitter).concat(seq(5000, 6500, () => [])));
check("left frame >1s ends hold", r.ended && r.reason === "left_frame");
r = run(seq(0, 5000, jitter).concat(seq(5000, 6500, () => stand)));
check("stood up ends hold", r.ended && r.reason === "standing");
r = run(seq(0, 20000, () => good));
check("frozen input (photo) flagged", r.ended && r.reason === "frozen");
const loop = seq(0, 1000, jitter).map((x) => x[1]);
r = run(seq(0, 20000, (t) => loop[Math.floor(t / 33) % loop.length]));
check("exactly repeating loop flagged", r.ended && r.reason === "repeat");
// a very still real person: sub-pixel noise
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
r = run(seq(0, 30000, () => pose(0, 0, rnd() * 1.2)));
check("still person with micro-jitter not flagged", r.phase === "holding");
const h = P.createPlankHold(); seq(0, 4000, jitter).forEach(([t, k]) => h.update(k, t));
r = h.stop(4000);
check("manual stop keeps time", r.ended && r.reason === "stopped" && Math.abs(r.ms - 2500) < 60);
r = h.update(good, 5000);
check("ended stays ended", r.ended && r.ms === r.ms);
check("reason text", P.reasonText("sag") === "Hips sagged" && P.reasonText("left_frame") === "Body left the frame");
const ranked = P.rankPlanks([{ name: "a", ms: 1000 }, { name: "b", ms: 90000 }, { name: "c", ms: 0 }, { name: "d", ms: "x" }, { name: "e", ms: 5000 }]);
check("ranking longest first, drops invalid", ranked.map((x) => x.name).join() === "b,e,a");
check("ranking limit", P.rankPlanks(Array.from({ length: 80 }, (_, i) => ({ ms: i + 1 })), 50).length === 50);
check("personal best", P.bestOf(5000, 3000) === 5000 && P.bestOf(null, 3000) === 3000 && P.bestOf(1, NaN) === 1);

const fails = R.filter((x) => !x).length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
