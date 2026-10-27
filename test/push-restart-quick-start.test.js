// Restart / next-set start: only a brand-new session hears the coaching intro + 7 s 3-2-1; every later set is a quick Ready, set, Go (no intro). Run: node test/push-restart-quick-start.test.js
// Restart / next-set start: only a brand-new session hears the coaching intro + 7 s 3-2-1; every later set in the session is a quick Ready, set, Go. Run: node test/push-restart-quick-start.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const GS_SRC = fs.readFileSync(path.join(__dirname, "..", "get-set.js"), "utf8");
const GS = require("../get-set.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const between = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); const j = html.indexOf(b, i + a.length); return html.slice(i, j + b.length); };
const fnSrc = (name) => between("function " + name + "(", "\n}");
const line = (s) => between(s, "\n");
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

function env(o = {}) {
  const log = []; let now = 0; const timers = [];
  const els = {}; const $ = (id) => (els[id] = els[id] || { id, textContent: "", hidden: true, disabled: false, setAttribute() {}, play: async () => {}, srcObject: null });
  const wake = (n) => ({ held: false, start() { this.held = true; log.push(n + ":start"); return Promise.resolve(); }, stop() { this.held = false; log.push(n + ":stop"); return Promise.resolve(); } });
  const ctx = { $, console, Math, Date: { now: () => now }, Promise, JSON, String, Number, log, els,
    setTimeout: (f, d) => { timers.push({ at: now + (d || 0), f }); return timers.length; }, clearTimeout() {},
    setInterval: (f, d) => { const t = { at: now + d, f, every: d }; timers.push(t); return t; }, clearInterval: (t) => { if (t) t.dead = true; },
    performance: { now: () => now }, requestAnimationFrame() {},
    navigator: { mediaDevices: { getUserMedia: async () => { if (o.camBlocked) throw new Error("denied"); log.push("camera"); return { getTracks: () => [{ stop() {} }] }; } } } };
  ctx.window = ctx;
  if (o.speech !== "absent") {
    ctx.spoken = []; ctx.speechSynthesis = { cancel: () => log.push("speech:cancel"), speak: (u) => { if (o.speech === "throw") throw new Error("nope"); ctx.spoken.push({ w: u.text, at: now, rate: u.rate, vol: u.volume }); ctx.lastUtter = u; if (u.onend && !o.noEnd) timers.push({ at: now + 1000, f: () => u.onend() }); log.push(u.volume === 0 ? "speech:unlock" : "say:" + u.text); } };
    ctx.SpeechSynthesisUtterance = function (t) { this.text = t; };
  }
  vm.createContext(ctx);
  vm.runInContext(GS_SRC, ctx);
  const STUBS = `
let signedIn = ${o.signedIn !== false}; let practiceCb = null;
function requireSignIn(f, cb, opt) { log.push("gate:" + f); if (signedIn) return true; practiceCb = cb; log.push("prompt"); return false; }
const pushWake = (${wake})("pushWake"), camWake = (${wake})("camWake"), plankWake = (${wake})("plankWake");
const pushState = { reps: 0, running: false, startedAt: 0, elapsed: 0, tick: null, finished: false, tut: 0 };
let pushMode = ${JSON.stringify(o.mode || "sets")}; let challengeFlags = {}; const postureGuard = null;
const pushChallenge = { start() { log.push("challenge:start"); }, reset() {} };
let camOn = false, poseLoopOn = false, camStream = null, pushCounter = { ph: "calibrate", state() { return { phase: this.ph }; }, reset() {} };
let plankLoop = false, plankHold = null, plankSaved = false, plankStream = null, plankSessionStartedAt = 0;
async function loadCamLibs() {} async function ensurePose() { log.push("pose"); }
function poseTick() {} function renderPush() {} function resetPoseBaseline() {} function camExitFs() {} function setCamStatus() {}
function newPlankHold() { log.push("plankHold"); } function plankTick() {} function plankEnded() {}`;
  const SRC = [STUBS, line("const GET_SET_MS"), line("const getSet = "), line("const quickSet = "), line("const sessionTrack = "), line("function sessionPlan"), line("function sessionCommit"), line("function sessionTouch"), fnSrc("getSetCountdown"), line("function cancelGetSet"), line("function unlockGetSet"), line("let pushStarting"),
    fnSrc("cancelPushStart"), line("const POSITION_MS"), fnSrc("showPositioning"), "async " + fnSrc("startPush"), fnSrc("beginPushClock"), line('if ($("pushStartBtn")) $("pushStartBtn").onclick = '),
    "async " + fnSrc("openCam"), fnSrc("stopCam"), "async " + fnSrc("startPlankCam"), line("let plankStarting"), fnSrc("cancelPlankStart"), fnSrc("stopPlankCam"),
    line('$("plankCamBtn").onclick = '), `const origClock = beginPushClock; beginPushClock = function () { log.push("clock"); return origClock(); };`].join("\n")
    .replace("function beginPushClock()", "var beginPushClock = function ()");
  vm.runInContext(SRC.replace(/function beginPushClock\(\) \{/, "beginPushClock = function () {"), ctx);
  const run = (c) => vm.runInContext(c, ctx);
  const advance = async (ms) => { const end = now + ms; for (;;) { await flush(); timers.sort((a, b) => a.at - b.at); const t = timers.find((x) => !x.dead && !x.done && x.at <= end); if (!t) break; now = t.at;
      if (t.every) t.at += t.every; else t.done = true; t.f(); } now = end; await flush(); };
  return { ctx, $, log, run, advance, now: () => now };
}

const STATUS = { sets: "Set on. The camera counts each full rep.", long: "Session on. The clock runs nonstop; the camera counts each full rep.",
  challenge: "Challenge on. 3:00 on the clock; stay in plank, the camera counts each full rep." };
(async () => {
  const SAID = (e) => e.ctx.spoken.filter((x) => x.vol !== 0);
  const words = (e, from) => SAID(e).slice(from || 0).map((x) => x.w + "@" + x.at).join(",");
  const C = { pushups: GS.coachLines("pushups"), tut: GS.coachLines("tut"), plank: GS.coachLines("plank") };
  const INTRO = (k) => [C[k].place, C[k].criteria];
  const NOINTRO = (e, from) => !SAID(e).slice(from || 0).some((x) => [].concat(INTRO("pushups"), INTRO("tut"), INTRO("plank")).includes(x.w));
  const FULL = (k, t0) => [C[k].place + "@" + t0, C[k].criteria + "@" + (t0 + 1000), "Ready@" + (t0 + 3000), "get set@" + (t0 + 5000), "three@" + (t0 + 7000), "two@" + (t0 + 8000), "one@" + (t0 + 9000), "Go@" + (t0 + 10000)].concat(k === "plank" ? [C.plank.rules + "@" + (t0 + 10000)] : []).join(","); // a fresh plank start also speaks the what-ends-the-hold line right after Go
  const QUICK = (t0) => ["Ready@" + t0, "set@" + (t0 + 1200), "Go@" + (t0 + 2400)].join(",");
  // ---- get-set.js: quick countdown
  { const said = [], shown = [], q = []; const g = GS.makeQuickCountdown({ speak: (w) => said.push(w), unlock() {}, schedule: (f, d) => q.push([f, d]) });
    let done = null; g.run((t) => shown.push(t)).then((v) => (done = v));
    const gaps = []; while (q.length) { const [f, d] = q.shift(); gaps.push(d); f(); } await flush();
    check("quick countdown: Ready, set, Go only (no 3-2-1), 1.2 s apart, total 2.4 s, resolves true", said.join("|") === "Ready|set|Go" && shown.join("|") === "Ready|Set|GO" && gaps.join(",") === "1200,1200" && g.ms === 2400 && GS.QUICK_MS === 2400 && done === true);
    check("quick countdown never says three/two/one and the full countdown is unchanged", !GS.QUICK_STEPS.some((x) => /three|two|one/.test(x[1])) && GS.makeGoCountdown().ms === 7000 && GS.STEPS.map((x) => x[1]).join("|") === "Ready|get set|three|two|one|Go");
    const c = GS.makeQuickCountdown({ speak: (w) => said.push(w), unlock() {}, schedule: (f, d) => q.push([f, d]) }); said.length = 0; let r = null; c.run(() => {}, () => false).then((v) => (r = v)); c.cancel(); q.splice(0).forEach(([f]) => f()); await flush();
    check("quick countdown: cancel resolves false and never says Go", r === false && !said.includes("Go")); }
  // ---- get-set.js: session tracker
  { let t = 0; const T = GS.makeSessionTracker({ now: () => t });
    check("tracker: first start after page load is fresh", T.plan("pushups") === "fresh");
    T.plan("pushups"); check("tracker: plan() alone does not start a session (cancelled start stays fresh)", T.plan("pushups") === "fresh");
    T.commit("pushups"); check("tracker: after the first set started, same exercise is restart", T.plan("pushups") === "restart");
    t += 5 * 60000; check("tracker: still restart within the idle window", T.plan("pushups") === "restart");
    check("tracker: different exercise / mode is fresh (plank, tut, tut-battle)", T.plan("plank") === "fresh" && T.plan("tut") === "fresh" && T.plan("tut-battle") === "fresh");
    t += 6 * 60000; check("tracker: after > 10 min idle it is fresh", T.plan("pushups") === "fresh" && T.idleMs === 600000 && GS.SESSION_IDLE_MS === 600000);
    T.commit("pushups"); t += 9 * 60000; T.touch(); t += 9 * 60000; check("tracker: touch() (stop / finish) keeps a long session alive", T.plan("pushups") === "restart");
    T.reset(); check("tracker: reset() (leaving the exercise) makes the next start fresh", T.plan("pushups") === "fresh");
    T.touch(); check("tracker: touch() without a session does not create one", T.plan("pushups") === "fresh");
    T.commit("plank"); T.commit("pushups"); check("tracker: switching exercise starts a new session", T.plan("plank") === "fresh" && T.plan("pushups") === "restart");
    check("tracker: missing kind is always fresh", T.plan() === "fresh" && T.plan(null) === "fresh"); }
  // ---- push-ups: first set full, then every later set quick (restart after stop, and next set after finishing)
  for (const mode of ["sets", "long", "challenge"]) {
    const k = mode === "long" ? "tut" : "pushups", e = env({ mode });
    e.$("pushStartBtn").onclick(); await e.advance(10100);
    check(`${mode}: first set of a new session has the full intro + 7 s countdown`, words(e) === FULL(k, 0) && e.run("pushState.running") === true);
    /* stop mid-session: stop camera, then start a new set */
    e.run("pushState.running = false; stopCam();"); let n = SAID(e).length, t0 = e.now();
    e.$("pushStartBtn").onclick();
    check(`${mode}: restart tap: no placement line, unlock + camera opening, no clock yet`, SAID(e).length === n && e.log.includes("speech:unlock") && e.run("pushStarting") === true && e.run("pushState.running") === false);
    await e.advance(2500);
    check(`${mode}: restart: only Ready, set, Go (1.2 s apart, no 3-2-1, no coaching)`, words(e, n) === QUICK(t0) && NOINTRO(e, n));
    check(`${mode}: restart: normal behavior continues (camera reopened, clock + status as a first set)`, e.run("camOn") === true && e.run("pushState.running") === true && e.$("pushStatus").textContent === STATUS[mode] && e.run("pushStarting") === false);
    /* next set after finishing the first (camera still on) and a third set */
    for (let i = 0; i < 2; i++) {
      e.run("pushState.running = false; pushState.finished = false; sessionTouch();"); n = SAID(e).length; t0 = e.now();
      e.$("pushStartBtn").onclick(); await e.advance(2500);
      check(`${mode}: next set #${i + 2} (camera on): quick Ready, set, Go, no intro, clock starts`, words(e, n) === QUICK(t0) && e.run("pushState.running") === true);
    }
    check(`${mode}: no 'three/two/one' ever spoken after the first set`, !SAID(e).slice(8).some((x) => /three|two|one/.test(x.w)));
  }
  /* switching push-up mode (sets -> TUT) is a different exercise: full intro again */
  { const e = env({ mode: "sets" }); e.$("pushStartBtn").onclick(); await e.advance(10100);
    e.run("pushState.running = false; pushMode = 'long';"); const n = SAID(e).length, t0 = e.now(); e.$("pushStartBtn").onclick(); await e.advance(10100);
    check("switching push-ups -> TUT: full TUT intro + countdown again", words(e, n) === FULL("tut", t0));
    e.run("pushState.running = false; pushMode = 'challenge';"); const m = SAID(e).length, t1 = e.now(); e.$("pushStartBtn").onclick(); await e.advance(10100);
    check("switching TUT -> challenge (push-ups): full intro again", words(e, m) === FULL("pushups", t1)); }
  /* a cancelled first start never counts as the first set */
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(6000); e.run("stopCam()"); await e.advance(500);
    const n = SAID(e).length, t0 = e.now(); e.$("pushStartBtn").onclick(); await e.advance(10100);
    check("cancelled first start (stopped during countdown): next start is still a full first start", words(e, n) === FULL("pushups", t0)); }
  /* idle for more than 10 minutes is a brand-new session */
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(10100); e.run("pushState.running = false; stopCam(); sessionTouch();");
    await e.advance(11 * 60000); const n = SAID(e).length, t0 = e.now(); e.$("pushStartBtn").onclick(); await e.advance(10100);
    check("push-ups after 11 min idle: full intro again", words(e, n) === FULL("pushups", t0));
    e.run("pushState.running = false; stopCam();"); await e.advance(3 * 60000); const m = SAID(e).length, t1 = e.now(); e.$("pushStartBtn").onclick(); await e.advance(2500);
    check("... then a restart within 10 min is quick again", words(e, m) === QUICK(t1)); }
  /* leaving the exercise (hashchange) is a brand-new session */
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(10100); e.run("pushState.running = false; stopCam(); sessionTrack.reset();");
    const n = SAID(e).length, t0 = e.now(); e.$("pushStartBtn").onclick(); await e.advance(10100);
    check("after leaving the exercise (session reset): full intro", words(e, n) === FULL("pushups", t0)); }
  /* signed out -> practice start is also a first set that commits */
  { const e = env({ signedIn: false }); e.$("pushStartBtn").onclick(); e.run("signedIn = true; practiceCb();"); await e.advance(10100);
    e.run("pushState.running = false; stopCam();"); const n = SAID(e).length, t0 = e.now(); e.$("pushStartBtn").onclick(); await e.advance(2500);
    check("practice start counts as the first set: restart is quick", words(e, n) === QUICK(t0)); }
  // ---- plank: first full, restart + later holds quick; exercise switch fresh
  { const e = env(); e.$("plankCamBtn").onclick(); await e.advance(10100);
    check("plank: first start of a session has the full intro + countdown", words(e) === FULL("plank", 0) && e.run("plankLoop") === true);
    e.run("plankHold = null; stopPlankCam();"); let n = SAID(e).length, t0 = e.now();
    e.$("plankCamBtn").onclick();
    check("plank restart tap: no placement line, wake + unlock inside the tap", SAID(e).length === n && e.log.slice(-3).join(",") === "plankWake:start,speech:cancel,speech:unlock" && e.$("plankStatus").textContent !== C.plank.place);
    await e.advance(2500);
    check("plank restart: only Ready, set, Go, no coaching, no 3-2-1", words(e, n) === QUICK(t0) && NOINTRO(e, n));
    check("plank restart: hold armed + status exactly as a first start", e.log.lastIndexOf("plankHold") > e.log.lastIndexOf("say:Go") && e.run("plankLoop") === true && e.$("plankStatus").textContent === "Whole body in the outline, side-on. Hold a straight plank for 1.5 seconds to start the clock. Hips sagging or piking up, knees down, standing up, or leaving the frame for a second ends the hold.");
    e.run("plankHold = null; stopPlankCam();"); n = SAID(e).length; t0 = e.now(); e.$("plankCamBtn").onclick(); await e.advance(2500);
    check("plank: third start is quick too", words(e, n) === QUICK(t0));
    /* switch exercise: push-ups after plank is a new session, and plank after push-ups is new again */
    e.run("plankHold = null; stopPlankCam();"); n = SAID(e).length; t0 = e.now(); e.$("pushStartBtn").onclick(); await e.advance(10100);
    check("plank -> push-ups: full push-ups intro", words(e, n) === FULL("pushups", t0));
    e.run("pushState.running = false; stopCam();"); n = SAID(e).length; t0 = e.now(); e.$("plankCamBtn").onclick(); await e.advance(10100);
    check("push-ups -> plank: full plank intro again", words(e, n) === FULL("plank", t0)); }
  { const e = env(); e.$("plankCamBtn").onclick(); await e.advance(6000); e.$("plankCamBtn").onclick(); await e.advance(500);
    const n = SAID(e).length, t0 = e.now(); e.$("plankCamBtn").onclick(); await e.advance(10100);
    check("plank: start cancelled during the countdown is not a first set", words(e, n) === FULL("plank", t0)); }
  // ---- static wiring
  const tbLine = line('$("tbCam").onclick = ');
  check("TUT battles camera tap: skips the placement + criteria intro on a restart, commits the session, still unlocks speech",
    /sessionPlan\("tut-battle"\) === "restart"/.test(tbLine) && /sessionCommit\("tut-battle"\)/.test(tbLine) && /restart \? null : showPositioning\("tut"/.test(tbLine) && /unlockGetSet\(\)/.test(tbLine) && /tbCamOn\(placed\)/.test(tbLine));
  check("battle room countdowns (server-synced for both phones) are unchanged", html.includes("makeSharedCountdownVoice") && !/getSetCountdown/.test(tbLine) && GS.BATTLE_WORDS[5] === "Ready" && GS.BATTLE_WORDS[1] === "one");
  check("leaving the exercise (hashchange) resets the session; stops and finishes touch it",
    /addEventListener\("hashchange", \(\) => \{ if \(sessionTrack\) sessionTrack\.reset\(\); \}\)/.test(html) && /function finishPushSet\((?:endedBy)?\) \{\n  if \(pushState\.finished\) return;\n  sessionTouch\(\);/.test(html) && /function stopPlankCam\(\) \{\n  sessionTouch\(\);/.test(html) && /function plankEnded\(r\) \{\n[^\n]*plankTimeVoice\.end\(\);\n  sessionTouch\(\);/.test(html) && /function tbFinish\(r\) \{\n  sessionTouch\(\); clearInterval/.test(html));
  check("session is committed only after the first countdown finishes (push-ups and plank)", /sessionCommit\(coachKind\);\n    pushStarting = false;/.test(html) && /sessionCommit\("plank"\);\n    plankStarting = false;/.test(html));
  check("get-set.js defaults: push-up COACH place line (leaned-up setup), plank line is the sideways side-view setup, and the 7 s STEPS", GS.STEPS.length === 6 && GS.COUNTDOWN_MS === 7000 && C.pushups.place === "Lean your phone up in front of you, camera facing you." && C.plank.place === "Prop your phone sideways on the floor, off to your side. Turn so the camera sees your side.");
  check("push-counter.js still exports DEFAULTS with the same rep-duration limits", require("../push-counter.js").DEFAULTS.minRepMs === 400 && require("../push-counter.js").DEFAULTS.maxRepMs === 6000);
  check("no 'zaba' user-facing or location text added in get-set.js", !/zaba(?!bba)/i.test(GS_SRC) && !/jersey/i.test(GS_SRC));
  const f = R.filter((x) => !x).length; console.log(`\n${R.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})();
