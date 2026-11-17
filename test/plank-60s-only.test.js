// Regular plank: exactly one ZAB at a continuous 60 s hold, once per set. Time past 60 s does not earn more.
// The 30-second plank push press hold bonus (source "hold", 0.5 ZAB) is unchanged.
// Run: node test/plank-60s-only.test.js
const fsx = require("fs"), path = require("path");
const E = require("../zab-earn.js"), Z = require("../zab-balance.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const read = (f) => fsx.readFileSync(path.join(__dirname, "..", f), "utf8");
function fakeFs(T) {
  const db = {};
  return { db, ts: () => T, toMs: (v) => (typeof v === "number" ? v : null),
    tx: async (fn) => { const w = []; const t = { get: async (p) => (db[p.join("/")] ? JSON.parse(JSON.stringify(db[p.join("/")])) : null),
      set: (p, d) => w.push([p.join("/"), d, false]), update: (p, d) => w.push([p.join("/"), d, true]) };
      const out = await fn(t); w.forEach(([k, d, u]) => { db[k] = u ? Object.assign({}, db[k], d) : d; }); return out; } };
}
const NOW = Date.parse("2026-11-14T15:00:00Z"), SINCE = NOW - 3600000;
const st = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, status: e.status, msg: e.message }));
const plankDoc = (id, holdSec) => ({ uid: "u1", holdSec, source: "camera", createdAt: NOW - 1000 });

