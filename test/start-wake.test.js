// Every Start button holds its own shared wake-lock.js instance. Run: node test/start-wake.test.js
// Runtime: real handlers/functions are sliced out of index.html and run in a vm with stubs; wake instances are made by
// the real makeWake() + real createWakeLock with an injected fake navigator (API path) or no API + fake video (fallback).
const fs = require("fs"), path = require("path"), vm = require("vm");
const WL = require("../wake-lock.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const tick = () => new Promise((r) => setTimeout(r, 0));
const between = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); const j = html.indexOf(b, i + a.length); return html.slice(i, j + b.length); };
const fnSrc = (name, pre = "function ") => between(pre + name + "(", "\n}");
const handler = (id) => between('$("' + id + '").onclick = ', "\n};");
const line = (start) => between(start, "\n");

function env(apiMode) {
  const nav = { requests: 0, live: () => sent.filter((s) => !s.released).length }; const sent = [];
  if (apiMode) nav.wakeLock = { request: async () => { nav.requests++; const s = { released: false, addEventListener() {}, release: async () => { s.released = true; } }; sent.push(s); return s; } };
  const vids = []; const ls = [];
  const doc = { visibilityState: "visible", addEventListener: (t, f) => t === "visibilitychange" && ls.push(f), fire() { ls.forEach((f) => f()); } };
  const createFallback = () => { const v = { playing: false, plays: 0, play() { v.plays++; v.playing = true; return Promise.resolve(); }, stop() { v.playing = false; } }; vids.push(v); return v; };
  const els = {};
  const $ = (id) => (els[id] = els[id] || { id, textContent: "", hidden: false, disabled: false, value: "", style: {}, setAttribute() {}, play: async () => {}, srcObject: null, addEventListener() {} });
  const ctx = { $, console, setInterval: () => 1, clearInterval() {}, setTimeout: (f) => setTimeout(f, 0), clearTimeout, Date, Math, Promise, JSON, String, Number,
    performance: { now: () => 1000 }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { WakeLock: { createWakeLock: (o) => WL.createWakeLock({ ...o, navigator: nav, document: doc, createFallback }) } },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } }, requestAnimationFrame() {} };
  vm.createContext(ctx);
  return { ctx, nav, sent, vids, doc, els,
    held: (w) => vm.runInContext(w + ".isHeld()", ctx), active: (w) => vm.runInContext(w + ".isActive()", ctx),
    run: (code) => vm.runInContext(code, ctx) };
}
const WAKES = line("const gameWake = makeWake(") + line("const plankBattleWake = makeWake(");
const BASE = [line("const WAKE_NOTE"), fnSrc("makeWake"), WAKES].join("\n");
const STATE = [line("const state = {"), line("let pocketOn = false;"), line("let walkLockOn = false;"), line("let relockTimer = null;"),
  line("const pushState = {"), "let pushMode = 'sets';", fnSrc("paintGameBtn"), fnSrc("setPocket"), fnSrc("setWalkLock")].join("\n");
const STUBS = `function requireSignIn() { return true; } let gameHoldDone = false; let currentUser = null; const postureGuard = null; const ZT = null; let saveRemotePush = async () => {}; let awardZab = async () => ({});
function render() {} function setStatus() {} function startPhoneSteps() {} function stopPhoneSteps() {} function renderPush() {} function resetPoseBaseline() {}
function paintPushRows() {} function localPush() { return []; } function pushTotalKey() { return "a"; } function pushSetsKey() { return "b"; } function pushTutKey() { return "c"; }
function savedPushTotal() { return 0; } function savedPushSets() { return 0; } function savedPushTut() { return 0; } function formatTime() { return ""; } function zabNote() { return ""; }
function displayNameOf() { return "x"; } window.ZabbadatSession = { setsToAdd: () => 0, tutToAdd: () => 0 };
const stepDetector = { reset() {} }; const stepVerifier = { reset() {}, resume() {}, pause() {}, result: () => ({ verified: true, reasons: [] }) };
let camStream = null, camOn = false, poseLoopOn = false, plankLoop = false, plankHold = null, plankSaved = false, plankStream = null, plankSessionStartedAt = 0;
const getSet = null, quickSet = null; function sessionPlan() { return "fresh"; } function sessionCommit() {} function sessionTouch() {} let pushCounter = null; let camFail = false; async function loadCamLibs() { if (camFail) throw new Error("blocked"); } async function ensurePose() {} function poseTick() {} function plankTick() {}
function camExitFs() {} function setCamStatus() {} function newPlankHold() {} function plankEnded() {}`;
const GAME = [handler("startBtn"), handler("pauseBtn"), handler("resetBtn"), "async " + fnSrc("finishGame"), "this.finishGame = finishGame;"].join("\n");
const PUSH = [fnSrc("finishPushSet"), line("const GET_SET_MS"), fnSrc("getSetCountdown"), line("function cancelGetSet"), line("function unlockGetSet"), line("let pushStarting"), fnSrc("cancelPushStart"), line("const POSITION_MS"), fnSrc("showPositioning"), "async " + fnSrc("startPush"), fnSrc("beginPushClock"), line('if ($("pushStartBtn")) $("pushStartBtn").onclick = '), between('if ($("pushPauseBtn")) $("pushPauseBtn").onclick = ', "\n};"),
  between('if ($("pushResetBtn")) $("pushResetBtn").onclick = ', "\n};"), "this.finishPushSet = finishPushSet;"].join("\n");
