// Front-view plank (phone on the floor ~3 ft ahead): classification + hold machine on simulated 3 ft geometry.
const P = require("../plank-session.js"), make = require("./lib/front-plank-geometry.js");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const jit = (k, t) => k.map((p, i) => ({ ...p, x: p.x + Math.sin(t / 97 + i) * 0.8, y: p.y + Math.cos(t / 89 + i) * 0.8 }));
const hideAnk = (k) => k.map((p) => (/ankle/.test(p.name) ? { ...p, score: 0.05 } : p));
function sim(after, { ms = 4000, pre = {}, map = (k) => k, still = false } = {}) {
  const h = P.createPlankHold({ front: true }); let r, t = 0;
  for (; t < 3000; t += 33) r = h.update(jit(map(make(pre)), t), t);
  const started = h.state().phase === "holding", src = h.state().base && h.state().base.floorSource;
  for (let i = 0; t < 3000 + ms; t += 33, i++) { const k = map(typeof after === "function" ? after(i) : make(after)); r = h.update(still ? k : jit(k, t), t); if (r.ended) break; }
  return { started, ended: !!r.ended, reason: r.reason, src };
}
const s0 = sim({}); check("straight hold starts and keeps going (floor line from ankles)", s0.started && !s0.ended && s0.src === "ankles");
for (const [n, o] of [["both knees", { kneeL: 0.05, kneeR: 0.05 }], ["left knee only", { kneeL: 0.05 }], ["right knee only", { kneeR: 0.05 }]])
  check(n + " down -> knees", sim(o).reason === "knees");
check("brief knee dip (<0.5 s) forgiven", (() => { const r = sim((i) => make(i < 10 ? { kneeL: 0.05 } : {})); return !r.ended; })());
check("hip sag -> sag", sim({ hipY: 0.15 }).reason === "sag");
check("pike -> pike", sim({ hipY: 0.65 }).reason === "pike");
check("stand up (gradual) -> standing", sim((i) => (i < 15 ? make({}).map((p) => ({ ...p, y: p.y - i * 8 })) : make({ stand: true }))).reason === "standing");
check("moves back from phone (shoulders shrink) -> standing", sim({ back: 0.6 }).reason === "standing");
check("legs occluded (low conf) keep holding", !sim({ legsConf: 0.05 }).ended && !sim({ legsConf: 0.2 }).ended);
const a = sim({ kneeL: 0.05 }, { map: hideAnk, pre: {} }); check("ankles hidden: floor line falls back to knees, knee drop still caught", a.src === "knees" && a.reason === "knees");
check("not standing at 3 ft (front plank not read as standing)", P.classifyFront(make({}), P.frontBaseline([P.frontPoints(make({}), { minScore: 0.3, lowScore: 0.15 })], {}), {}).frame === "ok");
check("liveness: frozen frames end the hold", sim({}, { still: true, ms: 20000 }).ended);
check("readyMs unchanged 1500", P.PLANK.readyMs === 1500);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
