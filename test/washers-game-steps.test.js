// Washers native game-steps: same Step Equity resume policy, app-only, browser unchanged.
// Covers lock/unlock, app switch, webview reload, unknown activity, monotonic snap,
// Eastern midnight (no mid-game reset), hold/arcade/snapshot wiring in index.html.
// Run: node test/washers-game-steps.test.js
const G = require("../game-steps.js");
const D = require("../daily-steps.js");
const fs = require("fs");
const path = require("path");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const tick = () => new Promise((r) => setImmediate(r));
const mkStore = () => ({ m: {}, getItem(k) { return this.m[k] ?? null; }, setItem(k, v) { this.m[k] = String(v); }, removeItem(k) { delete this.m[k]; } });
function mkWin(plugin, extra) {
  const ev = {}, dev = {};
  const doc = { hidden: false, addEventListener(t, f) { (dev[t] = dev[t] || []).push(f); } };
  const win = { localStorage: mkStore(), document: doc, addEventListener(t, f) { (ev[t] = ev[t] || []).push(f); }, removeEventListener() {},
    Capacitor: { isNativePlatform: () => true, Plugins: { ZabbaSteps: plugin, ...(extra || {}) } } };
  return { win, fire: (t) => (ev[t] || []).forEach((f) => f()), fireDoc: (t) => (dev[t] = dev[t] || []).forEach((f) => f()), ev, dev, doc };
}
function mkPlugin(init) {
  let game = init || null, listeners = {};
  const dict = () => game ? { gameId: game.gameId, steps: game.steps, rawSteps: game.rawSteps, rejectedSteps: game.rejected || 0,
    creditedSteps: game.steps, provisionalSteps: 0, activityMissing: !!game.activityMissing, debug: game.debug,
    ended: !!game.ended, active: !game.ended } : { active: false };
  return {
    listeners,
    async startGameSteps(o) {
      o = o || {};
      if ((o.resume !== false) && game && game.gameId === o.gameId && !game.ended) return dict();
      game = { gameId: o.gameId || "g", startedAt: o.startedAt || Date.now(), steps: 0, rawSteps: 0, rejected: 0, ended: false };
      return dict();
    },
    async getGameSteps() { return dict(); },
    async syncGameSteps() { return dict(); },
    async stopGameSteps() { if (!game) return { active: false }; game.ended = true; const d = dict(); game = null; return d; },
    async requestPermissions() { return { granted: true }; },
    addListener(name, fn) { listeners[name] = fn; return Promise.resolve({ remove() {} }); },
    _set(n, extra) { if (!game) game = { gameId: "g", steps: 0, rawSteps: 0 }; game.steps = n; game.rawSteps = (extra && extra.rawSteps) != null ? extra.rawSteps : n; Object.assign(game, extra || {}); },
    _game() { return game; }
  };
}

