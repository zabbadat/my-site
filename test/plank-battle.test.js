// Plank Battles result step: last one holding wins; write-once results; forfeit/leave; tie; flow over a mock store.
const PB = require("../plank-battle.js"), B = require("../battle-rooms.js"), fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const room = (a, b) => ({ status: "live", startAt: 1000, players: { a: { name: "A", ...a }, b: { name: "B", ...b } } });
const held = (ms, v = true) => ({ result: { holdMs: ms, verified: v, at: 1 } });
check("holdMs from shared startAt, capped 2 h", PB.holdMs({ startAt: 1000 }, 61000) === 60000 && PB.holdMs({ startAt: 0 }, 9e9) === PB.MAX_MS && PB.holdMs({ startAt: null }, 5) === 0);
check("nobody dropped: pending", !PB.decide(room({}, {})).done);
let d = PB.decide(room(held(30000), {})); check("first to drop loses at once", d.done && d.winner === "b" && d.reason === "last-holding");
d = PB.decide(room(held(30000), held(45000))); check("both dropped: longer hold wins", d.winner === "b" && d.reason === "longer");
d = PB.decide(room(held(30000), held(30000))); check("same hold: tie", d.done && d.winner === null && d.reason === "tie");
d = PB.decide(room({ result: { forfeit: true, at: 1 } }, {})); check("forfeit loses", d.winner === "b" && d.reason === "forfeit");
d = PB.decide(room({}, { leftAt: 5 })); check("left after start loses", d.winner === "a");
d = PB.decide(room({ leftAt: 3 }, { result: { forfeit: true, at: 1 } })); check("both out: no winner", d.done && d.winner === null);
check("not decided before live", !PB.decide({ ...room(held(1), {}), status: "countdown" }).done);
check("validResult", PB.validResult({ holdMs: 5, verified: true, at: 1 }) && PB.validResult({ forfeit: true, at: 1 }) && !PB.validResult({ holdMs: -1, verified: true, at: 1 }) && !PB.validResult({ holdMs: 5, at: 1 }));
check("result text", /longest/.test(PB.resultText(room(held(3), {}), "b")) && /dropped first/.test(PB.resultText(room(held(3), {}), "a")));
const rules = fsx.readFileSync(__dirname + "/../firestore.rules", "utf8"), blk = rules.slice(rules.indexOf("match /battles/{code}"), rules.indexOf("match /tutBattles"));
check("rules: plank seat may write result (write-once, live only, holdMs/verified/at or forfeit)", blk.includes("'ready','seenAt','leftAt','result'") && blk.includes("!('result' in o) && d().status == 'live'") && blk.includes("['holdMs','verified','at']") && blk.includes("['forfeit','at']"));
check("plank-session readyMs unchanged (1500)", /readyMs:\s*1500/.test(fsx.readFileSync(__dirname + "/../plank-session.js", "utf8")));
const html = fsx.readFileSync(__dirname + "/../index.html", "utf8");
check("plank battle UI: I dropped + Forfeit, no 'coming next' placeholder", html.includes('id="battleDrop"') && html.includes('id="battleForfeit"') && !html.includes("Video and form check coming next") && html.includes('src="/plank-battle.js"'));
// flow
let T = 1e6; const docs = {}; const SERVER = { __ts: 1 };
const deep = (v) => (v === SERVER ? T : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
function apply(d, p) { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; o[ks[ks.length - 1]] = deep(v); } return d; }
let lock = Promise.resolve();
const fs = { tx: (c, fn) => (lock = lock.then(async () => { let next; const out = fn({ get: () => clone(docs[c]), set: (x) => (next = deep(x)), update: (p) => (next = apply(next || docs[c], p)) }); if (next) docs[c] = next; return out; })),
  update: async (c, p) => { docs[c] = apply(docs[c], p); }, watch: (c, cb) => { setTimeout(() => cb(clone(docs[c]))); return () => {}; }, ts: () => SERVER, del: () => ({}), toMs: (v) => (typeof v === "number" ? v : null) };
(async () => {
  const pa = B.controller(fs, { now: () => T }), pb = B.controller(fs, { now: () => T });
  const code = await pa.createRoom({ uid: "a", name: "A" }); await pb.joinRoom(code, { uid: "b", name: "B" });
  check("no drop before live", (await PB.submitDrop(fs, code, "a", T, true)) === false);
  await pa.setReady(code, { uid: "a" }, true); await pb.setReady(code, { uid: "b" }, true); T += 5100; await pa.markLive(code);
  T += 40000; check("A drops at ~40 s", await PB.submitDrop(fs, code, "a", T, true) && Math.abs(docs[code].players.a.result.holdMs - 40000) < 200);
  check("write-once", (await PB.submitDrop(fs, code, "a", T + 9999, true)) === false);
  check("B wins at once", PB.decide(docs[code]).winner === "b");
  T += 2000; await PB.submitDrop(fs, code, "b", T, false); check("B's final hold recorded (unverified flag kept)", docs[code].players.b.result.holdMs > docs[code].players.a.result.holdMs && docs[code].players.b.result.verified === false);
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
