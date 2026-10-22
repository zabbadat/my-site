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
    ctx.spoken = []; ctx.speechSynthesis = { cancel: () => log.push("speech:cancel"), speak: (u) => { if (o.speech === "throw") throw new Error("nope"); ctx.spoken.push({ w: u.text, at: now, rate: u.rate, vol: u.volume }); log.push(u.volume === 0 ? "speech:unlock" : "say:" + u.text); } };
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
  const SRC = [STUBS, line("const GET_SET_MS"), line("const getSet = "), fnSrc("getSetCountdown"), line("function cancelGetSet"), line("function unlockGetSet"), line("let pushStarting"),
    fnSrc("cancelPushStart"), fnSrc("waitCalibrated"), "async " + fnSrc("startPush"), fnSrc("beginPushClock"), line('if ($("pushStartBtn")) $("pushStartBtn").onclick = '),
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
  // ---- get-set.js helper
  { const said = [], shown = []; let unl = 0; const g = GS.makeGetSet({ ms: 2000, speak: (w) => said.push(w), unlock: () => unl++, schedule: () => {} });
    check("GET_SET_MS is 2000 (countdown ~2 s)", /const GET_SET_MS = 2000;/.test(html) && g.ms === 2000);
    check("3-2-1 offsets 0/700/1400 ms inside the 2000 ms window", JSON.stringify(g.offsets) === "[0,700,1400]");
    check("spoken and shown 3, 2, 1", JSON.stringify(g.words) === '["3","2","1"]' && JSON.stringify(g.labels) === '["3","2","1"]');
    g.unlock(); g.run((t) => shown.push(t)); check("unlock() and first word run synchronously", unl === 1 && said[0] === "3" && shown[0] === "3"); }
  // ---- signed in: gate, wake, speech unlock (in tap), camera, pose, calibrate, 3-2-1, clock
  for (const mode of ["sets", "long", "challenge"]) {
    const e = env({ mode });
    e.$("pushStartBtn").onclick();
    check(`${mode}: in the tap: gate, wake, speech cancel + silent unlock (volume 0), no camera/countdown/clock yet`, e.log.slice(0, 4).join(",") === "gate:pushups,pushWake:start,speech:cancel,speech:unlock" && !e.log.some((x) => /^(camera|pose|say:|clock)/.test(x)) && e.ctx.spoken[0].vol === 0);
    check(`${mode}: button disabled while starting`, e.$("pushStartBtn").disabled === true);
    await e.advance(10);
    check(`${mode}: camera + pose, then "Hold the top to calibrate"`, e.log.indexOf("camera") > 0 && e.log.indexOf("camera") < e.log.indexOf("pose") && e.$("pushStatus").textContent === "Hold the top to calibrate");
    await e.advance(5000);
    check(`${mode}: no countdown and no clock before calibration`, !e.log.some((x) => x.startsWith("say:")) && !e.log.includes("clock"));
    e.run('pushCounter.ph = "first"'); await e.advance(100);
    const t0 = e.ctx.spoken.find((x) => x.w === "3").at;
    check(`${mode}: countdown starts after calibration, shows "3"`, e.$("pushStatus").textContent === "3" && !e.log.includes("clock"));
    await e.advance(1999 - (e.now() - t0));
    check(`${mode}: 3/2/1 spoken at +0/+700/+1400 ms, clock not yet started`, e.ctx.spoken.filter((x) => x.vol !== 0).map((x) => x.w + "@" + (x.at - t0)).join(",") === "3@0,2@700,1@1400" && e.$("pushStatus").textContent === "1" && !e.log.includes("clock"));
    await e.advance(1);
    check(`${mode}: clock starts at +2000 ms with mode status`, e.run("pushState.running") === true && e.$("pushStatus").textContent === STATUS[mode] && e.$("pushStartBtn").disabled === false);
    if (mode === "challenge") check("challenge: 3:00 challenge clock started", e.log.includes("challenge:start"));
    const L = e.log.filter((x) => /^(gate|pushWake:start|speech:unlock|camera|pose|say:|clock)/.test(x));
    check(`${mode}: order gate, wake, unlock, camera, pose, 3, 2, 1, clock`, [...new Set(L)].join(",") === "gate:pushups,pushWake:start,speech:unlock,camera,pose,say:3,say:2,say:1,clock");
  }
  // ---- already calibrated (camera on): countdown straight away
  { const e = env(); e.run('camOn = true; pushCounter.ph = "ready";'); e.$("pushStartBtn").onclick(); await e.advance(2000);
    check("camera already on + calibrated: reused, 3-2-1, clock", !e.log.includes("camera") && e.log.includes("say:1") && e.run("pushState.running") === true); }
  // ---- signed out
  { const e = env({ signedIn: false }); e.$("pushStartBtn").onclick(); await e.advance(5000);
    check("signed out: prompt shown, nothing starts (no wake, speech, camera, clock)", e.log.join(",") === "gate:pushups,prompt");
    e.run("signedIn = true; practiceCb();"); await e.advance(10); e.run('pushCounter.ph = "ready"'); await e.advance(2200);
    check("signed out -> practice: same flow starts the clock", e.log.includes("pushWake:start") && e.log.includes("camera") && e.log.includes("say:3") && e.run("pushState.running") === true); }
  // ---- camera blocked
  { const e = env({ camBlocked: true }); e.$("pushStartBtn").onclick(); await e.advance(2500);
    check("camera blocked: 'Camera or pose blocked.', no countdown, no clock, wakes released", e.$("pushStatus").textContent === "Camera or pose blocked." && !e.log.some((x) => x.startsWith("say:")) && !e.log.includes("clock") && e.run("pushWake.held") === false && e.run("camWake.held") === false && e.$("pushStartBtn").disabled === false); }
  // ---- cancel at each stage
  { const e = env(); e.$("pushStartBtn").onclick(); e.run("stopCam()"); await e.advance(5000); e.run('pushCounter.ph = "ready"'); await e.advance(3000);
    check("cancel while camera loading: camera closed, no countdown, no clock, wake released", e.run("camOn") === false && !e.log.some((x) => x.startsWith("say:")) && !e.log.includes("clock") && e.run("pushWake.held") === false); }
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(500); e.run("stopCam()"); e.run('pushCounter.ph = "ready"'); await e.advance(3000);
    check("cancel while calibrating: no countdown, no clock, wake released, 'Start cancelled.'", !e.log.some((x) => x.startsWith("say:")) && !e.log.includes("clock") && e.run("pushWake.held") === false && e.$("pushStatus").textContent === "Start cancelled."); }
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(10); e.run('pushCounter.ph = "ready"'); await e.advance(800); e.run("stopCam()"); await e.advance(3000);
    check("cancel during 3-2-1: speech stopped, '1' never spoken, no clock, wake released", e.log.includes("say:2") && !e.log.includes("say:1") && e.log.lastIndexOf("speech:cancel") > e.log.indexOf("say:2") && !e.log.includes("clock") && e.run("pushWake.held") === false); }
  // ---- speech fallback
  for (const sp of ["absent", "throw"]) { const e = env({ speech: sp }); let threw = null;
    try { e.$("pushStartBtn").onclick(); } catch (x) { threw = x; }
    await e.advance(10); e.run('pushCounter.ph = "ready"'); await e.advance(800); const shown = e.$("pushStatus").textContent; await e.advance(1400);
    check(`speech ${sp}: silent fallback, on-screen 3-2-1 runs, clock still starts`, !threw && shown === "2" && e.run("pushState.running") === true); }
  // ---- Plank House
  { const e = env(); e.$("plankCamBtn").onclick();
    check("plank: in the tap: gate, wake, speech unlock", e.log.join(",") === "gate:plank,plankWake:start,speech:cancel,speech:unlock");
    await e.advance(10);
    check("plank: camera + pose first, then 3-2-1 begins", e.log.includes("camera") && e.log.indexOf("pose") < e.log.indexOf("say:3") && !e.log.includes("plankHold"));
    await e.advance(1980); check("plank: 1.5 s hold not armed during countdown", !e.log.includes("plankHold") && e.$("plankStatus").textContent === "1");
    await e.advance(30);
    check("plank: after 3-2-1, 1.5 s good-form hold armed as the clock trigger", e.log.indexOf("plankHold") > e.log.indexOf("say:1") && e.run("plankLoop") === true && e.$("plankStatus").textContent === "Phone off to your side, whole body in view. Hold a straight plank for 1.5 seconds to start the clock." && /readyMs: 1500,/.test(fs.readFileSync(path.join(__dirname, "..", "plank-session.js"), "utf8"))); }
  for (const at of [0, 600]) { const e = env(); e.$("plankCamBtn").onclick(); await e.advance(at); e.$("plankCamBtn").onclick(); await e.advance(3000);
    check(`plank: Stop camera ${at ? "during 3-2-1" : "while camera loading"} cancels cleanly`, !e.log.includes("plankHold") && e.run("plankWake.held") === false && e.run("plankStream") === null && e.$("plankCamBtn").textContent === "Start plank camera" && e.log.lastIndexOf("speech:cancel") > 1); }
  { const e = env({ camBlocked: true }); e.$("plankCamBtn").onclick(); await e.advance(100);
    check("plank camera blocked: message, wake released", e.$("plankStatus").textContent === "Camera or pose blocked." && e.run("plankWake.held") === false); }
  // ---- static UI
  check("static: single push Start button, no Phone on floor / camBtn", !html.includes('id="camBtn"') && !html.includes("Phone on floor") && html.includes('<button class="btn" id="pushStartBtn" type="button">Start set</button>'));
  check("static: Stop camera kept", html.includes('<button class="btn ghost" id="camStopBtn" type="button" hidden>Stop camera</button>'));
  check("static: note near the button", html.includes("Get set first: tapping Start turns on your camera. Hold the top for a second to calibrate, then a 3-2-1 count and the clock starts."));
  check("static: default status", html.includes('<p class="note" id="pushStatus">Ready. Get set, then tap Start.</p>'));
  check("static: no 'Start, get, set' text left", !/Start, get, set|"get", "set"|Set!/.test(html + GS_SRC));
  check("static: no Calibrate or Place phone and camera labels", !/>\s*Calibrate\s*</.test(html) && !html.includes("Place phone and camera"));
  check("static: battles/plank/washers buttons unchanged", html.includes(">Start plank camera</button>") && html.includes('id="tbCam"') && />Turn on camera</.test(html) && />I(&rsquo;|'|’)m ready</.test(html) && />Start game</.test(html));
  const tb = between('$("tbCam").onclick = ', "\n") + between('$("tbReady").onclick', "\n");
  check("TUT battles: no get-set delay or speech (get-set used only by push + plank)", !/getSet|GET_SET|speech/.test(tb) && html.split("getSetCountdown(").length - 1 === 3 && html.split("speechSynthesis").length === 1);
  check("static: get-set.js loaded before use", html.indexOf('<script src="/get-set.js"></script>') > 0 && html.indexOf('<script src="/get-set.js"></script>') < html.indexOf("const getSet = "));
  const f = R.filter((x) => !x).length; console.log(`\n${R.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})();
