// Plank upgrades: body-length-scaled sag/pike with hysteresis, framing guide, One Euro on form points, raw liveness.
// Run: node test/plank-upgrade.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const P = require("../plank-session.js"), PC = require("../push-counter.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
// Side-on body of length L (shoulder to ankle), hip at 45% along, offset `dev` x L (+ = sag), small x jitter j.
const body = (L, dev = 0, o = {}) => { const pj = o.pj ? (k) => k.map((p) => ({ ...p, x: p.x + o.rnd() * o.pj, y: p.y + o.rnd() * o.pj })) : (k) => k;
  return pj(body0(L, dev, o)); };
const body0 = (L, dev, o) => {
  const x0 = o.x0 == null ? 60 : o.x0, y0 = o.y0 == null ? 240 : o.y0, j = o.j || 0;
  return K({
    left_shoulder: [x0 + j, y0], left_hip: [x0 + 0.45 * L - j, y0 + 0.0135 * L + dev * L], left_knee: [x0 + 0.75 * L, y0 + 0.02 * L + dev * L * 0.3],
    left_ankle: [x0 + L + j, y0 + 0.03 * L], left_elbow: [x0 + 0.05 * L, y0 + 0.15 * L], left_wrist: [x0 + 0.08 * L, y0 + 0.2 * L]
  }, o.score == null ? 0.9 : o.score);
};
const seq = (from, to, f, dt = 33) => { const a = []; for (let t = from; t < to; t += dt) a.push([t, f(t)]); return a; };
const jit = (L) => (t) => body(L, 0, { j: Math.sin(t / 37) * 1.5 + Math.cos(t / 91) });
function run(frames, opts, dims) { const h = P.createPlankHold(opts); let r; for (const [t, k] of frames) r = h.update(k, t, dims); return r; }
const D = { w: 640, h: 480 };

// ---- thresholds pinned (deliberate: replaces the old bodyAngle 160)
const PL = P.PLANK;
check("defaults: sag 0.05 start / 0.07 keep, pike 0.06 / 0.085, ready 1500, bad 1000, grace 250, filter on", PL.sagStart === 0.05 && PL.sagKeep === 0.07 && PL.pikeStart === 0.06 && PL.pikeKeep === 0.085 && PL.readyMs === 1500 && PL.badMs === 1000 && PL.missMs === 1000 && PL.readyGraceMs === 250 && PL.filter === true && PL.bodyAngle === undefined);
check("tolerances sit between the old loose ~0.088 and the open-source presets (0.015-0.04)", [PL.sagStart, PL.sagKeep, PL.pikeStart, PL.pikeKeep].every((v) => v > 0.04 && v < 0.088) && PL.sagStart <= PL.sagKeep && PL.pikeStart <= PL.pikeKeep);

// ---- sag / pike scale with body length
for (const L of [150, 300, 600, 1000]) {
  const c = (dev, keep) => P.classifyPlank(body(L, dev), { keep }).frame;
  check(`L=${L}: straight and 0.03 off are ok; 0.04 sag still ok`, c(0) === "ok" && c(0.03) === "ok" && c(0.04) === "ok");
  check(`L=${L}: sag 0.09 and pike -0.09 flagged even with the loose keep limits`, c(0.09, true) === "sag" && c(-0.09, true) === "pike");
  check(`L=${L}: a fixed 6 px hip drop is judged by its share of body length (${(6 / L).toFixed(3)})`, (P.classifyPlank(body(L, 6 / L), {}).frame === "sag") === (6 / L > 0.05));
}
// hysteresis: dev 0.06 sag: not good when starting, still good when already good
const sagMid = body(300, 0.06), pikeMid = body(300, -0.075);
check("sag 0.06: sag from a cold start (start limit 0.05), ok when already good (keep limit 0.07)", P.classifyPlank(sagMid, { keep: false }).frame === "sag" && P.classifyPlank(sagMid, { keep: true }).frame === "ok");
check("pike 0.075: pike from a cold start (0.06), ok when already good (0.085)", P.classifyPlank(pikeMid, { keep: false }).frame === "pike" && P.classifyPlank(pikeMid, { keep: true }).frame === "ok");
check("sag and pike have separate limits", PL.sagStart !== PL.pikeStart && PL.sagKeep !== PL.pikeKeep);
check("hipOffset sign: + below the line, - above; mirrored body (ankle left of shoulder) agrees", (() => { const a = { x: 0, y: 0 }, an = { x: 100, y: 0 }; return P.hipOffset(a, { x: 50, y: 10 }, an) > 0 && P.hipOffset(a, { x: 50, y: -10 }, an) < 0 && P.hipOffset({ x: 100, y: 0 }, { x: 50, y: 10 }, { x: 0, y: 0 }) > 0; })());
// hold-level hysteresis
let r = run(seq(0, 6000, () => sagMid), {}, D);
check("hold: a hip steadily at 0.06 never arms the ready start", r.phase === "ready" && r.frame === "sag");
r = run(seq(0, 2000, jit(300)).concat(seq(2000, 12000, (t) => body(300, 0.06, { j: Math.sin(t / 37) * 1.5 + Math.cos(t / 91) }))), {}, D);
check("hold: once holding, the same 0.06 sag is tolerated (keep limit)", r.phase === "holding" && r.ms > 9000);
r = run(seq(0, 2000, jit(300)).concat(seq(2000, 2400, () => body(300, 0.15)), seq(2400, 5000, () => sagMid)), {}, D);
check("hold: after a real sag, 0.06 is not good again (must get back under 0.05): ends after 1 s", r.ended && r.reason === "sag");
r = run(seq(0, 2000, jit(300)).concat(seq(2000, 2400, () => body(300, 0.15)), seq(2400, 5000, () => body(300, 0.03))), {}, D);
check("hold: sag shorter than 1 s then back under 0.05: keeps going", r.phase === "holding");
check("regression: ok / knees / standing / missing / low confidence", (() => {
  const knees = K({ left_shoulder: [100, 300], left_hip: [300, 310], left_knee: [330, 400], left_ankle: [450, 400] });
  const stand = K({ left_shoulder: [300, 50], left_hip: [300, 250], left_knee: [302, 350], left_ankle: [304, 450] });
  return P.classifyPlank(body(300)).frame === "ok" && P.classifyPlank(knees).frame === "knees" && P.classifyPlank(stand).frame === "standing" && P.classifyPlank([]).frame === "missing" && P.classifyPlank(body(300, 0, { score: 0.1 })).frame === "missing";
})());

