// Plank with the phone upright (portrait frame) as well as sideways (landscape): orientation-independent geometry.
// Run: node test/plank-portrait.test.js
const fs = require("fs");
const P = require("../plank-session.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, score = 0.9) => Object.entries(o).filter(([, v]) => v).map(([name, [x, y]]) => ({ name, x, y, score }));
// Side-on plank, shoulder at (x0,y0), body length L, hip offset dev x L (+ = sag). noAnkle drops the ankle.
const body = (L, dev = 0, o = {}) => { const x0 = o.x0 == null ? 60 : o.x0, y0 = o.y0 == null ? 320 : o.y0, j = o.j || 0;
  return K({ left_shoulder: [x0 + j, y0], left_hip: [x0 + 0.45 * L - j, y0 + 0.0135 * L + dev * L], left_knee: [x0 + 0.75 * L, y0 + 0.02 * L + dev * L * 0.3],
    left_ankle: o.noAnkle ? null : [x0 + L + j, y0 + 0.03 * L], left_elbow: [x0 + 0.05 * L, y0 + 0.15 * L], left_wrist: [x0 + 0.08 * L, y0 + 0.2 * L] }, o.score == null ? 0.9 : o.score); };
const seq = (a, b, f, dt = 33) => { const r = []; for (let t = a; t < b; t += dt) r.push([t, f(t)]); return r; };
const run = (frames, dims) => { const h = P.createPlankHold(); let r; for (const [t, k] of frames) r = h.update(k, t, dims); return r; };
const LAND = { w: 640, h: 480 }, PORT = { w: 480, h: 640 }, PORT_HD = { w: 720, h: 1280 };
const jit = (t) => Math.sin(t / 37) * 1.5 + Math.cos(t / 91);

for (const [name, D, L, x0] of [["landscape 640x480", LAND, 450, 90], ["portrait 480x640", PORT, 380, 50], ["portrait 720x1280", PORT_HD, 560, 80]]) {
  const y0 = D.h * 0.5;
  check(`${name}: framing ok for a side-on plank`, P.frameGuide(body(L, 0, { x0, y0 }), D).ok);
  let r = run(seq(0, 8000, (t) => body(L, 0, { x0, y0, j: jit(t) })), D);
  check(`${name}: good plank starts and keeps the clock`, r.phase === "holding" && r.ms > 6000);
  r = run(seq(0, 3000, (t) => body(L, 0, { x0, y0, j: jit(t) })).concat(seq(3000, 6000, (t) => body(L, 0.15, { x0, y0, j: jit(t) }))), D);
  check(`${name}: sagging hips end the hold`, r.ended && r.reason === "sag");
  r = run(seq(0, 3000, (t) => body(L, 0, { x0, y0, j: jit(t) })).concat(seq(3000, 6000, (t) => body(L, -0.15, { x0, y0, j: jit(t) }))), D);
  check(`${name}: piked hips end the hold`, r.ended && r.reason === "pike");
}
// Same pose, same verdict, regardless of frame orientation and size (body-length normalised).
for (const dev of [0, 0.03, 0.09, -0.09]) {
  const a = P.classifyPlank(body(450, dev)).frame, b = P.classifyPlank(body(200, dev), { kneeFallback: true }).frame;
  check(`dev ${dev}: same verdict for a big and a small body (${a})`, a === b);
}
// Missing ankles (cut off at the bottom/side of a tall frame): fall back to shoulder-hip-knee.
const na = (L, dev, o = {}) => body(L, dev, { ...o, noAnkle: true });
check("classify: no ankle, no fallback (landscape) -> missing (unchanged)", P.classifyPlank(na(300, 0)).frame === "missing");
check("classify: no ankle, portrait fallback -> ok on a straight line", (() => { const c = P.classifyPlank(na(300, 0), { kneeFallback: true }); return c.frame === "ok" && c.end === "knee"; })());
check("classify: fallback still flags sag and pike", P.classifyPlank(na(300, 0.15), { kneeFallback: true }).frame === "sag" && P.classifyPlank(na(300, -0.15), { kneeFallback: true }).frame === "pike");
check("classify: fallback flags standing (knee straight below shoulder)", P.classifyPlank(K({ left_shoulder: [200, 100], left_hip: [205, 300], left_knee: [208, 420] }), { kneeFallback: true }).frame === "standing");
check("framing: portrait, ankle missing -> ok via knee", (() => { const g = P.frameGuide(na(380, 0, { x0: 50, y0: 320 }), PORT); return g.ok && g.fallback; })());
check("framing: portrait, ankle at the frame edge -> ok via knee", P.frameGuide(body(470, 0, { x0: 40, y0: 320 }), PORT).ok);
check("framing: landscape, ankle missing -> still asks for the whole body", P.frameGuide(na(450, 0, { x0: 90 }), LAND).issue === "whole");
check("framing: portrait, knee missing too -> whole body message", P.frameGuide(na(380, 0, { x0: 50 }).filter((p) => p.name !== "left_knee"), PORT).issue === "whole");
let r = run(seq(0, 8000, (t) => na(380, 0, { x0: 50, j: jit(t) })), PORT);
check("hold: portrait without ankles runs the clock", r.phase === "holding" && r.ms > 6000);
r = run(seq(0, 3000, (t) => na(380, 0, { x0: 50, j: jit(t) })).concat(seq(3000, 6000, (t) => na(380, 0.15, { x0: 50, j: jit(t) }))), PORT);
check("hold: portrait without ankles, sag ends the hold", r.ended && r.reason === "sag");
// Lower keypoint confidence in a tall frame (smaller person).
r = run(seq(0, 8000, (t) => body(380, 0, { x0: 50, j: jit(t), score: 0.28 })), PORT);
check("hold: portrait accepts slightly lower confidence (0.28)", r.phase === "holding");
r = run(seq(0, 8000, (t) => body(450, 0, { x0: 90, y0: 240, j: jit(t), score: 0.28 })), LAND);
check("hold: landscape keeps its 0.3 confidence gate (0.28 never starts)", r.phase === "ready");
check("thresholds pinned", P.PLANK.minSpanPortrait === 0.35 && P.PLANK.portraitMinScore === 0.25 && P.PLANK.portraitFrameScore === 0.25 && P.PLANK.kneeFrac === 0.75 && P.PLANK.sagStart === 0.05 && P.PLANK.pikeStart === 0.06);
// Copy: upright phone works; no rotate prompt; no location text.
const idx = fs.readFileSync(__dirname + "/../index.html", "utf8"), pl = fs.readFileSync(__dirname + "/../plank.html", "utf8");
check("copy: plank setup says sideways or upright", /sideways or upright/.test(idx) && /sideways or upright/.test(pl) && /sideways or upright/.test(require("../get-set.js").POSITION.plank[0]));
check("copy: no 'Prop the phone sideways' prompt is reached from the framing guide", ["level", "closer", "whole", "turn"].every((i) => P.MSG[i]) && !/Prop the phone sideways/.test(idx));
const fail = R.filter((x) => !x).length; console.log(`\n${R.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
