// Fail -> exit, per push-up camera view (Nov 16, owner): a form failure (knees, collapse, stood up, elbows, out of frame, stall)
// ends the set through the shared save path AND leaves camera mode. Runs the real finishPushSet / voidTutSet / exitPushCam /
// endPushSetAuto (Sets, One long set / TUT, 3:00 challenge) and the real tbEndMySet (TUT Battle) from index.html in a vm.
// Run: node test/set-fail-exit.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const SS = require("../push-session.js"), G = require("../get-set.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const sl = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); return html.slice(i, html.indexOf(b, i)); };
const fn = (n) => { const i = html.indexOf("function " + n + "("); return html.slice(i, html.indexOf("\n}", i) + 2); };
const src = [sl("function freezePushClock(", "function failExtra("), fn("voidTutSet"), sl("function showChallengeResult(r, title) {", "function finishChallenge() {"), sl("function endPushOnCameraStop() {", "// Hero CTAs: jump to the counter"), sl("function finishPushSet(endedBy) {", "// One Start button: gate")].join("\n");
function page(mode, o) {
  o = o || {}; const log = [], store = {}, els = {};
  const el = (id) => els[id] || (els[id] = { hidden: false, textContent: "", value: id === "player" ? "Zab" : "" });
  const pushState = { reps: o.reps == null ? 6 : o.reps, tut: 9000, elapsed: 0, startedAt: 1000, running: true, finished: false, tick: 7 };
  const ctx = vm.createContext({ pushState, pushMode: mode, $: el, Date: Object.assign(function () { return new global.Date(); }, { now: () => 41000 }), ZT: null, clearInterval() {}, pushWake: { stop: () => ({ catch() {} }) },
    pushChallenge: { reset() {}, update() {}, result: () => ({ reps: pushState.reps, tutMs: 33000, score: 42 }) }, performance: { now: () => 5000 }, escapeHtml: String, formatTut: (ms) => ms + "ms",
    tutTimeVoice: { end: () => log.push("tutVoice.end") }, postureGuard: { state: () => ({ count: 0 }), reset() {} }, currentUser: { uid: "u1" }, displayNameOf: () => "Zab", challengeFlags: {},
    formatTime: (ms) => Math.round(ms / 1000) + "s", renderPush() {}, paintPushRows() {}, sessionTouch() {}, zabNote: () => "", zabRing() {}, freshPushSet() { log.push("fresh"); pushState.reps = 0; pushState.running = false; pushState.finished = false; },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem() {} },
    localPush: () => [], pushTotalKey: () => "a", pushTutKey: () => "b", pushSetsKey: () => "c", savedPushTotal: () => 0, savedPushSets: () => 0, savedPushTut: () => 0,
    awardZab: () => Promise.resolve({ credited: 0 }), saveRemotePush: (r) => { log.push("post:" + r.reps + ":" + r.category); return Promise.resolve(); },
    camOn: true, camStream: {}, pushStarting: false, repVoice: { reset() {} }, cancelPushStart() {},
    window: { ZabbadatChallenge: { flagSummary: () => "" }, ZabbadatSession: SS, ZabbadatGetSet: { interruptSpeak: (w) => log.push("say:" + w), SET_DONE_LINE: G.SET_DONE_LINE } } });
  vm.runInContext(src + `\nfunction stopCam() { log.push("stopCam"); if (typeof endPushOnCameraStop === "function") endPushOnCameraStop(); camOn = false; camStream = null; }`, Object.assign(ctx, { log }));
  return { log, pushState, els, run: (c) => vm.runInContext(c, ctx) };
}
const exited = (p) => p.log.includes("stopCam") && /Camera off/.test(p.els.camNote.textContent);
const said = (p) => p.log.filter((x) => x === "say:" + G.SET_DONE_LINE).length === 1;
for (const why of ["knees", "collapse", "standing", "elbows", "form", "frame"]) {
  const p = page("sets"); p.run(`finishPushSet((window.ZabbadatSession.FAIL_TEXT || {})[${JSON.stringify(why)}])`); // the exact Sets failure call in poseTick
  check(`Sets, fail '${why}': saved once (${p.log.find((x) => /^post:/.test(x))}), 'Set complete' once, camera mode exited`, p.log.filter((x) => /^post:/.test(x)).length === 1 && said(p) && exited(p) && p.pushState.finished);
}
for (const mode of ["long"]) { // Two-minute challenge fails: two-minute-challenge.test.js
  for (const why of ["knees", "collapse", "standing", "elbows", "form", "stalled"]) {
    const p = page(mode); p.run(`voidTutSet(${JSON.stringify(why)})`);
    check(`${mode === "long" ? "TUT (One long set)" : "3:00 challenge"}, fail '${why}' with 6 reps: posted once, camera mode exited`, p.log.filter((x) => /^post:6:/.test(x)).length === 1 && said(p) && exited(p));
  }
  const z = page(mode, { reps: 0 }); z.run(`voidTutSet("knees")`);
  check(`${mode}: fail with 0 reps: nothing saved, camera mode still exited`, !z.log.some((x) => /^post:/.test(x)) && z.log.includes("fresh") && exited(z));
}
{ const p = page("long", { reps: 12 }); p.run(`voidTutSet("knees")`); check("TUT fail before 1:20 is saved as an ordinary 'long' set, not a completed TUT set", p.log.includes("post:12:long")); }
for (const [mode, kind, expect] of [["sets", "stalled", /^post:6:set$/], ["long", "stalled", /^post:6:/]]) {
  const p = page(mode); p.run(`endPushSetAuto(${JSON.stringify(kind)})`);
  check(`${mode}: end-of-set '${kind}' -> saved through the normal path and camera mode exited`, p.log.some((x) => expect.test(x)) && exited(p));
}
{ const p = page("challenge"); p.run(`endPushSetAuto("stalled")`); check("challenge: the end-of-set stall never ends a Two-minute challenge (a hold has no reps)", !p.log.some((x) => /^post:/.test(x)) && p.pushState.running === true); }
{ const p = page("sets"); p.run("stopCam()"); check("Stop camera mid-set: one post, no recursion into stopCam", p.log.filter((x) => /^post:/.test(x)).length === 1 && p.log.filter((x) => x === "stopCam").length === 1); }
{ const p = page("sets"); p.run(`finishPushSet("Knees down"); finishPushSet("Knees down")`); check("a second failure call is a no-op (one post, one exit)", p.log.filter((x) => /^post:/.test(x)).length === 1 && p.log.filter((x) => x === "stopCam").length === 1); }
// pickup never fails (rule unchanged)
check("phone pickup ('lifted') never ends a set (failure watch endOn.lifted off)", SS.FAIL.endOn.lifted === false);
// TUT Battle: real tbEndMySet
{
  const log = [], els = {}; const $ = (id) => els[id] || (els[id] = { textContent: "" });
  let fails = 2; const timers = [];
  const ctx = vm.createContext({ log, $, tbCodeCur: "ROOM", currentUser: { uid: "u1" }, tbMine: { reps: 7, tutMs: 50000 }, tbLostSent: false, tbFs: {}, tbWake: { stop: () => ({ catch() {} }) },
    tbTimeVoice: { end: () => log.push("time.end") }, tbRepVoice: { reset: () => log.push("rep.reset") }, tbCamOff: () => log.push("camOff"), setTimeout: (f) => timers.push(f),
    TBm: { REASONS: { knees: "Knees down flagged", standing: "Stood up / left plank flagged", left: "Left the battle" }, reportLoss: (fs, code, uid, reason, mine) => { log.push("loss:" + reason + ":" + mine.reps); return fails-- > 0 ? Promise.reject(new Error("net")) : Promise.resolve(true); } },
    window: { ZabbadatGetSet: { interruptSpeak: (w) => log.push("say:" + w), SET_DONE_LINE: G.SET_DONE_LINE } } });
  vm.runInContext("let tbSetEnd = null;\n" + fn("tbEndMySet"), ctx);
  (async () => {
    vm.runInContext(`tbEndMySet("knees")`, ctx);
    check("TUT Battle fail: camera off at once, 'Set complete' once, reason shown", log.includes("camOff") && log.filter((x) => x === "say:" + G.SET_DONE_LINE).length === 1 && els.tbCamNote.textContent === "Knees down flagged");
    for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); while (timers.length) timers.shift()(); }
    check("TUT Battle fail: the loss write is retried until it lands (3 tries here)", log.filter((x) => x === "loss:knees:7").length === 3);
    vm.runInContext(`tbEndMySet("standing")`, ctx);
    check("TUT Battle: a second end call is a no-op", log.filter((x) => /^loss:standing/.test(x)).length === 0);
    console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
  })();
}
