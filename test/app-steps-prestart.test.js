// App launch: ZabbaSteps may emit immediately (today's CMPedometer total and, if a
// leftover ledger exists, gameSteps). Session / washers counters must stay 0 until
// Start walk / Start game. The daily "Steps today" total may already show the phone
// count — that is intended for the 10,000-step circuit. Also re-checks the washersGame
// TDZ guard so Sign in / Start handlers still attach when the plugin emits on construct.
// Run: node test/app-steps-prestart.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const G = require("../game-steps.js");
const D = require("../daily-steps.js");
const W = require("../walk-session.js");

const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

function el(id, extra) {
  return Object.assign({
    id, textContent: "0", hidden: false, style: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, onclick: null, onpointerdown: null, onpointerup: null,
    scrollIntoView() {}, focus() {}, querySelectorAll() { return []; }
  }, extra || {});
}

function mkPlugin(opts) {
  opts = opts || {};
  const today = opts.today != null ? opts.today : 13;
  const gameEmit = opts.gameEmit != null ? opts.gameEmit : 13;
  const listeners = {};
  const plugin = {
    listeners,
    async isAvailable() { return { available: true, filtered: true }; },
    async requestPermissions() { return { granted: true }; },
    async getTodaySteps() { return { steps: today, rawSteps: today }; },
    async getCachedSteps() { return { steps: today, rawSteps: today }; },
    async startTodayUpdates() {
      const fn = listeners.todaySteps;
      if (fn) fn({ steps: today, rawSteps: today });
      return { started: true };
    },
    async stopTodayUpdates() { return {}; },
    async startGameSteps(o) {
      this._game = { gameId: (o && o.gameId) || "g", steps: 0, rawSteps: 0, ended: false, active: true };
      return { gameId: this._game.gameId, steps: 0, rawSteps: 0, active: true };
    },
    async getGameSteps() { return { active: false }; },
    async syncGameSteps() { return { active: false }; },
    async stopGameSteps() { return { active: false, steps: this._game ? this._game.steps : 0 }; },
    async startWalkSession() { return { active: true }; },
    async getWalkSession() { return { active: false }; },
    async stopWalkSession() { return { active: false }; },
    addListener(name, fn) {
      listeners[name] = fn;
      // Immediate emit, as the native plugin can do on hook / foreground.
      if (name === "todaySteps" || name === "stepsResume") fn({ steps: today, rawSteps: today, resume: name === "stepsResume" });
      if (name === "gameSteps") fn({ steps: gameEmit, rawSteps: gameEmit, gameId: "stale-or-spurious" });
      return Promise.resolve({ remove() {} });
    }
  };
  return plugin;
}

