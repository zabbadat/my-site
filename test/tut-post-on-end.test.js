// One long set (TUT): once the clock has reached 60 s, the reps post on a camera failure AND on a manual End session, exactly once.
// Under 60 s keeps the old behavior (failure voids; manual End posts). Runs the real voidTutSet() and finishPushSet() from index.html.
// Run: node test/tut-post-on-end.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const SS = require("../push-session.js"), G = require("../get-set.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const src = html.slice(html.indexOf("function voidTutSet(reason) {"), html.indexOf("function finishChallenge() {")) + "\n" +
  html.slice(html.indexOf("function finishPushSet(endedBy) {"), html.indexOf("// One Start button: gate"));
function page(mode, o) {
  o = o || {}; const log = [], store = {}, els = {};
  const el = (id) => els[id] || (els[id] = { hidden: false, textContent: "", value: id === "player" ? "Zab" : "" });
  const pushState = { reps: o.reps == null ? 35 : o.reps, tut: 48000, elapsed: 0, startedAt: 1000, running: true, finished: false, tick: 7 };
  const ctx = vm.createContext({ pushState, pushMode: mode, $: el, Date: Object.assign(function () { return new global.Date(); }, { now: () => 1000 + o.ms }), ZT: null, clearInterval() {}, pushWake: { stop: () => ({ catch() {} }) }, pushChallenge: { reset() {} },
    tutTimeVoice: { end: () => log.push("tutVoice.end") }, postureGuard: { state: () => ({ count: 0 }) }, currentUser: o.signedIn === false ? null : { uid: "u1" }, displayNameOf: () => "Zab",
    formatTime: (ms) => Math.round(ms / 1000) + "s", renderPush() {}, paintPushRows() {}, sessionTouch() {}, zabNote: () => "", zabRing() {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); log.push("local:" + k); }, removeItem() {}, key: () => null, length: 0 },
    localPush: () => [], pushTotalKey: () => "zabbadat-push-total-u1-d", pushTutKey: () => "zabbadat-push-tut-u1-d", pushSetsKey: () => "zabbadat-push-sets-u1-d", savedPushTotal: () => 0, savedPushSets: () => 0, savedPushTut: () => 0,
    awardZab: (...a) => { log.push("award:" + a[0]); return Promise.resolve({ credited: 0 }); }, saveRemotePush: (r) => { log.push("post:" + r.reps + ":" + Math.round(r.ms)); return Promise.resolve(); },
    window: { ZabbadatSession: SS, ZabbadatGetSet: { interruptSpeak: (w) => log.push("say:" + w), SET_DONE_LINE: G.SET_DONE_LINE } } });
  vm.runInContext(src, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { log, store, pushState, els, ctx, fail: (why) => run(`voidTutSet(${JSON.stringify(why)})`), end: () => run("finishPushSet()"), posts: () => log.filter((x) => /^post:/.test(x)) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
(async () => {
  check("rule: long mode, 60 s, 1 rep posts on failure; 59.9 s, 0 reps, other modes do not", SS.postOnFailure("long", 60000, 1) && !SS.postOnFailure("long", 59999, 35) && !SS.postOnFailure("long", 90000, 0) && !SS.postOnFailure("challenge", 90000, 35) && !SS.postOnFailure("sets", 90000, 35) && SS.TUT_POST_MIN_MS === 60000);
  // Failure at 75 s with 35 reps: posts once with the normal fields (reps, ms), saves locally, speaks the failure line, not voided.
  let p = page("long", { ms: 75000 }); p.fail("knees"); await tick();
  check("failure at 75 s / 35 reps: posts exactly once with reps 35 and ms 75000", p.posts().length === 1 && p.posts()[0] === "post:35:75000");
  check("failure at 75 s: same save path as End session (local totals saved, ZAB awarded for pushups)", p.log.includes("local:zabbadat-push-total-u1-d") && p.store["zabbadat-push-total-u1-d"] === "35" && p.log.includes("award:pushups") && p.pushState.reps === 35);
  check("failure at 75 s: clock stopped, set finished, not voided, says Set done. once", p.pushState.finished === true && p.pushState.running === false && p.log.filter((x) => x === "say:Set done.").length === 1 && !/voided/i.test(p.els.pushStatus.textContent));
  check("failure at 75 s: result line names the reason and the post", /posted 35 reps in 75s\. Ended: Knees down\./.test(p.els.pushStatus.textContent));
  // Then the user taps End session after the failure, or a second failure fires: no second post.
  p.end(); p.fail("standing"); p.end(); await tick();
  check("End session / second failure after an auto-end do not post again (exactly once)", p.posts().length === 1);
  // Manual End at 75 s / 35 reps posts once; a second End does nothing.
  p = page("long", { ms: 75000 }); p.end(); p.end(); await tick();
  check("manual End session at 75 s / 35 reps posts once with the same fields", p.posts().length === 1 && p.posts()[0] === "post:35:75000" && /posted 35 reps in 75s\./.test(p.els.pushStatus.textContent) && !/Ended:/.test(p.els.pushStatus.textContent));
  // Under the minute: failure voids (old behavior), manual End still posts.
  p = page("long", { ms: 45000 }); p.fail("knees"); p.end(); await tick();
  check("failure at 45 s: still voided, nothing posted or saved, End afterwards does nothing", p.posts().length === 0 && p.log.filter((x) => /^local:/.test(x)).length === 0 && /^Set voided: Knees down/.test(p.els.pushStatus.textContent) && p.pushState.reps === 0);
  p = page("long", { ms: 45000 }); p.end(); await tick();
  check("manual End at 45 s / 35 reps still posts (existing behavior)", p.posts().length === 1 && p.posts()[0] === "post:35:45000");
  // 60 s boundary and zero reps.
  p = page("long", { ms: 60000 }); p.fail("frame"); await tick();
  check("failure at exactly 60 s posts", p.posts().length === 1);
  p = page("long", { ms: 90000, reps: 0 }); p.fail("frame"); await tick();
  check("failure at 90 s with 0 reps does not post (voided)", p.posts().length === 0 && /^Set voided/.test(p.els.pushStatus.textContent));
  // 3:00 challenge and regular Sets are unchanged.
  p = page("challenge", { ms: 90000 }); p.fail("knees"); await tick();
  check("3:00 challenge failure at 90 s is still voided (unchanged)", p.posts().length === 0 && /^Set voided/.test(p.els.pushStatus.textContent));
  p = page("sets", { ms: 90000 }); p.fail("knees"); await tick();
  check("regular Sets: failure handler does nothing", p.posts().length === 0 && p.pushState.running === true);
  // Signed out: saved on device with the failure reason, no remote post.
  p = page("long", { ms: 75000, signedIn: false }); p.fail("knees"); await tick();
  check("signed out: failure at 75 s saves on this device, no remote post", p.posts().length === 0 && p.log.includes("local:zabbadat-push-total-u1-d") && /saved on this device\. Sign in to post\. Ended: Knees down\./.test(p.els.pushStatus.textContent));
  // Wiring pins.
  check("End session button still calls finishPushSet for long mode; poseTick still calls voidTutSet(failed)", /pushEndBtn"\)\.onclick = \(\) => \{ if \(pushMode === "long"\) finishPushSet\(\); \}/.test(html) && /if \(failed\) voidTutSet\(failed\);/.test(html));
  check("tut.html copy says one minute on posts", /from one minute on, your reps and time post/.test(fs.readFileSync(path.join(__dirname, "../tut.html"), "utf8")) && /From one minute on, your reps and time post/.test(html));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
