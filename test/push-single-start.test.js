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
  const PROMPT_PUSH = GS.positionPrompt("pushups"), PROMPT_PLANK = GS.positionPrompt("plank");
  const SAID = (e) => e.ctx.spoken.filter((x) => x.vol !== 0);
  // ---- get-set.js helper
  { const said = [], shown = []; let unl = 0, q = []; const g = GS.makeGoCountdown({ ms: 5000, speak: (w) => said.push(w), unlock: () => unl++, schedule: (f, d) => q.push([f, d]) });
    check("GET_SET_MS is 5000 (5-second countdown)", /const GET_SET_MS = 5000;/.test(html) && g.ms === 5000);
    check("spoken words: 'Ready, get set' then 'Go'", JSON.stringify(g.words) === '["Ready, get set","Go"]' && GS.READY === "Ready, get set");
    let done = null; g.unlock(); g.run((t) => shown.push(t)).then((v) => (done = v));
    check("unlock() and 'Ready, get set' run synchronously", unl === 1 && said[0] === "Ready, get set" && shown[0] === "Ready, get set · 5");
    while (q.length) { const [f, d] = q.shift(); check("countdown step is 1 s", d === 1000); f(); }
    await flush(); check("shown 5,4,3,2,1 then GO; 'Go' spoken last; resolves true", shown.join("|") === "Ready, get set · 5|4|3|2|1|GO" && said.join("|") === "Ready, get set|Go" && done === true);
    check("setup prompts: max 2 short lines, include 'Eyes forward'", [PROMPT_PUSH, PROMPT_PLANK].every((p) => p.split("\n").length <= 2 && /Eyes forward/.test(p) && p.length < 120) && /Front view/.test(PROMPT_PLANK) && /4-6 ft/.test(PROMPT_PLANK)); }
  // ---- signed in: gate, wake, speech unlock (in tap), camera, pose, setup prompt 2 s, 5 s countdown, Go, clock
  for (const mode of ["sets", "long", "challenge"]) {
    const e = env({ mode });
    e.$("pushStartBtn").onclick();
    check(`${mode}: in the tap: gate, wake, speech cancel + silent unlock (volume 0), no camera/countdown/clock yet`, e.log.slice(0, 4).join(",") === "gate:pushups,pushWake:start,speech:cancel,speech:unlock" && !e.log.some((x) => /^(camera|pose|say:|clock)/.test(x)) && e.ctx.spoken[0].vol === 0);
    check(`${mode}: setup prompt shown while the camera loads`, e.$("pushStatus").textContent === PROMPT_PUSH && e.$("pushStartBtn").disabled === true);
    await e.advance(10);
    const tc = e.now();
    check(`${mode}: camera + pose, setup prompt still shown, no countdown yet`, e.log.indexOf("camera") > 0 && e.log.indexOf("camera") < e.log.indexOf("pose") && e.$("pushStatus").textContent === PROMPT_PUSH && !SAID(e).length);
    await e.advance(1980);
    check(`${mode}: prompt held ~2 s after camera opens`, !SAID(e).length && e.$("pushStatus").textContent === PROMPT_PUSH);
    await e.advance(30);
    const t0 = SAID(e)[0] && SAID(e)[0].at;
    check(`${mode}: 'Ready, get set' spoken at +2 s, shows 5`, SAID(e)[0].w === "Ready, get set" && t0 - tc >= 1990 && t0 - tc <= 2030 && e.$("pushStatus").textContent === "Ready, get set · 5" && !e.log.includes("clock"));
    await e.advance(4999 - (e.now() - t0));
    check(`${mode}: 4..1 shown, no 'Go' and no clock before 5 s`, e.$("pushStatus").textContent === "1" && SAID(e).length === 1 && !e.log.includes("clock") && e.run("pushState.running") === false);
    await e.advance(1);
    check(`${mode}: 'Go' spoken at +5 s and the clock starts`, SAID(e).map((x) => x.w + "@" + (x.at - t0)).join(",") === "Ready, get set@0,Go@5000" && e.run("pushState.running") === true && e.$("pushStatus").textContent === STATUS[mode] && e.$("pushStartBtn").disabled === false);
    if (mode === "challenge") check("challenge: 3:00 challenge clock started", e.log.includes("challenge:start"));
    const L = e.log.filter((x) => /^(gate|pushWake:start|speech:unlock|camera|pose|say:|clock)/.test(x));
    check(`${mode}: order gate, wake, unlock, camera, pose, Ready get set, Go, clock`, [...new Set(L)].join(",") === "gate:pushups,pushWake:start,speech:unlock,camera,pose,say:Ready, get set,say:Go,clock");
  }
  // ---- camera already on: reused, prompt + countdown, clock
  { const e = env(); e.run('camOn = true;'); e.$("pushStartBtn").onclick(); await e.advance(7100);
    check("camera already on: reused, prompt, countdown, Go, clock", !e.log.includes("camera") && e.log.includes("say:Go") && e.run("pushState.running") === true); }
  // ---- signed out
  { const e = env({ signedIn: false }); e.$("pushStartBtn").onclick(); await e.advance(8000);
    check("signed out: prompt shown, nothing starts (no wake, speech, camera, clock)", e.log.join(",") === "gate:pushups,prompt");
    e.run("signedIn = true; practiceCb();"); await e.advance(7100);
    check("signed out -> practice: same flow starts the clock", e.log.includes("pushWake:start") && e.log.includes("camera") && e.log.includes("say:Ready, get set") && e.run("pushState.running") === true); }
  // ---- camera blocked
  { const e = env({ camBlocked: true }); e.$("pushStartBtn").onclick(); await e.advance(2500);
    check("camera blocked: 'Camera or pose blocked.', no countdown, no clock, wakes released", e.$("pushStatus").textContent === "Camera or pose blocked." && !e.log.some((x) => x.startsWith("say:")) && !e.log.includes("clock") && e.run("pushWake.held") === false && e.run("camWake.held") === false && e.$("pushStartBtn").disabled === false); }
  // ---- cancel at each stage
  { const e = env(); e.$("pushStartBtn").onclick(); e.run("stopCam()"); await e.advance(9000);
    check("cancel while camera loading: camera closed, no countdown, no clock, wake released", e.run("camOn") === false && !e.log.some((x) => x.startsWith("say:")) && !e.log.includes("clock") && e.run("pushWake.held") === false); }
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(500); e.run("stopCam()"); await e.advance(9000);
    check("cancel during the setup prompt: no countdown, no clock, wake released, 'Start cancelled.'", !e.log.some((x) => x.startsWith("say:")) && !e.log.includes("clock") && e.run("pushWake.held") === false && e.$("pushStatus").textContent === "Start cancelled."); }
  { const e = env(); e.$("pushStartBtn").onclick(); await e.advance(3500); e.run("stopCam()"); await e.advance(9000);
    check("cancel during the countdown: speech stopped, 'Go' never spoken, no clock, wake released", e.log.includes("say:Ready, get set") && !e.log.includes("say:Go") && e.log.lastIndexOf("speech:cancel") > e.log.indexOf("say:Ready, get set") && !e.log.includes("clock") && e.run("pushWake.held") === false); }
  // ---- speech fallback
  for (const sp of ["absent", "throw"]) { const e = env({ speech: sp }); let threw = null;
    try { e.$("pushStartBtn").onclick(); } catch (x) { threw = x; }
    await e.advance(4010); const shown = e.$("pushStatus").textContent; await e.advance(3100);
    check(`speech ${sp}: silent fallback, on-screen countdown runs, clock still starts`, !threw && shown === "3" && e.run("pushState.running") === true); }
  // ---- Plank House: same prompt + 5 s countdown, then its 1.5 s good-form hold (plank-session readyMs unchanged)
  { const e = env(); e.$("plankCamBtn").onclick();
    check("plank: in the tap: gate, wake, speech unlock; plank setup prompt shown", e.log.join(",") === "gate:plank,plankWake:start,speech:cancel,speech:unlock" && e.$("plankStatus").textContent === PROMPT_PLANK);
    await e.advance(10);
    check("plank: camera + pose, prompt held, no countdown yet", e.log.includes("camera") && !e.log.some((x) => x.startsWith("say:")) && e.$("plankStatus").textContent === PROMPT_PLANK);
    await e.advance(2010); check("plank: 'Ready, get set' after the prompt", e.log.includes("say:Ready, get set") && !e.log.includes("plankHold"));
    await e.advance(4970); check("plank: 1.5 s hold not armed during countdown", !e.log.includes("plankHold") && e.$("plankStatus").textContent === "1");
    await e.advance(40);
    check("plank: after Go, 1.5 s good-form hold armed as the clock trigger", e.log.indexOf("plankHold") > e.log.indexOf("say:Go") && e.run("plankLoop") === true && e.$("plankStatus").textContent === "Front view, whole body in frame. Hold a straight plank for 1.5 seconds to start the clock." && /readyMs: 1500,/.test(fs.readFileSync(path.join(__dirname, "..", "plank-session.js"), "utf8"))); }
  for (const at of [0, 600, 4000]) { const e = env(); e.$("plankCamBtn").onclick(); await e.advance(at); e.$("plankCamBtn").onclick(); await e.advance(9000);
    check(`plank: Stop camera at ${at} ms cancels cleanly`, !e.log.includes("plankHold") && !e.log.includes("say:Go") && e.run("plankWake.held") === false && e.run("plankStream") === null && e.$("plankCamBtn").textContent === "Start plank camera"); }
  { const e = env({ camBlocked: true }); e.$("plankCamBtn").onclick(); await e.advance(100);
    check("plank camera blocked: message, wake released", e.$("plankStatus").textContent === "Camera or pose blocked." && e.run("plankWake.held") === false); }
  // ---- static UI
  check("static: single push Start button, no Phone on floor / camBtn", !html.includes('id="camBtn"') && !html.includes("Phone on floor") && html.includes('<button class="btn" id="pushStartBtn" type="button">Start set</button>'));
  check("static: Stop camera kept", html.includes('<button class="btn ghost" id="camStopBtn" type="button" hidden>Stop camera</button>'));
  check("static: note near the button", html.includes('Get set first: tapping Start turns on your camera, then a 5-second countdown ("Ready, get set" … "Go"). Counting starts at Go; your first full, slow pushup sets the top and counts.'));
  check("static: solo counter locks the top from the first real dip", html.includes("createCounter({ lockOnDip: true })") && !html.includes("function waitCalibrated("));
  check("static: default status", html.includes('<p class="note" id="pushStatus">Ready. Get set, then tap Start.</p>'));
  check("static: no 'Start, get, set' text left", !/Start, get, set|"get", "set"|Set!/.test(html + GS_SRC));
  check("static: no Calibrate or Place phone and camera labels", !/>\s*Calibrate\s*</.test(html) && !html.includes("Place phone and camera"));
  check("static: battles/plank/washers buttons unchanged", html.includes(">Start plank camera</button>") && html.includes('id="tbCam"') && />Turn on camera</.test(html) && />I(&rsquo;|'|’)m ready</.test(html) && />Start game</.test(html));
  const tb = between('$("tbCam").onclick = ', "\n") + between('$("tbReady").onclick', "\n");
  check("TUT battles: no get-set delay or speech (get-set used only by push + plank)", !/getSet|GET_SET|speech/.test(tb) && html.split("getSetCountdown(").length - 1 === 3 && html.split("speechSynthesis").length === 1);
  check("static: get-set.js loaded before use", html.indexOf('<script src="/get-set.js"></script>') > 0 && html.indexOf('<script src="/get-set.js"></script>') < html.indexOf("const getSet = "));
  const f = R.filter((x) => !x).length; console.log(`\n${R.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})();
