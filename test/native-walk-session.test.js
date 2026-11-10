// App (Capacitor, native ZabbaSteps) live walk sessions: Start walk times a session on the phone's step counter.
// Unit math (walk-session.js createNativeCounter), controller (daily-steps.js native startWalk) and the real index.html
// Step Equity wiring run in a vm with a fake plugin, fake clock and fake DOM. Run: node test/native-walk-session.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const W = require("../walk-session.js"), D = require("../daily-steps.js");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const tick = () => new Promise((r) => setTimeout(r, 5));

// ---- unit: session steps from the phone total
{
  const c = W.createNativeCounter(1000);
  check("baseline: at Start the session is 0", c.steps() === 0 && c.base() === 1000);
  check("live increments: total 1,250 -> 250 session steps", c.update(1250) === 250);
  check("live increments keep rising: 1,600 -> 600", c.update(1600) === 600);
  check("never negative: a lower reading never drops below 0 / never subtracts", W.createNativeCounter(500).update(200) >= 0);
  check("null / NaN readings keep the last value", c.update(null) === 600 && c.update(NaN) === 600);
  const r = W.createNativeCounter(9000); r.update(9800);
  check("day rollover: phone counter restarts at 0 after midnight, steps so far are carried (800)", r.update(0) === 800);
  check("day rollover: new day's steps add on top (800 + 150)", r.update(150) === 950);
  check("capped at MAX_STEPS", W.createNativeCounter(0).update(5e6) === W.MAX_STEPS);
  const s = W.createSession(0, 0), n = W.createNativeCounter(3000); n.update(3000 + 400);
  const res = s.stop(12 * 60000, n.steps());
  check("rules unchanged: 12 min with 400 phone steps qualifies (33 spm)", res.steps === 400 && W.qualifies(res).ok);
  const s2 = W.createSession(0, 0), n2 = W.createNativeCounter(3000); n2.update(3200);
  check("rules unchanged: 12 min with 200 phone steps rejected (<30 spm)", !W.qualifies(s2.stop(12 * 60000, n2.steps())).ok);
  const s3 = W.createSession(0, 0);
  check("rules unchanged: 9 min not logged", !W.qualifies(s3.stop(9 * 60000, 2000)).ok);
}