(async () => {
  check("nextDisplayed is monotonic and snaps a large catch-up at once", G.nextDisplayed(100, 80) === 100 && G.nextDisplayed(1200, 1800) === 1800);
  check("game nextDisplayed is independent of the daily 60k cap", G.nextDisplayed(0, 70000) === 70000 && D.nextDisplayed(0, 70000) === 60000);

  // Browser / non-native: no plugin, bindForegroundEvents is a no-op.
  const webWin = { localStorage: mkStore(), document: { addEventListener() {} }, addEventListener() {}, Capacitor: { isNativePlatform: () => false, Plugins: {} } };
  check("pickGameSource is web when not native", G.pickGameSource(webWin).kind === "web");
  const webCtl = G.createGameController(webWin, {});
  check("browser controller does not look native", webCtl.source.kind === "web");
  check("bindForegroundEvents is a no-op in the browser", G.bindGameForeground(webWin, webCtl, () => {}) === false);
  check("start() refuses in the browser (DeviceMotion path stays in index.html)", (await webCtl.start({ gameId: "x" })) === false);

  // Pre-start: native may emit as soon as the listener is attached (plugin load / today
  // stream). The washers counter must stay at 0 until Start game.
  const earlyPlugin = mkPlugin();
  earlyPlugin.addListener = function (name, fn) {
    this.listeners[name] = fn;
    if (name === "gameSteps") fn({ steps: 13, rawSteps: 13, gameId: "stale" });
    return Promise.resolve({ remove() {} });
  };
  const He = mkWin(earlyPlugin);
  const ce = G.createGameController(He.win, {});
  check("immediate gameSteps emit before Start game does not paint the counter", ce.state().steps === 0 && ce.state().active === false);
  earlyPlugin._set(13);
  if (earlyPlugin.listeners.gameSteps) earlyPlugin.listeners.gameSteps({ steps: 13, rawSteps: 13, active: true, gameId: "stale" });
  check("later gameSteps events are ignored until Start game", ce.state().steps === 0 && ce.state().active === false);
  const startedEarly = await ce.start({ gameId: "washers-early" });
  check("Start game begins at 0, then live events count", startedEarly && ce.state().active && ce.state().steps === 0);
  earlyPlugin._set(8);
  earlyPlugin.listeners.gameSteps(await earlyPlugin.getGameSteps());
  check("after Start game, steps accumulate", ce.state().steps === 8);

  // Stale zabbadat-washers-live without a native ledger must not resume or paint.
  const stalePlugin = mkPlugin(); // no game
  const Hs = mkWin(stalePlugin);
  const cs = G.createGameController(Hs.win, {});
  cs.writeLive({ running: true, gameId: "old-game", steps: 13, baseSteps: 0, rawSteps: 13, startedAt: Date.now() - 86400000, elapsed: 120000 });
  const staleRec = await cs.restore();
  check("stale local live record without a native ledger does not resume or show steps",
    staleRec && staleRec.active === false && cs.state().steps === 0 && cs.state().active === false);

  // Native happy path: start, lock/unlock catch-up, app switch, unknown activity, snap.
  const plugin = mkPlugin();
  const H = mkWin(plugin);
  const paints = [];
  const c = G.createGameController(H.win, { onChange: (s) => paints.push(s.steps) });
  check("native source picked when startGameSteps exists", c.source.kind === "native" && typeof plugin.listeners.gameSteps === "function");
  const started = await c.start({ gameId: "washers-1", startedAt: 1_800_000_000_000 });
  check("startGameSteps begins a ledger at 0", started && c.state().active && c.state().gameId === "washers-1" && c.state().steps === 0);

  plugin._set(80, { rawSteps: 80 });
  plugin.listeners.gameSteps(await plugin.getGameSteps());
  check("live gameSteps stream is monotonic", c.state().steps === 80);

  // Lock (hidden) then unlock with a catch-up: last-known on the same tick, then backfill snaps.
  const fg = G.createGameForegroundRefresh(c, { now: () => Date.now() });
  check("bound resume listeners (visibility, pageshow, appStateChange via shared bindForegroundEvents)", G.bindGameForeground(H.win, c, fg.run) === true);
  check("visibilitychange and pageshow are wired (same helpers as Step Equity)", !!(H.dev.visibilitychange && H.dev.visibilitychange.length) && !!(H.ev.pageshow && H.ev.pageshow.length));

  H.doc.hidden = true; H.fireDoc("visibilitychange"); await tick();
  const before = c.state().steps;
  plugin._set(260, { rawSteps: 270, debug: { rawSteps: 270, filteredSteps: 260, rejectedTotal: 10, reason: "spike" } });
  H.doc.hidden = false;
  const tResume = Date.now();
  H.fireDoc("visibilitychange");
  H.fire("pageshow");
  const sameTick = c.state().steps;
  check("lock/unlock: last-known count on the same tick as resume (no empty/stale flash)", sameTick === before && sameTick === 80);
  await tick();
  check("lock/unlock: backfill snaps to 260 within one tick (no count-up)", c.state().steps === 260 && Date.now() - tResume < 50);
  check("debug line shows raw vs counted", /Phone raw 270/.test(c.state().debugLine) && /counted 260/.test(c.state().debugLine));

  // App switch cycle (another resume)
  plugin._set(400, { rawSteps: 400 });
  H.fire("pageshow"); await tick();
  check("app switch: catch-up is current immediately after backfill", c.state().steps === 400);

  // Unknown / stationary activity still counts (fail open)
  plugin._set(480, { rawSteps: 480, activityMissing: true, debug: { rawSteps: 480, filteredSteps: 480, rejectedTotal: 0, reason: "", activity: "unknown" } });
  plugin.listeners.gameSteps(await plugin.getGameSteps());
  check("unknown activity counts (fail open)", c.state().steps === 480);
  check("debug line still shows raw vs counted for unlabeled activity", /Phone raw 480/.test(c.state().debugLine) && /counted 480/.test(c.state().debugLine));

  const preSnap = c.state().steps;
  plugin._set(900, { rawSteps: 900 });
  plugin.listeners.gameSteps(await plugin.getGameSteps());
  check("large catch-up snaps at once (no intermediate values)", c.state().steps === 900 && preSnap === 480);
  check("never shows a lower value", G.nextDisplayed(900, 850) === 900 && c.state().steps === 900);

  // Persist + webview reload: new controller, same store + still-active ledger.
  c.writeLive({ running: true, gameId: "washers-1", steps: 900, baseSteps: 0, rawSteps: 900, startedAt: 1_800_000_000_000, elapsed: 120000 });
  const store = H.win.localStorage;
  const plugin2 = mkPlugin({ gameId: "washers-1", steps: 900, rawSteps: 910, ended: false });
  plugin2._set(940, { rawSteps: 950 }); // coprocessor advanced while the webview reloaded
  const H2 = mkWin(plugin2);
  H2.win.localStorage = store;
  let firstPaint = null;
  const c2 = G.createGameController(H2.win, { onChange: (s) => { if (firstPaint == null) firstPaint = s.steps; } });
  const restored = await c2.restore();
  check("reload: restore keeps the same gameId and does not reset", restored && restored.active && c2.state().gameId === "washers-1");
  check("reload: displayed is at least the persisted total, then the backfill", c2.state().steps === 940);
  const fg2 = G.createGameForegroundRefresh(c2, {});
  G.bindGameForeground(H2.win, c2, fg2.run);
  plugin2._set(980, { rawSteps: 990 });
  H2.fireDoc("visibilitychange"); H2.fire("pageshow"); await tick();
  check("reload + resume: catch-up within one tick", c2.state().steps === 980);

  // Pause finalizes; a later start is a new segment added to baseSteps (no double count, no drop).
  const plugin3 = mkPlugin();
  const H3 = mkWin(plugin3);
  const c3 = G.createGameController(H3.win, {});
  await c3.start({ gameId: "seg-a" });
  plugin3._set(50); plugin3.listeners.gameSteps(await plugin3.getGameSteps());
  await c3.stop();
  check("pause/stop finalizes and parks the total as baseSteps", c3.state().steps === 50 && c3.state().baseSteps === 50 && c3.state().active === false);
  await c3.start({ gameId: "seg-b", newSegment: true });
  plugin3._set(20); plugin3.listeners.gameSteps(await plugin3.getGameSteps());
  check("resume after pause adds the new segment (50 + 20)", c3.state().steps === 70);

  // Eastern midnight does not reset a running game (per-game total). Daily cache rolling is Step Equity's job.
  const ET = require("../et-day.js");
  const beforeMid = new Date("2026-11-11T04:59:00Z");
  const afterMid = new Date("2026-11-11T05:00:00Z");
  check("et-day itself still flips at Eastern midnight (Step Equity / Tonight board)", ET.key(beforeMid) === "2026-11-10" && ET.key(afterMid) === "2026-11-11");
  const plugin4 = mkPlugin();
  const H4 = mkWin(plugin4);
  const c4 = G.createGameController(H4.win, {});
  await c4.start({ gameId: "span-midnight", startedAt: beforeMid.getTime() });
  plugin4._set(300); plugin4.listeners.gameSteps(await plugin4.getGameSteps());
  c4.writeLive({ running: true, gameId: "span-midnight", steps: 300, baseSteps: 0, startedAt: beforeMid.getTime() });
  // Simulate a resume just after midnight: no rollDay on this controller.
  const fg4 = G.createGameForegroundRefresh(c4, { now: () => afterMid.getTime() });
  G.bindGameForeground(H4.win, c4, fg4.run);
  plugin4._set(340);
  await fg4.run();
  check("resume across Eastern midnight does not reset a running washers game", c4.state().steps === 340 && c4.state().gameId === "span-midnight");

  // Native verification: lock/hide is not a fail; still requires 60 s and min steps.
  const fakeV = { state: () => ({ packs: 2 }) };
  const short = G.nativeResult(fakeV, 40, 20000);
  check("native verify still requires 60 s", short.verified === false && short.reasons.some((x) => /60 s/.test(x)) && short.native === true);
  const ok = G.nativeResult(fakeV, 40, 120000);
  check("native verify accepts a 60 s+ game with enough steps and does not mention hidden/sensor", ok.verified === true && ok.reasons.length === 0);
  const hiddenWebWouldFail = G.nativeResult({ state: () => ({ packs: 1, hidden: true, samples: 0 }) }, 40, 120000);
  check("native verify ignores hidden / no-sensor (those are browser DeviceMotion rules)", hiddenWebWouldFail.verified === true);

  // index.html wiring: do not change Step Equity; browser startPhoneSteps path stays extractable;
  // arcade strip, snapshot, hold guards, no refresh button, native branch is opt-in.
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("index includes game-steps.js after daily-steps.js (shared helpers already loaded)",
    /script src="\/daily-steps\.js"/.test(html) && /script src="\/game-steps\.js"/.test(html) &&
    html.indexOf("/daily-steps.js") < html.indexOf("/game-steps.js"));
  check("no Refresh from phone button in the washers play section or anywhere new for washers",
    !/Refresh from phone/i.test(html));
  const playStart = html.indexOf('<section id="play">'), playEnd = html.indexOf("</section>", playStart);
  const play = html.slice(playStart, playEnd);
  check("play section still has Start / Pause / Reset (Reset is a new-game control, not a daily-total reset)",
    /id="startBtn"/.test(play) && /id="pauseBtn"/.test(play) && /id="resetBtn"/.test(play));
  check("arcade top strip has washers Score, Steps and Time cells",
    /id="washersStripScore"/.test(html) && /id="washersStripSteps"/.test(html) && /id="washersStripClock"/.test(html) &&
    /paintArcadeStrip/.test(html) && /kind === "washers"|kind: "washers"/.test(html));
  check("in-page washers score/steps/clock use arcade-page numbers",
    /id="score"[^>]*arcade-page/.test(html) && /id="stepsStat"[^>]*arcade-page/.test(html) && /id="clock"[^>]*arcade-page/.test(html));
  check("snapshot CSS hides washers step numbers (stepsStat + strip) without touching daily apply path meaning",
    /body\.zabba-snapshot #dailyCount/.test(html) && /body\.zabba-snapshot #stepsStat/.test(html) &&
    /body\.zabba-snapshot #washersStripSteps/.test(html));
  check("startPhoneSteps native branch is opt-in and leaves the DeviceMotion body in place",
    /typeof isNativeGameSteps === "function" && isNativeGameSteps\(\)/.test(html) &&
    /setPhoneNote\("Step sensor on\."\);/.test(html) &&
    /window\.addEventListener\("devicemotion", onMotion\)/.test(html));
  check("visibilitychange does not mark a native game unverified (browser still does)",
    /Page was hidden during play/.test(html) &&
    /!isNativeGameSteps\(\).*stepVerifier\.hidden|stepVerifier\.hidden\(\)/.test(html.replace(/\n/g, " ")) &&
    /if \(state\.running && !state\.finished && !\(typeof isNativeGameSteps === "function" && isNativeGameSteps\(\)\)\) stepVerifier\.hidden\(\);/.test(html));
  // tighter: the hidden() call is guarded
  const vis = html.slice(html.indexOf('document.addEventListener("visibilitychange"'), html.indexOf("function onMotion"));
  check("hidden() and the unverified status are skipped when isNativeGameSteps() is true",
    /stepVerifier\.hidden\(\)/.test(vis) && /isNativeGameSteps/.test(vis) &&
    /Page was hidden during play/.test(vis));
  check("hold-to-stop fill and selection guards also cover the washers play HUD and strip",
    /#dailyWalkBtn \.hold-fill, #startBtn \.hold-fill/.test(html) &&
    /#play|#score|#stepsStat|#sessionStrip/.test(html) &&
    /document\.getElementById\("play"\)/.test(html) &&
    /zabba-holding/.test(html));
  check("native debug field for washers raw vs filtered is present",
    /id="gameStepsDebug"/.test(html));
  check("saveRemote omits sensorSamples/maxGapMs when the game was counted by the phone ledger (rules allow the omit)",
    /sensorSamples/.test(html) && /native/.test(html) &&
    /record\.sensor[\s\S]{0,200}sensorSamples|source === "native"|record\.native/.test(html));
  check("Step Equity wiring is untouched (bindForegroundEvents still on daily, refresh button still gone there)",
    /DS\.bindForegroundEvents\(window, daily, dailyFg\.run\)/.test(html) &&
    /id="dailyCount"/.test(html) && !/id="refreshNative"|Refresh from phone/.test(html));
  check("__zabbaApplyGameSteps is wired for the willEnterForeground snapshot unhide",
    /__zabbaApplyGameSteps/.test(html));
  check("__zabbaApplyGameSteps ignores leftover native paints until the game is started or restored",
    /if \(!wg\.state\(\)\.active && !state\.running && !state\.elapsed\) return;/.test(html));

  process.exit(R.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