(async () => {
  const errors = [];
  const plugin = mkPlugin({ today: 13, gameEmit: 13 });
  const els = {
    stepsStat: el("stepsStat"),
    washersStripSteps: el("washersStripSteps"),
    dailyCount: el("dailyCount"),
    walkSteps: el("walkSteps"),
    walkClock: el("walkClock"),
    dailyWalkBtn: el("dailyWalkBtn", { textContent: "Start walk" }),
    startBtn: el("startBtn", { textContent: "Start game" }),
    signInBtn: el("signInBtn", { textContent: "Sign in with Google" }),
    signInXBtn: el("signInXBtn", { textContent: "Sign in with X" }),
    gameStepsDebug: el("gameStepsDebug", { hidden: true, textContent: "" }),
    dailySource: el("dailySource"),
    dailyStatus: el("dailyStatus"),
    stepsDebug: el("stepsDebug", { hidden: true }),
    status: el("status"),
    score: el("score"),
    clock: el("clock"),
    sessionStrip: el("sessionStrip", { hidden: true })
  };

  const store = { m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); }, removeItem(k) { delete this.m[k]; } };
  const ev = {};
  const win = {
    localStorage: store,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      hidden: false,
      body: { classList: { add() {}, remove() {} } },
      getElementById(id) { return els[id] || el(id); },
      addEventListener() {},
      querySelectorAll() { return []; }
    },
    addEventListener(t, f) { (ev[t] = ev[t] || []).push(f); },
    removeEventListener() {},
    Capacitor: { isNativePlatform: () => true, Plugins: { ZabbaSteps: plugin } },
    ZabbadatGameSteps: G,
    ZabbadatDaily: D,
    ZabbadatWalk: W,
    console: { log() {}, warn() {}, error(...a) { errors.push(a.join(" ")); } },
    performance: { now: () => 0 },
    Date, Math, Number, String, JSON, Promise, Object, Array, isFinite, parseInt, setTimeout, clearTimeout, setInterval, clearInterval
  };
  win.window = win;
  win.location = { hash: "", search: "", href: "https://www.zabbadat.com/" };

  // Faithful slice of index.html order: render() (TDZ-safe), Start / Sign in handlers,
  // then let washersGame = createGameController which emits immediately.
  const ctx = vm.createContext(win);
  vm.runInContext(`
    const $ = (id) => document.getElementById(id);
    const state = { score: 0, steps: 0, running: false, startedAt: 0, elapsed: 0, tick: null, finished: false };
    function formatTime(ms) { return "00:00"; }
    function render() {
      $("score").textContent = state.score;
      $("stepsStat").textContent = state.steps.toLocaleString();
      $("clock").textContent = formatTime(0);
      let wg = null; try { wg = washersGame; } catch (e) { wg = null; }
      if (wg && (state.running || state.elapsed || state.score || state.steps) && !state.finished) {
        wg.writeLive({ running: !!(state.running && !state.finished), steps: state.steps });
      }
    }
    $("startBtn").onclick = () => { state.running = true; };
    $("signInBtn").onclick = () => {};
    $("signInXBtn").onclick = () => {};
    const GS = window.ZabbadatGameSteps;
    function isNativeGameSteps() {
      try { return !!(GS && GS.pickGameSource(window).kind === "native"); } catch (e) { return false; }
    }
    let washersGame = (GS && isNativeGameSteps()) ? GS.createGameController(window, { onChange: (s) => {
      if (s && s.steps != null) state.steps = Math.max(state.steps || 0, s.steps);
      if (typeof render === "function") render();
    } }) : null;
    window.__zabbaApplyGameSteps = function (r) {
      let wg = null; try { wg = washersGame; } catch (e) { wg = null; }
      if (!wg) return;
      if (!wg.state().active && !state.running && !state.elapsed) return;
      wg.applyNativeReading(r || {});
    };
    window.__test = { state, washersGame, get startBtn() { return $("startBtn"); }, get signInBtn() { return $("signInBtn"); } };
    const DS = window.ZabbadatDaily;
    const daily = DS ? DS.createController(window, { onChange: (s) => {
      $("dailyCount").textContent = s.steps.toLocaleString();
    } }) : null;
    $("walkSteps").textContent = "0";
    window.__daily = daily;
  `, ctx, { filename: "app-steps-prestart-harness.js" });

  // Let any promised addListener callbacks settle.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const t = win.__test;
  const daily = win.__daily;

  check("no console errors while constructing controllers (TDZ guard held)", errors.length === 0);
  check("Start game handler is attached", typeof t.startBtn.onclick === "function");
  check("Sign in with Google handler is attached", typeof t.signInBtn.onclick === "function");
  check("washers game Steps stat stays 0 before Start game, despite an immediate native emit of 13",
    els.stepsStat.textContent === "0" && t.state.steps === 0 && t.washersGame && t.washersGame.state().steps === 0);
  check("session Steps (walkSteps) stays 0 before Start walk", els.walkSteps.textContent === "0");
  check("daily Steps today may show the phone total (13) without Start walk — all-day total by design",
    daily && daily.state().steps === 13 && els.dailyCount.textContent === "13");

  // Native snapshot hook must not paint the washers number either.
  win.__zabbaApplyGameSteps({ steps: 13, rawSteps: 13, immediate: true, resume: true });
  check("__zabbaApplyGameSteps before Start game leaves the washers counter at 0",
    t.washersGame.state().steps === 0 && t.state.steps === 0);

  // After Start game, steps can move.
  await t.washersGame.start({ gameId: "live" });
  plugin.listeners.gameSteps({ steps: 4, rawSteps: 4, gameId: "live", active: true });
  check("after Start game, the washers counter accepts live steps",
    t.washersGame.state().active && t.washersGame.state().steps === 4);

  // Real index.html still has the TDZ try and the pre-start apply guard, and
  // Sign in / Start handlers remain below the washersGame let (module abort would skip them).
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const renderAt = html.indexOf("function render() {");
  const wgAt = html.indexOf("let washersGame =");
  const startAt = html.indexOf('$("startBtn").onclick');
  const signAt = html.indexOf('$("signInBtn").onclick');
  const renderFn = html.slice(renderAt, html.indexOf("function setStatus", renderAt));
  check("index.html render() reads washersGame inside try (TDZ guard)",
    /let wg = null; try \{ wg = washersGame; \} catch \(e\) \{ wg = null; \}/.test(renderFn));
  check("Start game handler is assigned before washersGame is constructed (survives a construct emit)",
    startAt > 0 && startAt < wgAt);
  check("Sign in handler remains in the same module after the washersGame construction",
    signAt > wgAt);
  check("daily controller still auto-hooks startTodayUpdates in the app (all-day total unchanged)",
    /startTodayUpdates/.test(fs.readFileSync(path.join(__dirname, "..", "daily-steps.js"), "utf8")));

  process.exit(R.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
