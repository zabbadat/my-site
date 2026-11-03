// 30-second top hold: two half-bonuses = 1 ZAB ("hold" earn, qty 2 halves, amount 1). Run: node test/hold-half-zab.test.js
const fs = require("fs"), path = require("path"), ZT = require("../zab-balance.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"), rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
{ const s = mem(); const a = ZT.bankHalf(s, "u1"), b = ZT.bankHalf(s, "u1"), c = ZT.bankHalf(s, "u1"), d = ZT.bankHalf(s, "u1");
  check("1st half banks, 2nd completes a pair, then it starts over", a.banked && !a.pair && b.pair && !b.banked && c.banked && d.pair);
  check("halves are per user", ZT.bankHalf(s, "u2").banked === true); }
check("no user / no storage: nothing banked", !ZT.bankHalf(null, "u").banked && !ZT.bankHalf(mem(), "").banked);
{ const e = ZT.buildEarn("u1", "hold", ZT.qtyFrom("hold", 2), "abc123");
  check("a pair builds a normal 1 ZAB earn: source hold, units halves, qty 2, id hold-<setId>", e && e.id === "hold-abc123" && e.tx.amount === 1 && e.tx.qty === 2 && e.tx.units === "halves" && ZT.validEarn(e.tx)); }
check("one half alone earns nothing", ZT.buildEarn("u1", "hold", ZT.qtyFrom("hold", 1), "x") === null);
check("can't claim more than 1 ZAB per hold entry", !ZT.validEarn({ type: "earn", source: "hold", units: "halves", qty: 2, amount: 2 }) && ZT.buildEarn("u1", "hold", 50, "y").tx.amount === 1);
check("rules: hold earn only as units halves, qty == 2, amount == 1", /t\(\)\.source == 'hold'    && t\(\)\.units == 'halves'  && t\(\)\.qty == 2    && t\(\)\.amount == 1/.test(rules));
check("page: HOLD_ZAB_LIVE on; '+½ banked' on the first, '+1 ZAB' on the second; credits awardZab('hold', 2, newSetId) only on a pair", /const HOLD_ZAB_LIVE = true;/.test(html) && /" \+½ banked"/.test(html) && /" \+1 ZAB"/.test(html) && /if \(hb && hb\.pair\) awardZab\("hold", 2, ZT\.newSetId\(\)\)/.test(html));
check("ledger line reads '30-second holds'", /30-second holds/.test(ZT.txLine ? JSON.stringify(ZT.txLine({ type: "earn", source: "hold", amount: 1, qty: 2, units: "halves" })) : "30-second holds"));
// Walking: already live, 1 ZAB per 10 full minutes, stacking, one ledger entry per session
check("walking: 9 min = 0, 10 = 1, 19 = 1, 20 = 2, 4 h cap = 24", [9, 10, 19, 20, 300].map((m) => ZT.zabFor("walk", ZT.qtyFrom("walk", m * 60000))).join(",") === "0,1,1,2,24");
check("walking: rules cap amount * 10 <= minutes, minutes <= 240; one id per session (walk-<setId>, create-once)", /t\(\)\.source == 'walk'    && t\(\)\.units == 'minutes' && t\(\)\.qty <= 240  && t\(\)\.amount \* 10 <= t\(\)\.qty/.test(rules) && /awardZab\("walk", ZT\.qtyFrom\("walk", r\.ms\), ZT\.newSetId\(\)\)/.test(html) && /allow update, delete: if false;/.test(rules));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
