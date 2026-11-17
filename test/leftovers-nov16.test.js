// Leftover fixes (Nov 16): (1) a side plank seen front-on never reads as knees-down; (2) "One, two, three, Hold" plank
// countdown that only starts the clock on a locked-in proper plank; (3) a superseded camera open (double tap, or Stop while
// opening) leaves exactly one live stream or none, never an orphaned track, on every camera start (push-ups / TUT, TUT
// Battle, Live Match preview), browser and app paths. Run: node test/leftovers-nov16.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const PS = require("../plank-session.js"), SS = require("../push-session.js"), G = require("../get-set.js"), SY = require("./lib/break-synth.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

// ---------- 1. front-facing view during a side plank hold ----------
// Front-on frame: shoulders up at plank height, hips foreshortened down near the hands' line, straight legs. The push-up
// front-view rule (hips dropped to the hands, shoulders still up) reads this as a kneel; plank is side-view only and must not.
const frontHipNearHands = (t, jitter) => SY.frontKps(false).map((k) => {
  const o = Object.assign({}, k, { x: k.x + (jitter ? Math.sin(t / 97 + k.x) : 0), y: k.y + (jitter ? Math.cos(t / 89 + k.y) : 0) });
  if (/_hip$/.test(k.name)) o.y = 352; // 18 px above the wrists (y 370): under 0.22 x shoulder width (128 px)
  return o;
});
{
  const f = frontHipNearHands(0), get = (n) => f.find((k) => k.name === n);
  const sw = Math.abs(get("right_shoulder").x - get("left_shoulder").x);
  const pushRule = SS.kneesFallback(get("left_hip"), get("left_knee"), get("left_ankle"), get("left_shoulder"), 370, sw, SS.GUARD);
  check("control: the push-up front-view rule DOES read this front-on frame as knees-down (so the plank test below is meaningful)", pushRule === true);
  const c = PS.classifyPlank(f);
  check(`plank classify on the front-on frame is not "knees" (got ${JSON.stringify(c && (c.state || c.issue || c))})`, !/knee/i.test(JSON.stringify(c)));
  for (const v of [["front-on side plank, hips near the hands", (t) => frontHipNearHands(t, true)], ["front-on plank, foreshortened straight legs", () => SY.frontKps(false)]]) {
    const h = PS.createPlankHold(); let ended = null, held = false;
    for (let t = 0; t <= 12000; t += 33) { const r = h.update(t < 5000 ? SY.kpsOf(SY.POSE.top) : v[1](t), t, { w: 640, h: 480 }); if (h.state().phase === "holding") held = true; if (r.ended) { ended = r.reason; break; } }
    check(`${v[0]}: a side plank hold that turns front-on never ends as knees-down (held: ${held}, ended: ${ended})`, held && ended !== "knees");
  }
  // side-on knees-down still ends the plank (the fix does not blind plank to real kneels)
  const h = PS.createPlankHold(); let reason = null;
  for (let t = 0; t <= 9000; t += 33) { const p = t < 4000 ? SY.POSE.top : SY.lerp(SY.POSE.top, SY.POSE.knees, Math.min(1, (t - 4000) / 400)); const r = h.update(SY.kpsOf(p), t, { w: 640, h: 480 }); if (r.ended) { reason = r.reason; break; } }
  check(`side-on knees down still ends the plank hold (${reason})`, reason === "knees");
}