// ---- fake page running the real Step Equity section of index.html
const html = R("index.html");
const sec = html.slice(html.indexOf("// ---- Daily steps (shared module daily-steps.js"), html.indexOf('const { initializeApp } = await import('));
function page(o) {
  let now = o.t0 || new Date(2026, 10, 10, 9, 0, 0).getTime(), perf = 1000;
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { a.length ? super(...a) : super(now); } static now() { return now; } }
  const els = {}, docEv = {}, winEv = {}, saved = [], wake = { start: 0, stop: 0 };
  const el = (id) => els[id] || (els[id] = { id, textContent: "", innerHTML: "", hidden: false, setAttribute() {} });
  const store = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); } };
  const doc = { hidden: false, get visibilityState() { return this.hidden ? "hidden" : "visible"; }, addEventListener: (t, f) => (docEv[t] = docEv[t] || []).push(f), getElementById: el };
  const win = { localStorage: store, document: doc, performance: { now: () => perf }, addEventListener: (t, f) => (winEv[t] = winEv[t] || []).push(f), removeEventListener: (t, f) => { winEv[t] = (winEv[t] || []).filter((x) => x !== f); },
    WakeLock: { createWakeLock: () => ({ start: async () => { wake.start++; }, stop: async () => { wake.stop++; } }) }, ZabbadatGetSet: { pocketCue() {} } };
  if (o.plugin) win.Capacitor = { isNativePlatform: () => true, Plugins: { ZabbaSteps: o.plugin } };
  else win.DeviceMotionEvent = function () {};
  win.ZabbadatSteps = { createStepDetector: () => ({ update: () => ({ added: 0 }), reset() {} }) };
  let hold = null;
  const ctx = vm.createContext({ window: win, document: doc, Date: FakeDate, performance: win.performance, localStorage: store, console, Promise, Math, Number, String, isFinite,
    $: el, currentUser: { uid: "u1" }, walkLockOn: false, requireSignIn: () => true, setWalkLock(on) { ctx.walkLockOn = !!on; },
    bindHold: (btn, ho) => { hold = ho; }, escapeHtml: (s) => String(s), publicName: (s) => String(s), displayNameOf: () => "Zab", ZT: null, awardZab: async () => null, zabNote: () => "", zabRing() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
  ctx.globalThis = ctx;
  vm.runInContext(R("daily-steps.js").replace("(this)", "(window)"), ctx);
  win.ZabbadatDaily = ctx.window.ZabbadatDaily || ctx.ZabbadatDaily;
  vm.runInContext("(function(){var module;" + R("walk-session.js").replace("})(this);", "})(window);") + "})()", ctx);
  vm.runInContext("(function(){var module;" + R("live-walk.js").replace('typeof self !== "undefined" ? self : this', "window") + "})()", ctx);
  vm.runInContext(sec + '\n$("player").value = "";\nsaveRemoteDaily = async () => {};\nsaveRemoteWalk = async (r) => { __saved.push(r); return "w1"; };', Object.assign(ctx, { __saved: saved }));
  const run = (c) => vm.runInContext(c, ctx);
  return { els, ctx, saved, wake, winEv, run, doc,
    adv: (ms) => { now += ms; perf += ms; }, advWall: (ms) => { now += ms; },
    fireVis: async (hidden) => { doc.hidden = hidden; (docEv.visibilitychange || []).forEach((f) => f()); await tick(); },
    // the click right after a completed hold is swallowed (walkHoldDone, cleared by a 600 ms timer that this fake page never runs): tap again
    click: async () => { await run('$("dailyWalkBtn").onclick()'); await tick(); if (!run("daily.state().walking")) { await run('$("dailyWalkBtn").onclick()'); await tick(); } },
    hold: async () => { hold.done(); await tick(); await tick(); } };
}

(async () => {
  // ---- controller: native startWalk
  {
    let total = 1200, reads = 0, listeners = 0;
    const win = { localStorage: { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = v; } }, addEventListener: () => { listeners++; }, removeEventListener() {}, DeviceMotionEvent: function () {},
      Capacitor: { isNativePlatform: () => true, Plugins: { ZabbaSteps: { async getTodaySteps() { reads++; return { steps: total }; } } } } };
    const c = D.createController(win, {});
    const ok = await c.startWalk();
    check("native startWalk: reads the phone first (baseline), walking, no DeviceMotion listener", ok === true && reads === 1 && c.state().steps === 1200 && c.state().walking && listeners === 0);
    check("native startWalk: message says lock / other apps still count", /lock your phone or use other apps/.test(c.state().msg));
    c.syncRemote(1500); check("native stream (syncRemote) raises the total", c.state().steps === 1500);
    c.syncRemote(1300); check("native stream never lowers the total", c.state().steps === 1500);
    c.stopWalk(); check("native stopWalk: stopped, total kept", !c.state().walking && c.state().steps === 1500 && listeners === 0);
    const bad = D.createController({ ...win, Capacitor: { isNativePlatform: () => true, Plugins: { ZabbaSteps: { async getTodaySteps() { throw new Error("denied"); } } } } }, {});
    check("native startWalk refuses without a phone reading (permission off), keeps the Settings message", (await bad.startWalk()) === false && !bad.state().walking && /Settings/.test(bad.state().msg));
  }

  // ---- app wiring
  let total = 4000, reads = 0;
  const plugin = { async getTodaySteps() { reads++; return { steps: total }; } };
  let p = page({ plugin }); await tick();
  check("app: Start walk shown, Reset hidden, no Refresh from phone button", p.els.dailyWalkBtn.hidden === false && p.els.dailyResetBtn.hidden === true && !html.includes("dailyRefreshBtn") && !html.includes("Refresh from phone"));
  check("app: button label 'Start walk'", p.els.dailyWalkBtn.textContent === "Start walk");
  check("app: Step Equity lead describes the phone counter + Start walk, never goes down, no Refresh sentence", /all-day total automatically/.test(p.els.stepsLead.innerHTML) && /lock your phone or use other apps, steps still count/.test(p.els.stepsLead.innerHTML) && /Today's total never goes down/.test(p.els.stepsLead.innerHTML) && !/Refresh from phone/.test(p.els.stepsLead.innerHTML));
  check("app: Live walk sessions lead describes the app (no 'Hiding the page pauses')", /Tap Start walk/.test(p.els.walkLead.textContent) && !/Hiding the page/.test(p.els.walkLead.textContent));
  total = 4200;
  await p.click();
  check("Start: refreshes first, baseline = phone total (4,200), session 0, clock running", p.els.dailyCount.textContent === "4,200" && p.els.walkSteps.textContent === "0" && p.els.dailyWalkBtn.textContent === "Hold to stop" && p.ctx.walkLockOn === true);
  check("Start: no DeviceMotion listener and no forced screen wake in the app", !(p.winEv.devicemotion || []).length && p.wake.start === 0);
  p.adv(3 * 60000); p.run("daily.syncRemote(4500)");
  check("live: phone stream 4,500 -> session 300 steps, clock 03:00", p.els.walkSteps.textContent === "300" && p.els.walkClock.textContent === "03:00");
  await p.fireVis(true); p.advWall(6 * 60000); total = 5100; await p.fireVis(false);
  check("background 6 min (> 2 min): session NOT paused or ended, clock 09:00 on wall time", p.run("!!walkSession && !walkSession.isPaused()") && p.els.walkClock.textContent === "09:00");
  check("return: phone total re-read, session 900", p.els.dailyCount.textContent === "5,100" && p.els.walkSteps.textContent === "900");
  p.run("daily.syncRemote(100)");
  check("lower reading never makes the session negative or lower", p.els.walkSteps.textContent === "900");
  const readsBefore = reads; p.adv(3 * 60000); total = 5300;
  await p.hold();
  check("Stop (hold): final phone read before closing", reads === readsBefore + 1 && p.els.dailyCount.textContent === "5,300");
  check("Stop posts via saveRemoteWalk: 12:00 with 1,100 steps", p.saved.length === 1 && p.saved[0].ms === 12 * 60000 && p.saved[0].steps === 1100 && /Posted session 12:00 with 1,100 steps/.test(p.els.walkStatus.textContent));
  check("after Stop: label back to Start walk, lock off", p.els.dailyWalkBtn.textContent === "Start walk" && p.ctx.walkLockOn === false);
  await p.click(); p.adv(5 * 60000); total = 6000; await p.hold();
  check("app short session (5 min) uses the same rules: not posted", p.saved.length === 1 && /Not logged: Sessions under 10 minutes/.test(p.els.walkStatus.textContent));
  await p.click(); p.adv(11 * 60000); total = 6100; await p.hold();
  check("app slow session (100 steps / 11 min) uses the same 30 spm rule: not posted", p.saved.length === 1 && /Not enough steps/.test(p.els.walkStatus.textContent));

  // ---- web unchanged
  const w = page({});
  check("web: label 'Start live walk', no Refresh button, web lead untouched", w.els.dailyWalkBtn.textContent === "Start live walk" && !html.includes("dailyRefreshBtn") && !w.els.stepsLead);
  await w.click();
  check("web: Start adds the DeviceMotion listener and keeps the screen awake", (w.winEv.devicemotion || []).length === 1 && w.wake.start === 1);
  w.adv(60000); await w.fireVis(true);
  check("web: hidden pauses the clock", w.run("walkSession.isPaused()"));
  w.adv(3 * 60000); await w.fireVis(false);
  check("web: hidden over 2 min ends the session", w.run("walkSession === null") && /page hidden too long/.test(w.els.walkStatus.textContent));

  // ---- source wiring
  check("index.html: native session never calls addWeb / DeviceMotion for the app", !/NATIVE_WALK[^\n]*addWeb/.test(html));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
