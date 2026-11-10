// App-only sharpened hold-to-stop (createHoldTracker + index.css/guards). Browser bindHold is unchanged.
// Run: node test/app-hold-stop.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };

const start = html.indexOf("function createHoldTracker(opts)");
const end = html.indexOf("if (typeof window !== \"undefined\") window.ZabbadatHold", start);
if (start < 0 || end < 0) { console.log("FAIL  createHoldTracker missing"); process.exit(1); }
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(html.slice(start, end) + "\nthis.createHoldTracker = createHoldTracker;", ctx);
const make = () => ctx.createHoldTracker({ holdMs: 1000, graceMs: 150, moveTol: 30 });
const ev = (o) => Object.assign({ isPrimary: true, pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 }, o);

{
  const t = make();
  t.down(ev({}), 0);
  const up = t.up(ev({}), 200);
  check("quick tap (200 ms) does not complete", up.action === "pause" && up.elapsed === 200);
  const exp = t.expirePause(200 + 151);
  check("quick tap: after grace, hold cancels and should hint (does not stop)", exp.action === "cancel" && exp.hint === true && exp.progress === 0);
}
{
  const t = make();
  t.down(ev({}), 0);
  check("full hold of 1000 ms completes", t.tick(1000).action === "complete");
}
{
  const t = make();
  t.down(ev({}), 0);
  const up = t.up(ev({}), 860);
  check("early lift inside the 150 ms grace (860 ms of 1000) still stops", up.action === "complete");
}
{
  const t = make();
  t.down(ev({}), 0);
  const up = t.up(ev({}), 700);
  check("early lift outside the grace pauses rather than completing", up.action === "pause");
  const exp = t.expirePause(700 + 151);
  check("early lift outside the grace cancels and resets the fill", exp.action === "cancel" && exp.progress === 0);
}
{
  const t = make();
  t.down(ev({ clientX: 10, clientY: 10 }), 0);
  const ok = t.move(ev({ clientX: 10 + 20, clientY: 10 + 10, timeStamp: 200 })); // ~22 px
  check("drift under 30 px is tolerated", ok.action === "move");
  const far = t.move(ev({ clientX: 10 + 40, clientY: 10, timeStamp: 300 })); // 40 px
  check("drift over 30 px cancels and resets the fill", far.action === "cancel-move" && far.progress === 0);
}
{
  const t = make();
  t.down(ev({ pointerId: 1 }), 0);
  const second = t.down(ev({ pointerId: 2, isPrimary: false }), 100);
  check("multi-touch / non-primary pointer is ignored", second.action === "ignore");
  check("primary hold can still complete after an ignored extra finger", t.tick(1000).action === "complete");
}

check("browser bindHold path is unchanged (pointerleave still cancels only on the web branch)",
  /if \(typeof isNativeApp === "function" && isNativeApp\(\)\) \{ bindHoldNative\(btn, o\); return; \}/.test(html) &&
  /btn\.onpointerleave = cancel;/.test(html) &&
  /btn\.onpointerup = cancel;/.test(html));
check("app hold uses pointer capture, touch-action none, and a growing fill indicator",
  /setPointerCapture/.test(html) && /touch-action: none/.test(html) && /hold-fill/.test(html) && /fill\.style\.width/.test(html));
check("button and session HUD block iOS text selection, callout and the magnifier loupe",
  /#dailyWalkBtn[\s\S]{0,400}#stepsHud[\s\S]{0,500}-webkit-user-select: none; user-select: none; -webkit-touch-callout: none/.test(html) &&
  /#dailyCount, #walkClock, #walkSteps/.test(html) &&
  /document\.addEventListener\("selectstart", blockSelect, true\)/.test(html) &&
  /document\.addEventListener\("contextmenu", blockSelect, true\)/.test(html) &&
  /blockSelect\(ev\) \{ ev\.preventDefault\(\); \}/.test(html) &&
  /-webkit-touch-callout: none/.test(html) &&
  /session-hud/.test(html));
check("owner-confirmed fill indicator is present in CSS and wired on the walk and washers buttons",
  /#dailyWalkBtn \.hold-fill, #startBtn \.hold-fill/.test(html) && /bindHoldNative/.test(html));
check("light haptic only if Capacitor Haptics is already present",
  /Plugins && window\.Capacitor\.Plugins\.Haptics/.test(html) && /H\.impact\(\{ style: "Light" \}\)/.test(html));
check("native plank Stop stays a tap (no hold-to-stop on the camera screen)", (() => {
  try {
    const sw = fs.readFileSync(path.join(__dirname, "../../build5-app/ios/App/App/ZabbaPlankPlugin.swift"), "utf8");
    return /stopButton\.addTarget\(self, action: #selector\(stopTapped\), for: \.touchUpInside\)/.test(sw);
  } catch (e) {
    // Site-only checkout: skip the native file, but the site must not invent a plank hold-to-stop.
    return !/plankStopBtn[^\n]*bindHold/.test(html);
  }
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
