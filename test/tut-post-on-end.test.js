// TUT (One long set and 3:00 challenge): a camera failure (knees / stood up / out of frame) no longer voids: with >= 1 rep the time under tension
// and reps so far post exactly once, same path and fields as a normal post; a manual End session posts too. No minute threshold.
// 0 reps: nothing to post. Runs the real voidTutSet() / showChallengeResult() / finishPushSet() from index.html.
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
  const ctx = vm.createContext({ pushState, pushMode: mode, $: el, Date: Object.assign(function () { return new global.Date(); }, { now: () => 1000 + o.ms }), ZT: null, clearInterval() {}, pushWake: { stop: () => ({ catch() {} }) }, pushChallenge: { reset() {}, update() { log.push("chUpdate"); }, result: () => ({ reps: o.chReps == null ? 20 : o.chReps, tutMs: 33000, score: 53 }) }, performance: { now: () => 5 }, challengeFlags: { standing: 0, knees: 0 }, escapeHtml: (x) => String(x), formatTut: (ms) => Math.round(ms / 1000) + "s tut",
    tutTimeVoice: { end: () => log.push("tutVoice.end") }, postureGuard: { state: () => ({ count: 0 }) }, currentUser: o.signedIn === false ? null : { uid: "u1" }, displayNameOf: () => "Zab",
    formatTime: (ms) => Math.round(ms / 1000) + "s", renderPush() {}, paintPushRows() {}, sessionTouch() {}, zabNote: () => "", zabRing() {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); log.push("local:" + k); }, removeItem() {}, key: () => null, length: 0 },
    localPush: () => [], pushTotalKey: () => "zabbadat-push-total-u1-d", pushTutKey: () => "zabbadat-push-tut-u1-d", pushSetsKey: () => "zabbadat-push-sets-u1-d", savedPushTotal: () => 0, savedPushSets: () => 0, savedPushTut: () => 0,
    awardZab: (...a) => { log.push("award:" + a[0]); return Promise.resolve({ credited: 0 }); }, saveRemotePush: (r) => { log.push("post:" + r.reps + ":" + Math.round(r.ms)); return Promise.resolve(); },
    window: { ZabbadatChallenge: { flagSummary: () => "No flags" }, ZabbadatSession: SS, ZabbadatGetSet: { interruptSpeak: (w) => log.push("say:" + w), SET_DONE_LINE: G.SET_DONE_LINE } } });
  vm.runInContext(src, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { log, store, pushState, els, ctx, fail: (why) => run(`voidTutSet(${JSON.stringify(why)})`), end: () => run("finishPushSet()"), posts: () => log.filter((x) => /^post:/.test(x)) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const complete = (p) => p.log.filter((x) => x === "say:Set complete.").length;
(async () => {
  check("rule: long and challenge, >= 1 rep posts on failure; 0 reps and Sets do not; no minute threshold exported", SS.postOnFailure("long", 1) && SS.postOnFailure("challenge", 35) && !SS.postOnFailure("long", 0) && !SS.postOnFailure("sets", 35) && SS.TUT_POST_MIN_MS === undefined);
  for (const secs of [75, 20, 1]) {
    const p = page("long", { ms: secs * 1000 }); p.fail("knees"); await tick();
    check(`long: failure at ${secs} s / 35 reps posts exactly once with reps 35 and ms ${secs * 1000}`, p.posts().length === 1 && p.posts()[0] === "post:35:" + secs * 1000);
    check(`long ${secs} s: same save path as End session (local totals saved, ZAB awarded), not zeroed or voided`, p.store["zabbadat-push-total-u1-d"] === "35" && p.log.includes("award:pushups") && p.pushState.reps === 35 && !/voided|nothing was saved/i.test(p.els.pushStatus.textContent));
    check(`long ${secs} s: clock stopped, finished; says "Set complete." exactly once`, p.pushState.finished === true && p.pushState.running === false && complete(p) === 1 && p.log.includes("tutVoice.end"));
    check(`long ${secs} s: result line names the post and the reason`, new RegExp("posted 35 reps in " + secs + "s\\. Ended: Knees down\\.").test(p.els.pushStatus.textContent) && p.els.camNote.textContent === "Set ended");
    p.end(); p.fail("standing"); p.end(); await tick();
    check(`long ${secs} s: End session / second failure afterwards do not post again, nor speak again`, p.posts().length === 1 && complete(p) === 1);
  }
  // 3:00 challenge: failure posts the result so far (time under tension from the challenge clock, reps from the challenge).
  let p = page("challenge", { ms: 95000, chReps: 20 }); p.fail("frame"); await tick();
  check("challenge: failure at 95 s posts once with the challenge reps (20) and the real elapsed ms", p.posts().length === 1 && p.posts()[0] === "post:20:95000" && p.log.includes("chUpdate"));
  check("challenge: result card shows 'ended early' with the reason, reps and time under tension; challenge clock not reset; status not voided", /ended early: Out of frame/.test(p.els.challengeResult.innerHTML) && /Reps: 20/.test(p.els.challengeResult.innerHTML) && p.els.challengeResult.hidden === false && !p.log.includes("challengeReset") && !/voided|nothing was saved/i.test(p.els.pushStatus.textContent));
  check("challenge: says 'Set complete.' once; a second failure does not post again", complete(p) === 1 && (p.fail("knees"), p.posts().length === 1 && complete(p) === 1));
  p = page("challenge", { ms: 30000, reps: 0, chReps: 0 }); p.fail("knees"); await tick();
  check("challenge: failure with 0 reps posts nothing, nothing saved, says 'Set complete.' once", p.posts().length === 0 && !p.log.some((x) => /^local:/.test(x)) && complete(p) === 1 && /^Set ended: Knees down/.test(p.els.pushStatus.textContent));
  p = page("long", { ms: 90000, reps: 0 }); p.fail("frame"); await tick();
  check("long: failure with 0 reps posts nothing (nothing to post), says 'Set complete.' once", p.posts().length === 0 && !p.log.some((x) => /^local:/.test(x)) && complete(p) === 1 && /^Set ended: Out of frame/.test(p.els.pushStatus.textContent) && p.pushState.reps === 0);
  // Manual end: posts at any time with reps, once, and says Set complete.
  for (const secs of [75, 12]) {
    p = page("long", { ms: secs * 1000 }); p.end(); p.end(); await tick();
    check(`manual End session at ${secs} s / 35 reps posts once (same fields), says "Set complete." once`, p.posts().length === 1 && p.posts()[0] === "post:35:" + secs * 1000 && complete(p) === 1 && new RegExp("posted 35 reps in " + secs + "s\\.").test(p.els.pushStatus.textContent) && !/Ended:/.test(p.els.pushStatus.textContent));
  }
  p = page("sets", { ms: 90000 }); p.fail("knees"); p.end(); await tick();
  check("regular Sets: the failure handler does nothing; finishing a set stays silent (no TUT end line)", p.posts().length === 1 && complete(p) === 0 && p.pushState.reps === 35);
  p = page("long", { ms: 75000, signedIn: false }); p.fail("knees"); await tick();
  check("signed out: failure saves on this device with the reason, no remote post", p.posts().length === 0 && p.log.includes("local:zabbadat-push-total-u1-d") && /saved on this device\. Sign in to post\. Ended: Knees down\./.test(p.els.pushStatus.textContent));
  check("wiring: End session still calls finishPushSet in long mode; poseTick still calls voidTutSet(failed)", /pushEndBtn"\)\.onclick = \(\) => \{ if \(pushMode === "long"\) finishPushSet\(\); \}/.test(html) && /if \(failed\) voidTutSet\(failed\);/.test(html));
  check("copy: longNote, challengeNote and tut.html say the time and reps so far still post", (html.match(/ends the set, and the time under tension and reps so far still post/g) || []).length === 2 && /ends the set, and your time under tension and reps so far still post/.test(fs.readFileSync(path.join(__dirname, "../tut.html"), "utf8")));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
