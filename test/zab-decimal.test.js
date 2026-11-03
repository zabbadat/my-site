// ZAB in tenths (one decimal place): helpers, earns (0.5 hold), float accumulation, sends, wagers from decimal balances,
// pot splits, rules text + a JS mirror of the rules' zabOk/tenths checks against abuse values. Run: node test/zab-decimal.test.js
const fsx = require("fs"), path = require("path");
const ZC = require("../zab-currency.js"), Z = require("../zab-balance.js"), X = require("../zab-transfer.js"), W = require("../zaba-wager.js"), POT = require("../washers-pot.js");
const rules = fsx.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8"), html = fsx.readFileSync(path.join(__dirname, "../index.html"), "utf8"), bank = fsx.readFileSync(path.join(__dirname, "../bank.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
// ---- helpers
check("roundZab kills float noise: 0.1 + 0.2 = 0.3, 12.3 - 3 = 9.3, -0 -> 0, NaN -> 0", ZC.roundZab(0.1 + 0.2) === 0.3 && ZC.roundZab(12.3 - 3) === 9.3 && Object.is(ZC.roundZab(-0), 0) && ZC.roundZab(NaN) === 0);
check("isZab accepts tenths: 0, 0.1, 0.5, 12.5, 1e6", [0, 0.1, 0.5, 12.5, 1e6, 0.1 + 0.2].every(ZC.isZab));
check("isZab rejects abuse: 0.0001, 1e-9, 0.05, -0.1, -1, NaN, Infinity, '1', null", [0.0001, 1e-9, 0.05, -0.1, -1, NaN, Infinity, "1", null, undefined].every((v) => !ZC.isZab(v)));
check("display: 12.5 -> '12.5', 12 -> '12' (never '12.0'), 1234.5 -> '1,234.5', 0.30000000000000004 -> '0.3'", ZC.fmtZab(12.5) === "12.5" && ZC.fmtZab(12) === "12" && ZC.fmtZab(1234.5) === "1,234.5" && ZC.fmtZab(0.1 + 0.2) === "0.3");
check("amountText / amountHtml use the same format", ZC.amountText(12.5) === "12.5 ZAB" && ZC.amountText(12) === "12 ZAB" && /12\.5 ZAB/.test(ZC.amountHtml(12.5)));
// ---- earns
{ const e = Z.buildEarn("u1", "hold", Z.qtyFrom("hold", 1), "abc123");
  check("30-second hold earns 0.5 ZAB: source hold, units holds, qty 1, id hold-<setId>", e && e.id === "hold-abc123" && e.tx.amount === 0.5 && e.tx.qty === 1 && e.tx.units === "holds" && Z.validEarn(e.tx)); }
check("hold: can't claim more than 0.5 per entry or a fraction of a tenth", !Z.validEarn({ type: "earn", source: "hold", units: "holds", qty: 1, amount: 1 }) && !Z.validEarn({ type: "earn", source: "hold", units: "holds", qty: 1, amount: 0.50001 }) && !Z.validEarn({ type: "earn", source: "hold", units: "holds", qty: 1, amount: NaN }));
check("other earns unchanged: 25 reps = 2, 125 s plank = 2, walk 20 min = 2", Z.buildEarn("u", "pushups", 25, "a").tx.amount === 2 && Z.buildEarn("u", "plank", 125, "b").tx.amount === 2 && Z.buildEarn("u", "walk", 20, "c").tx.amount === 2);
check("profile reads tenths, rejects bad stored values as 0", Z.profileFrom({ zabBalance: 12.5 }, "u").zabBalance === 12.5 && Z.profileFrom({ zabBalance: 0.0001 }, "u").zabBalance === 0 && Z.profileFrom({ zabBalance: -3 }, "u").zabBalance === 0);
check("ledger line shows +0.5 and '1 30-second hold'", (() => { const l = Z.txLine({ type: "earn", source: "hold", amount: 0.5, qty: 1, units: "holds" }); return l.amount === "+0.5" && /30-second hold/.test(l.qty); })());
check("board entry / top line / holders keep tenths", Z.boardEntry("u", "A", 12.5).total === 12.5 && /12\.5 ZAB/.test(Z.topLine({ name: "A", total: 12.5 })) && Z.holdersView([{ uid: "a", name: "A", total: 2.5 }, { uid: "b", name: "B", total: 2.4 }])[0].total === 2.5);
// ---- mock admin store
let T = 1e9; const db = {}; const SV = { __ts: 1 };
const P = (p) => p.join("/"), clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
const deep = (v) => (v === SV ? T : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
function apply(d, p) { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; o[ks[ks.length - 1]] = deep(v); } return d; }
let lock = Promise.resolve();
const fs = { tx: (fn) => { const run = lock.then(async () => { const w = []; const out = await fn({ get: async (p) => clone(db[P(p)]),
  set: (p, d) => w.push(() => (db[P(p)] = deep(d))), update: (p, x) => w.push(() => { if (!db[P(p)]) throw new Error("update missing " + P(p)); db[P(p)] = apply(db[P(p)], x); }) }); w.forEach((f) => f()); return out; }); lock = run.catch(() => {}); return run; },
  ts: () => SV, toMs: (v) => (typeof v === "number" ? v : null) };
