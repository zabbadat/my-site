// Set boundaries (fix/push-set-reset): every new set starts clean. Runs the REAL startPush / beginPushClock / freshPushSet /
// clearPushPrompts / voidTutSet / finishPushSet / resetPoseBaseline from index.html with stubbed camera + speech.
const fs = require("fs"), vm = require("vm"), path = require("path");
const SS = require("../push-session.js"), G = require("../get-set.js"), P = require("../push-counter.js"), SY = require("./lib/push-synth.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const fnSrc = (n) => { const i = html.indexOf("function " + n + "("); if (i < 0) throw new Error("missing " + n); return html.slice(i, html.indexOf("\n}", i) + 2); };
const SRC = ["clearPushPrompts", "freshPushSet", "voidTutSet", "showChallengeResult", "finishPushSet", "beginPushClock", "resetPoseBaseline", "setCamStatus"].map(fnSrc).join("\n") + "\nasync " + fnSrc("startPush");
check("push-ups have no Reset button or handler any more", !/pushResetBtn/.test(html));
function page(mode) {
  const log = [], els = {}, store = {}; let now = 1000;
  const el = (id) => els[id] || (els[id] = { hidden: false, textContent: "", disabled: false, innerHTML: "", value: id === "player" ? "Zab" : "" });
  const pushState = { reps: 0, running: false, startedAt: 0, elapsed: 0, tick: null, finished: false, tut: 0 };
  const counter = P.createCounter();
  const ctx = vm.createContext({ pushState, pushMode: mode, $: el, Date: Object.assign(function () { return new global.Date(); }, { now: () => now }), performance: { now: () => now },
    ZT: null, setInterval: () => 1, clearInterval() {}, pushWake: null, camOn: true, lastCamStatus: "", pushCounter: counter, plankLoop: false, pushStarting: false, pushStartSeq: 0,
    pushChallenge: { reset: () => log.push("challengeReset"), start: () => log.push("challengeStart"), update() {}, result: () => ({ reps: 0, tutMs: 0, score: 0 }) },
    challengeFlags: { standing: 0, knees: 0 }, escapeHtml: String, formatTut: (ms) => ms + "tut",
    tutTimeVoice: { end: () => log.push("tutVoice.end"), reset: () => log.push("tutVoice.reset"), tick() {} },
    repVoice: { reset: () => log.push("repVoice.reset") }, failWatch: { reset: (t) => log.push("failWatch.reset:" + t) },
    postureGuard: { state: () => ({ count: 2 }), reset: () => log.push("guard.reset") },
    cancelGetSet: () => log.push("speech.cancel"), unlockGetSet() {}, requireSignIn: () => true, sessionPlan: () => "restart", sessionCommit() {}, sessionTouch() {},
    showPositioning: async () => true, openCam: async () => true, stopCam() {}, cancelPushStart() {}, stopPlankCam() {},
    getSetCountdown: async (show) => { show("3"); log.push("countdown"); ctx.duringCountdown && ctx.duringCountdown(); return true; },
    currentUser: { uid: "u1" }, displayNameOf: () => "Zab", formatTime: (ms) => Math.round(ms / 1000) + "s", renderPush() {}, paintPushRows() {}, zabNote: () => "", zabRing() {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem() {}, key: () => null, length: 0 },
    localPush: () => [], pushTotalKey: () => "t", pushTutKey: () => "tt", pushSetsKey: () => "s", savedPushTotal: () => 0, savedPushSets: () => 0, savedPushTut: () => 0,
    awardZab: () => Promise.resolve({ credited: 0 }), saveRemotePush: (r) => { log.push("post:" + r.reps); return Promise.resolve(); },
    window: { ZabbadatChallenge: { flagSummary: () => "" }, ZabbadatSession: SS, ZabbadatGetSet: { interruptSpeak: (w) => log.push("say:" + w), SET_DONE_LINE: G.SET_DONE_LINE } } });
  vm.runInContext(SRC, ctx);
  const run = (c) => vm.runInContext(c, ctx);
  return { log, els, pushState, counter, ctx, run, adv: (ms) => { now += ms; }, start: async () => { await run("startPush()"); for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); }, posts: () => log.filter((x) => /^post:/.test(x)) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
(async () => {
  // 1) countdown movement never carries into the set
  { const p = page("sets"); let t = 0;
    p.ctx.duringCountdown = () => { for (; t < 3000; t += 33) { const d = (t % 1500) < 750 ? (t % 750) / 750 : 1 - (t % 750) / 750; p.counter.update(SY.frameFor(d, SY.BASE, t), t, 640); } };
    await p.start(); const s = p.counter.state();
    check("dips during the countdown: counter wiped at Go (calibrate, up, 0 internal reps, no top/base)", s.phase === "calibrate" && s.stage === "up" && s.reps === 0 && s.top == null && s.base == null && p.pushState.running && p.pushState.reps === 0); }
  for (const mode of ["sets", "long", "challenge"]) {
    const p = page(mode); await p.start();
    p.pushState.reps = 7; p.pushState.tut = 21000; p.adv(30000);
    p.els.camNote.textContent = "Counted 7."; p.els.pushViolFlag.hidden = false; p.els.pushViol.textContent = "2";
    p.run("finishPushSet()"); await tick();
    // 2) finish clears the display, keeps the result text, posts once
    check(`${mode}: Finish posts exactly once`, p.posts().length === 1 && p.posts()[0] === "post:7");
    check(`${mode}: Finish clears the big rep number, clock and TUT; counter wiped`, p.pushState.reps === 0 && p.pushState.elapsed === 0 && p.pushState.tut === 0 && p.counter.state().phase === "calibrate");
    check(`${mode}: result stays in the status line (reps + time)`, /posted 7 reps in 30s/.test(p.els.pushStatus.textContent));
    p.run("finishPushSet()"); await tick(); check(`${mode}: a second Finish does not post again`, p.posts().length === 1);
    // 3) Start right after a finished set: clean set, no Reset tap; set-1 prompts gone
    p.log.length = 0; await p.start();
    check(`${mode}: Start after Finish begins a clean set with no Reset tap`, p.pushState.running && !p.pushState.finished && p.pushState.reps === 0 && p.pushState.tut === 0 && p.log.includes("countdown"));
    check(`${mode}: fresh set resets TUT voice, rep voice, fail watch, posture guard, challenge`, ["tutVoice.reset", "repVoice.reset", "guard.reset", "challengeReset"].every((x) => p.log.includes(x)) && p.log.some((x) => /^failWatch\.reset/.test(x)));
    check(`${mode}: set-1 prompts do not show or speak in set 2 (speech cancelled, camera note, form flag, rule-break count cleared)`, p.log.includes("speech.cancel") && p.log.indexOf("speech.cancel") < p.log.indexOf("countdown") && !/Counted 7/.test(p.els.camNote.textContent) && p.els.pushViolFlag.hidden === true && p.els.pushViol.textContent === "0" && p.els.challengeResult.hidden === true);
  }
  // TUT set -> failure (posts once) -> auto reset -> next TUT set
  for (const mode of ["long", "challenge"]) {
    const p = page(mode); await p.start(); p.pushState.reps = 5; p.adv(40000);
    if (mode === "challenge") p.ctx.pushChallenge.result = () => ({ reps: 5, tutMs: 12000, score: 17 });
    p.run('voidTutSet("knees")'); await tick();
    check(`${mode}: failed TUT set posts once, then everything is back to zero`, p.posts().length === 1 && p.pushState.reps === 0 && p.pushState.tut === 0 && p.pushState.elapsed === 0 && p.counter.state().phase === "calibrate" && p.log.includes("guard.reset") && p.log.some((x) => x === "failWatch.reset:null"));
    check(`${mode}: failed set status 'Set failed: N reps, m:ss. Ready for the next set.'`, /Set failed: 5 reps, \d+s\. Ready for the next set\./.test(p.els.pushStatus.textContent));
    p.log.length = 0; await p.start();
    check(`${mode}: Start after a failed set begins a clean TUT set (no Reset)`, p.pushState.running && p.pushState.reps === 0 && p.log.includes("tutVoice.reset") && p.log.includes("speech.cancel"));
    const q = page(mode); await q.start(); q.adv(20000); q.run('voidTutSet("standing")');
    check(`${mode}: failure with 0 reps: nothing posted, auto-reset, 'Set failed: 0 reps' + ready`, q.posts().length === 0 && !q.pushState.finished && !q.pushState.running && q.pushState.elapsed === 0 && /^Set failed: 0 reps, 20s .*Ready for the next set\./.test(q.els.pushStatus.textContent));
    await q.start(); check(`${mode}: Start after a 0-rep failure starts at once`, q.pushState.running && q.pushState.reps === 0);
  }
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