// ---------- 2. plank countdown: One, two, three, Hold ----------
{
  const said = [], shown = [], timers = []; let now = 0;
  const cd = G.makeGoCountdown({ steps: G.PLANK_STEPS, speak: (w) => said.push([now, w]), stop: () => {}, schedule: (fn, d) => timers.push([now + d, fn]) });
  let done = null; cd.run((t) => shown.push([now, t])).then((ok) => { done = ok; });
  while (timers.length) { timers.sort((a, b) => a[0] - b[0]); const [t, fn] = timers.shift(); now = t; fn(); }
  check("plank countdown speaks One, two, three, Hold in order", said.map((x) => x[1]).join(",") === "One,two,three,Hold");
  check("plank countdown timing 0 / 1.2 / 2.4 / 3.6 s (same pace as push-ups' go on three)", said.map((x) => x[0]).join(",") === "0,1200,2400,3600" && JSON.stringify(G.PLANK_STEPS.map((s) => s[0])) === JSON.stringify(G.NEXT_STEPS.map((s) => s[0])));
  check("on screen: 1, 2, 3, HOLD (same big-digit style)", shown.map((x) => x[1]).join(",") === "1,2,3,HOLD");
  setImmediate(() => check("countdown resolves true at Hold", done === true));
  check("setup line before the count: Set up, hold on three.", G.COACH.plank.next === "Set up, hold on three." && G.PLANK_SET_LINE === G.COACH.plank.next);
  check("push-ups keep Set up, go on three. / One two three Go", G.NEXT_SET_LINE === "Set up, go on three." && G.NEXT_STEPS.map((s) => s[1]).join(" ") === "One two three Go");
  // the clock only starts on a proper plank: begin() is refused until the hold has locked into the cue phase
  const hold = PS.createPlankHold({ cue: true, cueMaxMs: 20000 });
  for (let t = 0; t < 3000; t += 33) hold.update(SY.kpsOf(SY.POSE.stand), t, { w: 640, h: 480 });
  check("standing up: no lock-in, the countdown's Hold cannot start the clock", hold.state().phase !== "cue" && hold.begin(3000) === false && hold.state().phase !== "holding");
  let t = 3000; for (; t < 9000 && hold.state().phase !== "cue"; t += 33) hold.update(SY.kpsOf(SY.POSE.top), t, { w: 640, h: 480 });
  check("proper side plank locks in (cue phase) before the count", hold.state().phase === "cue");
  check("Hold then starts the clock", hold.begin(t) === true && hold.state().phase === "holding");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const cue = html.slice(html.indexOf("function plankCue(r)"), html.indexOf("function plankOutlineSet("));
  check("page: the count runs only from the cue phase and Hold calls hold.begin (never bypasses the proper-plank rule)", /r\.phase !== "cue"/.test(cue) && /hold\.state\(\)\.phase !== "cue"/.test(cue) && /if \(ok && !cancelled\(\)\) hold\.begin\(performance\.now\(\)\)/.test(cue) && /makeGoCountdown\(\{ steps: window\.ZabbadatGetSet\.PLANK_STEPS, speak: window\.ZabbadatGetSet\.plankSpeak/.test(html));
  check("End set stays on the plank camera screen", /id="plankEndBtn"/.test(html) && /\$\("plankEndBtn"\)\.onclick = plankEndSetNow/.test(html));
}

// ---------- 3. camera race: one stream or none ----------
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const between = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); const j = html.indexOf(b, i + a.length); return html.slice(i, j + b.length); };
const fnSrc = (name) => between("function " + name + "(", "\n}");
function env(native) {
  const els = {}, all = [], pend = [];
  const $ = (id) => (els[id] = els[id] || { id, textContent: "", hidden: true, setAttribute() {}, play: async () => {}, srcObject: null, classList: { toggle() {}, remove() {}, contains() { return false; } }, querySelector() { return null; } });
  const ctx = { $, console, Promise, setTimeout: (f) => setImmediate(f), clearTimeout() {}, performance: { now: () => 0 }, requestAnimationFrame() {},
    navigator: { mediaDevices: { getUserMedia: () => new Promise((res) => { const n = all.length; const s = { n, tracks: [{ live: true, stop() { this.live = false; } }] }; s.getTracks = () => s.tracks; all.push(s); pend.push(() => res(s)); }) } } };
  ctx.window = ctx; if (native) ctx.Capacitor = { isNativePlatform: () => true };
  vm.createContext(ctx);
  const STUBS = `let camOn = false, poseLoopOn = false, camStream = null, poseLoopId = 0, pushStarting = false, camWake = null, pushState = { running: false, finished: false };
let tbStream = null, tbLoop = false, tbCounter = null, tbCoaching = false;
async function loadCamLibs() {} async function ensurePose() {} function poseTick() {} function resetPoseBaseline() {} function camExitFs() {} function setCamStatus() {}
function endPushOnCameraStop() {} function cancelPushStart() {} function syncPushStartBtn() {} function camFs() {}
function showPositioning() { return Promise.resolve(true); } window.ZabbadatPush = { createCounter: () => ({}) }; function tbPose() {} function tbPaint() {}`;
  const helpers = [between("const CAM_CONSTRAINTS = ", "\n"), fnSrc("camErrorText"), fnSrc("stopCamTracks"), fnSrc("attachCam")].join("\n");
  vm.runInContext([STUBS, helpers, "async " + fnSrc("openCam"), fnSrc("stopCam"), "async " + fnSrc("tbCamOn"), fnSrc("tbCamOff")].join("\n"), ctx);
  const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
  const grant = async (i) => { await flush(); pend[i](); await flush(); };
  const live = () => all.filter((s) => s.tracks.some((t) => t.live));
  return { run: (c) => vm.runInContext(c, ctx), all, live, flush, grant, els };
}
(async () => {
  for (const native of [false, true]) {
    const tag = native ? "app" : "browser";
    for (const [name, open, stop, cur] of [["push-ups / TUT openCam", "openCam()", "stopCam()", "camStream"], ["TUT Battle tbCamOn", "tbCamOn(null)", "tbCamOff()", "tbStream"]]) {
      { // double tap, first permission granted first
        const e = env(native); e.run(open); await e.flush(); e.run(open); await e.flush();
        await e.grant(0); await e.grant(1);
        const L = e.live();
        check(`${tag} ${name}: double tap (in order) leaves exactly one live stream, the current one`, e.all.length === 2 && L.length === 1 && e.run(cur) === L[0]);
        e.run(stop); check(`${tag} ${name}: then stop leaves none`, e.live().length === 0);
      }
      { // double tap, second resolves first
        const e = env(native); e.run(open); await e.flush(); e.run(open); await e.flush();
        await e.grant(1); await e.grant(0);
        const L = e.live();
        check(`${tag} ${name}: double tap (out of order) leaves exactly one live stream, the current one`, L.length === 1 && e.run(cur) === L[0]);
      }
      { // stop while opening
        const e = env(native); e.run(open); await e.flush(); e.run(stop); await e.grant(0);
        check(`${tag} ${name}: Stop while opening leaves no live stream and no camera on`, e.live().length === 0 && e.run(cur) === null && (name.startsWith("push") ? e.run("camOn") === false : e.run("tbLoop") === false));
      }
    }
  }
  // Live Match preview (match-pfp-cam.js start / stop)
  {
    const src = fs.readFileSync(path.join(__dirname, "..", "match-pfp-cam.js"), "utf8");
    const mk = () => {
      const all = [], pend = [], els = {};
      const el = (id) => (els[id] = els[id] || { id, textContent: "", hidden: false, style: {}, play: async () => {}, srcObject: null, addEventListener() {}, setAttribute() {}, classList: { toggle() {}, add() {}, remove() {} }, appendChild() {}, querySelector() { return null; }, getContext() { return null; } });
      const doc = { getElementById: el, createElement: () => el("x" + Math.random()), addEventListener() {}, querySelector() { return null; }, body: el("body") };
      const root = { document: doc, addEventListener() {}, requestAnimationFrame() {}, performance: { now: () => 0 }, localStorage: { getItem() { return null; }, setItem() {} },
        navigator: { mediaDevices: { getUserMedia: () => new Promise((res) => { const s = { tracks: [{ live: true, stop() { this.live = false; } }] }; s.getTracks = () => s.tracks; all.push(s); pend.push(() => res(s)); }) } } };
      root.window = root; root.self = root; root.navigator = root.navigator;
      const ctx = vm.createContext(Object.assign({ console, Promise, setTimeout: (f) => setImmediate(f), clearTimeout() {}, Math, JSON }, root));
      ctx.globalThis = ctx;
      vm.runInContext(src, ctx);
      const api = ctx.window.ZabbaMatchPfpCam || Object.values(ctx).find((v) => v && typeof v === "object" && typeof v.start === "function" && typeof v.stop === "function" && typeof v.isOn === "function");
      const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
      return { api, all, pend, flush, live: () => all.filter((s) => s.tracks.some((t) => t.live)) };
    };
    const m0 = mk();
    if (!m0.api) { check("Live Match camera api found", false); }
    else {
      { const m = mk(); m.api.start(); await m.flush(); m.api.start(); await m.flush(); m.pend[0](); await m.flush(); m.pend[1](); await m.flush();
        check("Live Match preview: double tap leaves exactly one live stream", m.all.length === 2 && m.live().length === 1 && m.api.isOn() === true);
        m.api.stop(); check("Live Match preview: then Stop leaves none", m.live().length === 0); }
      { const m = mk(); m.api.start(); await m.flush(); m.api.start(); await m.flush(); m.pend[1](); await m.flush(); m.pend[0](); await m.flush();
        check("Live Match preview: double tap (out of order) leaves exactly one live stream", m.live().length === 1); }
      { const m = mk(); m.api.start(); await m.flush(); m.api.stop(); m.pend[0](); await m.flush();
        check("Live Match preview: Stop while opening leaves no live stream and the camera off", m.live().length === 0 && m.api.isOn() === false); }
    }
  }
  await new Promise((r) => setImmediate(r));
  const f = R.filter((x) => !x).length; console.log(`\n${R.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
