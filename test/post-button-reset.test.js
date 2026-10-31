// One main button per competition (start -> stop/end, the stop auto-posts) plus a separate Reset. The manual "Post to board" button is gone;
// Step Equity gets "Reset", which restarts the SESSION readout from zero and never lowers today's total or the posted board total.
// Runs the real postDaily() and the Reset handler from index.html.
// Run: node test/post-button-reset.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const html = R("index.html"), DS = require("../daily-steps.js");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const tick = () => new Promise((r) => setTimeout(r, 5));

// ---- markup / copy
check("no dailyPostBtn and no 'Post to board' button or copy anywhere (pages, scripts)", !/dailyPostBtn/.test(html) && !/Post to board/i.test(["index.html", "how-it-works.html", "about.html", "rules.html", "plank.html", "tut.html", "washers.html", "zab.html", "reputation.html", "daily-steps.js", "walk-session.js"].map(R).join("\n")));
check("Step Equity: one Reset button (dailyResetBtn, label 'Reset', same danger style as the other Reset buttons)", /<button class="btn danger" id="dailyResetBtn" type="button">Reset<\/button>/.test(html));
check("Step Equity lead explains: stopping posts, Reset clears the session readout only, total never goes down", /stopping posts your steps to the daily board\. Reset clears the session readout only; today's total never goes down/.test(html));
check("existing resets kept with the label 'Reset': washers resetBtn; push-ups have no Reset (sets auto-reset); plank keeps 'New hold' (behaviour unchanged)", /id="resetBtn" type="button">Reset</.test(html) && !/pushResetBtn/.test(html) && /id="plankAgainBtn" type="button" hidden>New hold</.test(html));
check("main walk button cycle unchanged: 'Start live walk' -> 'Hold to stop' (1 s hold, pocket/walk lock) -> back to Start", /s\.walking \? "Hold to stop" : "Start live walk"/.test(html) && /bindHold\(\$\("dailyWalkBtn"\), \{ label: "Hold to stop"/.test(html) && /Hold to stop the walk\./.test(html));
check("native app: Reset is hidden (the phone counter owns the all-day total; there is no session), Refresh from phone stays", /\$\("dailyResetBtn"\)\.hidden = true; \$\("dailyRefreshBtn"\)\.hidden = false/.test(html));

// ---- real postDaily + Reset handler
const pdSrc = html.slice(html.indexOf("async function postDaily(quiet) {"), html.indexOf("function paintDailyRows(rows) {"));
const rsStart = html.indexOf('$("dailyResetBtn").onclick = () => {'), rsSrc = html.slice(rsStart, html.indexOf("\n  };\n", rsStart) + 5);
function page(o) {
  o = o || {}; const els = {}, calls = [], timers = [];
  const el = (id) => els[id] || (els[id] = { textContent: "", hidden: false });
  const st = { steps: o.steps == null ? 4200 : o.steps, walking: !!o.walking };
  const ctx = vm.createContext({ $: el, daily: { state: () => st }, currentUser: o.signedIn === false ? null : { uid: "u1" }, dailyPosted: o.posted || 0, dailyLiveTimer: null, dailyRetryTimer: null, dailyRetries: 0,
    walkLockOn: !!o.lock, walkSession: o.session || null, liveShown: !!o.liveShown,
    saveRemoteDaily: async (s) => { calls.push("save:" + s.steps); if (o.offline) throw new Error("offline"); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  vm.runInContext(pdSrc + "\n" + rsSrc.replace('$("dailyResetBtn").onclick =', "var resetClick ="), ctx);
  const run = (c) => vm.runInContext(c, ctx);
  return { els, calls, timers, st, ctx, reset: () => run("resetClick()"), post: (q) => run("postDaily(" + q + ")"), posted: () => run("dailyPosted") };
}
(async () => {
  let p = page({ steps: 4200, posted: 4000 });
  p.reset(); await tick();
  check("Reset (stopped): readout back to 00:00 / 0, today's total untouched (4,200), says so in the UI copy", p.els.walkClock.textContent === "00:00" && p.els.walkSteps.textContent === "0" && p.st.steps === 4200 && /Session reset to 0\. Today's total \(4,200 steps\) is unchanged\./.test(p.els.walkStatus.textContent));
  check("Reset posts any not-yet-posted steps once (never lowers the board total: 4,000 -> 4,200)", p.calls.join() === "save:4200" && p.posted() === 4200);
  p.reset(); await tick();
  check("Reset again with nothing new: no second post of the same total", p.calls.length === 1 && p.posted() === 4200);
  p = page({ steps: 100, posted: 4200 }); p.post(true); await tick();
  check("a lower local total never posts over a higher posted total (quiet post skips)", p.calls.length === 0 && p.posted() === 4200);
  check("mergeNative / syncRemote never lower the total (reset has no path to zero it)", DS.mergeNative(4200, 0) === 4200 && DS.mergeNative(4200, 100) === 4200 && DS.mergeNative(4200, 5000) === 5000 && DS.validateRecord(DS.buildRecord({ uid: "u1", date: "2026-10-27", steps: 10 }), "u1_2026-10-27", 4200).errors.includes("steps can't go down"));
  check("Reset code never writes the total (no setSteps / writeLocal / steps = 0 / remote delete)", !/setSteps|writeLocal|\.steps\s*=|deleteDoc|updateDoc|rollDay/.test(rsSrc));
  p = page({ walking: true, lock: true, session: {} }); p.reset();
  check("Reset while a walk runs (walk lock / session active): blocked with 'Hold to stop first.', nothing changes or posts", /Hold to stop first\./.test(p.els.dailyStatus.textContent) && p.calls.length === 0 && p.els.walkClock === undefined);
  p = page({ walking: false, lock: false, session: {} }); p.reset();
  check("Reset with a session object still live: blocked too (never zeroes a running session)", /Hold to stop first\./.test(p.els.dailyStatus.textContent) && p.calls.length === 0);
  p = page({ liveShown: true }); p.reset();
  check("Reset while another device's live walk is mirrored: does not clear it", /Live on another device/.test(p.els.walkStatus.textContent) && p.els.walkClock === undefined && p.calls.length === 0);
  p = page({ signedIn: false }); p.reset(); await tick();
  check("signed out: Reset only clears the readout; nothing is posted", p.calls.length === 0 && p.els.walkClock.textContent === "00:00");
  // ---- failure: status-line retry, no permanent button
  p = page({ steps: 900, offline: true }); await p.post(false);
  check("post fails (offline): status says retrying automatically; one retry timer (30 s); total stays on the phone; no Retry button in the markup", /Saved on this phone\. Board offline: retrying the post automatically\./.test(p.els.dailyStatus.textContent) && p.timers.length === 1 && p.timers[0].ms === 30000 && p.posted() === 0 && !/id="[a-zA-Z]*Retry/i.test(html));
  await p.post(true); check("a second failure while a retry is pending does not stack timers", p.timers.length === 1);
  for (let i = 0; i < 8; i++) { p.timers.splice(0).forEach((t) => t.fn()); await tick(); }
  check("retries stop after 5 and the status says it posts next time you walk or open the app", /It posts the next time you walk or open the app\./.test(p.els.dailyStatus.textContent) && p.calls.length <= 7);
  p = page({ steps: 900 }); await p.post(false);
  check("post succeeds: 'Posted 900 steps to today's board.' and retries reset", /^Posted 900 steps to today's board\.$/.test(p.els.dailyStatus.textContent) && p.posted() === 900 && p.timers.length === 0);
  // ---- unchanged auto-post
  check("auto-post on stop unchanged: stopWalk then postDaily(true); endWalk still gates on the 5 min minimum and signed-in", /daily\.stopWalk\(\); postDaily\(true\)/.test(html) && /const q = WS\.qualifies\(r\)/.test(html) && /Sessions under 5 minutes don't count/.test(R("walk-session.js")));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
