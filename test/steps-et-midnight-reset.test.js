// Steps reset at Eastern midnight and keep tracking the new day (Nov 14 2026 report: "didn't track today, never reset").
// Covers: web live walk open across midnight, app open across midnight (old app build that carried yesterday's total),
// app resumed the next day, newer builds' day tag, board doc listener left on yesterday's doc, DST (spring/fall),
// device zones other than Eastern, the 10K bonus day key, and the page wiring. Run: node test/steps-et-midnight-reset.test.js
const { execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
if (!process.env.__ET_CHILD) {
  let ok = true;
  for (const tz of ["America/New_York", "America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
    try { process.stdout.write(execFileSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: tz, __ET_CHILD: "1" }) }).toString()); }
    catch (e) { ok = false; process.stdout.write(String(e.stdout || "") + (e.stderr || "")); }
  }
  process.exit(ok ? 0 : 1);
}
const D = require("../daily-steps.js"), ET = require("../et-day.js"), Z = require("../zab-balance.js"), E = require("../zab-earn.js");
const tz = process.env.TZ, R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  [${tz}] ${n}`); R.push(!!ok); };
const T = (s) => Date.parse(s);
let NOW = 0; const realNow = Date.now; Date.now = () => NOW;
const mkStore = () => ({ m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); }, removeItem(k) { delete this.m[k]; } });
function webCtl(store, hooks) {
  const listeners = {};
  const win = { localStorage: store || mkStore(), DeviceMotionEvent: function () {}, performance: { now: () => NOW },
    addEventListener(t, f) { listeners[t] = f; }, removeEventListener(t) { delete listeners[t]; },
    ZabbadatSteps: { createStepDetector: () => ({ update: (s) => ({ added: s.x }), reset() {} }) } };
  const c = D.createController(win, hooks || {});
  return { c, win, motion: (n) => listeners.devicemotion({ accelerationIncludingGravity: { x: n, y: 0, z: 0 } }) };
}
function nativeCtl(plugin, store, hooks) {
  const ls = {};
  plugin.addListener = (ev, f) => { ls[ev] = f; return Promise.resolve({}); };
  const win = { localStorage: store || mkStore(), document: { hidden: false, addEventListener() {} }, addEventListener() {},
    Capacitor: { isNativePlatform: () => true, Plugins: { ZabbaSteps: plugin } } };
  const c = D.createController(win, hooks || {});
  return { c, win, push: (ev, d) => ls[ev] && ls[ev](d) };
}
(async () => {
  // ---------- 1. Web: page open across Eastern midnight (EST, Nov 14 -> 15 2026: midnight = 05:00Z)
  NOW = T("2026-11-15T04:58:00Z"); // 11:58 PM ET Sat Nov 14
  let days = [];
  const w = webCtl(null, { onDayChange: (d, p) => days.push(p + ">" + d) });
  await w.c.startWalk();
  w.motion(5200);
  check("web: 5200 steps on 2026-11-14 before midnight", w.c.state().date === "2026-11-14" && w.c.state().steps === 5200);
  NOW = T("2026-11-15T05:00:30Z"); // 12:00:30 AM ET Sun Nov 15
  w.motion(3);
  check("web: first steps after midnight start the new day at 3, not 5203", w.c.state().date === "2026-11-15" && w.c.state().steps === 3);
  w.motion(40);
  check("web: new steps keep tracking on the new day (43)", w.c.state().steps === 43);
  check("web: yesterday's total is kept under yesterday's key", D.readLocal(w.win.localStorage, "2026-11-14") === 5200 && D.readLocal(w.win.localStorage, "2026-11-15") === 43);
  check("web: onDayChange fired exactly once", days.length === 1 && days[0] === "2026-11-14>2026-11-15");

  // ---------- 2. checkDay(): reset with no new steps (midnight timer) and idempotent
  NOW = T("2026-11-15T04:59:00Z");
  const q = webCtl(); await q.c.startWalk(); q.motion(900);
  let emitted = 0; NOW = T("2026-11-15T05:00:01Z");
  const rolled = q.c.checkDay(), again = q.c.checkDay();
  check("checkDay at midnight zeroes the display with no new steps, once", rolled === true && again === false && q.c.state().steps === 0 && q.c.state().date === "2026-11-15");

  // ---------- 3. DST-safe: spring forward (Mar 9 2026 midnight is EDT, 04:00Z) and fall back (Nov 2 2026 midnight is EST, 05:00Z)
  for (const [label, before, at, d0, d1] of [
    ["spring forward", "2026-03-09T03:59:00Z", "2026-03-09T04:00:00Z", "2026-03-08", "2026-03-09"],
    ["DST start day itself", "2026-03-08T04:59:00Z", "2026-03-08T05:00:00Z", "2026-03-07", "2026-03-08"],
    ["fall back", "2026-11-02T04:59:00Z", "2026-11-02T05:00:00Z", "2026-11-01", "2026-11-02"],
    ["DST end day itself (midnight EDT)", "2026-11-01T03:59:00Z", "2026-11-01T04:00:00Z", "2026-10-31", "2026-11-01"]]) {
    NOW = T(before); const x = webCtl(); await x.c.startWalk(); x.motion(1234);
    const okBefore = x.c.state().date === d0 && x.c.state().steps === 1234;
    NOW = T(at) - 1000; x.c.checkDay(); const stillOld = x.c.state().date === d0 && x.c.state().steps === 1234;
    NOW = T(at); x.motion(7);
    check(`${label}: ${d0} until the Eastern midnight, then ${d1} starts at 0 and counts (7)`, okBefore && stillOld && x.c.state().date === d1 && x.c.state().steps === 7);
  }
  // fall back: 1:30 AM happens twice (05:30Z, 06:30Z): no second reset
  NOW = T("2026-11-01T05:30:00Z"); const fb = webCtl(); await fb.c.startWalk(); fb.motion(50);
  NOW = T("2026-11-01T06:30:00Z"); const fbRolled = fb.c.checkDay(); fb.motion(1);
  check("fall back: the repeated 1 AM hour does not reset again", fbRolled === false && fb.c.state().steps === 51);

  // ---------- 4. App (old build) open across midnight: plugin carries yesterday's 5200 into today
  NOW = T("2026-11-15T04:50:00Z");
  let phone = { steps: 5200, rawSteps: 5300 };
  const plugin = { async getTodaySteps() { return { ...phone }; }, async getCachedSteps() { return { ...phone, resume: true, immediate: true }; }, async startTodayUpdates() {} };
  const a = nativeCtl(plugin);
  await a.c.refreshNative();
  check("app: 5200 before midnight", a.c.state().steps === 5200 && a.c.state().date === "2026-11-14");
  NOW = T("2026-11-15T13:00:00Z"); // 8 AM ET: phone woken up
  a.push("stepsResume", { steps: 5200, rawSteps: 5300, resume: true, immediate: true }); // old build: base not reset
  check("app resumed next day: yesterday's pushed total is not shown (0)", a.c.state().date === "2026-11-15" && a.c.state().steps === 0);
  phone = { steps: 5200, rawSteps: 410 }; // old build: filtered stuck at 5200, raw since today's ET midnight = 410
  await a.c.refreshNative();
  check("app: carried-over total detected (filtered > raw): today shows 410", a.c.state().steps === 410);
  a.push("stepsResume", { steps: 5200, rawSteps: 5300, resume: true, immediate: true });
  check("app: later stale pushes cannot raise it back to 5200", a.c.state().steps === 410);
  a.push("todaySteps", { steps: 5200, rawSteps: 520 });
  check("app: live stream keeps tracking today (520)", a.c.state().steps === 520);
  check("app: today's local store holds today's count only", D.readLocal(a.win.localStorage, "2026-11-15") === 520 && D.readLocal(a.win.localStorage, "2026-11-14") === 5200);

  // ---------- 5. App (fixed build): readings tagged with their Eastern day
  NOW = T("2026-11-15T04:59:00Z");
  const p2 = { async getTodaySteps() { return { steps: 8000, rawSteps: 8100, day: "2026-11-14" }; }, async startTodayUpdates() {} };
  const b = nativeCtl(p2); await b.c.refreshNative();
  NOW = T("2026-11-15T05:00:10Z");
  b.push("stepsResume", { steps: 8000, rawSteps: 8100, day: "2026-11-14", resume: true });
  check("fixed build: a reading tagged with yesterday is dropped after midnight", b.c.state().date === "2026-11-15" && b.c.state().steps === 0);
  b.push("todaySteps", { steps: 12, rawSteps: 12, day: "2026-11-15" });
  check("fixed build: today's tagged reading counts (12)", b.c.state().steps === 12);

  // ---------- 6. Cold start the next day with yesterday's local data
  NOW = T("2026-11-15T03:00:00Z"); const st6 = mkStore();
  const c1 = webCtl(st6); await c1.c.startWalk(); c1.motion(9000);
  NOW = T("2026-11-15T12:00:00Z"); const c2 = webCtl(st6);
  check("reopened the next day: starts at 0 (yesterday's cache not reused)", c2.c.state().date === "2026-11-15" && c2.c.state().steps === 0);
  await c2.c.startWalk(); c2.motion(25);
  check("reopened the next day: new steps tracked (25)", c2.c.state().steps === 25);

  // ---------- 7. Board doc listener left on yesterday's doc
  NOW = T("2026-11-15T05:01:00Z"); const s7 = webCtl();
  s7.c.syncRemote(5200, "2026-11-14");
  check("syncRemote ignores yesterday's board doc", s7.c.state().steps === 0);
  s7.c.syncRemote(300, "2026-11-15");
  check("syncRemote takes today's board doc", s7.c.state().steps === 300);

  // ---------- 8. 10K bonus: same Eastern day key, fires again the next day, never twice
  NOW = T("2026-11-15T04:30:00Z"); // 11:30 PM ET Nov 14 = 8:30 PM in LA, Nov 15 in Tokyo/UTC
  const k = webCtl(); await k.c.startWalk(); k.motion(10050);
  check("10K day key is the Eastern date the reset uses (2026-11-14 in every device zone)", k.c.state().date === "2026-11-14" && Z.tenKEarn("u", k.c.state().steps, k.c.state().date).id === "steps10k-2026-11-14");
  NOW = T("2026-11-15T05:00:05Z"); k.motion(5);
  check("after the reset the new day is below 10K (no bonus from yesterday's total)", k.c.state().steps === 5 && Z.tenKEarn("u", k.c.state().steps, k.c.state().date) === null);
  const f = (() => { const db = {}; return { db, ts: () => NOW, toMs: (v) => (typeof v === "number" ? v : null),
    tx: async (fn) => { const w = []; const t = { get: async (p) => (db[p.join("/")] ? JSON.parse(JSON.stringify(db[p.join("/")])) : null), set: (p, d) => w.push([p.join("/"), d, false]), update: (p, d) => w.push([p.join("/"), d, true]) };
      const out = await fn(t); w.forEach(([kk, d, u]) => { db[kk] = u ? Object.assign({}, db[kk], d) : d; }); return out; } }; })();
  const claim = (id, at) => E.claim(f, "u", { source: "steps10k", id }, at, 1).then((r) => r, (e) => ({ status: e.status }));
  f.db["users/u"] = { uid: "u", zabBalance: 0 };
  f.db["dailySteps/u_2026-11-14"] = { uid: "u", date: "2026-11-14", steps: 10050, updatedAt: T("2026-11-15T04:31:00Z") };
  const r1 = await claim("u_2026-11-14", T("2026-11-15T04:32:00Z"));
  const r2 = await claim("u_2026-11-14", T("2026-11-15T04:33:00Z"));
  check("server: 10K pays 4 ZAB once for the day", r1.credited === 4 && f.db["users/u"].zabBalance === 4);
  check("server: the same day can't be paid twice (409)", r2.status === 409 && f.db["users/u"].zabBalance === 4);
  f.db["dailySteps/u_2026-11-15"] = { uid: "u", date: "2026-11-15", steps: 9999, updatedAt: T("2026-11-15T20:00:00Z") };
  const r3 = await claim("u_2026-11-15", T("2026-11-15T20:01:00Z"));
  check("server: below 10,000 on the new day pays nothing (422)", r3.status === 422 && f.db["users/u"].zabBalance === 4);
  f.db["dailySteps/u_2026-11-15"].steps = 10001;
  const r4 = await claim("u_2026-11-15", T("2026-11-15T21:00:00Z"));
  check("server: pays again on the new Eastern day after the reset", r4.credited === 4 && f.db["users/u"].zabBalance === 8);
  f.db["dailySteps/u_2026-11-10"] = { uid: "u", date: "2026-11-10", steps: 20000, updatedAt: T("2026-11-15T21:00:00Z") };
  check("server: an old day can't be claimed", (await claim("u_2026-11-10", T("2026-11-15T21:05:00Z"))).status === 422);
  f.db["dailySteps/x_2026-11-15"] = { uid: "x", date: "2026-11-15", steps: 20000, updatedAt: T("2026-11-15T21:00:00Z") };
  check("server: someone else's day can't be claimed", (await claim("x_2026-11-15", T("2026-11-15T21:05:00Z"))).status === 403);
  check("client: steps10k is a claimable source", (await Z.claimEarn(async () => ({ credited: 4 }), mkStore(), "steps10k", "u_2026-11-15")).credited === 4);

  // ---------- 9. Page wiring
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("page: day change resets dailyPosted and re-subscribes today's doc and the boards", /function dailyNewDay\(\) \{\s*dailyPosted = 0;[\s\S]*?dailyDocSub\(currentUser\)[\s\S]*?boardsOnUser\(currentUser\)/.test(html) && /onDayChange: \(\) => dailyNewDay\(\)/.test(html));
  check("page: dailySteps listener uses the controller's day and ignores other days", /function dailyDocSub\(u\)[\s\S]*?daily\.state\(\)\.date[\s\S]*?x\.date === daily\.state\(\)\.date/.test(html) && !/DS\.docId\(u\.uid, DS\.localDateKey\(\)\)/.test(html));
  check("page: midnight check runs on a timer and on resume", /setInterval\(\(\) => \{ daily\.checkDay\(\); \}, 30000\)/.test(html) && /daily\.checkDay\(\)/.test(html));
  check("page: native resume paint goes through the day guard (__zabbaApplySteps)", /window\.__zabbaApplySteps = \(r\) =>[^\n]*applyNativeReading/.test(html));
  check("page: 10K claim uses today's dailySteps doc id and only today's Eastern day", /awardZab\("steps10k", DS\.docId\(currentUser\.uid, s\.date\)\)/.test(html) && /s\.date !== DS\.localDateKey\(\)/.test(html));
  check("page: 10K guard also set on 409 (already claimed), no repeat claims", /err\.status === 409[^\n]*localStorage\.setItem\(key, "1"\)/.test(html));

  Date.now = realNow;
  const bad = R.filter((x) => !x).length;
  console.log(`[${tz}] ${R.length - bad} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
