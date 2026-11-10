// App only: after a completed press-and-hold (Start walk "Hold to stop", washers game button), the click that the
// release produces is swallowed however long the hold was. Browsers keep the original 600 ms window.
// Run: node test/app-hold-release.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const block = (start) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf("\n}\n", i) + 2); };
function rig() {
  let now = 0; const timers = [];
  const ctx = { setTimeout: (f, d) => { timers.push({ at: now + d, f }); } };
  vm.createContext(ctx); vm.runInContext(block("function holdSwallow(btn, clear)"), ctx);
  const L = {}; const btn = { addEventListener: (t, f) => { (L[t] = L[t] || []).push(f); }, removeEventListener: (t, f) => { L[t] = (L[t] || []).filter((x) => x !== f); } };
  const fire = (t) => (L[t] || []).slice().forEach((f) => f());
  const adv = (ms) => { now += ms; timers.sort((a, b) => a.at - b.at); while (timers.length && timers[0].at <= now) timers.shift().f(); };
  return { ctx, btn, fire, adv };
}
{ const r = rig(); let flag = true; r.ctx.holdSwallow(r.btn, () => { flag = false; });
  r.adv(5000); check("held 5 s past the hold: click still swallowed while the finger is down", flag);
  r.fire("pointerup"); check("release: swallowed right after (the click comes now)", flag);
  r.adv(450); check("400 ms after release: guard cleared, the next tap works", !flag); }
{ const r = rig(); let flag = true; r.ctx.holdSwallow(r.btn, () => { flag = false; }); r.fire("pointerleave"); r.adv(450); check("finger slid off: cleared 400 ms later", !flag); }
{ const r = rig(); let flag = true; r.ctx.holdSwallow(r.btn, () => { flag = false; }); r.adv(10500); r.adv(500); check("safety: cleared after 10 s even without a pointer event", !flag); }
check("walk and washers use it only in the app; browsers keep the 600 ms window",
  /walkHoldDone = true; if \(typeof isNativeApp === "function" && isNativeApp\(\) && typeof holdSwallow === "function"\) holdSwallow\(\$\("dailyWalkBtn"\), \(\) => \{ walkHoldDone = false; \}\); else setTimeout\(\(\) => \{ walkHoldDone = false; \}, 600\);/.test(html) &&
  /gameHoldDone = true; if \(typeof isNativeApp === "function" && isNativeApp\(\) && typeof holdSwallow === "function"\) holdSwallow\(\$\("startBtn"\), \(\) => \{ gameHoldDone = false; \}\); else setTimeout\(\(\) => \{ gameHoldDone = false; \}, 600\);/.test(html));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
