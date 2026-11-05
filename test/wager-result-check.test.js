// Server result checks before a pot is paid + the same-pair flag (zaba-wager.js resultCheck / settle). Run: node test/wager-result-check.test.js
const W = require("../zaba-wager.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const T = Date.parse("2026-11-03T15:00:00Z");
function fakeFs() {
  const db = {};
  return { db, ts: () => T, toMs: (v) => (typeof v === "number" ? v : null),
    tx: async (fn) => { const w = []; const t = { get: async (p) => (db[p.join("/")] ? JSON.parse(JSON.stringify(db[p.join("/")])) : null),
      set: (p, d) => w.push([p.join("/"), d, 0]), update: (p, d) => w.push([p.join("/"), d, 1]) };
      const out = await fn(t); w.forEach(([k, d, u]) => { if (!u) db[k] = d; else { db[k] = JSON.parse(JSON.stringify(db[k] || {})); Object.entries(d).forEach(([kk, v]) => { db[k][kk] = v; }); } }); return out; } };
}
let n = 0;
function tutGame(f, a, b, extra) {
  const code = "C" + "DEFGH"[n % 5] + "J" + "KLMNP"[Math.floor(n / 5) % 5]; n++;
  const created = T - 400000 - n, key = "tut_" + code + "_" + created;
  f.db["tutBattles/" + code] = Object.assign({ code, status: "done", startAt: T - 240000, createdAt: created, winnerUid: "a", loserUid: "b", loseReason: "knees", players: { a, b } }, extra || {});
  f.db["wagers/" + key] = { key, game: "tut", code, roomCreatedAt: created, stake: 5, players: { a: { amount: 5 }, b: { amount: 5 } }, status: "open" };
  return key;
}
(async () => {
  // pure checks
  check("TUT: plausible result passes", W.resultCheck("tut", { startAt: T - 200000, status: "done", winnerUid: "a", loserUid: "b", players: { a: { tutMs: 150000, reps: 60 }, b: { tutMs: 90000, reps: 30 } } }, T) === null);
  check("TUT: more TUT than the battle allows -> refused", /TUT longer/.test(W.resultCheck("tut", { startAt: T - 200000, players: { a: { tutMs: 250000 }, b: {} } }, T)));
  check("TUT: TUT longer than time since start -> refused", /TUT longer/.test(W.resultCheck("tut", { startAt: T - 30000, players: { a: { tutMs: 90000 }, b: {} } }, T)));
  check("TUT: impossible rep rate -> refused", /reps/.test(W.resultCheck("tut", { startAt: T - 200000, players: { a: { tutMs: 10000, reps: 200 }, b: {} } }, T)));
  check("TUT: winner/loser must be the two seated players", /seated/.test(W.resultCheck("tut", { startAt: T - 200000, status: "done", winnerUid: "x", loserUid: "b", players: { a: {}, b: {} } }, T)));
  check("Plank: hold longer than the battle -> refused", /hold longer/.test(W.resultCheck("plank", { startAt: T - 20000, players: { a: { result: { holdMs: 60000, at: T } }, b: {} } }, T)));
  check("Plank: hold reported before it could have ended -> refused", /outside/.test(W.resultCheck("plank", { startAt: T - 100000, players: { a: { result: { holdMs: 60000, at: T - 90000 } }, b: {} } }, T)));
  check("Plank: forfeit results are not checked", W.resultCheck("plank", { startAt: T - 1000, players: { a: { result: { forfeit: true } }, b: {} } }, T) === null);
  check("Washers / arena: a win under 60 s refused, a forfeit allowed, 2 min fine", /faster/.test(W.resultCheck("washers", { startAt: T - 30000, players: {} }, T, null, "21")) && W.resultCheck("arena", { startAt: T - 30000, seats: {} }, T, null, "forfeit") === null && W.resultCheck("washers", { startAt: T - 120000, players: {} }, T, null, "21") === null);
  check("no start time -> refused", /no start/.test(W.resultCheck("tut", { players: {} }, T)));
  // settle: implausible win refunds both, flagged, no payout
  const f = fakeFs(); f.db["users/a"] = { zabBalance: 10 }; f.db["users/b"] = { zabBalance: 10 };
  let key = tutGame(f, { tutMs: 250000, reps: 10 }, { tutMs: 1000, reps: 1 });
  let out = await W.settle(f, key, T);
  check("settle: implausible TUT win -> refunded to both, flag 'implausible', reason kept on the wager, no payout ledger",
    out.status === "refunded" && out.flag === "implausible" && f.db["wagers/" + key].detail && f.db["users/a"].zabBalance === 15 && f.db["users/b"].zabBalance === 15 && !f.db["users/a/zabLedger/payout-" + key]);
  check("result line explains it", /flagged/.test(W.outcomeText(f.db["wagers/" + key], "a")));
  key = tutGame(f, { tutMs: 150000, reps: 60 }, { tutMs: 90000, reps: 30 });
  out = await W.settle(f, key, T);
  check("settle: plausible win still pays the pot as before", out.status === "paid" && out.winner === "a" && f.db["users/a"].zabBalance === 25 && !out.flag);
  // same-pair flag
  let flagged = [];
  for (let i = 0; i < W.PAIR_FLAG; i++) { key = tutGame(f, { tutMs: 150000, reps: 60 }, { tutMs: 90000, reps: 30 }); out = await W.settle(f, key, T); flagged.push(out.flag || ""); }
  const pair = f.db["wagerPairs/a_b"];
  check("same pair settled " + W.PAIR_FLAG + "+ times a day: later wagers flagged 'repeat-pair' (still paid)", pair.count === W.PAIR_FLAG + 2 && flagged.filter((x) => x === "repeat-pair").length >= 3 && out.status === "paid");
  check("pair counter resets on a new UTC day", await (async () => { const k = tutGame(f, { tutMs: 150000, reps: 60 }, { tutMs: 90000, reps: 30 }); f.db["tutBattles/" + f.db["wagers/" + k].code].startAt = T + 86400000 - 240000; const o = await W.settle(f, k, T + 86400000); return !o.flag && f.db["wagerPairs/a_b"].count === 1; })());
  check("unplayed wagers (never started / expired) are not counted", await (async () => { const k = tutGame(f, {}, {}, { status: "abandoned" }); const before = f.db["wagerPairs/a_b"].count; await W.settle(f, k, T + 86400000); return f.db["wagerPairs/a_b"].count === before; })());
  check("MAX_STAKE unchanged (owner decision: no cap)", W.MAX_STAKE === null);
  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
