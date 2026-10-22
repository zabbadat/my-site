// Single push-up Start (Start set / Start challenge) + 2 s spoken get-set (push + Plank House). Run: node test/push-single-start.test.js
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
    ctx.spoken = []; ctx.speechSynthesis = { cancel: () => log.push("speech:cancel"), speak: (u) => { if (o.speech === "throw") throw new Error("nope"); ctx.spoken.push({ w: u.text, at: now, rate: u.rate }); log.push("say:" + u.text); } };
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
  const SRC = [STUBS, line("const GET_SET_MS"), line("const getSet = "), fnSrc("getSetCountdown"), line("function cancelGetSet"), line("let pushStarting"),
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

(async () => {
  // ---- get-set.js helper
  { const said = [], sched = [], shown = []; const g = GS.makeGetSet({ ms: 2000, speak: (w) => said.push(w), schedule: (f, d) => sched.push({ f, d }) });
    check("GET_SET_MS is 2000 (within 1-3 s)", /const GET_SET_MS = 2000;/.test(html) && g.ms >= 1000 && g.ms <= 3000 && g.ms === 2000);
    check("word offsets 0/1000/1700 ms, all inside the 2000 ms window", JSON.stringify(g.offsets) === "[0,1000,1700]" && g.offsets.every((t) => t < g.ms));
    check("spoken words Start, get, set; shown Start, Get, Set!", JSON.stringify(g.words) === '["Start","get","set"]' && JSON.stringify(g.labels) === '["Start","Get","Set!"]');
    g.run((t) => shown.push(t));
    check("first word spoken synchronously in run() (inside the tap)", said.length === 1 && said[0] === "Start" && shown[0] === "Get set \u2014 Start"); }
  // ---- signed in, sets mode: order gate, wake, (get-set), camera, pose, calibrate, clock
  for (const mode of ["sets", "long", "challenge"]) {
    const e = env({ mode }); const label = mode === "challenge" ? "Start challenge" : "Start set";
    e.$("pushStartBtn").onclick();
    check(`${mode}: wake started inside the tap, first word spoken + speech cancelled first`, e.log.join(",") === "gate:pushups,pushWake:start,speech:cancel,say:Start" && e.$("pushStatus").textContent === "Get set \u2014 Start");
    check(`${mode}: button disabled while starting`, e.$("pushStartBtn").disabled === true);
    await e.advance(1999);
    check(`${mode}: nothing (camera/clock) before the 2000 ms get-set ends`, !e.log.includes("camera") && !e.log.includes("clock") && e.ctx.spoken.map((s) => s.w + "@" + s.at).join(",") === "Start@0,get@1000,set@1700");
    check(`${mode}: speech rate 1.3`, e.ctx.spoken.every((s) => s.rate === 1.3));
    await e.advance(1);
    check(`${mode}: camera + pose after get-set, then calibration prompt`, e.log.includes("camera") && e.log.indexOf("camera") < e.log.indexOf("pose") && e.$("pushStatus").textContent === "Hold the top to calibrate");
    await e.advance(3000);
    check(`${mode}: clock not started until calibrated`, !e.log.includes("clock") && e.run("pushState.running") === false);
    e.run('pushCounter.ph = "first"'); await e.advance(200);
    const want = mode === "challenge" ? "Challenge on. 3:00 on the clock; stay in plank, the camera counts each full rep." : mode === "long" ? "Session on. The clock runs nonstop; the camera counts each full rep." : "Set on. The camera counts each full rep.";
    check(`${mode}: then clock starts with mode status (${label})`, e.run("pushState.running") === true && e.log.includes("clock") && e.$("pushStatus").textContent === want && e.$("pushStartBtn").disabled === false);
    if (mode === "challenge") check("challenge: 3:00 challenge clock started", e.log.includes("challenge:start"));
    const L = e.log.filter((x) => /^(gate|pushWake:start|camera|pose|clock)/.test(x));
    check(`${mode}: full order gate, wake, camera, pose, clock`, [...new Set(L)].join(",") === "gate:pushups,pushWake:start,camera,pose,clock");
  }
  // ---- signed out
  { const e = env({ signedIn: false }); e.$("pushStartBtn").onclick(); await e.advance(5000);
    check("signed out: prompt shown, nothing starts (no wake, speech, camera, clock)", e.log.join(",") === "gate:pushups,prompt");
    e.run("signedIn = true; practiceCb();"); await e.advance(2000); e.run('pushCounter.ph = "ready"'); await e.advance(200);
    check("signed out -> practice: same flow starts the clock", e.log.includes("pushWake:start") && e.log.includes("camera") && e.run("pushState.running") === true); }
  // ---- camera blocked
  { const e = env({ camBlocked: true }); e.$("pushStartBtn").onclick(); await e.advance(2500);
    check("camera blocked: 'Camera or pose blocked.', no clock, wakes released", e.$("pushStatus").textContent === "Camera or pose blocked." && !e.log.includes("clock") && e.run("pushWake.held") === false && e.run("camWake.held") === false && e.$("pushStartBtn").disabled === false); }
  // ---- cancel during countdown / calibration
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(700); e.run("stopCam()"); await e.advance(5000);
    check("Stop camera during get-set: no camera, no clock, wake released, speech cancelled", !e.log.includes("camera") && !e.log.includes("clock") && e.run("pushWake.held") === false && e.log.filter((x) => x === "speech:cancel").length >= 2 && !e.ctx.spoken.some((s) => s.w === "get")); }
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(2100); e.run("stopCam()"); e.run('pushCounter.ph = "ready"'); await e.advance(1000);
    check("Stop camera while calibrating cancels the pending start", !e.log.includes("clock") && e.run("pushWake.held") === false && e.$("pushStatus").textContent === "Start cancelled."); }
  // ---- speech fallback
  for (const sp of ["absent", "throw"]) { const e = env({ speech: sp }); let threw = null;
    try { e.$("pushStartBtn").onclick(); } catch (x) { threw = x; }
    await e.advance(1000); const shown = e.$("pushStatus").textContent; await e.advance(1100); e.run('pushCounter.ph = "ready"'); await e.advance(200);
    check(`speech ${sp}: silent fallback, visual count runs, game still starts`, !threw && shown === "Get set \u2014 Get" && e.run("pushState.running") === true); }
  // ---- Plank House
  { const e = env(); e.$("plankCamBtn").onclick();
    check("plank: wake + first word inside the tap", e.log.join(",") === "gate:plank,plankWake:start,speech:cancel,say:Start");
    await e.advance(1999); check("plank: no camera before get-set ends", !e.log.includes("camera") && !e.log.includes("plankHold"));
    await e.advance(10);
    check("plank: then camera and 1.5 s good-form hold armed", e.log.includes("camera") && e.log.includes("plankHold") && e.$("plankStatus").textContent.includes("Hold a straight plank for 1.5 seconds to start the clock") && /readyMs: 1500,/.test(fs.readFileSync(path.join(__dirname, "..", "plank-session.js"), "utf8"))); }
  { const e = env(); e.$("plankCamBtn").onclick(); await e.advance(600); e.$("plankCamBtn").onclick(); await e.advance(3000);
    check("plank: tap again (Stop camera) during get-set cancels cleanly", !e.log.includes("camera") && e.run("plankWake.held") === false && e.$("plankCamBtn").textContent === "Start plank camera"); }
  // ---- static UI
  check("static: single push Start button, no Phone on floor / camBtn", !html.includes('id="camBtn"') && !html.includes("Phone on floor") && html.includes('<button class="btn" id="pushStartBtn" type="button">Start set</button>'));
  check("static: Stop camera kept", html.includes('<button class="btn ghost" id="camStopBtn" type="button" hidden>Stop camera</button>'));
  check("static: note near the button", html.includes('Get set first: tapping Start turns on your camera after a 2-second "Start, get, set" count. Hold the top for a second to calibrate, then the clock starts.'));
  check("static: default status", html.includes('<p class="note" id="pushStatus">Ready. Get set, then tap Start.</p>'));
  check("static: no Calibrate or Place phone and camera labels", !/>\s*Calibrate\s*</.test(html) && !html.includes("Place phone and camera"));
  check("static: battles/plank/washers buttons unchanged", html.includes(">Start plank camera</button>") && html.includes('id="tbCam"') && />Turn on camera</.test(html) && />I(&rsquo;|'|’)m ready</.test(html) && />Start game</.test(html));
  const tb = between('$("tbCam").onclick = ', "\n") + between('$("tbReady").onclick', "\n");
  check("TUT battles: no get-set delay or speech (get-set used only by push + plank)", !/getSet|GET_SET|speech/.test(tb) && html.split("getSetCountdown(").length - 1 === 3 && html.split("speechSynthesis").length === 1);
  check("static: get-set.js loaded before use", html.indexOf('<script src="/get-set.js"></script>') > 0 && html.indexOf('<script src="/get-set.js"></script>') < html.indexOf("const getSet = "));
  const f = R.filter((x) => !x).length; console.log(`\n${R.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})();