(async () => {
  check("rate: 60 s still pays 1 ZAB (the existing one-minute amount)", Z.zabFor("plank", 60) === 1 && Z.RATES.plank.per === 60 && Z.RATES.plank.max === 60 && (Z.RATES.plank.zab == null || Z.RATES.plank.zab === 1));
  check("59 s = 0", Z.zabFor("plank", Z.qtyFrom("plank", 59000)) === 0 && Z.buildEarn("u1", "plank", 59, "s59") === null);
  check("60 s = 1", Z.zabFor("plank", Z.qtyFrom("plank", 60000)) === 1 && Z.buildEarn("u1", "plank", 60, "s60").tx.amount === 1);
  check("5 min = still 1", Z.zabFor("plank", Z.qtyFrom("plank", 300000)) === 1 && Z.buildEarn("u1", "plank", 300, "s5").tx.amount === 1 && Z.buildEarn("u1", "plank", 300, "s5").tx.qty === 60);
  check("measure: 59 s pays nothing, 60 s and 5 min pay 1 ZAB with qty 60",
    E.measure("plank", plankDoc("a", 59), "u1", NOW).amount === 0
    && E.measure("plank", plankDoc("b", 60), "u1", NOW).amount === 1 && E.measure("plank", plankDoc("b", 60), "u1", NOW).qty === 60
    && E.measure("plank", plankDoc("c", 300), "u1", NOW).amount === 1 && E.measure("plank", plankDoc("c", 300), "u1", NOW).qty === 60);

  const f = fakeFs(NOW);
  f.db["users/u1"] = { uid: "u1", zabBalance: 0, lastTxId: "" };
  f.db["planks/under"] = plankDoc("under", 59);
  f.db["planks/exact"] = plankDoc("exact", 60);
  f.db["planks/long"] = plankDoc("long", 300);
  let r = await st(E.claim(f, "u1", { source: "plank", id: "under" }, NOW, SINCE));
  check("claim 59 s credits 0 and writes no ledger earn", r.ok && r.r.credited === 0 && !f.db["users/u1/zabLedger/plank-plunder"] && f.db["users/u1"].zabBalance === 0);
  r = await st(E.claim(f, "u1", { source: "plank", id: "exact" }, NOW, SINCE));
  const tx = f.db["users/u1/zabLedger/plank-plexact"];
  check("claim 60 s awards 1 ZAB once, ledger source plank / 1 minute / +1",
    r.ok && r.r.credited === 1 && tx && tx.source === "plank" && tx.amount === 1 && tx.qty === 60 && tx.units === "seconds" && tx.type === "earn" && tx.setId === "exact");
  const line = Z.txLine(tx);
  check("ledger display label is Plank, unit line is 1 minute, amount +1", line.source === "Plank" && line.qty === "1 minute" && line.amount === "+1");
  r = await st(E.claim(f, "u1", { source: "plank", id: "exact" }, NOW, SINCE));
  check("no double award on resume / second claim of the same set (409)", !r.ok && r.status === 409 && f.db["users/u1"].zabBalance === 1);
  r = await st(E.claim(f, "u1", { source: "plank", id: "long" }, NOW, SINCE));
  check("claim 5 min still awards only 1 ZAB", r.ok && r.r.credited === 1 && f.db["users/u1/zabLedger/plank-pllong"].amount === 1 && f.db["users/u1/zabLedger/plank-pllong"].qty === 60 && f.db["users/u1"].zabBalance === 2);
  r = await st(E.claim(f, "u1", { source: "plank", id: "long" }, NOW, SINCE));
  check("5 min set is also idempotent on retry", !r.ok && r.status === 409 && f.db["users/u1"].zabBalance === 2);

  // 30-second plank push press hold bonus stays 0.5 ZAB, unchanged
  check("hold bonus rate unchanged: 0.5 ZAB per 30-second hold", Z.zabFor("hold", 1) === 0.5 && Z.RATES.hold.zab === 0.5 && Z.RATES.hold.max === 1);
  const h = fakeFs(NOW);
  h.db["users/u1"] = { uid: "u1", zabBalance: 0, lastTxId: "" };
  h.db["pushups/p1"] = { uid: "u1", reps: 12, ms: 60000, holds: 1, createdAt: NOW - 1000 };
  r = await st(E.claim(h, "u1", { source: "hold", id: "p1" }, NOW, SINCE));
  check("hold claim still pays 0.5 ZAB", r.ok && r.r.credited === 0.5 && h.db["users/u1/zabLedger/hold-pup1"].source === "hold" && h.db["users/u1/zabLedger/hold-pup1"].amount === 0.5);

  const html = read("index.html"), src = [read("zab-balance.js"), read("zab-earn.js"), html, read("zab.html"), read("plank.html"), read("get-set.js")].join("\n");
  check("spoken line is 'One minute plank. Plus one ZAB.' and goes through plankSpeak once",
    /const PLANK_ZAB_LINE = "One minute plank\. Plus one ZAB\."/.test(html)
    && /GS\.plankSpeak\) GS\.plankSpeak\(PLANK_ZAB_LINE\)/.test(html)
    && /function speakPlankZabOnce\(\)/.test(html)
    && /if \(plankZabSpoken\) return/.test(html)
    && /!plankSaved && r\.ms >= 60000 && currentUser\) speakPlankZabOnce\(\)/.test(html)
    && /tk && tk\.credited > 0\) speakPlankZabOnce\(\)/.test(html)
    && /plankSaved = false; plankZabSpoken = false/.test(html));
  check("rate copy says once per set, amount still 1 ZAB",
    Z.rateLines()[1] === "1 ZAB for a 60-second plank"
    && /1 minute of plank = 1[\s\S]*once per set/.test(read("zab.html")));
  // No 30 s regular-plank bonus anywhere (the hold / plank-push-press 30 s line is the existing, unchanged bonus).
  const forbidden = /plankHold['"]\s*,|source:\s*["']plankHold["']|["']30-second plank["'](?! push press)/;
  check("no 30-second regular-plank bonus source, label, or spoken line", !forbidden.test(src) && !/regular plank[\s\S]{0,80}30-second/i.test(src));
  check("30-second hold spoken lines stay on the plank push press / top-hold path only",
    /function holdAwardSpoken\(live\)/.test(html) && /30-second hold! Plus half a ZAB/.test(html) && /30-second plank push press! Plus half a ZAB/.test(html));

  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
