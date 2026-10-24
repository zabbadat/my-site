// Tests for zab-balance.js. Run: node test/zab-balance.test.js
const Z = require("../zab-balance.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
// rates + floor
check("9 reps = 0", Z.zabFor("pushups", 9) === 0);
check("10 reps = 1", Z.zabFor("pushups", 10) === 1);
check("39 reps = 3", Z.zabFor("pushups", 39) === 3);
check("plank 59 s = 0", Z.zabFor("plank", Z.qtyFrom("plank", 59999)) === 0);
check("plank 60 s = 1", Z.zabFor("plank", Z.qtyFrom("plank", 60000)) === 1);
check("plank 2m59 = 2", Z.zabFor("plank", Z.qtyFrom("plank", 179000)) === 2);
check("walk 9m59 = 0", Z.zabFor("walk", Z.qtyFrom("walk", 599999)) === 0);
check("walk 10 min = 1", Z.zabFor("walk", Z.qtyFrom("walk", 600000)) === 1);
check("walk 4h cap = 24", Z.zabFor("walk", Z.qtyFrom("walk", 14400000)) === 24);
check("tut 61 s = 1", Z.zabFor("tut", Z.qtyFrom("tut", 61000)) === 1);
check("unknown source = 0", Z.zabFor("bogus", 1000) === 0 && Z.zabFor("washers", 1000) === 1);
check("negative = 0", Z.zabFor("pushups", -50) === 0);
check("over max clamps", Z.zabFor("pushups", 99999) === 500);
// buildEarn
const e = Z.buildEarn("u1", "pushups", 25, "abc");
check("earn shape", e && e.id === "pushups-abc" && e.tx.amount === 2 && e.tx.units === "reps" && e.tx.qty === 25 && e.tx.type === "earn");
check("no earn under rate", Z.buildEarn("u1", "pushups", 5, "x") === null);
check("no earn without uid/id", Z.buildEarn("", "plank", 600, "x") === null && Z.buildEarn("u", "plank", 600, "") === null);
check("id sanitized", Z.buildEarn("u", "plank", 60, "a/b..c").id === "plank-abc");
check("validEarn ok", Z.validEarn(e.tx));
check("validEarn rejects inflated amount", !Z.validEarn({ ...e.tx, amount: 3 }));
check("validEarn rejects wrong units", !Z.validEarn({ ...e.tx, units: "seconds" }));
check("validEarn rejects spend", !Z.validEarn({ ...e.tx, type: "spend" }));
check("profileFrom default 0", Z.profileFrom(null, "u").zabBalance === 0 && Z.profileFrom({ zabBalance: -4 }, "u").zabBalance === 0);
// fake Firestore transaction adapter
function fakeFs() {
  const db = {}; let fail = false;
  return { db, setFail: (v) => { fail = v; }, ts: () => "TS",
    tx: async (fn) => { if (fail) throw new Error("offline"); const w = []; const t = { get: async (p) => (db[p.join("/")] ? { ...db[p.join("/")] } : null), set: (p, d) => w.push([p.join("/"), d]), update: (p, d) => w.push([p.join("/"), { ...db[p.join("/")], ...d }]) }; const r = await fn(t); for (const [k, d] of w) db[k] = d; return r; } };
}
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
(async () => {
  const fs = fakeFs();
  const p = await Z.ensureProfile(fs, "u1");
  check("new profile created at 0", p.created && fs.db["users/u1"].zabBalance === 0);
  fs.db["users/u1"].zabBalance = 7;
  check("existing profile loaded", (await Z.ensureProfile(fs, "u1")).zabBalance === 7);
  const r1 = await Z.award(fs, Z.buildEarn("u1", "plank", 125, "s1"));
  check("award credits", r1.credited === 2 && fs.db["users/u1"].zabBalance === 9 && fs.db["users/u1"].lastTxId === "plank-s1");
  check("log written", fs.db["users/u1/zabLedger/plank-s1"].amount === 2 && fs.db["users/u1/zabLedger/plank-s1"].source === "plank");
  const r2 = await Z.award(fs, Z.buildEarn("u1", "plank", 125, "s1"));
  check("retry is idempotent", r2.credited === 0 && r2.skipped === "duplicate" && fs.db["users/u1"].zabBalance === 9);
  const sum = Object.keys(fs.db).filter((k) => k.startsWith("users/u1/zabLedger/")).reduce((a, k) => a + fs.db[k].amount, 0);
  check("balance = 7 seed + log sum", fs.db["users/u1"].zabBalance === 7 + sum);
  const fs2 = fakeFs(); await Z.award(fs2, Z.buildEarn("u2", "walk", 30, "w1"));
  check("award without profile creates it", fs2.db["users/u2"].zabBalance === 3);
  check("invalid award no-op", (await Z.award(fs2, { id: "x", tx: { uid: "u2", type: "earn", source: "walk", amount: 99, units: "minutes", qty: 30 } })).credited === 0 && fs2.db["users/u2"].zabBalance === 3);
  // offline queue + flush
  const st = mem(); fs2.setFail(true);
  let threw = false; try { await Z.earnAndQueue(fs2, st, Z.buildEarn("u2", "tut", 120, "t1")); } catch (e) { threw = true; }
  check("offline award queued", threw && Z.readQ(st).length === 1);
  fs2.setFail(false); await Z.flush(fs2, st, "u2"); await Z.flush(fs2, st, "u2");
  check("flush credits once and clears", fs2.db["users/u2"].zabBalance === 5 && Z.readQ(st).length === 0);
  check("newSetId unique", Z.newSetId() !== Z.newSetId());
  const failed = R.filter((x) => !x).length;
  console.log(`\n${R.length - failed}/${R.length} passed`);
  process.exit(failed ? 1 : 0);
})();
