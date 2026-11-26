// Gyatt Squats ZAB: 10 squats = 1 ZAB per set (whole tens, remainder not carried), NO daily cap, server-measured,
// other sources' rates and caps unchanged.
const E = require("../zab-earn.js"), Z = require("../zab-balance.js");
const R = []; const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || why == null ? "" : " :: " + why}`); R.push(!!ok); };
function fakeFs(T) {
  const db = {};
  return { db, ts: () => T, toMs: (v) => (typeof v === "number" ? v : null),
    tx: async (fn) => { const w = []; const t = { get: async (p) => (db[p.join("/")] ? JSON.parse(JSON.stringify(db[p.join("/")])) : null),
      set: (p, d) => w.push([p.join("/"), d, false]), update: (p, d) => w.push([p.join("/"), d, true]) };
      const out = await fn(t); w.forEach(([k, d, u]) => { db[k] = u ? Object.assign({}, db[k], d) : d; }); return out; } };
}
const NOW = Date.parse("2026-11-16T18:00:00Z"), SINCE = NOW - 3600000;
const st = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, status: e.status, msg: e.message }));
(async () => {
  check("rate: 10 squats = 1 ZAB; 9 = 0; 19 = 1; 20 = 2; 1000 = 100", Z.zabFor("squats", 10) === 1 && Z.zabFor("squats", 9) === 0 && Z.zabFor("squats", 19) === 1 && Z.zabFor("squats", 20) === 2 && Z.zabFor("squats", 1000) === 100);
  check("rate line 'One set of 10 Gyatt Squats = 1 ZAB' shown on the page", Z.rateLines().includes("One set of 10 Gyatt Squats = 1 ZAB"));
  check("squats is a claim source; ledger label Gyatt Squats", Z.txLine({ source: "squats", amount: 2, qty: 25 }).source === "Gyatt Squats" && Z.txLine({ source: "squats", amount: 2, qty: 25 }).qty === "25 squats");
  check("other rates unchanged: push-up 0.1/rep, plank 60 s = 1 once, walk 10 min = 1, TUT 60 s = 1, hold 0.5, 10K = 4",
    Z.zabFor("pushups", 1) === 0.1 && Z.zabFor("plank", 600) === 1 && Z.zabFor("walk", 10) === 1 && Z.zabFor("tut", 60) === 1 && Z.RATES.hold.zab === 0.5 && Z.zabFor("steps10k", 10000) === 4);
  check("DAY_CAP unchanged for every other source; squats has no day cap", JSON.stringify(E.DAY_CAP) === JSON.stringify({ pushups: 50, tut: 30, hold: 10, plank: 30, plankTut: 30, walk: 24, washers: 20, steps10k: 4, breath: 15 }) && E.NO_DAY_CAP.squats === true && !("squats" in E.DAY_CAP));
  const f = fakeFs(NOW);
  for (let i = 0; i < 12; i++) f.db["squats/s" + i] = { uid: "u1", reps: 100, ms: 600000, source: "camera", createdAt: NOW - 1000 };
  f.db["squats/r25"] = { uid: "u1", reps: 25, ms: 400000, source: "camera", createdAt: NOW - 1000 };
  f.db["squats/r9"] = { uid: "u1", reps: 9, ms: 120000, source: "camera", createdAt: NOW - 1000 };
  f.db["squats/fast"] = { uid: "u1", reps: 200, ms: 60000, source: "camera", createdAt: NOW - 1000 };
  f.db["squats/huge"] = { uid: "u1", reps: 5000, ms: 9000000, source: "camera", createdAt: NOW - 1000 };
  f.db["squats/manual"] = { uid: "u1", reps: 20, ms: 60000, source: "typed", createdAt: NOW - 1000 };
  f.db["squats/other"] = { uid: "u2", reps: 20, ms: 60000, source: "camera", createdAt: NOW - 1000 };
  f.db["users/u1"] = { uid: "u1", zabBalance: 0, lastTxId: "" };
  let r = await st(E.claim(f, "u1", { source: "squats", id: "r25" }, NOW, SINCE));
  check("25 squats -> 2 ZAB (the leftover 5 are not carried)", r.ok && r.r.credited === 2 && f.db["users/u1/zabLedger/squats-sqr25"].qty === 25 && f.db["zabEarnDay/u1_2026-11-16"].squats === 2, JSON.stringify(r));
  r = await st(E.claim(f, "u1", { source: "squats", id: "r9" }, NOW, SINCE));
  check("9 squats -> nothing credited", r.ok && r.r.credited === 0);
  let total = 0; for (let i = 0; i < 12; i++) { r = await st(E.claim(f, "u1", { source: "squats", id: "s" + i }, NOW, SINCE)); total += r.ok ? r.r.credited : 0; }
  check("no daily cap: 12 sets x 100 squats in one day = 120 ZAB (push-ups would stop at 50)", total === 120 && f.db["zabEarnDay/u1_2026-11-16"].squats === 122 && f.db["users/u1"].zabBalance === 122, total);
  r = await st(E.claim(f, "u1", { source: "squats", id: "s0" }, NOW, SINCE));
  check("repeat claim for the same set: 409", !r.ok && r.status === 409);
  r = await st(E.claim(f, "u1", { source: "squats", id: "fast" }, NOW, SINCE));
  check("200 squats in 60 s is refused (422)", !r.ok && r.status === 422);
  r = await st(E.claim(f, "u1", { source: "squats", id: "huge" }, NOW, SINCE));
  check("more than 1000 reps in a set is refused (422)", !r.ok && r.status === 422);
  r = await st(E.claim(f, "u1", { source: "squats", id: "manual" }, NOW, SINCE));
  check("non-camera squat record refused (422)", !r.ok && r.status === 422);
  r = await st(E.claim(f, "u1", { source: "squats", id: "other" }, NOW, SINCE));
  check("someone else's squat set: 403", !r.ok && r.status === 403);
  // push-up day cap still applies
  for (let i = 0; i < 3; i++) f.db["pushups/p" + i] = { uid: "u1", reps: 300, ms: 600000, createdAt: NOW - 1000 };
  let pu = 0; for (let i = 0; i < 3; i++) { r = await st(E.claim(f, "u1", { source: "pushups", id: "p" + i }, NOW, SINCE)); pu += r.ok ? r.r.credited : 0; }
  check("push-ups still capped at 50 ZAB a day", pu === 50, pu);
  const f2 = fakeFs(NOW); f2.db["users/u1"] = { uid: "u1", zabBalance: 0 };
  f2.db["squats/max"] = { uid: "u1", reps: 1000, ms: 1200000, source: "camera", createdAt: NOW - 1000 };
  r = await st(E.claim(f2, "u1", { source: "squats", id: "max" }, NOW, SINCE));
  check("a full 1000-rep set = 100 ZAB, under the 500 ZAB per-claim cap", r.ok && r.r.credited === 100 && E.CLAIM_CAP === 500);
  const nf = R.filter((x) => !x).length; console.log(`\n${R.length - nf}/${R.length} passed`); process.exit(nf ? 1 : 0);
})();
