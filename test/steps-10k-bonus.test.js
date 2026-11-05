// 10K steps a day bonus: 4 ZAB once per user per local day, stacked on the walk earn. Run: node test/steps-10k-bonus.test.js
const fs = require("fs"), path = require("path"), Z = require("../zab-balance.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
function fakeFs() {
  const db = {};
  return { db, ts: () => "TS", tx: async (fn) => { const w = []; const t = { get: async (p) => (db[p.join("/")] ? { ...db[p.join("/")] } : null), set: (p, d) => w.push([p.join("/"), d]), update: (p, d) => w.push([p.join("/"), { ...db[p.join("/")], ...d }]) }; const r = await fn(t); for (const [k, d] of w) db[k] = d; return r; } };
}
(async () => {
  check("below 10,000 steps pays nothing", Z.tenKEarn("u", 9999, "2026-11-03") === null && Z.tenKEarn("u", 0, "2026-11-03") === null);
  const e = Z.tenKEarn("u", 10000, "2026-11-03");
  check("crossing 10,000 builds a 4 ZAB earn", e && e.tx.amount === 4 && e.tx.qty === 10000 && e.tx.units === "steps" && e.tx.source === "steps10k" && Z.validEarn(e.tx));
  check("ledger id is one per day: steps10k-YYYY-MM-DD", e && e.id === "steps10k-2026-11-03");
  check("25,000 steps still 4 ZAB (bonus, not per 10K)", Z.tenKEarn("u", 25000, "2026-11-03").tx.amount === 4);
  check("bad day key rejected", Z.tenKEarn("u", 12000, "today") === null && Z.tenKEarn("u", 12000, "") === null);
  check("inflated bonus rejected", !Z.validEarn({ ...e.tx, amount: 8 }));
  const f = fakeFs();
  const a = await Z.award(f, Z.tenKEarn("u", 10012, "2026-11-03"));
  const b = await Z.award(f, Z.tenKEarn("u", 14000, "2026-11-03"));
  check("pays 4 once", a.credited === 4 && a.balance === 4);
  check("not twice the same day", b.credited === 0 && b.skipped === "duplicate" && f.db["users/u"].zabBalance === 4);
  const c = await Z.award(f, Z.tenKEarn("u", 10000, "2026-11-04"));
  check("pays again the next day", c.credited === 4 && f.db["users/u"].zabBalance === 8);
  await Z.award(f, Z.buildEarn("u", "walk", 90, "w1"));
  check("stacks on the walk earn (90 min = 9 ZAB unchanged, total 17)", f.db["users/u"].zabBalance === 17);
  const o = await Z.award(f, Z.tenKEarn("other", 10000, "2026-11-03"));
  check("per user: another user same day still paid", o.credited === 4);
  // rules text: earning moved to the server, so browsers can no longer write a steps10k ledger entry.
  const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  check("rules: no client steps10k ledger clause (balances and ledger are server-only)", !/t\(\)\.source == 'steps10k'/.test(rules) && /u\(\)\.zabBalance == 0 && u\(\)\.lastTxId == ''/.test(rules));
  check("rules: ledger writes are server-only", /match \/zabLedger\/\{txId\}[\s\S]*?allow create, update, delete: if false;/.test(rules));
  // page
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("page: daily onChange triggers the bonus at 10,000", /if \(s\.steps >= 10000\) tenKBonus\(s\);/.test(html));
  check("page: cue uses the shared queued voice (plankSpeak, rate 0.88)", /G\.plankSpeak\(TEN_K_LINE\)/.test(html) && require("../get-set.js").VOICE.rate === 0.88);
  check("page: approved copy present", html.includes("Ten thousand steps. Breathe, stride, collect.") && html.includes("Hit 10K in a day and stack a 4 <span class=\"zab\">ZAB<svg"));
  check("page: no 4 hour cap copy left", !/4 hour cap/.test(html));
  const fails = R.filter((x) => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);
})();
