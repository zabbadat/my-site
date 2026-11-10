// Daily step resume vs Eastern midnight: no reset within the same ET day; reset only at ET midnight,
// even if the device zone is UTC or Tokyo. Run: node test/et-day-resume.test.js
const { execFileSync } = require("child_process");
if (!process.env.__ET_CHILD) {
  let ok = true;
  for (const tz of ["America/New_York", "UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
    try { process.stdout.write(execFileSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: tz, __ET_CHILD: "1" }) }).toString()); }
    catch (e) { ok = false; process.stdout.write(String(e.stdout || "") + (e.stderr || "")); }
  }
  process.exit(ok ? 0 : 1);
}
const D = require("../daily-steps.js"), ET = require("../et-day.js");
const R = []; const tz = process.env.TZ;
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  [${tz}] ${n}`); R.push(!!ok); };
const tick = () => new Promise((r) => setImmediate(r));
const T = (s) => Date.parse(s);
function mk(plugin, nowMs) {
  const store = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); }, removeItem(k) { delete this.m[k]; } };
  const win = { localStorage: store, document: { hidden: false, addEventListener() {} }, addEventListener() {},
    Capacitor: { isNativePlatform: () => true, Plugins: { ZabbaSteps: plugin } } };
  const orig = Date.now; Date.now = () => nowMs;
  const c = D.createController(win, {});
  Date.now = orig;
  return { c, store, win, at(ms, fn) { const p = Date.now; Date.now = () => ms; try { return fn(); } finally { Date.now = p; } } };
}

(async () => {
  // Same Eastern day resume (11:00 ET and 18:00 ET on 10 Nov 2026 = 16:00Z and 23:00Z)
  const sameA = T("2026-11-10T16:00:00Z"), sameB = T("2026-11-10T23:00:00Z");
  let total = 2400;
  const plugin = { async getTodaySteps() { return { steps: total, rawSteps: total }; }, async getCachedSteps() { return { steps: total, rawSteps: total, resume: true }; }, async startTodayUpdates() {}, addListener() { return Promise.resolve({}); } };
  const a = mk(plugin, sameA);
  a.at(sameA, () => { a.c.applyNativeReading({ steps: 2400, rawSteps: 2400 }); });
  check("same-day: cache is tagged with the Eastern date", D.readCache(a.store).date === ET.key(sameA) && D.readCache(a.store).steps === 2400);
  total = 2650;
  const after = a.at(sameB, () => { a.c.rollDay(); const c = D.readCache(a.store); if (c) a.c.applyNativeReading(c); return a.c.state(); });
  check("no reset on resume within the same Eastern day (cache still applies, total stays up)", after.date === ET.key(sameB) && after.steps === 2400);
  await a.at(sameB, () => a.c.applyNativeReading({ steps: 2650, rawSteps: 2650 }));
  check("same-day catch-up only goes up", a.c.state().steps === 2650);

  // Across Eastern midnight: 11:59 PM ET Nov 10 = 2026-11-11T04:59Z; midnight = 05:00Z
  const before = T("2026-11-11T04:59:00Z"), afterMid = T("2026-11-11T05:00:00Z");
  let dayTotal = 5200;
  const plugin2 = { async getTodaySteps() { return { steps: dayTotal, rawSteps: dayTotal }; }, async startTodayUpdates() {}, addListener() { return Promise.resolve({}); } };
  const b = mk(plugin2, before);
  b.at(before, () => b.c.applyNativeReading({ steps: 5200, rawSteps: 5200 }));
  check("before midnight: " + ET.key(before) + " has 5200", b.c.state().date === "2026-11-10" && b.c.state().steps === 5200);
  dayTotal = 40; // new Eastern day's pedometer total
  const rolled = b.at(afterMid, () => { b.c.rollDay(); const c = D.readCache(b.store); if (c) b.c.applyNativeReading(c); return { state: b.c.state(), cache: D.readCache(b.store, ET.key(afterMid)) }; });
  check("resume across Eastern midnight does not carry yesterday's cache", rolled.cache == null && rolled.state.date === "2026-11-11" && rolled.state.steps === 0);
  b.at(afterMid, () => b.c.applyNativeReading({ steps: 40, rawSteps: 40 }));
  check("new Eastern day then shows today's count (40), not yesterday's 5200", b.c.state().steps === 40 && b.c.state().date === "2026-11-11");

  check("device time zone is " + tz + " but keys stay Eastern", D.localDateKey(new Date(before)) === "2026-11-10" && D.localDateKey(new Date(afterMid)) === "2026-11-11");
  check("no manual daily reset API besides walk session reset (controller has no resetToday)", typeof b.c.resetToday !== "function" && typeof b.c.reset !== "function");

  const ok = R.every(Boolean);
  console.log(`[${tz}] ${R.filter(Boolean).length} passed, ${R.length - R.filter(Boolean).length} failed`);
  process.exit(ok ? 0 : 1);
})();
