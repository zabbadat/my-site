// Resume lifecycle for native step counts (daily-steps.js + walk-session.js).
// Simulates repeated background/foreground, a lost live stream, a webview reload,
// and unknown-activity payloads. Asserts the displayed number updates within one
// tick of resume, stays monotonic, and large catch-ups snap at once (no count-up).
// Run: node test/step-resume-lifecycle.test.js
const D = require("../daily-steps.js");
const W = require("../walk-session.js");
const fs = require("fs");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const tick = () => new Promise((r) => setImmediate(r)); // one microtask / event-loop tick
const mkStore = () => ({ m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); }, removeItem(k) { delete this.m[k]; } });
function mkWin(plugin, extra) {
  const ev = {}, dev = {};
  const doc = { hidden: false, addEventListener(t, f) { (dev[t] = dev[t] || []).push(f); } };
  const win = { localStorage: mkStore(), document: doc, addEventListener(t, f) { (ev[t] = ev[t] || []).push(f); }, removeEventListener() {},
    Capacitor: { isNativePlatform: () => true, Plugins: { ZabbaSteps: plugin, ...(extra || {}) } } };
  return { win, fire: (t) => (ev[t] || []).forEach((f) => f()), fireDoc: (t) => (dev[t] = dev[t] || []).forEach((f) => f()), ev, dev, doc };
}

