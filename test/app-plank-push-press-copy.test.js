// App only (Capacitor native): the 30-second pressed-plank top hold is called "plank push press" (lowercase in
// running text, "Plank Push Press" in headings). Browsers keep every original word. The hold rules themselves
// (createHoldReward: 30 s, once per set, +0.5 ZAB, never ends the set; 10 s cap in TUT/challenge) are untouched.
// Run: node test/app-plank-push-press-copy.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let pass = 0, fail = 0; const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + n + (extra ? "  " + extra : "")); };
const nativeWin = (on) => ({ Capacitor: { isNativePlatform: () => on } });

// zab-balance.js ledger labels
function loadBalance(win) {
  const ctx = { console, Math, Date, Number, String, Object, JSON, Array, Promise };
  ctx.window = Object.assign(ctx, win || {}); vm.createContext(ctx);
  vm.runInContext(read("zab-currency.js"), ctx); vm.runInContext(read("zab-balance.js"), ctx);
  return ctx.ZabBalance;
}
const web = require("../zab-balance.js"), webVm = loadBalance(nativeWin(false)), app = loadBalance(nativeWin(true));
const hold1 = { source: "hold", qty: 1, amount: 0.5 }, hold2 = { source: "hold", qty: 2, amount: 1 };
check("browser (node + Capacitor not native): ledger keeps '30-second holds'", web.txLine(hold1).source === "30-second holds" && webVm.txLine(hold2).qty === "2 30-second holds" && webVm.txLine(hold1).qty === "1 30-second hold");
check("app: ledger says 'plank push press'", app.txLine(hold1).source === "30-second plank push presses" && app.txLine(hold1).qty === "1 30-second plank push press" && app.txLine(hold2).qty === "2 30-second plank push presses");
check("hold earn unchanged: 0.5 ZAB, once per set", app.RATES.hold.zab === 0.5 && app.RATES.hold.max === 1 && web.RATES.hold.zab === 0.5);

// index.html dynamic strings
const html = read("index.html");
const line = (start) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf("\n", i)); };
const helpers = [line("function isNativeApp()"), line("const HOLD_CAPPED_TEXT"), line("function holdTimerText("), line("function holdAwardLine("), line("function holdAwardSpoken(")].join("\n").replace("const HOLD_CAPPED_TEXT", "var HOLD_CAPPED_TEXT");
const evalCopy = (on) => { const ctx = Object.assign({}, nativeWin(on)); ctx.window = ctx; vm.createContext(ctx); vm.runInContext(helpers + "\nthis.out = { cap: HOLD_CAPPED_TEXT, timer: holdTimerText(12), line: holdAwardLine(true), lineP: holdAwardLine(false), say: holdAwardSpoken(true), sayP: holdAwardSpoken(false) };", ctx); return ctx.out; };
const W = evalCopy(false), A = evalCopy(true);
check("browser: original live strings", W.cap === "Top hold capped at 10 seconds" && W.timer === "Top hold 12s / 30s" && W.line === "30-second hold! +0.5 ZAB" && W.lineP === "30-second hold!" && W.say === "30-second hold! Plus half a ZAB." && W.sayP === "30-second hold!");
check("app: plank push press strings (spoken too)", A.cap === "Plank push press capped at 10 seconds" && A.timer === "Plank push press 12s / 30s" && A.line === "30-second plank push press! +0.5 ZAB" && A.say === "30-second plank push press! Plus half a ZAB." && A.sayP === "30-second plank push press!");
check("no hard-coded 'Top hold' / '30-second hold!' strings left outside the helpers", (html.match(/"Top hold/g) || []).length === 2 && (html.match(/"30-second hold!/g) || []).length === 3);

// index.html static copy: data-app-copy pairs only swap in the app; browser markup text is untouched
const tags = [...html.matchAll(/<(\w+)([^>]*?) data-app-copy='([^']*)'([^>]*)>([\s\S]*?)<\/\1>/g)];
check("6 app-copy elements (drop your tuts board: no Hold column / hold copy since the 1:20 TUT rule)", tags.length === 6, String(tags.length));
let allFrom = true, allTo = true;
for (const m of tags) { const pairs = JSON.parse(m[3].replace(/&#39;/g, "'")); for (const [f, t] of pairs) { if (m[5].indexOf(f) < 0) allFrom = false; if (!/plank push press|Plank Push Press/.test(t)) allTo = false; } }
check("every swapped phrase exists in the browser text", allFrom);
check("every replacement says plank push press (heading: Plank Push Press)", allTo);
const applySrc = html.slice(html.indexOf("function applyAppCopy(doc)"), html.indexOf("\nif (typeof document !== \"undefined\") applyAppCopy(document);"));
const runApply = (on) => {
  const els = tags.map((m) => ({ innerHTML: m[5], getAttribute: () => m[3].replace(/&#39;/g, "'") }));
  const ctx = Object.assign({ JSON }, nativeWin(on)); ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(line("function isNativeApp()") + "\n" + applySrc + "\nthis.n = applyAppCopy({ querySelectorAll: () => this.els });", Object.assign(ctx, { els }));
  return { n: ctx.n, els };
};
const rw = runApply(false), ra = runApply(true);
check("browser: applyAppCopy changes nothing", rw.n === 0 && rw.els.every((e, i) => e.innerHTML === tags[i][5]));
check("app: applyAppCopy swaps every phrase", ra.n === 7 && ra.els.some((e) => /Holding a plank push press never ends it\./.test(e.innerHTML)) && !ra.els.some((e) => /top hold/i.test(e.innerHTML)));
check("app camera note uses the name", /Get into a plank push press\. After Go, your first full push-up counts\./.test(html) && /Get into a push-press plank\. After Go, your first full push-up counts\./.test(html));

// tut.html
const tut = read("tut.html");
check("tut.html: browser text unchanged, app-only swap script gated on isNativePlatform", /Holding the top never ends it\./.test(tut) && /Each hold at the top counts for at most 10 seconds of tension\./.test(tut) && /Holding the top never loses\./.test(tut) && /if \(!\(C && typeof C\.isNativePlatform === "function" && C\.isNativePlatform\(\)\)\) return;/.test(tut) && /Holding a plank push press never ends it\./.test(tut));

// The hold reward itself is unchanged.
const PS = require("../push-session.js");
{ const h = PS.createHoldReward(); let r, t = 0; h.update(true, 0, false); for (t = 0; t <= 31000; t += 100) { r = h.update(true, t, false); if (r.awarded) break; }
  check("createHoldReward: awards at 30 s continuous top hold", r && r.awarded && t >= 30000 && t < 30300, String(t)); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
