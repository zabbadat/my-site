// TUT failure: knees / stood up / out of frame ends the set and VOIDS it. TUT modes only (One long set, 3:00 challenge, TUT Battles voice).
// Regular Sets get no failure watch, no void, no timed voice. Run: node test/tut-failure.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const S = require("./lib/push-synth.js"), PC = require("../push-counter.js"), SS = require("../push-session.js"), G = require("../get-set.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const upper = (sw = 128, y = 170) => K({ left_shoulder: [256, y], right_shoulder: [256 + sw, y], nose: [320, y - 30], left_wrist: [240, y + 200], right_wrist: [400, y + 200] });
const kneeling = () => upper().concat(K({ left_hip: [300, 400], left_knee: [330, 300], left_ankle: [310, 420], right_hip: [340, 400], right_knee: [350, 300], right_ankle: [330, 420] })); // hip-knee-ankle sharply bent
const run = (frames, topW = 128) => { const w = SS.createFailureWatch(); w.reset(0); let out = null, at = null; for (const [t, k] of frames) { const r = w.update(k, t, topW); if (r && out == null) { out = r; at = t; } } return { out, at }; };
const seq = (from, to, f, dt = 33) => { const a = []; for (let t = from; t < to; t += dt) a.push([t, f(t)]); return a; };

check("defaults reuse Plank's 1 s bad-form rule; out of frame 2 s", SS.FAIL.badMs === 1000 && SS.FAIL.frameMs === 2000 && require("../plank-session.js").PLANK.badMs === SS.FAIL.badMs);
let r = run(seq(0, 3000, () => upper()).concat(seq(3000, 5000, kneeling)));
check(`knees down for 1 s fails as 'knees' (at ${r.at - 3000} ms into it)`, r.out === "knees" && r.at - 3000 >= 1000 && r.at - 3000 < 1100);
r = run(seq(0, 3000, () => upper()).concat(seq(3000, 3900, kneeling), seq(3900, 6000, () => upper())));
check("knees for 0.9 s then back: no failure", r.out === null);
r = run(seq(0, 3000, () => upper()).concat(seq(3000, 5000, () => upper(60))));
check("stood up / left plank (shoulders shrink to 47% of the top width) for 1 s fails as 'standing'", r.out === "standing");
r = run(seq(0, 3000, () => upper()).concat(seq(3000, 3900, () => upper(60)), seq(3900, 6000, () => upper())));
check("shrink for 0.9 s then back: no failure", r.out === null);
r = run(seq(0, 3000, () => upper()).concat(seq(3000, 6000, () => [])));
check(`out of frame for 2 s fails as 'frame' (at ${r.at - 3000 + 33} ms)`, r.out === "frame" && r.at - 3000 >= 1950 && r.at - 3000 < 2100);
r = run(seq(0, 3000, () => upper()).concat(seq(3000, 4900, () => []), seq(4900, 8000, () => upper())));
check("out of frame 1.9 s then back: no failure", r.out === null);
r = run(seq(0, 3000, () => upper()).concat(seq(3000, 8000, (t) => (Math.floor(t / 400) % 2 ? [] : upper()))));
check("flickering tracking (every other 0.4 s lost) is not a failure", r.out === null);
check("uncertain legs (low confidence knees) never read as kneeling", run(seq(0, 5000, () => upper().concat(K({ left_hip: [300, 400], left_knee: [330, 300], left_ankle: [310, 420] }, 0.1)))).out === null);
{ const w = SS.createFailureWatch(); w.reset(0); w.update(upper(), 0, 128); for (let t = 33; t < 2500; t += 33) w.update([], t, 128); const f = w.update(upper(), 2600, 128);
  check("once failed it stays failed until reset(); reset clears it", f === "frame" && w.failed() === "frame" && (w.reset(3000), w.failed() === null && w.update(upper(), 3033, 128) === null)); }

// ---- normal reps never fail: real counter on synthetic front-view reps (fast, slow, long bottom pause, 10 s top hold, noisy/dropped points)
function normal(segs, cfg) {
  const c = Object.assign({}, S.BASE, cfg || {}), ctr = PC.createCounter(), w = SS.createFailureWatch(); w.reset(0); let out = null, n = 0;
  for (let t = 0; t <= S.total(segs); t += 1000 / c.fps) {
    const kps = S.frameFor(S.fracAt(segs, t), c, t); ctr.update(kps, t, c.W);
    const st = ctr.state(), f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0); if (f && !out) out = f; n++;
  }
  return { out, reps: ctr.state().reps };
}
S.reseed(5);
for (const [name, segs, cfg] of [["12 fast reps (1.2 s)", S.reps(12, 1200)], ["10 slow reps (6 s)", S.reps(10, 6000)], ["reps with a 4 s pause at the bottom and 10 s hold at the top", [[10000, 0, 0], [800, 0, 1], [4000, 1, 1], [800, 1, 0], [10000, 0, 0], ...S.reps(5, 2000)]],
  ["noisy keypoints with 15% dropped points", S.reps(15, 1800), { noise: 0.004, drop: 0.15 }], ["body shifting 20 px mid-set", S.reps(10, 1800), { shiftAt: [8000, 0.3] }]]) {
  const x = normal(segs, cfg); check(`normal reps do not fail: ${name} (${x.reps} reps counted)`, x.out === null && x.reps >= 4);
}

