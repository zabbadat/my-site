// Single push-up Start (Start set / Start session / Start challenge) + 3-2-1 spoken countdown after calibration (push + Plank House). Run: node test/push-single-start.test.js
// Real functions are sliced from index.html and run in a vm with a manual clock and stubs; get-set.js runs in the same vm.
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
  const C = { sets: GS.coachLines("pushups"), long: GS.coachLines("tut"), challenge: GS.coachLines("pushups"), plank: GS.coachLines("plank") };
  const CD = ["Ready", "get set", "three", "two", "one", "Go"];
  // ---- get-set.js countdown
  { const said = [], shown = [], q = []; let unl = 0; const g = GS.makeGoCountdown({ speak: (w) => said.push(w), unlock: () => unl++, schedule: (f, d) => q.push([f, d]) });
    check("GET_SET_MS is 7000 and matches the shared STEPS", /const GET_SET_MS = 7000;/.test(html) && g.ms === 7000 && GS.STEPS[GS.STEPS.length - 1][0] === 7000);
    let done = null; g.unlock(); g.run((t) => shown.push(t)).then((v) => (done = v));
    check("unlock() and 'Ready' run synchronously", unl === 1 && said[0] === "Ready" && shown[0] === "Ready");
    const gaps = []; while (q.length) { const [f, d] = q.shift(); gaps.push(d); f(); }
    await flush();
    check("pacing: Ready +2 s get set +2 s three +1 two +1 one +1 Go", gaps.join(",") === "2000,2000,1000,1000,1000");
    check("spoken Ready, get set, three, two, one, Go; shown Ready, Get set, 3, 2, 1, GO; resolves true", said.join("|") === CD.join("|") && shown.join("|") === "Ready|Get set|3|2|1|GO" && done === true); }
  // ---- signed in, speech ends each line after 1 s: place @0 (in tap), criteria @1 s (>= 2 s), Ready @3 s ... Go + clock @10 s
  for (const mode of ["sets", "long", "challenge"]) {
    const e = env({ mode });
    e.$("pushStartBtn").onclick();
    check(`${mode}: in the tap: gate, wake, silent unlock, placement line spoken + shown; no camera/clock yet`, e.log.slice(0, 5).join(",") === "gate:pushups,pushWake:start,speech:cancel,speech:unlock,say:" + C[mode].place && !e.log.some((x) => /^(camera|pose|clock)/.test(x)) && e.$("pushStatus").textContent === C[mode].place && e.$("pushStartBtn").disabled === true);
    await e.advance(10);
    check(`${mode}: camera + pose open while the placement line plays`, e.log.indexOf("camera") > 0 && e.log.indexOf("camera") < e.log.indexOf("pose") && SAID(e).length === 1);
    await e.advance(1000);
    check(`${mode}: criteria line spoken + shown after the placement line ends`, SAID(e)[1] && SAID(e)[1].w === C[mode].criteria && SAID(e)[1].at === 1000 && e.$("pushStatus").textContent === C[mode].criteria);
    await e.advance(9990 - e.now());
    check(`${mode}: no Go / clock before 10 s`, !e.log.includes("say:Go") && !e.log.includes("clock") && e.$("pushStatus").textContent === "1");
    await e.advance(20);
    const times = SAID(e).map((x) => x.w + "@" + x.at).join(",");
    check(`${mode}: timeline`, times === [C[mode].place + "@0", C[mode].criteria + "@1000", "Ready@3000", "get set@5000", "three@7000", "two@8000", "one@9000", "Go@10000"].join(","));
    check(`${mode}: clock starts at Go`, e.run("pushState.running") === true && e.$("pushStatus").textContent === STATUS[mode] && e.$("pushStartBtn").disabled === false);
    if (mode === "challenge") check("challenge: 3:00 challenge clock started", e.log.includes("challenge:start"));
  }
  { const e = env({ noEnd: true }); e.$("pushStartBtn").onclick(); await e.advance(9990);
    check("utterance end never reported: placement line capped at 10 s", SAID(e).length === 1); await e.advance(20); check("... then the criteria line", SAID(e).length === 2); }
  // ---- camera already on
  { const e = env(); e.run('camOn = true;'); e.$("pushStartBtn").onclick(); await e.advance(10100);
    check("camera already on: reused, coaching, countdown, Go, clock", !e.log.includes("camera") && e.log.includes("say:Go") && e.run("pushState.running") === true); }
  // ---- signed out
  { const e = env({ signedIn: false }); e.$("pushStartBtn").onclick(); await e.advance(12000);
    check("signed out: prompt shown, nothing starts (no wake, speech, camera, clock)", e.log.join(",") === "gate:pushups,prompt");
    e.run("signedIn = true; practiceCb();"); await e.advance(10100);
    check("signed out -> practice: same flow starts the clock", e.log.includes("pushWake:start") && e.log.includes("camera") && e.log.includes("say:Ready") && e.run("pushState.running") === true); }
  // ---- camera blocked
  { const e = env({ camBlocked: true }); e.$("pushStartBtn").onclick(); await e.advance(2500);
    check("camera blocked: 'Camera or pose blocked.', no countdown, no clock, wakes released", e.$("pushStatus").textContent === "Camera or pose blocked." && !e.log.includes("say:Ready") && !e.log.includes("clock") && e.run("pushWake.held") === false && e.run("camWake.held") === false && e.$("pushStartBtn").disabled === false); }
  // ---- cancel at each stage
  { const e = env(); e.$("pushStartBtn").onclick(); e.run("stopCam()"); await e.advance(12000);
    check("cancel while camera loading: camera closed, no countdown, no clock, wake released", e.run("camOn") === false && !e.log.includes("say:Ready") && !e.log.includes("clock") && e.run("pushWake.held") === false); }
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(1500); e.run("stopCam()"); await e.advance(12000);
    check("cancel during the criteria line: no countdown, no clock, wake released, 'Start cancelled.'", !e.log.includes("say:Ready") && !e.log.includes("clock") && e.run("pushWake.held") === false && e.$("pushStatus").textContent === "Start cancelled."); }
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(6000); e.run("stopCam()"); await e.advance(12000);
    check("cancel during the countdown: speech stopped, 'Go' never spoken, no clock, wake released", e.log.includes("say:Ready") && !e.log.includes("say:Go") && e.log.lastIndexOf("speech:cancel") > e.log.indexOf("say:Ready") && !e.log.includes("clock") && e.run("pushWake.held") === false); }
  // ---- speech fallback: place resolves at once, criteria 2 s, countdown 7 s -> Go ~9 s
  for (const sp of ["absent", "throw"]) { const e = env({ speech: sp }); let threw = null;
    try { e.$("pushStartBtn").onclick(); } catch (x) { threw = x; }
    await e.advance(6010); const shown = e.$("pushStatus").textContent; await e.advance(3100);
    check(`speech ${sp}: silent fallback, on-screen countdown runs, clock still starts`, !threw && shown === "3" && e.run("pushState.running") === true); }
  // ---- Plank House: same shared sequence, then its 1.5 s good-form hold (plank-session readyMs unchanged)
  { const e = env(); e.$("plankCamBtn").onclick();
    check("plank: in the tap: gate, wake, unlock, placement line spoken + shown", e.log.join(",") === "gate:plank,plankWake:start,speech:cancel,speech:unlock,say:" + C.plank.place && e.$("plankStatus").textContent === C.plank.place);
    await e.advance(10); check("plank: camera opens while the placement line plays", e.log.includes("camera") && SAID(e).length === 1);
    await e.advance(1000); check("plank: criteria line after the placement line", SAID(e)[1].w === C.plank.criteria && e.$("plankStatus").textContent === C.plank.criteria);
    await e.advance(9980 - e.now()); check("plank: hold not armed during countdown", !e.log.includes("plankHold") && e.$("plankStatus").textContent === "1");
    await e.advance(30);
    check("plank: timeline", SAID(e).map((x) => x.w + "@" + x.at).join(",") === [C.plank.place + "@0", C.plank.criteria + "@1000", "Ready@3000", "get set@5000", "three@7000", "two@8000", "one@9000", "Go@10000", C.plank.rules + "@10000"].join(","));
    check("plank: after Go, 1.5 s good-form hold armed as the clock trigger", e.log.indexOf("plankHold") > e.log.indexOf("say:Go") && e.run("plankLoop") === true && e.$("plankStatus").textContent === "Whole body in the outline, side-on. Hold a straight plank for 1.5 seconds to start the clock. Hips sagging or piking up, knees down, standing up, or leaving the frame for a second ends the hold." && /readyMs: 1500,/.test(fs.readFileSync(path.join(__dirname, "..", "plank-session.js"), "utf8"))); }
  { const e = env({ speech: "absent" }); e.$("plankCamBtn").onclick(); await e.advance(10); await e.advance(1900);
    check("plank silent fallback: criteria held 2 s", e.$("plankStatus").textContent === C.plank.criteria); await e.advance(150); check("plank silent fallback: countdown starts after 2 s", e.$("plankStatus").textContent === "Ready"); }
  for (const at of [0, 600, 5000]) { const e = env(); e.$("plankCamBtn").onclick(); await e.advance(at); e.$("plankCamBtn").onclick(); await e.advance(12000);
    check(`plank: Stop camera at ${at} ms cancels cleanly`, !e.log.includes("plankHold") && !e.log.includes("say:Go") && e.run("plankWake.held") === false && e.run("plankStream") === null && e.$("plankCamBtn").textContent === "Start plank camera"); }
  { const e = env({ camBlocked: true }); e.$("plankCamBtn").onclick(); await e.advance(100);
    check("plank camera blocked: message, wake released", e.$("plankStatus").textContent === "Camera or pose blocked." && e.run("plankWake.held") === false); }
  // ---- static UI
  check("static: single push Start button, no old phone-placement button / camBtn", !html.includes('id="camBtn"') && !html.includes("Phone on floor") && html.includes('<button class="btn" id="pushStartBtn" type="button">Start set</button>'));
  check("static: Stop camera kept", html.includes('<button class="btn ghost" id="camStopBtn" type="button" hidden>Stop camera</button>'));
  check("static: note near the button", html.includes('Get set first: tapping Start turns on your camera and talks you through setup, then a slow countdown ("Ready" … "get set" … "three, two, one, go"). Counting starts at Go; your first full push-up counts.'));
  check("static: solo counter needs no calibration (the first real dip sets the top and counts)", html.includes("pushCounter = window.ZabbadatPush.createCounter();") && !html.includes("function waitCalibrated("));
  check("static: default status", html.includes('<p class="note" id="pushStatus">Ready. Get set, then tap Start.</p>'));
  check("static: no 'Start, get, set' text left", !/Start, get, set|"get", "set"|Set!/.test(html + GS_SRC));
  check("static: no Calibrate or Place phone and camera labels", !/>\s*Calibrate\s*</.test(html) && !html.includes("Place phone and camera"));
  check("static: battles/plank/washers buttons unchanged", html.includes(">Start plank camera</button>") && html.includes('id="tbCam"') && />Turn on camera</.test(html) && />I(&rsquo;|'|’)m ready</.test(html) && />Start game</.test(html));
  const tb = between('$("tbCam").onclick = ', "\n") + between('$("tbReady").onclick', "\n");
  check("TUT battles: speech unlocked in both taps, coaching on camera tap, no solo get-set delay (battle countdown is shared)", /unlockGetSet\(\)/.test(tb.split("\n")[0]) && /showPositioning\("tut"/.test(tb) && /unlockGetSet\(\)/.test(tb.split("\n")[1]) && !/getSetCountdown/.test(tb) && html.split("getSetCountdown(").length - 1 === 3 && html.split("speechSynthesis").length === 1);
  check("static: get-set.js loaded before use", html.indexOf('<script src="/get-set.js"></script>') > 0 && html.indexOf('<script src="/get-set.js"></script>') < html.indexOf("const getSet = "));
  const f = R.filter((x) => !x).length; console.log(`\n${R.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})();