(async () => {
  const t0 = Date.now();
  // display policy
  check("nextDisplayed is monotonic", D.nextDisplayed(100, 80) === 100 && D.nextDisplayed(100, 140) === 140);
  check("large catch-up is the current number at once (no interpolation)", D.nextDisplayed(1200, 1800) === 1800);

  // Repeated background / foreground cycles, lost stream, unknown activity
  let total = 2000, reads = 0, starts = 0, listeners = {};
  const plugin = {
    async getTodaySteps() { reads++; return { steps: total, rawSteps: total + 5, debug: { rawSteps: total + 5, filteredSteps: total, rejectedTotal: 5, reason: "spike" }, validation: { rawSteps: total + 5, validatedSteps: total, unverifiedSteps: total, verifiedSteps: 0 } }; },
    async getCachedSteps() { return { steps: total, rawSteps: total + 5, resume: true, immediate: true }; },
    async startTodayUpdates() { starts++; },
    async requestPermissions() { return { granted: true }; },
    addListener(name, fn) { listeners[name] = fn; return Promise.resolve({ remove() {} }); }
  };
  const H = mkWin(plugin);
  const paints = [];
  const c = D.createController(H.win, { onChange: (s) => paints.push({ t: Date.now() - t0, steps: s.steps, debug: s.debugLine }) });
  check("controller hooks startTodayUpdates and todaySteps + stepsResume", starts === 1 && typeof listeners.todaySteps === "function" && typeof listeners.stepsResume === "function");
  const fg = D.createForegroundRefresh(c, { now: () => Date.now(), afterRefresh: () => {} });
  check("bound resume events", D.bindForegroundEvents(H.win, c, fg.run) === true);

  // Seed a walk
  const started = await c.startWalk();
  check("startWalk persists session", started && D.readWalk(H.win.localStorage) && D.readWalk(H.win.localStorage).walking && D.readWalk(H.win.localStorage).baseSteps === 2000);

  const shown = [];
  async function cycle(newTotal, label) {
    H.doc.hidden = true; H.fireDoc("visibilitychange"); await tick();
    const before = c.state().steps;
    total = newTotal;
    // lost stream: the live todaySteps subscription is gone while suspended; resume still backfills.
    const keepResume = listeners.stepsResume;
    const keepToday = listeners.todaySteps;
    listeners.todaySteps = undefined;
    H.doc.hidden = false;
    const tResume = Date.now();
    H.fireDoc("visibilitychange");
    H.fire("pageshow");
    shown.push(c.state().steps); // synchronous last-known paint, same tick as resume
    await tick();
    shown.push(c.state().steps);
    check(label + ": last-known count on the same tick as resume (no empty/stale flash)", shown[shown.length - 2] >= before);
    check(label + ": backfill applied within one tick", c.state().steps === newTotal && Date.now() - tResume < 50);
    // stream resumes via hookNativeStream / startTodayUpdates
    listeners.todaySteps = keepToday;
    listeners.stepsResume = keepResume;
    if (keepResume) keepResume({ steps: newTotal, rawSteps: newTotal, immediate: true, resume: true });
    check(label + ": monotonic after cycle", c.state().steps >= before);
  }

  await cycle(2400, "fg1");
  await cycle(2650, "fg2");
  await cycle(3100, "fg3");
  check("repeated bg/fg raised the total each time", c.state().steps === 3100);

  // Unknown activity payload from native (fail-open: unverified steps still count)
  listeners.stepsResume && listeners.stepsResume({
    steps: 3500, rawSteps: 3500,
    debug: { rawSteps: 3500, filteredSteps: 3500, rejectedTotal: 0, reason: "", activity: "unknown" },
    validation: { rawSteps: 3500, validatedSteps: 3500, unverifiedSteps: 3500, verifiedSteps: 0 },
    immediate: true, resume: true
  });
  check("unknown activity counts (fail open)", c.state().steps === 3500);
  check("debug line shows raw vs counted", /Phone raw 3,500/.test(c.state().debugLine) && /counted 3,500/.test(c.state().debugLine));

  // Large catch-up at once
  const pre = c.state().steps;
  listeners.todaySteps({ steps: 5200, rawSteps: 5200, immediate: true, resume: true });
  check("large catch-up snaps to 5200 at once (no intermediate values)", c.state().steps === 5200 && pre === 3500);
  check("never shows a lower value", c.state().steps === D.nextDisplayed(pre, 5200));

  // Lost stream then resume event
  const startsBefore = starts;
  delete listeners.todaySteps;
  c.hookNativeStream(); // already hooked; startTodayUpdates already called
  H.fire("pageshow"); await tick();
  check("pageshow still backfills after a lost stream", c.state().steps >= 5200);

  // Webview reload: new controller, same localStorage, last count painted immediately (sync)
  const store = H.win.localStorage;
  const H2 = mkWin({
    async getTodaySteps() { return { steps: 5400, rawSteps: 5410 }; },
    async getCachedSteps() { return { steps: 5200, rawSteps: 5210, resume: true }; },
    async getWalkSession() { return { active: true, startedAt: Date.now() - 60000, baseSteps: 2000, sessionSteps: 3200, steps: 5200 }; },
    async startTodayUpdates() {},
    addListener() { return Promise.resolve({}); }
  });
  H2.win.localStorage = store;
  let firstPaint = null;
  const c2 = D.createController(H2.win, { onChange: (s) => { if (firstPaint == null) firstPaint = s.steps; } });
  check("reload: first paint is the cached total, not 0", firstPaint === 5200 && c2.state().steps === 5200);
  const restored = c2.restoreWalk();
  check("reload: walk session restored from localStorage", !!(restored && restored.walking) && restored.baseSteps === 2000);
  const ctr = W.createNativeCounter(restored.baseSteps);
  check("reload: session steps catch up from persisted base (3200)", ctr.update(5200) === 3200);
  const fg2 = D.createForegroundRefresh(c2, {});
  D.bindForegroundEvents(H2.win, c2, fg2.run);
  H2.doc.hidden = false; H2.fireDoc("visibilitychange"); H2.fire("pageshow");
  const afterSync = c2.state().steps;
  await tick();
  check("reload + resume: displayed updates within one tick to the fast query", c2.state().steps === 5400 && afterSync >= 5200);

  // Snapshot hide / unhide does not change the number
  const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
  check("index hides only step numbers in the app-switcher snapshot", /body\.zabba-snapshot #dailyCount/.test(html) && /#walkSteps/.test(html) && /#stepsStat/.test(html));
  check("index has a debug field for raw vs filtered", /id="stepsDebug"/.test(html));
  check("index restores a persisted walk after a webview reload", /resumePersistedWalk/.test(html) && /getWalkSession/.test(html));
  check("index still wires bindForegroundEvents", /DS\.bindForegroundEvents\(window, daily, dailyFg\.run\)/.test(html));
  check("dailyCount is set by textContent (no count-up animation)", /dailyCount"\)\.textContent = s\.steps\.toLocaleString/.test(html));

  process.exit(R.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