// ---- page: void behavior, run the real voidTutSet() from index.html
const fnSrc = html.slice(html.indexOf("function voidTutSet(reason) {"), html.indexOf("function finishChallenge() {"));
function page(mode, extra) {
  const log = [], store = [];
  const els = {}; const el = (id) => els[id] || (els[id] = { hidden: false, textContent: "" });
  const pushState = Object.assign({ reps: 12, tut: 41000, elapsed: 0, startedAt: 1000, running: true, finished: false, tick: 7 }, extra || {});
  const ctx = vm.createContext(Object.assign({ pushState, pushMode: mode, pushWake: { stop: () => ({ catch() {} }) }, pushChallenge: { reset: () => log.push("challengeReset") },
    tutTimeVoice: { end: () => log.push("tutVoice.end") }, clearInterval: () => log.push("clearInterval"), Date: { now: () => 31000 }, $: el,
    formatTime: (ms) => Math.round(ms / 1000) + "s", renderPush: () => log.push("renderPush"),
    window: { ZabbadatSession: { FAIL_TEXT: SS.FAIL_TEXT }, ZabbadatGetSet: { interruptSpeak: (w) => log.push("say:" + w), SET_DONE_LINE: G.SET_DONE_LINE } },
    localStorage: { setItem: (k) => store.push(k), removeItem: (k) => store.push(k) },
    finishPushSet: () => log.push("finishPushSet"), saveRemotePush: () => log.push("saveRemotePush"), awardZab: () => log.push("awardZab"), paintPushRows: () => log.push("paintPushRows") }));
  vm.runInContext(fnSrc, ctx);
  return { log, store, pushState, els, void: (why) => vm.runInContext(`voidTutSet(${JSON.stringify(why)})`, ctx) };
}
for (const mode of ["long", "challenge"]) {
  const p = page(mode); p.void("knees");
  check(`${mode}: clock stops at once (not running, finished, interval cleared)`, p.pushState.running === false && p.pushState.finished === true && p.log.includes("clearInterval"));
  check(`${mode}: VOID: reps 0, TUT 0, clock 0, nothing saved locally`, p.pushState.reps === 0 && p.pushState.tut === 0 && p.pushState.elapsed === 0 && p.store.length === 0);
  check(`${mode}: VOID: nothing posted to boards / ZAB / Firestore (no finishPushSet, saveRemotePush, awardZab)`, !p.log.some((x) => /finishPushSet|saveRemotePush|awardZab|paintPushRows/.test(x)));
  check(`${mode}: speaks the short failure line "Set done." and silences the 15 s count`, p.log.includes("say:Set done.") && p.log.includes("tutVoice.end"));
  check(`${mode}: result text says voided, the reason, and that nothing was saved`, /^Set voided: Knees down\. It lasted 30s and nothing was saved\./.test(p.els.pushStatus.textContent) && p.els.camNote.textContent === "Set voided");
}
{ const p = page("sets"); p.void("knees"); check("regular Sets: voidTutSet does nothing (no stop, no void, no speech)", p.pushState.running === true && p.pushState.reps === 12 && p.log.length === 0); }
{ const p = page("long"); p.void("knees"); p.log.length = 0; p.void("standing"); check("a second failure after the set ended does nothing", p.log.length === 0); }
check("the failure line is exactly 'Set done.'", G.SET_DONE_LINE === "Set done.");