// ---- framing guide
const G = (kps, dims) => P.frameGuide(kps, dims || D);
check("framing: good side view fills the frame -> ok, no message", (() => { const g = G(body(450, 0, { x0: 90 })); return g.ok && g.msg === "" && g.issue === null; })());
check("framing: missing ankle -> 'Step back until your whole body fits'", (() => { const k = body(450, 0, { x0: 90 }).filter((p) => p.name !== "left_ankle"); const g = G(k); return !g.ok && g.issue === "whole" && g.msg === "Step back until your whole body fits"; })());
check("framing: low-confidence knee counts as missing", G(body(450, 0, { x0: 90 }).map((p) => (p.name === "left_knee" ? { ...p, score: 0.2 } : p))).issue === "whole");
check("framing: joint cut off at the frame edge -> whole body message", G(body(590, 0, { x0: 40 })).issue === "whole" && G(body(450, 0, { x0: 90, y0: 4 })).issue === "whole");
check("framing: seen from the front (both shoulders apart) -> 'Turn so the camera sees your side'", (() => {
  const k = body(450, 0, { x0: 90 }).concat(K({ right_shoulder: [250, 244], right_hip: [420, 262] })); const g = G(k); return !g.ok && g.issue === "turn" && g.msg === "Turn so the camera sees your side"; })());
check("framing: side-on with the far shoulder hidden behind the near one is fine", (() => { const k = body(450, 0, { x0: 90 }).concat(K({ right_shoulder: [95, 244], right_hip: [292, 252] })); return G(k).ok; })());
check("framing: portrait frame, small body -> 'Prop the phone sideways'", (() => { const g = P.frameGuide(body(300, 0, { x0: 90 }), { w: 480, h: 640 }); return !g.ok && g.issue === "sideways" && g.msg === "Prop the phone sideways"; })());
check("framing: body running up the frame (phone turned) -> 'Prop the phone sideways'", (() => {
  const k = K({ left_shoulder: [240, 60], left_hip: [245, 200], left_knee: [250, 300], left_ankle: [255, 400] }); return P.frameGuide(k, { w: 480, h: 640 }).issue === "sideways"; })());
check("framing: landscape, tilted body -> level; far away -> closer", (() => {
  const tilt = K({ left_shoulder: [100, 60], left_hip: [250, 200], left_knee: [330, 280], left_ankle: [400, 360] });
  return P.frameGuide(tilt, D).issue === "level" && P.frameGuide(body(120, 0, { x0: 200 }), D).issue === "closer"; })());
