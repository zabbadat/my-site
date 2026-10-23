// Tests for washers-battle.js: validation, winner resolution, and a two-player room flow over a mock Firestore.
const W = require("../washers-battle.js");
const B = require("../battle-rooms.js");
const fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("score 0..21 ints only", W.validScore(0) && W.validScore(21) && !W.validScore(22) && !W.validScore(-1) && !W.validScore(2.5) && !W.validScore("3"));
check("steps 0..100000 ints only", W.validSteps(0) && W.validSteps(100000) && !W.validSteps(100001) && !W.validSteps(-2) && !W.validSteps(1.2));
check("ms >0 and <= 4h", W.validMs(1) && !W.validMs(0) && W.validMs(14400000) && !W.validMs(14400001));
const TS = { __ts: 1 };
const res = W.makeResult({ steps: 120, ms: 300000.4, verified: true, reasons: [] }, TS);
check("makeResult shape matches rules", JSON.stringify(Object.keys(res).sort()) === JSON.stringify(["at", "ms", "reasons", "score", "steps", "verified"]) && res.score === 21 && res.ms === 300000 && res.at === TS);
check("makeResult rejects bad steps/ms", W.makeResult({ steps: -1, ms: 5 }, TS) === null && W.makeResult({ steps: 5, ms: 0 }, TS) === null);
check("makeResult caps reasons at 8", W.makeResult({ steps: 1, ms: 9, reasons: Array(20).fill("x") }, TS).reasons.length === 8);
check("validResult: result + forfeit ok, junk rejected", W.validResult({ ...res, at: 1 }) && W.validResult({ forfeit: true, at: 1 }) && !W.validResult({ ...res, score: 20 }) && !W.validResult({ forfeit: true, at: 1, x: 1 }) && !W.validResult(null));
const room = (a, b, extra) => ({ status: "live", players: { a: { name: "A", ...a }, b: { name: "B", ...b } }, ...extra });
const done = (steps, ms) => ({ result: { score: 21, steps, ms, verified: true, reasons: [], at: 1 } });
check("nobody finished: not done", !W.decide(room({ score: 10 }, { score: 15 })).done);
check("only one finished, other still playing: not done", !W.decide(room(done(100, 5000), { score: 18 })).done);
let d = W.decide(room(done(100, 9000), done(140, 5000))); check("both 21: fewer steps wins", d.done && d.winner === "a" && d.reason === "steps");
d = W.decide(room(done(100, 9000), done(100, 5000))); check("steps tie: quicker time wins", d.winner === "b" && d.reason === "time");
d = W.decide(room(done(100, 5000), done(100, 5000))); check("full tie: no winner", d.done && d.winner === null && d.reason === "tie");
d = W.decide(room(done(300, 9000), { result: { forfeit: true, at: 1 } })); check("opponent forfeit: finisher wins", d.winner === "a" && d.reason === "forfeit");
d = W.decide(room({ score: 4, leftAt: 5 }, done(300, 9000))); check("left after start counts as forfeit", d.winner === "b");
d = W.decide(room({ result: { forfeit: true, at: 1 } }, { leftAt: 3 })); d = W.decide(room({ score: 7 }, { result: { forfeit: true, at: 1 } })); check("forfeit wins at once for the player still playing", d.done && d.winner === "a");
d = W.decide(room({ result: { forfeit: true, at: 1 } }, { leftAt: 3 })); check("both out: no winner", d.done && d.winner === null);
check("not decided before live", !W.decide({ ...room(done(1, 1), done(2, 2)), status: "countdown" }).done);
check("result text", /fewer steps/.test(W.resultText(room(done(100, 9000), done(140, 5000)), "a")) && /more steps/.test(W.resultText(room(done(100, 9000), done(140, 5000)), "b")));
check("publishPatch clamps own seat", JSON.stringify(W.publishPatch("a", { score: 25, steps: -3 })) === JSON.stringify({ "players.a.score": 21, "players.a.steps": 0 }));
// rules draft present, marked DRAFT/unpublished, and matches client fields
const rules = fsx.readFileSync(__dirname + "/../firestore.rules", "utf8");
const blk = rules.slice(rules.indexOf("match /washersBattles/{code}"), rules.indexOf("match /tutBattleStats"));
check("rules: washersBattles block marked DRAFT, not yet published", /DRAFT, not yet published/.test(rules.slice(rules.indexOf("match /washersBattles") - 600, rules.indexOf("match /washersBattles"))));
check("rules: result keys match makeResult", blk.includes("['score','steps','ms','verified','reasons','at']") && blk.includes("['forfeit','at']") && blk.includes("x.score == 21"));
check("rules: own seat fields cover client writes", blk.includes("'ready','seenAt','leftAt','opener','score','steps','result'"));
check("rules: washers tokenTx clause untouched", /t\(\)\.source == 'washers' && t\(\)\.units == 'wins'\s+&& t\(\)\.qty == 1\s+&& t\(\)\.amount == 1\)\)/.test(rules));
// index wiring
const html = fsx.readFileSync(__dirname + "/../index.html", "utf8");
check("hub card points at the battle UI", /href="#washerbattle" data-battle="washers"/.test(html) && html.includes('id="washerbattle"'));
check("module loaded, collection washersBattles", html.includes('src="/washers-battle.js"') && html.includes('mkBattleFs("washersBattles")'));
check("user-facing spelling Zabba", html.includes("Zabba Washer Battle") && !/>[^<]*\bZaba\b[^<]*</.test(html.slice(html.indexOf('id="washerbattle"'), html.indexOf('id="washerbattle"') + 3000)));
check("no push-counter DEFAULTS change", /maxRepMs:\s*6000/.test(fsx.readFileSync(__dirname + "/../push-counter.js", "utf8")));