const user = (u, n, name) => { db["users/" + u] = { uid: u, zabBalance: n, lastTxId: "", createdAt: 0, updatedAt: 0 }; if (name) db["zabBoard/" + u] = { uid: u, name, total: n, updatedAt: 0 }; };
const bal = (u) => db["users/" + u].zabBalance;
const caught = async (p) => { try { await p; return null; } catch (e) { return e; } };
let k = 0; const key = () => "deckey" + String(++k).padStart(4, "0");
(async () => {
  // float accumulation: 30 holds of 0.5 and 30 sends of 0.1 stay exact
  user("h", 0);
  for (let i = 0; i < 30; i++) await Z.award(fs, Z.buildEarn("h", "hold", 1, "s" + i));
  check(`30 hold bonuses = exactly 15 ZAB (got ${bal("h")})`, bal("h") === 15);
  user("a", 3, "A"); user("b", 0, "B");
  for (let i = 0; i < 30; i++) await X.send(fs, "a", { to: "b", amount: 0.1, key: key() }, T + i * 86400000); // 20 sends/day cap: spread over days
  check(`0.1 sent 30 times: sender exactly 0, receiver exactly 3, boards equal (got ${bal("a")}/${bal("b")})`, bal("a") === 0 && bal("b") === 3 && db["zabBoard/a"].total === 0 && db["zabBoard/b"].total === 3);
  user("c", 12.5, "C"); user("d", 0.2, "D");
  let r = await X.send(fs, "c", { to: "d", amount: 12.3, key: key() }, T);
  check(`decimal send 12.3 from 12.5: sender 0.2, receiver 12.5, ledger -12.3 / +12.3`, r.ok && bal("c") === 0.2 && bal("d") === 12.5 && Object.values(db).some((x) => x.type === "send" && x.amount === -12.3));
  let e = await caught(X.send(fs, "c", { to: "d", amount: 0.3, key: key() }, T)); check("no overdraft on tenths (0.3 from 0.2): 402", e && e.status === 402 && bal("c") === 0.2);
  for (const a of [0, 0.05, 0.0001, 1e-9, -0, -0.1, NaN, Infinity, "0.5"]) { e = await caught(X.send(fs, "c", { to: "d", amount: a, key: key() }, T)); if (!(e && e.status === 400)) check("send abuse value accepted: " + a, false); }
  check("send rejects 0, 0.05, 0.0001, 1e-9, -0, -0.1, NaN, Infinity, strings; min send 0.1", X.MIN_SEND === 0.1);
  const kk = key(); r = await X.send(fs, "d", { to: "c", amount: 0.7, key: kk }, T); const r2 = await X.send(fs, "d", { to: "c", amount: 0.7, key: kk }, T);
  check("decimal send retried with same key: idempotent", r.ok && r2.already && bal("d") === 11.8 && bal("c") === 0.9);
  // wagers: stakes stay whole ZAB, balances may be tenths
  check("stakes stay whole ZAB (min 1): 1.5 and 0.5 rejected", !W.validStake(1.5) && !W.validStake(0.5) && W.validStake(1));
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const code = "DECK", createdAt = T - 5;
  db[W.COL.tut + "/" + code] = { code, status: "waiting", createdAt, startAt: null, stake: 3, players: { p: { name: "P", ready: false, joinedAt: T }, q: { name: "Q", ready: false, joinedAt: T + 1 } } };
  user("p", 3.7); user("q", 2.9);
  r = await W.stake(fs, "p", "tut", code);
  check(`stake 3 from a 3.7 balance leaves exactly 0.7 (got ${bal("p")})`, r.ok && bal("p") === 0.7 && r.balance === 0.7);
  e = await caught(W.stake(fs, "q", "tut", code)); check("2.9 can't cover a stake of 3 (402), nothing debited", e && e.status === 402 && bal("q") === 2.9);
  // pot splits: pots are whole ZAB (whole stakes); odd unit to the winning team's lowest seat; decimal pots refused
  check("pot split: 5 between 2 -> [3, 2] (odd ZAB to the first/lowest seat); decimal pot refused", JSON.stringify(POT.split(5, 2)) === "[3,2]" && POT.split(2.5, 2).length === 0);
  // ---- rules (text + a JS mirror of zabOk / tenths)
  const zabOk = (x) => typeof x === "number" && x >= 0 && Math.abs(x * 10 - Math.round(x * 10)) < 0.000001 && (x == 0 || Math.round(x * 10) >= 1), tenths = (x) => Math.round(x * 10);
  check("rules: zabOk = number >= 0 and a whole number of tenths; tenths() compares sums exactly", /function zabOk\(x\) \{ return x is number && x >= 0 && math\.abs\(x \* 10 - math\.round\(x \* 10\)\) < 0\.000001 && \(x == 0 \|\| math\.round\(x \* 10\) >= 1\); \}/.test(rules) && /function tenths\(x\) \{ return math\.round\(x \* 10\); \}/.test(rules));
  check("rules mirror: abuse values rejected (0.0001, 1e-9, 0.05, -0.1, NaN, Infinity), tenths accepted, -0 is just 0", [0.0001, 1e-9, 0.05, -0.1, NaN, Infinity].every((v) => !zabOk(v)) && [0, -0, 0.1, 0.5, 12.5].every(zabOk));
  check("rules mirror: 0.1 x 30 then 0.2 + 0.1 compare equal in tenths", tenths(0.1 + 0.2) === tenths(0.3) && tenths([...Array(30)].reduce((s) => s + 0.1, 0)) === 30);
  check("rules: browsers can only create an empty profile (balance 0); balance changes are server-only (zab-earn, zab-send, wagers)", /u\(\)\.zabBalance == 0 && u\(\)\.lastTxId == ''/.test(rules) && !/zabBalance is int/.test(rules));
  check("server earn amounts are tenths: 0.5 per 30-second hold, whole ZAB for the rate sources", Z.zabFor("pushups", 25) === 2 && Z.zabFor("hold", 1) === 0.5);
  check("rules: ledger server-only; tenths helpers kept for stakes and wagers", /match \/zabLedger\/\{txId\} \{[^}]*allow create, update, delete: if false;/.test(rules) && /function tenths\(x\)/.test(rules));
  check("rules: stakes / wagers stay whole numbers (is int)", (rules.match(/stake is int/g) || []).length >= 3 && /p\.wager is int/.test(rules));
  // ---- page wiring
  check("page: each 30-second hold counts toward the set (+0.5 ZAB cue), credited by the server with the set; no halves counter", /if \(live\) pushHoldsThisSet \+= 1;/.test(html) && /" \+0\.5 ZAB"/.test(html) && /awardZab\("hold", id\)/.test(html) && !/bankHalf|½ banked/.test(html) && !Z.bankHalf);
  check("bank: send box takes 0.1 steps, validates tenths, formats with fmtZab", /step="0\.1"/.test(bank) && /ZC\.isZab\(Number\(\$\("sendAmt"\)\.value\)\)/.test(bank) && /ZC\.fmtZab\(mine\)/.test(bank));
  check("walking unchanged: 1 ZAB per 10 full minutes, stacking", [9, 10, 19, 20].map((m) => Z.zabFor("walk", m)).join(",") === "0,1,1,2");
  const fails = R.filter((x) => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);
})();
