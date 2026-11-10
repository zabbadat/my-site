// Eastern-midnight cutoff for every movement day: et-day.js, daily steps + plank boards, push-up tallies, walk "Today",
// ZAB send limits, same-pair wager day. Run: node test/et-day-cutoff.test.js (any TZ: forced to UTC and Asia/Tokyo below).
const { execFileSync } = require("child_process");
if (!process.env.__ET_CHILD) {
  let ok = true;
  for (const tz of ["America/New_York", "UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
    try { process.stdout.write(execFileSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: tz, __ET_CHILD: "1" }) }).toString()); }
    catch (e) { ok = false; process.stdout.write(String(e.stdout || "")); }
  }
  process.exit(ok ? 0 : 1);
}
const fsx = require("fs");
const ET = require("../et-day.js"), DS = require("../daily-steps.js"), PD = require("../plank-daily.js"), X = require("../zab-transfer.js"), E = require("../zab-earn.js");
const R = []; const tz = process.env.TZ; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  [${tz}] ${n}`); R.push(!!ok); };
const T = (s) => Date.parse(s);
const cases = [
  ["2026-11-10T04:59:59Z", "2026-11-09"], ["2026-11-10T05:00:00Z", "2026-11-10"], ["2026-11-11T00:30:00Z", "2026-11-10"],
  ["2026-07-01T03:59:00Z", "2026-06-30"], ["2026-07-01T04:00:00Z", "2026-07-01"],
  ["2026-03-08T04:59:00Z", "2026-03-07"], ["2026-03-08T05:00:00Z", "2026-03-08"], ["2026-03-09T03:59:00Z", "2026-03-08"], ["2026-03-09T04:00:00Z", "2026-03-09"],
  ["2026-11-01T03:59:00Z", "2026-10-31"], ["2026-11-01T04:00:00Z", "2026-11-01"], ["2026-11-01T06:30:00Z", "2026-11-01"], ["2026-11-02T04:59:00Z", "2026-11-01"], ["2026-11-02T05:00:00Z", "2026-11-02"],
  ["2026-12-31T23:30:00Z", "2026-12-31"], ["2027-01-01T05:00:00Z", "2027-01-01"]
];
check("et-day key: Eastern date across EST, EDT, both DST switches, new year", cases.every(([t, d]) => ET.key(T(t)) === d));
check("et-day key accepts a Date", ET.key(new Date(T("2026-11-10T04:59:59Z"))) === "2026-11-09");
check("shortKey unpadded (push-up localStorage format)", ET.shortKey(T("2026-03-08T05:00:00Z")) === "2026-3-8");
const mids = [["2026-11-10T15:00:00Z", "2026-11-10T05:00:00Z"], ["2026-07-01T12:00:00Z", "2026-07-01T04:00:00Z"], ["2026-03-08T12:00:00Z", "2026-03-08T05:00:00Z"],
  ["2026-03-09T02:00:00Z", "2026-03-08T05:00:00Z"], ["2026-11-01T12:00:00Z", "2026-11-01T04:00:00Z"], ["2026-11-02T03:00:00Z", "2026-11-01T04:00:00Z"], ["2026-11-02T06:00:00Z", "2026-11-02T05:00:00Z"]];
check("startMs = Eastern midnight (DST-safe)", mids.every(([t, m]) => ET.startMs(T(t)) === T(m)));
check("daily steps day key = Eastern date", cases.every(([t, d]) => DS.localDateKey(new Date(T(t))) === d));
check("plank sets day key = Eastern date", cases.every(([t, d]) => PD.localDateKey(new Date(T(t))) === d));
check("zab-earn caps: every source on the Eastern date", Object.keys(E.DAY_CAP).every((s) => cases.every(([t, d]) => E.capDay(s, T(t)) === d)));
// zab-transfer send rate: the day field is the Eastern date (limits reset at Eastern midnight)
(async () => {
  const db = {}, P = (p) => p.join("/");
  const fs = { ts: () => 0, tx: async (fn) => { const w = []; const out = await fn({ get: async (p) => (db[P(p)] ? JSON.parse(JSON.stringify(db[P(p)])) : null),
    set: (p, d) => w.push(() => { db[P(p)] = d; }), update: (p, d) => w.push(() => { db[P(p)] = Object.assign({}, db[P(p)], d); }) }); w.forEach((f) => f()); return out; } };
  db["users/a"] = { uid: "a", zabBalance: 100 }; db["users/b"] = { uid: "b", zabBalance: 0 }; db["zabBoard/a"] = { uid: "a", name: "A", total: 100 }; db["zabBoard/b"] = { uid: "b", name: "B", total: 0 };
  await X.send(fs, "a", { to: "b", amount: 1, key: "etkey00001" }, T("2026-11-11T00:30:00Z")); // 7:30 PM ET Nov 10
  check("ZAB send limit day = Eastern date (7:30 PM ET Nov 10 -> 2026-11-10)", db["zabSendRate/a"] && db["zabSendRate/a"].day === "2026-11-10" && db["zabSendRate/a"].count === 1);
  await X.send(fs, "a", { to: "b", amount: 1, key: "etkey00002" }, T("2026-11-11T04:59:00Z"));
  check("same Eastern day keeps counting", db["zabSendRate/a"].count === 2);
  await X.send(fs, "a", { to: "b", amount: 1, key: "etkey00003" }, T("2026-11-11T05:00:00Z"));
  check("Eastern midnight resets send limits", db["zabSendRate/a"].day === "2026-11-11" && db["zabSendRate/a"].count === 1);
  // wager same-pair day, index.html walk "Today" + push-up keys + washers tonight, app bridge
  const W = fsx.readFileSync(__dirname + "/../zaba-wager.js", "utf8"), H = fsx.readFileSync(__dirname + "/../index.html", "utf8"), B = fsx.readFileSync(__dirname + "/../app-bridge.js", "utf8");
  check("wager same-pair day uses the Eastern date", /const ETD = NODE \? require\("\.\/et-day\.js"\)/.test(W) && /today = ETD \? ETD\.key\(nowMs\)/.test(W));
  check("index.html loads et-day.js before plank-daily.js and daily-steps.js", H.indexOf('src="/et-day.js"') > 0 && H.indexOf('src="/et-day.js"') < H.indexOf('src="/plank-daily.js"') && H.indexOf('src="/et-day.js"') < H.indexOf('src="/daily-steps.js"'));
  check("push-up today tallies + TUT history key by Eastern shortKey", (H.match(/window\.ZabbadatEtDay\.shortKey\(d\)/g) || []).length >= 2);
  check("walk 'Today' view starts at Eastern midnight", /window\.ZabbadatEtDay\.startMs\(\)/.test(H));
  check("washers 'tonight' compares Eastern dates", /window\.ZabbadatEtDay\.key\(d\) === window\.ZabbadatEtDay\.key\(\)/.test(H));
  check("app bridge push-today mirror uses the Eastern key", /E\.shortKey\(\)/.test(B));
  const ok = R.every(Boolean); console.log(`[${tz}] ${R.filter(Boolean).length} passed, ${R.length - R.filter(Boolean).length} failed`); process.exit(ok ? 0 : 1);
})();