// ---- two-player flow over a mock Firestore ----
let T = 1_000_000; let docs = {}; const subs = {}; const SERVER = { __ts: 1 }, DEL = { __del: 1 };
const deep = (v) => (v === SERVER ? T : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
function apply(d, p) { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; const last = ks[ks.length - 1]; if (v === DEL) delete o[last]; else o[last] = deep(v); } return d; }
const emit = (c) => setTimeout(() => (subs[c] || []).slice().forEach((f) => f(clone(docs[c]))));
let lock = Promise.resolve();
const fs = {
  tx: (c, fn) => (lock = lock.then(async () => { await new Promise((r) => setTimeout(r, 1)); let next; const out = fn({ get: () => clone(docs[c]), set: (x) => (next = deep(x)), update: (p) => (next = apply(next || docs[c], p)) }); if (next) { docs[c] = next; emit(c); } return out; })),
  update: async (c, p) => { docs[c] = apply(docs[c], p); emit(c); },
  watch: (c, cb) => { (subs[c] = subs[c] || []).push(cb); setTimeout(() => cb(clone(docs[c]))); return () => { subs[c] = subs[c].filter((f) => f !== cb); }; },
  ts: () => SERVER, del: () => DEL, toMs: (v) => (typeof v === "number" ? v : null),
};
const A = { uid: "a", name: "Zab" }, Bu = { uid: "b", name: "Pal" };
(async () => {
  const pa = B.controller(fs, { now: () => T + 2000 }), pb = B.controller(fs, { now: () => T - 1500 });
  const code = await pa.createRoom(A); await pb.joinRoom(code, Bu);
  check("room: two seats", Object.keys(docs[code].players).length === 2);
  check("no publish before live", (await W.submitResult(fs, code, "a", { steps: 5, ms: 10 })) === false && !docs[code].players.a.result);
  await pa.setReady(code, A, true); await pb.setReady(code, Bu, true);
  check("both ready -> countdown 5 s", docs[code].status === "countdown" && Math.abs(docs[code].startAt - T - B.LEAD_MS) < 50);
  T += 5100; await pb.markLive(code);
  check("live", docs[code].status === "live");
  await W.publishLive(fs, code, "a", { score: 12, steps: 40 }); await W.publishLive(fs, code, "b", { score: 9, steps: 30 });
  check("shared scoreboard sees both", docs[code].players.a.score === 12 && docs[code].players.b.steps === 30);
  check("A reaches 21: result written", await W.submitResult(fs, code, "a", { steps: 80, ms: 400000, verified: true, reasons: [] }));
  check("write-once: second result rejected", (await W.submitResult(fs, code, "a", { steps: 1, ms: 1 })) === false && docs[code].players.a.result.steps === 80 && docs[code].players.a.score === 21);
  check("A finished, B playing: not decided", !W.decide(docs[code]).done);
  check("B result -> decided (fewer steps A)", await W.submitResult(fs, code, "b", { steps: 95, ms: 300000, verified: true, reasons: [] }) && W.decide(docs[code]).winner === "a");
  check("result validates", W.validResult(docs[code].players.a.result) && W.validResult(docs[code].players.b.result));
  // forfeit room
  const c2 = await pa.createRoom(A); await pb.joinRoom(c2, Bu); await pa.setReady(c2, A, true); await pb.setReady(c2, Bu, true); T += 5100; await pa.markLive(c2);
  check("forfeit written", await W.forfeit(fs, c2, "b") && docs[c2].players.b.result.forfeit === true);
  check("after forfeit no result", (await W.submitResult(fs, c2, "b", { steps: 1, ms: 5 })) === false);
  check("forfeit then A finishes: A wins", await W.submitResult(fs, c2, "a", { steps: 50, ms: 9000 }) && W.decide(docs[c2]).winner === "a");
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
