// The 24 ZAB daily walk cap resets at midnight America/New_York (DST-safe); other sources keep the UTC day. Run: node test/zab-earn-walk-et-day.test.js
const E = require("../zab-earn.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const T = (s) => Date.parse(s);
function fakeFs() {
  const db = {};
  return { db, ts: () => 0, toMs: (v) => (typeof v === "number" ? v : null),
    tx: async (fn) => { const w = []; const t = { get: async (p) => (db[p.join("/")] ? JSON.parse(JSON.stringify(db[p.join("/")])) : null),
      set: (p, d) => w.push([p.join("/"), d, false]), update: (p, d) => w.push([p.join("/"), d, true]) };
      const out = await fn(t); w.forEach(([k, d, u]) => { db[k] = u ? Object.assign({}, db[k], d) : d; }); return out; } };
}
// ---- day keys
check("walk cap amount unchanged (24)", E.DAY_CAP.walk === 24);
check("11:30 PM EST Nov 9 (04:30Z Nov 10): walk day 2026-11-09, push-ups day (UTC) 2026-11-10", E.capDay("walk", T("2026-11-10T04:30:00Z")) === "2026-11-09" && E.capDay("pushups", T("2026-11-10T04:30:00Z")) === "2026-11-10");
check("12:30 AM EST Nov 10 (05:30Z): walk day 2026-11-10", E.capDay("walk", T("2026-11-10T05:30:00Z")) === "2026-11-10");
check("7:30 PM EST Nov 10 (00:30Z Nov 11): walk still 2026-11-10, UTC sources already 2026-11-11", E.capDay("walk", T("2026-11-11T00:30:00Z")) === "2026-11-10" && E.capDay("plank", T("2026-11-11T00:30:00Z")) === "2026-11-11");
check("summer (EDT, UTC-4): 11:30 PM Jun 30 = 03:30Z Jul 1 -> 2026-06-30; 12:30 AM = 04:30Z -> 2026-07-01", E.capDay("walk", T("2026-07-01T03:30:00Z")) === "2026-06-30" && E.capDay("walk", T("2026-07-01T04:30:00Z")) === "2026-07-01");
check("spring forward Mar 8 2026: 11:59 PM EST Mar 7 (04:59Z) -> 03-07; midnight (05:00Z) -> 03-08; 3:30 AM EDT (07:30Z) -> 03-08", E.capDay("walk", T("2026-03-08T04:59:00Z")) === "2026-03-07" && E.capDay("walk", T("2026-03-08T05:00:00Z")) === "2026-03-08" && E.capDay("walk", T("2026-03-08T07:30:00Z")) === "2026-03-08");
check("spring forward: Mar 9 midnight is EDT (04:00Z) -> 03-09; 03:59Z -> 03-08", E.capDay("walk", T("2026-03-09T04:00:00Z")) === "2026-03-09" && E.capDay("walk", T("2026-03-09T03:59:00Z")) === "2026-03-08");
check("fall back Nov 1 2026: midnight EDT (04:00Z) -> 11-01; 03:59Z -> 10-31; 1:30 AM (twice, 05:30Z and 06:30Z) -> 11-01", E.capDay("walk", T("2026-11-01T04:00:00Z")) === "2026-11-01" && E.capDay("walk", T("2026-11-01T03:59:00Z")) === "2026-10-31" && E.capDay("walk", T("2026-11-01T05:30:00Z")) === "2026-11-01" && E.capDay("walk", T("2026-11-01T06:30:00Z")) === "2026-11-01");
check("fall back: Nov 2 midnight is EST (05:00Z) -> 11-02; 04:59Z -> 11-01", E.capDay("walk", T("2026-11-02T05:00:00Z")) === "2026-11-02" && E.capDay("walk", T("2026-11-02T04:59:00Z")) === "2026-11-01");
check("all non-walk sources keep the UTC day", ["pushups", "tut", "hold", "plank", "washers"].every((s) => E.capDay(s, T("2026-11-10T04:30:00Z")) === "2026-11-10"));
(async () => {
  // ---- claims across Eastern midnight
  const f = fakeFs(), late = T("2026-11-10T04:30:00Z") /* 11:30 PM ET Nov 9 */, early = T("2026-11-10T05:30:00Z") /* 12:30 AM ET Nov 10 */;
  f.db["users/u1"] = { uid: "u1", zabBalance: 0 };
  f.db["walkSessions/a"] = { uid: "u1", ms: 300 * 60000, steps: 30000, createdAt: late - 1000 };   // 30 ZAB worth, capped at 24
  f.db["walkSessions/b"] = { uid: "u1", ms: 60 * 60000, steps: 6000, createdAt: late - 500 };
  f.db["walkSessions/c"] = { uid: "u1", ms: 60 * 60000, steps: 6000, createdAt: early - 1000 };
  f.db["pushups/p1"] = { uid: "u1", reps: 40, ms: 60000, createdAt: late - 1000 };
  let r = await E.claim(f, "u1", { source: "walk", id: "a" }, late, 0);
  check("11:30 PM ET: walk capped at 24, day doc u1_2026-11-09 (Eastern date)", r.credited === 24 && f.db["zabEarnDay/u1_2026-11-09"].walk === 24 && f.db["zabEarnDay/u1_2026-11-09"].day === "2026-11-09");
  r = await E.claim(f, "u1", { source: "walk", id: "b" }, late + 60000, 0);
  check("same Eastern day: cap reached, nothing more", r.credited === 0);
  r = await E.claim(f, "u1", { source: "walk", id: "c" }, early, 0);
  check("12:30 AM ET (same UTC date as 11:30 PM ET): fresh cap, 6 ZAB on u1_2026-11-10", r.credited === 6 && f.db["zabEarnDay/u1_2026-11-10"].walk === 6);
  r = await E.claim(f, "u1", { source: "pushups", id: "p1" }, late, 0);
  check("push-ups at 11:30 PM ET still use the UTC day doc (u1_2026-11-10)", r.credited > 0 && f.db["zabEarnDay/u1_2026-11-10"].pushups === r.credited && !("pushups" in f.db["zabEarnDay/u1_2026-11-09"]));
  const ok = R.every(Boolean); console.log(`\n${R.filter(Boolean).length} passed, ${R.length - R.filter(Boolean).length} failed`); process.exit(ok ? 0 : 1);
})();
