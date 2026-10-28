// Tests for the foreground step refresh (daily-steps.js). Run: node test/daily-foreground-refresh.test.js
const D = require("../daily-steps.js");
const fs = require("fs");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const mkStore = () => ({ m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); } });
function mkWin(plugin, extra) {
  const ev = {}, dev = {};
  const doc = { hidden: false, addEventListener(t, f) { (dev[t] = dev[t] || []).push(f); } };
  const win = { localStorage: mkStore(), document: doc, addEventListener(t, f) { (ev[t] = ev[t] || []).push(f); }, removeEventListener() {},
    Capacitor: { isNativePlatform: () => true, Plugins: { ZabbaSteps: plugin, ...(extra || {}) } } };
  return { win, fire: (t) => (ev[t] || []).forEach((f) => f()), fireDoc: (t) => (dev[t] || []).forEach((f) => f()), ev, dev };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
(async () => {
  // foreground triggers one refresh, then posts
  let reads = 0, total = 1000, posted = [];
  const plugin = { async getTodaySteps() { reads++; return { steps: total }; } };
  const H = mkWin(plugin);
  const c = D.createController(H.win, {});
  let t = 10000;
  const fg = D.createForegroundRefresh(c, { now: () => t, afterRefresh: (s) => { posted.push(s.steps); } });
  check("bound for native", D.bindForegroundEvents(H.win, c, fg.run) === true);
  H.fireDoc("visibilitychange"); await tick();
  check("visible triggers refreshNative once", reads === 1 && c.state().steps === 1000);
  check("post hook gets new total", posted.length === 1 && posted[0] === 1000);
  // debounce
  H.fire("focus"); H.fire("pageshow"); H.fireDoc("visibilitychange"); await tick();
  check("debounced within 1s", reads === 1);
  t += 1500; total = 1800; H.fire("focus"); await tick();
  check("after debounce window refreshes and total rises", reads === 2 && c.state().steps === 1800 && posted[1] === 1800);
  // hidden does nothing
  t += 5000; H.win.document.hidden = true; H.fireDoc("visibilitychange"); await tick();
  check("hidden visibilitychange does nothing", reads === 2);
  H.win.document.hidden = false;
  // never lowers
  t += 5000; total = 900; H.fire("pageshow"); await tick();
  check("never lowers the total", reads === 3 && c.state().steps === 1800 && posted[2] === 1800);
  // never concurrent
  let release, inflight = 0, maxIn = 0, calls = 0;
  const slow = { getTodaySteps() { calls++; inflight++; maxIn = Math.max(maxIn, inflight); return new Promise((r) => { release = () => { inflight--; r({ steps: 2000 }); }; }); } };
  const H2 = mkWin(slow), c2 = D.createController(H2.win, {});
  const fg2 = D.createForegroundRefresh(c2, { now: () => (t += 5000) });
  const p1 = fg2.run(), p2 = fg2.run(); await tick();
  check("no concurrent run", calls === 1 && maxIn === 1);
  release(); await p1; await p2;
  check("second run was refused while busy", (await p2) === false && c2.state().steps === 2000);
  // plugin rejection swallowed
  const bad = { async getTodaySteps() { throw new Error("denied"); } };
  const H3 = mkWin(bad), c3 = D.createController(H3.win, {});
  let postedBad = 0;
  const fg3 = D.createForegroundRefresh(c3, { afterRefresh: () => { postedBad++; } });
  let threw = false, r3;
  try { r3 = await fg3.run(); } catch (e) { threw = true; }
  check("plugin rejection swallowed, total kept", !threw && c3.state().steps === 0);
  const fg3b = D.createForegroundRefresh(c3, { afterRefresh: () => { throw new Error("post failed"); } });
  let threw2 = false; try { await fg3b.run(); } catch (e) { threw2 = true; }
  check("post hook error swallowed", !threw2);
  // web source: nothing new
  const Hw = mkWin(null); delete Hw.win.Capacitor; Hw.win.DeviceMotionEvent = function () {};
  const cw = D.createController(Hw.win, {});
  let wr = 0; cw.refreshNative = async () => { wr++; };
  const fgw = D.createForegroundRefresh(cw, {});
  check("web source: bind does nothing", D.bindForegroundEvents(Hw.win, cw, fgw.run) === false && !Hw.ev.focus && !Hw.ev.pageshow && !Hw.dev.visibilitychange);
  check("web source: run does nothing", (await fgw.run()) === false && wr === 0);
  // Capacitor App events
  const appL = {};
  const H4 = mkWin({ async getTodaySteps() { return { steps: 50 }; } }, { App: { addListener(n, f) { appL[n] = f; return Promise.resolve({ remove() {} }); } } });
  const c4 = D.createController(H4.win, {});
  let n4 = 0; const fg4 = D.createForegroundRefresh(c4, { now: () => (t += 5000), afterRefresh: () => { n4++; } });
  D.bindForegroundEvents(H4.win, c4, fg4.run);
  check("App appStateChange + resume registered", typeof appL.appStateChange === "function" && typeof appL.resume === "function");
  appL.appStateChange({ isActive: false }); await tick();
  check("appStateChange inactive ignored", n4 === 0);
  appL.appStateChange({ isActive: true }); await tick();
  check("appStateChange active refreshes", n4 === 1);
  appL.resume(); await tick();
  check("resume refreshes", n4 === 2);
  // App listener rejection swallowed
  const H5 = mkWin({ async getTodaySteps() { return { steps: 1 }; } }, { App: { addListener() { return Promise.reject(new Error("x")); } } });
  const c5 = D.createController(H5.win, {});
  let ok5 = true; try { D.bindForegroundEvents(H5.win, c5, D.createForegroundRefresh(c5, {}).run); await tick(); } catch (e) { ok5 = false; }
  check("App.addListener rejection swallowed", ok5);
  // rollDay called before refresh
  let rolled = 0; const fake = { source: { kind: "native" }, rollDay() { rolled++; }, async refreshNative() {}, state() { return {}; } };
  await D.createForegroundRefresh(fake, {}).run();
  check("rollDay runs before refresh", rolled === 1);
  // wiring in index.html
  const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
  check("index wires foreground refresh to postDaily", /createForegroundRefresh\(daily, \{ afterRefresh: \(\) => postDaily\(true\) \}\)/.test(html) && /DS\.bindForegroundEvents\(window, daily, dailyFg\.run\)/.test(html));
  check("old visibility-only listener removed", !/!document\.hidden && daily\.source\.kind === "native"\) daily\.refreshNative/.test(html));
  const bridge = fs.readFileSync(__dirname + "/../app-bridge.js", "utf8");
  check("app-bridge untouched by step refresh", !/refreshNative|ZabbaSteps/.test(bridge));
  process.exit(R.every(Boolean) ? 0 : 1);
})();