check("framing: the message set is short spoken-style text", Object.values(P.MSG).every((m) => m.length <= 40) && P.MSG.whole === "Step back until your whole body fits" && P.MSG.turn === "Turn so the camera sees your side" && P.MSG.sideways === "Prop the phone sideways");
// framing in the ready start
r = run(seq(0, 5000, (t) => body(450, 0, { x0: 90, j: Math.sin(t / 37) * 1.5 }).filter((p) => p.name !== "left_knee")), {}, D);
check("ready: good form but knee out of frame -> clock never starts, message shown", r.phase === "ready" && r.countdownMs == null && r.framing.issue === "whole" && r.framing.msg === P.MSG.whole);
r = run(seq(0, 5000, (t) => body(300, 0, { x0: 90, j: Math.sin(t / 37) * 1.5 })), {}, { w: 480, h: 640 });
check("ready: portrait phone, small body -> blocked with 'Prop the phone sideways'", r.phase === "ready" && r.framing.msg === P.MSG.sideways);
r = run(seq(0, 5000, jit(450)), {}, D);
check("ready: good framing + form starts the clock after 1.5 s, framing ok", r.phase === "holding" && r.framing.ok);
{ const h = P.createPlankHold(), f = seq(0, 400, jit(450)); let last; for (const [t, k] of f) last = h.update(k, t, D);
  check("framing message is debounced (not shown for a 0.3 s blip)", (() => { const h2 = P.createPlankHold(); let x; for (const [t, k] of seq(0, 300, () => body(450, 0, { x0: 90 }).filter((p) => p.name !== "left_ankle"))) x = h2.update(k, t, D); return x.framing.msg === ""; })() && last.framing.msg === ""); }
// framing NEVER ends a running hold
const base = (t) => body(450, 0, { x0: 90, j: Math.sin(t / 37) * 1.5 + Math.cos(t / 91) });
const noKnee = (t) => base(t).filter((p) => p.name !== "left_knee");
const front = (t) => base(t).concat(K({ right_shoulder: [250, 244], right_hip: [420, 262] }));
const tooBig = (t) => body(450, 0, { x0: 4, j: Math.sin(t / 37) * 1.5 }); // touching the left edge
const PORT = { w: 480, h: 640 };
{ const small = (t) => body(300, 0, { x0: 90, j: Math.sin(t / 37) * 1.5 + Math.cos(t / 91) });
  const h = P.createPlankHold(); let rr; for (const [t, k] of seq(0, 2000, base)) h.update(k, t, D); for (const [t, k] of seq(2000, 30000, small)) rr = h.update(k, t, PORT);
  check(`framing never ends a hold: phone turned to portrait mid-hold for 28 s -> still holding (message: ${rr.framing.msg})`, rr.phase === "holding" && rr.ms > 27000 && rr.framing.msg === P.MSG.sideways); }
for (const [n, f, d] of [["knee out of frame", noKnee, D], ["turned to face the camera", front, D], ["cut off at the edge", tooBig, D]]) {
  r = run(seq(0, 2000, base).concat(seq(2000, 30000, f)), {}, d);
  check(`framing never ends a hold: ${n} for 28 s -> still holding (message shown: ${!!r.framing.msg})`, r.phase === "holding" && !r.ended && r.ms > 27000 && !!r.framing.msg);
}

// ---- One Euro filter on form points
check("filter uses push-counter's One Euro (same function), MoveNet smoothing is off for plank", PC.oneEuro && typeof PC.oneEuro === "function" && /enableSmoothing:\s*false/.test(fs.readFileSync(path.join(__dirname, "../index.html"), "utf8")));
{ // lag: hips drop 0.12 L in one step; the filtered classification must say sag within 150 ms (and not before it happens)
  const L = 400; const h = P.createPlankHold(); let tSag = null, early = false;
  for (const [t, k] of seq(0, 3000, jit(L))) h.update(k, t, D);
  for (const [t, k] of seq(3000, 3600, () => body(L, 0.12, { j: 0 }))) { const rr = h.update(k, t, D); if (rr.frame === "sag" && tSag == null) tSag = t - 3000; }
  check(`One Euro lag: a 0.12 L hip drop classifies as sag within 150 ms (got ${tSag} ms)`, tSag != null && tSag <= 150); }
{ // noise: hip noise sd 0.02 L around a good plank. Raw classification flickers; filtered does not
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const noisy = () => body(400, 0.2 * rnd(), { j: rnd() * 2 });
  const flick = (opts) => { seed = 11; const h = P.createPlankHold(opts); let bad = 0, n = 0; for (const [t, k] of seq(0, 20000, noisy)) { const rr = h.update(k, t, D); if (t > 2000) { n++; if (rr.frame !== "ok") bad++; } } return bad / n; };
  const fRaw = flick({ filter: false }), fFilt = flick({});
  check(`One Euro cuts flicker: bad-frame share raw ${(fRaw * 100).toFixed(1)}% -> filtered ${(fFilt * 100).toFixed(1)}%`, fRaw > 0.05 && fFilt < fRaw / 3);
  const rr = run(seq(0, 30000, noisy), {}, D);
  check("noisy honest plank (hip noise up to 0.1 L) holds 30 s with the filter", (seed = 11, true) && rr.phase === "holding"); }