// ---- page wiring pins
const pt = html.slice(html.indexOf("async function poseTick()"), html.indexOf("async function openCam()"));
check("failure check lives only inside the long/challenge block of poseTick (not Sets)", /if \(\(pushMode === "long" \|\| pushMode === "challenge"\) && postureGuard && pushState\.running && !pushState\.finished\) \{[\s\S]*failWatch\.update\([\s\S]*voidTutSet\(failed\)/.test(pt) && pt.split("failWatch.update(").length === 2);
check("voidTutSet only acts in long/challenge and never calls the save/post path", /\(pushMode !== "long" && pushMode !== "challenge"\)\) return;/.test(fnSrc) && !/finishPushSet|saveRemotePush|awardZab|localStorage|paintPushRows/.test(fnSrc));
check("failWatch resets on each clock start and on Reset", /failWatch\.reset\(performance\.now\(\)\);\n  pushState\.running = true;/.test(html) && /failWatch\.reset\(null\);\n  resetPoseBaseline\(\);/.test(html));
check("the old 'clock keeps running' wording is gone from TUT copy (index.html, tut.html)", !/clock keeps running/i.test(html) && !/clock keeps running/i.test(fs.readFileSync(path.join(__dirname, "../tut.html"), "utf8")));
check("TUT copy says the set is voided and nothing is saved", /ends the set and voids it: nothing is saved or posted/.test(html) && /ends the set and voids it, so nothing is saved or posted/.test(fs.readFileSync(path.join(__dirname, "../tut.html"), "utf8")));

// ---- regular Sets: no timed voice, no failure. Sets-mode code path speaks only rep numbers and the start coaching.
check("regular Sets get NO 15 s count: the one tutTimeVoice.tick call is gated on long/challenge only", html.split("tutTimeVoice.tick(").length === 2 && /\(pushMode === "long" \|\| pushMode === "challenge"\) && pushState\.running && !pushState\.finished\) tutTimeVoice\.tick\(now\)/.test(html));
check("regular Sets: nothing else speaks on a timer (4 interruptSpeak call sites: rules line, TUT void, TUT Battle loss, plank failure end; only sayRep and the shared coaching lines call speech in the push-up code)", (html.match(/interruptSpeak\(/g) || []).length === 4 && !/pushMode === "sets"[^\n]*(interruptSpeak|tick\()/.test(html));
{ const sets = html.slice(html.indexOf('if ($("pushPauseBtn")) $("pushPauseBtn").onclick'), html.indexOf('if ($("pushResetBtn"))'));
  check("Sets pause/resume path has no voice or failure code", !/tutTimeVoice|failWatch|voidTutSet|interruptSpeak/.test(sets)); }

// ---- 3:00 challenge voice: marks 15..165 s, never a '3 minutes' (renderPush returns into finishChallenge at 180 s first)
{ const said = []; const v = G.makeHoldVoice({ polite: true, speak: (w) => said.push(w), busy: () => false });
  for (let now = 0; now < 180000; now += 200) v.tick(now); v.end(); v.tick(180000); v.tick(181000);
  check("challenge: spoken elapsed marks 15 s ... 2 minutes 45, then silence (no '3 minutes', never after the finish)", said.join() === "15 seconds,30 seconds,45 seconds,1 minute,1 minute 15,1 minute 30,1 minute 45,2 minutes,2 minutes 15,2 minutes 30,2 minutes 45"); }
{ const rc = html.slice(html.indexOf("function renderPush() {"), html.indexOf("function renderPushMode()"));
  check("challenge: renderPush finishes at 3:00 (return) before the voice tick; the clock/countdown text is untouched", rc.indexOf("finishChallenge(); return;") > 0 && rc.indexOf("finishChallenge(); return;") < rc.indexOf("tutTimeVoice.tick(now)")); }

// ---- TUT Battles
check("TUT Battle: polite 15 s count from the shared 3:00 (3:00 mark never spoken), reset at GO, ended on loss / time-up / done", /const tbTimeVoice = [^\n]*makeHoldVoice\(\{ polite: true \}\)/.test(html) && /tbTimeVoice\.tick\(TBm\.RULES\.durationMs - left\)/.test(html) && /left > 0\) tbTimeVoice\.tick/.test(html) && /tbRepVoice\.reset\(\); if \(tbTimeVoice\) tbTimeVoice\.reset\(\);/.test(html) && /tbLostSent = true; if \(tbTimeVoice\) tbTimeVoice\.end\(\);/.test(html));
check("TUT Battle failure: 'Set done.' spoken when the judge calls you out; the loss is still recorded (reportLoss), not voided", /tbTimeVoice\.end\(\); if \(window\.ZabbadatGetSet[^\n]*interruptSpeak\(window\.ZabbadatGetSet\.SET_DONE_LINE\)[^\n]*TBm\.reportLoss\(/.test(html));
check("Plank Battle voice untouched (Plank House now has its own uncapped voice, see plank-no-cap.test.js)", /const plankTimeVoice = [^\n]*makePlankTimeVoice\(\) : null;/.test(html) && /const pbTimeVoice = [^\n]*makeHoldVoice\(\) : null;/.test(html));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
