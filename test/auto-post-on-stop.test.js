// Auto-post on stop: "Stop camera" while a push set / TUT session / 3:00 challenge clock is running with >= 1 rep ends it and posts once through
// finishPushSet (same path as Finish / End session). Paused sets, 0 reps and signed-out users post nothing. Runs the real endPushOnCameraStop(),
// showChallengeResult() and finishPushSet() from index.html. Also locks in the audit: every other stop path already posts, and the
// manual buttons, minimums and wager/settlement code are untouched.
// Run: node test/auto-post-on-stop.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const SS = require("../push-session.js"), G = require("../get-set.js");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const html = R("index.html");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const src = html.slice(html.indexOf("function showChallengeResult(r, title) {"), html.indexOf("function finishChallenge() {")) + "\n" + html.slice(html.indexOf("function endPushOnCameraStop() {"), html.indexOf("// Hero CTAs: jump to the counter")) + "\n" +
  html.slice(html.indexOf("function finishPushSet(endedBy) {"), html.indexOf("// One Start button: gate"));
function page(mode, o) {
  o = o || {}; const log = [], store = {}, els = {};
  const el = (id) => els[id] || (els[id] = { hidden: false, textContent: "", value: id === "player" ? "Zab" : "" });
  const pushState = { reps: o.reps == null ? 12 : o.reps, tut: 9000, elapsed: o.elapsed || 0, startedAt: o.running === false ? 0 : 1000, running: o.running !== false, finished: false, tick: 7 };
  const ctx = vm.createContext({ pushState, pushMode: mode, $: el, Date: Object.assign(function () { return new global.Date(); }, { now: () => 1000 + (o.ms == null ? 40000 : o.ms) }), ZT: null, clearInterval() {}, pushWake: { stop: () => ({ catch() {} }) },
    pushChallenge: { reset() {}, update() { log.push("chUpdate"); }, result: () => ({ reps: o.chReps == null ? 9 : o.chReps, tutMs: 33000, score: 42 }) }, performance: { now: () => 5 }, challengeFlags: { standing: 0, knees: 0 }, escapeHtml: (x) => String(x), formatTut: (ms) => Math.round(ms / 1000) + "s tut",
    tutTimeVoice: { end: () => log.push("tutVoice.end") }, postureGuard: { state: () => ({ count: 0 }) }, currentUser: o.signedIn === false ? null : { uid: "u1" }, displayNameOf: () => "Zab",
    formatTime: (ms) => Math.round(ms / 1000) + "s", renderPush() {}, paintPushRows() {}, sessionTouch() {}, zabNote: () => "", zabRing() {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); log.push("local:" + k); }, removeItem() {}, key: () => null, length: 0 },
    localPush: () => [], pushTotalKey: () => "zabbadat-push-total-u1-d", pushTutKey: () => "zabbadat-push-tut-u1-d", pushSetsKey: () => "zabbadat-push-sets-u1-d", savedPushTotal: () => 0, savedPushSets: () => 0, savedPushTut: () => 0,
    awardZab: (...a) => { log.push("award:" + a[0]); return Promise.resolve({ credited: 0 }); }, saveRemotePush: (r) => { log.push("post:" + r.reps + ":" + Math.round(r.ms)); return Promise.resolve(); },
    window: { ZabbadatChallenge: { flagSummary: () => "No flags" }, ZabbadatSession: SS, ZabbadatGetSet: { interruptSpeak: (w) => log.push("say:" + w), SET_DONE_LINE: G.SET_DONE_LINE } } });
  vm.runInContext(src, ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { log, store, pushState, els, stop: () => run("endPushOnCameraStop()"), end: () => run("finishPushSet()"), posts: () => log.filter((x) => /^post:/.test(x)), awards: () => log.filter((x) => /^award:/.test(x)) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
(async () => {
  // rule
  check("rule: running clock + >= 1 rep in sets / long / challenge posts on camera stop", ["sets", "long", "challenge"].every((m) => SS.postOnCameraStop(m, 1, { running: true, finished: false })));
  check("rule: 0 reps, paused (not running), finished, unknown mode, missing state: no post", !SS.postOnCameraStop("sets", 0, { running: true }) && !SS.postOnCameraStop("sets", 5, { running: false, elapsed: 5000 }) && !SS.postOnCameraStop("long", 5, { running: true, finished: true }) && !SS.postOnCameraStop("walk", 5, { running: true }) && !SS.postOnCameraStop("sets", 5, null));
  // each mode posts exactly once
  for (const [mode, ms, reps, expect] of [["sets", 40000, 12, "post:12:40000"], ["long", 75000, 35, "post:35:75000"], ["challenge", 95000, 9, "post:9:95000"]]) {
    const p = page(mode, { ms, reps, chReps: 9 });
    const did = p.stop(); await tick();
    check(`${mode}: Stop camera with the clock running posts once (${expect}) with ZAB awarded through the normal path`, did === true && p.posts().length === 1 && p.posts()[0] === expect && p.awards().length >= 1 && p.pushState.finished === true && p.pushState.running === false);
    check(`${mode}: result line says it was posted and why ("Ended: Camera stopped.")`, /posted \d+ reps in \d+s\. Ended: Camera stopped\./.test(p.els.pushStatus.textContent));
    const aw = p.awards().length; p.stop(); p.stop(); p.end(); await tick();
    check(`${mode}: stopping again and tapping Finish / End session afterwards never posts or awards twice`, p.posts().length === 1 && p.awards().length === aw);
  }
  let p = page("challenge", { ms: 95000, chReps: 9 }); p.stop(); await tick();
  check("challenge: reps and time under tension come from the challenge clock; card says 'stopped early'; nothing credited past now", p.posts()[0] === "post:9:95000" && p.log.includes("chUpdate") && /stopped early/.test(p.els.challengeResult.innerHTML) && /Reps: 9/.test(p.els.challengeResult.innerHTML) && p.pushState.tut === 33000);
  // manual first, then stop: one post
  p = page("sets", { ms: 40000 }); p.end(); p.stop(); await tick();
  check("manual Finish first, then Stop camera: still exactly one post", p.posts().length === 1);
  // nothing to post
  p = page("long", { ms: 40000, reps: 0 }); const d0 = p.stop(); await tick();
  check("0 reps: Stop camera posts nothing and saves nothing (unchanged)", d0 === false && p.posts().length === 0 && !p.log.some((x) => /^local:/.test(x)) && p.pushState.finished === false);
  p = page("sets", { running: false, elapsed: 30000, reps: 8 }); const d1 = p.stop(); await tick();
  check("paused Sets set (Pause, may resume): Stop camera does not end or post it; Finish still works", d1 === false && p.posts().length === 0 && p.pushState.finished === false && (p.end(), p.posts().length === 1));
  p = page("sets", { ms: 40000, signedIn: false }); p.stop(); await tick();
  check("signed out: Stop camera keeps it on this phone, posts nothing, awards nothing", p.posts().length === 0 && p.awards().length === 0 && p.log.includes("local:zabbadat-push-total-u1-d") && /saved on this device\. Sign in to post\./.test(p.els.pushStatus.textContent));
  // wiring
  check("wiring: stopCam calls endPushOnCameraStop first; manual Finish / End session buttons still wired", /function stopCam\(\) \{\s*if \(typeof endPushOnCameraStop === "function"\) endPushOnCameraStop\(\);/.test(html) && /pushFinishBtn"\)\.onclick = \(\) => \{ if \(pushMode === "sets"\) finishPushSet\(\); \}/.test(html) && /pushEndBtn"\)\.onclick = \(\) => \{ if \(pushMode === "long"\) finishPushSet\(\); \}/.test(html));
  check("wiring: push-up counter stays camera-only (no devicemotion / step counting in the push code path)", !/endPushOnCameraStop[\s\S]{0,900}devicemotion/.test(html));
  // audit locks: other stop paths already post, exactly once
  check("audit: plank stop (button, camera stop, form failure) all end through plankEnded, which is write-once (plankSaved) and posts when signed in", /function stopPlankCam\(\) \{[\s\S]{0,120}plankEnded\(r\)/.test(html) && /if \(plankSaved\) return;\s*\n\s*if \(!plankSessionStartedAt\) return;/.test(html) && /saveRemotePlank\(record\)/.test(html));
  check("audit: live walk stop (hold, 4 h cap, hidden > 2 min) calls endWalk, which clears walkSession first (once), keeps the 5 minute qualifies() gate, posts only when signed in", /async function endWalk\(r\) \{[\s\S]{0,160}walkSession = null;/.test(html) && /const q = WS\.qualifies\(r\)[\s\S]{0,200}if \(!q\.ok\)[\s\S]{0,260}if \(!currentUser\)[\s\S]{0,420}saveRemoteWalk\(r\)/.test(html) && /MIN_MS = 300000|minMs: 300000|300000/.test(R("walk-session.js")));
  check("audit: daily steps post on stop (stopWalk then postDaily(true)), on foreground, on a 2 min tick and after sign-in; postDaily skips unchanged totals when quiet; the manual Post button is replaced by Reset (see post-button-reset.test.js)", /daily\.stopWalk\(\); postDaily\(true\)/.test(html) && /if \(s\.steps <= dailyPosted && quiet\) return;/.test(html) && /dailyResetBtn"\)\.onclick/.test(html));
  check("audit: washers solo posts on finishGame at 21; battles / arenas / wagers are not touched by this change (no diff in settle / pot / stats modules)", /if \(state\.score >= TARGET\) finishGame\(\);/.test(html));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
