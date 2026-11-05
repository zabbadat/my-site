// Server-checked earning (zab-earn.js + netlify/functions/zab-earn.js + rules + page wiring). Run: node test/zab-earn.test.js
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
const NOW = Date.parse("2026-11-03T15:00:00Z"), SINCE = NOW - 3600000;
const st = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, status: e.status, msg: e.message }));
(async () => {
  const f = fakeFs(NOW);
  f.db["pushups/p1"] = { uid: "u1", reps: 45, ms: 60000, tutMs: 60000, holds: 1, createdAt: NOW - 1000 };
  f.db["pushups/fast"] = { uid: "u1", reps: 500, ms: 60000, createdAt: NOW - 1000 };
  f.db["pushups/old"] = { uid: "u1", reps: 50, ms: 60000, createdAt: SINCE - 1 };
  f.db["pushups/other"] = { uid: "u2", reps: 50, ms: 60000, createdAt: NOW - 1000 };
  f.db["planks/k1"] = { uid: "u1", holdSec: 185, source: "camera", createdAt: NOW - 1000 };
  f.db["walkSessions/w1"] = { uid: "u1", ms: 1800000, steps: 3000, createdAt: NOW - 1000 };
  f.db["walkSessions/w2"] = { uid: "u1", ms: 1800000, steps: 10, createdAt: NOW - 1000 };
  f.db["walkSessions/w5"] = { uid: "u1", ms: 300000, steps: 150, createdAt: NOW - 1000 };
  f.db["games/g1"] = { uid: "u1", score: 21, verified: true, ms: 600000, steps: 300, createdAt: NOW - 1000 };
  f.db["tutBattles/ABCD"] = { status: "done", startAt: NOW - 300000, createdAt: NOW - 400000, players: { u1: { tutMs: 150000, reps: 60 }, u2: { tutMs: 90000 } } };
  f.db["users/u1"] = { uid: "u1", zabBalance: 0, lastTxId: "" };
  f.db["zabBoard/u1"] = { uid: "u1", name: "Ann", total: 0 };
  let r = await st(E.claim(f, "u1", { source: "pushups", id: "p1" }, NOW, SINCE));
  check("push-ups: 45 reps -> 4.5 ZAB, computed on the server from the stored set", r.ok && r.r.credited === 4.5 && f.db["users/u1"].zabBalance === 4.5);
  check("ledger entry, claim marker, day total and board total written in the same transaction",
    f.db["users/u1/zabLedger/pushups-pup1"].amount === 4.5 && f.db["zabClaims/pushups_pushups_p1"].amount === 4.5 && f.db["zabEarnDay/u1_2026-11-03"].pushups === 4.5 && f.db["zabBoard/u1"].total === 4.5);
  r = await st(E.claim(f, "u1", { source: "pushups", id: "p1" }, NOW, SINCE));
  check("repeat claim for the same session fails (409) and credits nothing", !r.ok && r.status === 409 && f.db["users/u1"].zabBalance === 4.5);
  r = await st(E.claim(f, "u1", { source: "tut", id: "p1" }, NOW, SINCE));
  check("TUT from the same set is its own claim (60 s -> 1 ZAB)", r.ok && r.r.credited === 1);
  r = await st(E.claim(f, "u1", { source: "hold", id: "p1" }, NOW, SINCE));
  check("30-second hold -> 0.5 ZAB (tenths)", r.ok && r.r.credited === 0.5 && f.db["users/u1"].zabBalance === 6);
  r = await st(E.claim(f, "u1", { source: "pushups", id: "other" }, NOW, SINCE));
  check("someone else's session: 403", !r.ok && r.status === 403);
  r = await st(E.claim(f, "u1", { source: "pushups", id: "fast" }, NOW, SINCE));
  check("implausible set (500 reps in 60 s): 422, nothing credited", !r.ok && r.status === 422 && f.db["users/u1"].zabBalance === 6);
  r = await st(E.claim(f, "u1", { source: "pushups", id: "old" }, NOW, SINCE));
  check("session from before ZAB_EARN_SINCE (credited by the old path): 410", !r.ok && r.status === 410);
  r = await st(E.claim(f, "u1", { source: "pushups", id: "nope" }, NOW, SINCE));
  check("missing session: 404", !r.ok && r.status === 404);
  r = await st(E.claim(f, "u1", { source: "pushups", id: "p1" }, NOW + E.MAX_AGE_MS + 5000, SINCE));
  check("session older than 48 h: 410", !r.ok && r.status === 410);
  r = await st(E.claim(f, "u1", { source: "bogus", id: "p1" }, NOW, SINCE));
  check("unknown source / bad id: 400", !r.ok && r.status === 400 && (await st(E.claim(f, "u1", { source: "pushups", id: "a/b" }, NOW, SINCE))).status === 400);
  check("not signed in: 401", (await st(E.claim(f, null, { source: "pushups", id: "p1" }, NOW, SINCE))).status === 401);
  r = await st(E.claim(f, "u1", { source: "plank", id: "k1" }, NOW, SINCE));
  check("plank 185 s -> 3 ZAB", r.ok && r.r.credited === 3);
  r = await st(E.claim(f, "u1", { source: "walk", id: "w1" }, NOW, SINCE));
  check("walk 30 min with 3,000 steps -> 3 ZAB", r.ok && r.r.credited === 3);
  r = await st(E.claim(f, "u1", { source: "walk", id: "w2" }, NOW, SINCE));
  check("walk with 10 steps in 30 min: 422", !r.ok && r.status === 422);
  r = await st(E.claim(f, "u1", { source: "walk", id: "w5" }, NOW, SINCE));
  check("walk under 10 minutes (5 min) cannot earn: 422", !r.ok && r.status === 422);
  r = await st(E.claim(f, "u1", { source: "washers", id: "g1" }, NOW, SINCE));
  check("verified washers win -> 1 ZAB", r.ok && r.r.credited === 1);
  r = await st(E.claim(f, "u1", { source: "tutBattle", id: "ABCD" }, NOW, SINCE));
  check("TUT Battle: own tutMs 150 s -> 2 ZAB as source tut, keyed by code + room time", r.ok && r.r.credited === 2 && f.db["zabClaims/tut_tutBattles_ABCD_" + (NOW - 400000)]);
  // daily cap
  const g = fakeFs(NOW);
  for (let i = 0; i < 8; i++) g.db["pushups/s" + i] = { uid: "u9", reps: 100, ms: 60000, createdAt: NOW - 1000 };
  let got = 0, capped = false;
  for (let i = 0; i < 8; i++) { const x = await E.claim(g, "u9", { source: "pushups", id: "s" + i }, NOW, SINCE); got += x.credited; capped = capped || x.capped; }
  check("per-source daily cap: push-ups stop at " + E.DAY_CAP.pushups + " ZAB a day, later claims marked capped", got === E.DAY_CAP.pushups && capped && g.db["zabClaims/pushups_pushups_s7"].amount === 0);
  check("a capped session stays claimed: it cannot be re-claimed the next day (409)", (await E.claim(g, "u9", { source: "pushups", id: "s7" }, NOW + 86400000, SINCE).catch((e) => e)).status === 409);
  check("per-claim cap is 500 ZAB", E.CLAIM_CAP === 500);
  // browser claim queue
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
  const s1 = mem(); let calls = 0;
  await Z.claimEarn(() => { calls++; return Promise.reject(Object.assign(new Error("down"), { status: 503 })); }, s1, "plank", "k1").catch(() => {});
  check("claim kept for retry on a server/network error", Z.readClaims(s1).length === 1);
  await Z.flushClaims(() => { calls++; return Promise.resolve({ credited: 1 }); }, s1);
  check("flush retries and clears", Z.readClaims(s1).length === 0 && calls === 2);
  await Z.claimEarn(() => Promise.reject(Object.assign(new Error("dup"), { status: 409 })), s1, "plank", "k2").catch(() => {});
  check("a 4xx answer is final (not retried)", Z.readClaims(s1).length === 0);
  check("claimEarn ignores unknown sources", (await Z.claimEarn(() => Promise.resolve(), s1, "free", "x")).skipped === "invalid");
  // function + rules + page
  const fn = read("netlify/functions/zab-earn.js"), rules = read("firestore.rules"), html = read("index.html");
  check("function: POST only, verifies the Firebase sign-in (uidFrom), needs ZAB_EARN_SINCE", /POST only/.test(fn) && /uidFrom\(event\)/.test(fn) && /ZAB_EARN_SINCE/.test(fn));
  const users = rules.slice(rules.indexOf("match /users/{uid} {"), rules.indexOf('// Public "Top Zabba Bag"'));
  check("rules: browsers can't raise a balance (users update denied, create only at 0)", /allow update, delete: if false;/.test(users) && /u\(\)\.zabBalance == 0 && u\(\)\.lastTxId == ''/.test(users));
  check("rules: browsers can't write the ledger", /match \/zabLedger\/\{txId\} \{\s*allow read: if request\.auth != null && request\.auth\.uid == uid;\s*allow create, update, delete: if false;/.test(users));
  check("rules: pushups may carry tutMs and holds, bounded by the set time", /'tutMs','holds'/.test(rules) && /holds \* 30000 <= request\.resource\.data\.ms \+ 10000/.test(rules));
  check("page: every award goes through zab-earn after the session is saved (no client-side ledger writes)",
    /fetch\("\/\.netlify\/functions\/zab-earn"/.test(html) && !/earnAndQueue|ZT\.flush\(ztFs/.test(html) && /awardZab\("washers", gameDocId\)/.test(html)
    && /awardZab\("plank", id\)/.test(html) && /awardZab\("walk", walkId\)/.test(html) && /awardZab\("tutBattle", r\.code\)/.test(html) && /saveRemotePush\(record\)\s*\.then\(\(id\) => zabFor\(id\)\)/.test(html));
  check("page: holds are counted with the set, not credited mid-set", /if \(live\) pushHoldsThisSet \+= 1;/.test(html) && !/awardZab\("hold", 1/.test(html));
  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
