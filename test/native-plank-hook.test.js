// App-only native plank hook: in the iOS app with the ZabbaPlank plugin, "Start plank camera" opens the native Apple Vision
// plank screen and its result is saved by the SAME plankEnded() as the site camera (sign-in gate, one-shot session guard,
// best, local rows, sets board, Plank House board, server-checked ZAB award). Browsers, Android and app builds without the
// plugin run startPlankCam() exactly as before; a native failure falls back to the site plank.
// Run: node test/native-plank-hook.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const P = require("../plank-session.js"), G = require("../get-set.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const ended = /function plankEnded\(r\) \{[\s\S]*?\n\}\n/.exec(html);
const a = html.indexOf("// ---- App-only native plank hook"), b = html.indexOf("\n", html.indexOf('$("plankCamBtn").onclick = '));
const hook = a > 0 && b > a ? html.slice(a, b + 1) : "";
check("plankEnded and the hook block found", !!ended && hook.length > 0);

function env({ capacitor, signedIn = true, gate = true, now = 1_000_000 } = {}) {
  const log = [], store = {}, els = {};
  const $ = (id) => els[id] || (els[id] = { id, textContent: "", hidden: false, value: "", onclick: null });
  const clock = { now };
  const ctx = {
    log, $, els, clock, store, P, console,
    plankLoop: false, plankStarting: false, plankSaved: false, plankSessionStartedAt: 0, plankHold: null,
    camOn: false, pushStarting: false, currentUser: signedIn ? { uid: "u1" } : null, PLANK_BEST_KEY: "zabbadat-plank-best", ZT: {},
    Date: Object.assign(function FakeDate() { return new Date(clock.now); }, { now: () => clock.now }), Number, Math, JSON, String, Promise, Error,
    requireSignIn: (f, fn, o) => { log.push("gate:" + f + ":" + !!(o && o.practice)); return gate; },
    unlockGetSet: () => log.push("unlock"), stopCam: () => log.push("stopCam"), cancelPushStart: () => log.push("cancelPush"),
    sessionPlan: () => "fresh", sessionCommit: (k) => log.push("commit:" + k), sessionTouch() {},
    startPlankCam: () => { log.push("siteCam"); return Promise.resolve(); }, stopPlankCam: () => log.push("stopSiteCam"), cancelPlankStart: () => log.push("cancelSite"),
    plankTimeVoice: { end() {} }, formatTut: (ms) => ms + "ms", renderPlankBest() {}, plankBest: () => 0, renderPlankDays() {},
    paintPlankRows() {}, localPlanks: () => JSON.parse(store["zabbadat-plank-local"] || "[]"), displayNameOf: () => "Zab", zabNote: () => "", zabRing() {},
    PD: { countsAsSet: (ms) => ms >= 10000, recordHold: (s, ms) => { log.push("recordHold:" + ms); return { sets: 1 }; }, localDateKey: () => "2026-11-10" },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); log.push("save:" + k); } },
    saveRemotePlankDaily: (day, rec) => { log.push("daily:" + rec.ms); return Promise.resolve(); },
    saveRemotePlank: (rec) => { log.push("board:" + rec.ms + ":" + rec.sessionStartedAt); return Promise.resolve("id1"); },
    awardZab: (kind, id) => { log.push("award:" + kind + ":" + id); return Promise.resolve({}); },
    window: { ZabbadatPlank: P, ZabbadatGetSet: { plankSpeak: (w) => log.push("say:" + w), PLANK_SET_DONE_LINE: G.PLANK_SET_DONE_LINE } },
  };
  if (capacitor) ctx.window.Capacitor = capacitor;
  vm.createContext(ctx);
  ctx.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [clock.now])); } static now() { return clock.now; } };
  vm.runInContext(ended[0].replace(/^function plankEnded/, "plankEnded = function"), ctx);
  vm.runInContext(hook, ctx);
  ctx.click = () => ctx.$("plankCamBtn").onclick();
  return ctx;
}
const plugin = (impl) => { const calls = []; return { calls, start: (o) => { calls.push(o); return impl(o); } }; };
const app = (p) => ({ isNativePlatform: () => true, getPlatform: () => "ios", Plugins: p ? { ZabbaPlank: p } : {} });
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  // Browsers / non-app / older app builds: unchanged
  { const c = env(); await c.click(); check("browser (no Capacitor): Start runs the site camera, nothing native", c.log.join() === "siteCam"); }
  { const p = plugin(() => Promise.resolve({ ms: 5000 })); const c = env({ capacitor: { isNativePlatform: () => false, Plugins: { ZabbaPlank: p } } }); await c.click();
    check("Capacitor web (isNativePlatform false) with a plugin object: site camera, plugin never called", c.log.join() === "siteCam" && p.calls.length === 0); }
  { const c = env({ capacitor: app(null) }); await c.click(); check("app build without ZabbaPlank (live 1.0 builds): site camera", c.log.join() === "siteCam"); }
  { const c = env({ capacitor: { isNativePlatform() { throw new Error("x"); } } }); await c.click(); check("a throwing Capacitor probe falls back to the site camera", c.log.join() === "siteCam"); }
  { const p = plugin(() => Promise.resolve({})); const c = env({ capacitor: app(p) }); c.plankLoop = true; await c.click(); c.plankLoop = false; c.plankStarting = true; await c.click();
    check("running / starting site camera: the button still stops / cancels it (unchanged)", c.log.join() === "stopSiteCam,cancelSite" && p.calls.length === 0); }

  // App with the plugin: native screen, same save path
  { const p = plugin(() => { return Promise.resolve({ ms: 42000, reason: "sag", engine: "vision-2d" }); });
    const c = env({ capacitor: app(p) }); const pr = c.click(); c.clock.now += 60000; await pr; await tick(); await tick();
    check("app + plugin: same sign-in gate as the site camera (plank, practice allowed), speech unlocked in the tap", c.log[0] === "gate:plank:true" && c.log[1] === "unlock");
    check("app + plugin: native screen opened once with { restart }", p.calls.length === 1 && p.calls[0].restart === false && !c.log.includes("siteCam"));
    check("result saved through plankEnded: best + local rows + sets board + Plank House board", c.store["zabbadat-plank-best"] === "42000" && c.localPlanks().length === 1 && c.log.includes("daily:42000") && c.log.includes("recordHold:42000"));
    check("board record carries the native session start; ZAB awarded via the server-checked awardZab(\"plank\", id)", c.log.includes("board:42000:1000000") && c.log.includes("award:plank:id1"));
    check("failure end speaks \"Set complete\" once (the page's single line)", c.log.filter((x) => x.startsWith("say:")).join() === "say:Set complete");
    check("session committed; guard closed after the save (plankSessionStartedAt 0, plankSaved true)", c.log.includes("commit:plank") && c.plankSessionStartedAt === 0 && c.plankSaved === true);
    check("status says posted to the board", /Posted to the Plank House board/.test(c.els.plankStatus.textContent));
    check("\"New hold\" hidden after a native hold (the start button opens the next native hold)", c.els.plankAgainBtn.hidden === true);
    c.plankEnded({ ms: 42000, reason: "sag" }); check("a late second plankEnded cannot save again", c.log.filter((x) => x.startsWith("board:")).length === 1); }
  { const p = plugin(() => Promise.resolve({ ms: 30000, reason: "stopped" })); const c = env({ capacitor: app(p), signedIn: false }); const pr = c.click(); c.clock.now += 40000; await pr; await tick();
    check("signed-out practice: saved on the phone only, no board, no ZAB", c.localPlanks().length === 1 && !c.log.some((x) => /^(board|daily|award):/.test(x)) && /Sign in to post/.test(c.els.plankStatus.textContent));
    check("Stop end is silent", !c.log.some((x) => x.startsWith("say:"))); }
  { const p = plugin(() => Promise.resolve({ ms: 1 })); const c = env({ capacitor: app(p), gate: false }); await c.click();
    check("sign-in gate refuses: native screen never opens", p.calls.length === 0 && !c.log.includes("siteCam")); }

  // Fallback and sanitizing
  { const p = plugin(() => Promise.reject(new Error("UNAVAILABLE"))); const c = env({ capacitor: app(p) }); await c.click(); await tick();
    check("native screen fails: falls back to the site plank", p.calls.length === 1 && c.log.includes("siteCam") && !c.log.some((x) => x.startsWith("save:"))); }
  { const p = plugin(() => Promise.resolve({ cancelled: true })); const c = env({ capacitor: app(p) }); await c.click(); await tick();
    check("cancelled native screen: nothing saved", !c.log.some((x) => /^(save|board|award):/.test(x)) && !c.log.includes("commit:plank")); }
  { const p = plugin(() => Promise.resolve({ ms: 1e12, reason: "stopped" })); const c = env({ capacitor: app(p) }); const pr = c.click(); c.clock.now += 25000; await pr; await tick();
    check("ms is capped at the time the native screen was open", c.store["zabbadat-plank-best"] === "25000"); }
  { const p = plugin(() => Promise.resolve({ ms: "abc", reason: "<img>" })); const c = env({ capacitor: app(p) }); const pr = c.click(); c.clock.now += 5000; await pr; await tick();
    check("non-numeric ms -> 0: nothing saved, unknown reason treated as Stop (silent)", !c.log.some((x) => /^(save|board|award):/.test(x)) && !c.log.some((x) => x.startsWith("say:"))); }
  { let res; const p = plugin(() => new Promise((r) => { res = r; })); const c = env({ capacitor: app(p) }); c.click(); c.click(); c.click();
    check("taps while the native screen is open do not open a second one", p.calls.length === 1); res({ cancelled: true }); await tick(); }

  // Static: narrow hook, no new save path, no global entry point
  check("hook saves only through plankEnded (no direct saveRemotePlank / saveRemotePlankDaily / awardZab / localStorage)", !/saveRemotePlank|awardZab|localStorage/.test(hook) && /plankEnded\(nativePlankResult\(/.test(hook));
  check("no window-level entry point for posting a plank (no window.* assignment in the hook)", !/window\.\w+\s*=/.test(hook) && !/zabNativePlank/.test(html));
  check("ZabbaPlank appears only inside the hook block", (html.match(/ZabbaPlank\b/g) || []).length === (hook.match(/ZabbaPlank\b/g) || []).length);
  check("button falls through to startPlankCam() when nativePlank() is null", /typeof nativePlank === "function" && nativePlank\(\) \? startNativePlank\(nativePlank\(\)\) : startPlankCam\(\)\);/.test(hook));
  check("plankEnded unchanged: still requires a live session (plankSessionStartedAt) and plankSaved", /if \(plankSaved\) return;\n  if \(!plankSessionStartedAt\) return;/.test(ended[0]));
  console.log(`\n${R.filter(Boolean).length} passed, ${R.filter((x) => !x).length} failed`); process.exit(R.every(Boolean) ? 0 : 1);
})();