check("filter does not modify its input and passes low-confidence points through", (() => { const f = P.createPlankFilter(), k = body(400, 0, { x0: 90 }); const copy = JSON.stringify(k); f.filter(k, 0); const o = f.filter(k.map((p) => (p.name === "left_wrist" ? { ...p, score: 0.1, x: 5 } : p)), 33); return JSON.stringify(k) === copy && o.find((p) => p.name === "left_wrist").x === 5; })());
check("filter: opts.filter=false is a pass-through", (() => { const f = P.createPlankFilter({ filter: false }), k = body(400, 0, { x0: 90 }); return JSON.stringify(f.filter(k, 0)) === JSON.stringify(k); })());

// ---- liveness stays on RAW keypoints
{ const L = 400; // raw sub-pixel jitter on every joint (+-0.4 px): alive, but the One Euro output moves less than frozenTol * L (0.12 px)
  let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const frames = seq(0, 30000, () => body(L, 0, { x0: 90, pj: 0.4, rnd }));
  // what the liveness check would see if it were handed the FILTERED points
  const lv = P.createLiveness(), pf = P.createPlankFilter(); let viaFiltered = null;
  for (const [t, k] of frames) { const v = lv.update(pf.filter(k, t), t, L); if (v) viaFiltered = v; }
  const lvRaw = P.createLiveness(); let viaRaw = null; for (const [t, k] of frames) { const v = lvRaw.update(k, t, L); if (v) viaRaw = v; }
  check("trap shown: the filtered points of a still, live person WOULD read as 'frozen'", viaFiltered === "frozen" && viaRaw === null);
  r = run(frames, {}, D);
  check("hold with the filter on: still live person is NOT ended as frozen (liveness reads raw)", r.phase === "holding" && r.reason == null);
  r = run(seq(0, 20000, () => body(400, 0, { x0: 90 })), {}, D);
  check("a real frozen image (identical raw frames) is still flagged", r.ended && r.reason === "frozen");
  const loopF = seq(0, 1000, (t) => body(400, 0, { x0: 90, j: Math.sin(t / 37) * 1.5 + Math.cos(t / 91) })).map((x) => x[1]);
  r = run(seq(0, 20000, (t) => loopF[Math.floor(t / 33) % loopF.length]), {}, D);
  check("an exactly repeating raw loop is still flagged", r.ended && r.reason === "repeat");
  const src = fs.readFileSync(path.join(__dirname, "../plank-session.js"), "utf8");
  check("source: live.update is handed the raw keypoints", /live\.update\(raw, t, bodyLen\(raw\)\)/.test(src) && /pf\.filter\(raw, t\)/.test(src)); }

// ---- ready countdown tolerance
{ const gap = (ms) => run(seq(0, 1000, jit(450)).concat(seq(1000, 1000 + ms, () => body(450, 0.15)), seq(1000 + ms, 1000 + ms + 400, jit(450))), {}, D);
  check("ready: one bad frame (33 ms) does not reset", gap(33).countdownMs != null || gap(33).phase === "holding");
  check("ready: 200 ms bad stretch does not reset (clock still starts on time)", gap(200).phase === "holding" || gap(200).countdownMs < 400);
  check("ready: 400 ms bad stretch resets the countdown", gap(400).countdownMs == null || gap(400).countdownMs > 1000); }

// ---- browser path: plank-session finds the filter via window.ZabbadatPush (push-counter.js loads later, lazily)
{ const ctx = vm.createContext({ Math, Date, console }); ctx.self = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../plank-session.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../push-counter.js"), "utf8"), ctx);
  const api = ctx.ZabbadatPlank, f = api.createPlankFilter(), k = body(400, 0, { x0: 90 });
  f.filter(k, 0); const o = f.filter(k.map((p) => ({ ...p, x: p.x + 3 })), 33);
  check("browser: window.ZabbadatPlank uses window.ZabbadatPush.oneEuro (output differs from the jumped input)", !!api && o[0].x < k[0].x + 3 && o[0].x > k[0].x); }
{ const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const tick = html.slice(html.indexOf("async function plankTick"), html.indexOf("function newPlankHold"));
  check("page: frame stamped before inference, raw keypoints + frame size go to plankHold.update", /tFrame = performance\.now\(\)[\s\S]*estimatePoses[\s\S]*plankHold\.update\(poses[^;]*, tFrame, \{ w: /.test(tick));
  check("page: framing message shown in ready and during the hold, outline element exists, no skeleton drawing", /r\.framing/.test(tick) && html.includes('id="plankOutline"') && !/getContext\(\s*["']2d/.test(tick)); }

const fails = R.filter((x) => !x).length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