const CAM = ["async " + fnSrc("openCam"), fnSrc("stopCam"), "async " + fnSrc("startPlankCam"), line("let plankStarting"), fnSrc("cancelPlankStart"), fnSrc("stopPlankCam"),
  "this.startCam = openCam; this.stopCam = stopCam; this.startPlankCam = startPlankCam; this.stopPlankCam = stopPlankCam;"].join("\n");
const ALL_WAKES = ["gameWake", "pushWake", "camWake", "plankWake", "plankBattleWake", "tbWake"];
const load = (api) => { const e = env(api); e.run([BASE, STATE, STUBS, GAME, PUSH, CAM,
  "this.W = { gameWake, pushWake, camWake, plankWake, plankBattleWake, tbWake }; this.S = () => ({ pocketOn, walkLockOn, relockTimer }); this.setPocket = setPocket; this.setWalkLock = setWalkLock;"].join("\n")); return e; };

(async () => {
  for (const api of [true, false]) {
    const tag = api ? "API" : "fallback";
    const held = (e, w) => e.ctx.W[w].isHeld() && (api ? !e.ctx.W[w].usingFallback() : e.ctx.W[w].usingFallback());
    // ---- Zabba Washers game (#startBtn): end on pause (Hold to stop), Reset, finish at 21.
    for (const end of ["pause", "reset", "finish"]) {
      const e = load(api); const $ = e.ctx.$;
      $("startBtn").onclick(); await tick();
      check(`${tag} washers Start game: wake held, pocket lock engaged as before`, held(e, "gameWake") && e.ctx.S().pocketOn === true);
      const before = e.ctx.S().pocketOn;
      if (end === "pause") { e.ctx.setPocket(false); $("pauseBtn").onclick(); }
      if (end === "reset") { e.ctx.setPocket(false); $("resetBtn").onclick(); }
      if (end === "finish") { try { await e.ctx.finishGame(); } catch (x) {} }
      await tick();
      check(`${tag} washers ${end}: wake released`, !e.ctx.W.gameWake.isHeld() && !e.ctx.W.gameWake.isActive() && (api ? e.sent.every((s) => s.released) : e.vids.every((v) => !v.playing)));
      const r0 = api ? e.nav.requests : e.vids.reduce((n, v) => n + v.plays, 0);
      e.doc.fire(); await tick();
      check(`${tag} washers ${end}: no re-acquire after end`, (api ? e.nav.requests : e.vids.reduce((n, v) => n + v.plays, 0)) === r0 && !e.ctx.W.gameWake.isHeld());
      if (end === "pause") { $("startBtn").onclick(); await tick(); check(`${tag} washers resume re-acquires`, held(e, "gameWake")); void before; }
    }
    // Pocket lock unaffected by wake start/stop directly.
    { const e = load(api); e.ctx.setPocket(true); e.ctx.setWalkLock(true);
      for (const w of ALL_WAKES) { await e.ctx.W[w].start(); await e.ctx.W[w].stop(); }
      const s = e.ctx.S(); check(`${tag} all wakes start/stop: pocketOn + walkLockOn unchanged, no relock timer`, s.pocketOn === true && s.walkLockOn === true && s.relockTimer === null);
      e.ctx.setPocket(false); e.ctx.setWalkLock(false);
      for (const w of ALL_WAKES) { await e.ctx.W[w].start(); await e.ctx.W[w].stop(); }
      check(`${tag} all wakes start/stop: unlocked stays unlocked`, e.ctx.S().pocketOn === false && e.ctx.S().walkLockOn === false); }
    // ---- Push-up sets / One Long Set (#pushStartBtn): end on Pause (sets), Reset, Finish/End (finishPushSet).
    for (const mode of ["sets", "long"]) for (const end of ["pause", "reset", "finish"]) {
      if (mode === "long" && end === "pause") continue; // Pause is a no-op in long mode (clock is nonstop)
      const e = load(api); const $ = e.ctx.$; e.run(`pushMode = "${mode}";`);
      $("pushStartBtn").onclick(); for (let i = 0; i < 20; i++) await tick();
      check(`${tag} push ${mode} Start set: wake held`, held(e, "pushWake"));
      if (end === "pause") $("pushPauseBtn").onclick(); if (end === "reset") $("pushResetBtn").onclick(); if (end === "finish") { try { e.ctx.finishPushSet(); } catch (x) {} }
      await tick(); const n0 = e.nav.requests; e.doc.fire(); await tick();
      check(`${tag} push ${mode} ${end}: released, no re-acquire`, !e.ctx.W.pushWake.isHeld() && e.nav.requests === n0);
    }
    // ---- Cameras: push-up camera (openCam via single Start -> stopCam / failure), plank camera (#plankCamBtn -> stopPlankCam / failure).
    { const e = load(api); const p = e.ctx.startCam();
      check(`${tag} camera: wake started synchronously inside tap (before getUserMedia await)`, e.ctx.W.camWake.isActive() && (api || e.vids[e.vids.length - 1].plays === 1));
      await p; await tick();
      check(`${tag} camera on: wake held alongside stream`, held(e, "camWake") && e.run("camOn") === true && e.run("camStream") !== null);
      e.ctx.stopCam(); await tick(); check(`${tag} camera stop: released`, !e.ctx.W.camWake.isHeld() && !e.ctx.W.camWake.isActive()); }
    { const e = load(api); e.run("camFail = true;"); await e.ctx.startCam(); await tick();
      check(`${tag} camera blocked: wake released`, !e.ctx.W.camWake.isActive() && !e.ctx.W.camWake.isHeld()); }
    { const e = load(api); await e.ctx.startPlankCam(); await tick();
      check(`${tag} Start plank camera: wake held`, held(e, "plankWake") && e.run("plankLoop") === true);
      e.ctx.stopPlankCam(); await tick(); check(`${tag} Stop plank camera: released`, !e.ctx.W.plankWake.isActive() && !e.ctx.W.plankWake.isHeld()); }
    { const e = load(api); e.run("camFail = true;"); await e.ctx.startPlankCam(); await tick();
      check(`${tag} plank camera blocked: wake released`, !e.ctx.W.plankWake.isActive()); }
    // ---- Independence: every instance holds its own sentinel/video; ending one leaves the rest held.
    { const e = load(api); for (const w of ALL_WAKES) await e.ctx.W[w].start();
      check(`${tag} 6 features hold 6 separate locks`, ALL_WAKES.every((w) => held(e, w)) && (api ? new Set(e.sent).size === 6 : e.vids.length === 6));
      e.ctx.$("startBtn"); e.run("state.running = true;"); e.ctx.setPocket(false); e.ctx.$("pauseBtn").onclick(); await tick();
      check(`${tag} ending washers leaves the other 6 held`, !e.ctx.W.gameWake.isHeld() && ALL_WAKES.filter((w) => w !== "gameWake").every((w) => held(e, w)));
      e.ctx.$("pushResetBtn").onclick(); e.ctx.stopCam(); await tick();
      check(`${tag} ending push + camera leaves plank/battles held`, ["plankWake", "plankBattleWake", "tbWake"].every((w) => held(e, w)));
      // shared walk instance (as created in index.html) is independent too
      const walk = WL.createWakeLock({ navigator: e.nav, document: e.doc, createFallback: () => ({ playing: false, play() { this.playing = true; return Promise.resolve(); }, stop() { this.playing = false; } }) });
      await walk.start(); await e.ctx.W.tbWake.stop();
      check(`${tag} ending TUT battle leaves live walk held; walk stop leaves plank held`, walk.isHeld() && (await walk.stop(), held(e, "plankWake"))); }
  }

  // ---- Battles: state-driven want() expressions sliced from paintBattle / tbPaint and evaluated on room states.
  const wantExpr = (w) => { const s = between("  if (" + w + ") " + w + ".want(", ").catch"); return s.slice(s.indexOf(".want(") + 6, -7); };
  const evalWant = (expr, vars) => vm.runInNewContext("!!(" + expr + ")", vars);
  const pb = wantExpr("plankBattleWake"), tbx = wantExpr("tbWake");
  const pr = (status, ready) => ({ status, players: {} , _m: { ready } });
  const P = (m, status) => ({ mine: m, r: { status } });
  check("plank battle: not held before ready", !evalWant(pb, P({ ready: false }, "waiting")));
  check("plank battle: held when ready / countdown / live", evalWant(pb, P({ ready: true }, "waiting")) && evalWant(pb, P({ ready: false }, "countdown")) && evalWant(pb, P({}, "live")));
  check("plank battle: released when abandoned or not seated", !evalWant(pb, P({ ready: true }, "abandoned")) && !evalWant(pb, P(null, "live")));
  const T = (m, status, tbStream) => ({ mine: m, r: { status }, pre: status === "waiting", tbStream });
  check("TUT battle: held with camera on in lobby, or ready", evalWant(tbx, T({ ready: false }, "waiting", {})) && evalWant(tbx, T({ ready: true }, "waiting", null)));
  check("TUT battle: not held in lobby without camera or ready", !evalWant(tbx, T({ ready: false }, "waiting", null)));
  check("TUT battle: held through countdown and live", evalWant(tbx, T({}, "countdown", null)) && evalWant(tbx, T({}, "live", null)));
  check("TUT battle: released when done/abandoned", !evalWant(tbx, T({ ready: true }, "done", {})) && !evalWant(tbx, T({ ready: true }, "abandoned", {})));
  const G = (m, status, phase) => ({ mine: m, r: { status }, pre: status === "waiting", dec: { phase: phase || "playing" } });
  void pr;
  // Runtime: want() itself is idempotent and releases on false.
  { const nav = { n: 0, wakeLock: { request: async () => { nav.n++; return { released: false, addEventListener() {}, release: async function () { this.released = true; } }; } } };
    const w = WL.createWakeLock({ navigator: nav, document: { visibilityState: "visible", addEventListener() {} } });
    await w.want(true); await w.want(true); check("want(true) twice = one request", nav.n === 1 && w.isHeld());
    await w.want(false); check("want(false) releases", !w.isHeld() && !w.isActive()); }

  // ---- Static wiring for battles (tap-start inside gesture + exit paths); runtime of full paint needs Firestore.
  check("static: plank battle I'm ready tap starts wake", /\$\("battleReady"\)\.onclick = async \(\) => \{[^\n]*plankBattleWake\.start\(\)/.test(html));
  check("static: TUT battle I'm ready + camera taps start wake", /\$\("tbReady"\)\.onclick[^\n]*tbWake\.start\(\)/.test(html) && /\$\("tbCam"\)\.onclick = \(\) => \{[^\n]*if \(tbWake\) tbWake\.start\(\)/.test(html));
  check("static: leave/exit/sign-out (no room code) stops each battle wake", /if \(!battleCode\) \{ if \(plankBattleWake\) plankBattleWake\.stop\(\)/.test(html) && /if \(!tbCodeCur\) \{ if \(tbWake\) tbWake\.stop\(\)/.test(html));
  check("static: tbFinish stops TUT battle wake", /function tbFinish[^\n]*\n[^\n]*tbWake\.stop\(\)/.test(html));
  check("static: exitBattle/tbExit repaint (which stops wake)", /function exitBattle\(\)[^\n]*paintBattle\(\)/.test(html) && /function tbExit\(\)[^\n]*tbPaint\(\)/.test(html));
  // ---- No ad-hoc wake code left; walk uses the shared module.
  check("static: no ad-hoc navigator.wakeLock / keepAwake / releaseAwake in index.html", !/navigator\.wakeLock|keepAwake|releaseAwake|\bwakeLock\s*=/.test(html));
  check("static: every wake instance comes from wake-lock.js", (html.match(/createWakeLock\(/g) || []).length === 2 && /const walkWake = window\.WakeLock \? window\.WakeLock\.createWakeLock/.test(html));
  check("static: wake code never touches pocket/walk lock or relock", !/setPocket|pocketOn|setWalkLock|walkLockOn|armRelock/.test(fnSrc("makeWake") + WAKES));
  check("static: wake-lock.js never touches camera streams", !/getUserMedia|srcObject|getTracks/.test(fs.readFileSync(path.join(__dirname, "..", "wake-lock.js"), "utf8")));

  const pass = R.filter(Boolean).length;
  console.log(`\n${pass}/${R.length} passed`);
  if (pass !== R.length) process.exit(1);
})();
