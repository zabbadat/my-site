// Push-up tallies repaint at Eastern midnight while the page stays open (owner, Nov 16: Reset total removed; daily reset is
// automatic). Runs the real pushTotalKey / saved* / pushEtDay / pushDayCheck from index.html with a fake clock, a stub
// renderPush that paints the same keyed values, and the real et-day.js. Run: node test/push-midnight-repaint.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const fnSrc = (n) => { const a = "function " + n + "("; const i = html.indexOf(a); if (i < 0) throw new Error("missing " + n); const eol = html.indexOf("\n", i); const l = html.slice(i, eol);
  if (/\}\s*$/.test(l) && (l.match(/\{/g) || []).length === (l.match(/\}/g) || []).length) return l; return html.slice(i, html.indexOf("\n}", i) + 2); };
const line = (start) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf("\n", i)); };
let now = Date.parse("2026-11-17T04:58:00Z"); // 11:58 PM Eastern, Nov 16
const RealDate = Date; function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(now); } FakeDate.now = () => now; FakeDate.parse = RealDate.parse; FakeDate.UTC = RealDate.UTC;
const store = {}, els = {}, listeners = {}, intervals = [];
const ctx = { Date: FakeDate, Number, String, Math, Intl, console, localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: { hidden: false, addEventListener: (ev, f) => { (listeners[ev] = listeners[ev] || []).push(f); } }, setInterval: (f, d) => intervals.push(f) };
ctx.window = ctx; ctx.window.addEventListener = (ev, f) => { (listeners[ev] = listeners[ev] || []).push(f); };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "et-day.js"), "utf8"), ctx);
const src = ["let currentUser = { uid: 'u1' }; let paints = 0; const $ = (id) => (els[id] = els[id] || { textContent: '' });",
  fnSrc("pushTotalKey"), fnSrc("savedPushTotal"), fnSrc("pushTutKey"), fnSrc("savedPushTut"), fnSrc("pushSetsKey"), fnSrc("savedPushSets"),
  "function renderPush() { paints++; $('pushReps').textContent = String(savedPushTotal()); $('pushSets').textContent = String(savedPushSets()); $('pushTut').textContent = String(savedPushTut()); }",
  fnSrc("pushEtDay"), line("let pushTallyDay = null;"), fnSrc("pushDayCheck"), line('if (typeof setInterval === "function" && typeof document !== "undefined" && document.addEventListener) { pushDayCheck();'),
  "this.T = { renderPush, pushTotalKey, get paints() { return paints; } };"].join("\n");
ctx.els = els; vm.runInContext(src, ctx);
const T = ctx.T;
store[T.pushTotalKey()] = "42"; store[T.pushTotalKey().replace("total", "sets")] = "3"; store[T.pushTotalKey().replace("total", "tut")] = "90000";
T.renderPush();
check("before midnight: panel shows today's tallies (42 reps, 3 sets)", els.pushReps.textContent === "42" && els.pushSets.textContent === "3" && els.pushTut.textContent === "90000");
check("a minute timer and a visibilitychange listener are installed", intervals.length === 1 && (listeners.visibilitychange || []).length === 1);
const p0 = T.paints; intervals[0]();
check("same Eastern day: the minute check does not repaint", T.paints === p0);
now = Date.parse("2026-11-17T05:00:30Z"); // 12:00:30 AM Eastern, Nov 17
intervals[0]();
check("after Eastern midnight, page left open: the minute check repaints Reps / Sets / TUT today to 0 (no reload)", T.paints === p0 + 1 && els.pushReps.textContent === "0" && els.pushSets.textContent === "0" && els.pushTut.textContent === "0");
check("yesterday's stored tallies are untouched (history / boards keep them)", store["zabbadat-push-total-u1-2026-11-16"] === "42");
now = Date.parse("2026-11-18T05:01:00Z"); els.pushReps.textContent = "stale"; listeners.visibilitychange[0]();
check("phone woken after the next Eastern midnight: visibilitychange repaints at once", els.pushReps.textContent === "0" && T.paints === p0 + 2);
listeners.visibilitychange[0](); check("no repaint storm: second wake on the same day does nothing", T.paints === p0 + 2);
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
