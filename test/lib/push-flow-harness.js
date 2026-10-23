// Harness: real push flow functions sliced from an index.html version + real modules, synthetic MoveNet frames.
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
module.exports = function run(htmlPath, { mode = "sets", script, ms = 30000, camAlreadyOn = false }) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const between = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); return html.slice(i, html.indexOf(b, i + a.length) + b.length); };
  const fnSrc = (n) => { const a = "function " + n + "("; const i = html.indexOf(a); if (i < 0) throw new Error("missing " + n); const eol = html.indexOf("\n", i); const l = html.slice(i, eol);
    if (/\}\s*$/.test(l) && (l.match(/\{/g) || []).length === (l.match(/\}/g) || []).length) return l; return html.slice(i, html.indexOf("\n}", i) + 2); };
  let now = 0; const timers = []; const els = {};
  const $ = (id) => (els[id] = els[id] || { id, textContent: "", hidden: true, disabled: false, setAttribute() {}, play: async () => {}, srcObject: null, videoWidth: 640 });
  const ctx = { $, console, Math, Date: { now: () => now }, Promise, JSON, String, Number, Object, isFinite,
    setTimeout: (f, d) => { timers.push({ at: now + (d || 0), f }); return timers.length; }, clearTimeout() {},
    setInterval: (f, d) => { const t = { at: now + d, f, every: d }; timers.push(t); return t; }, clearInterval: (t) => { if (t) t.dead = true; },
    performance: { now: () => now }, requestAnimationFrame: (f) => timers.push({ at: now + 33, f }),
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ["push-counter.js", "push-session.js", "push-challenge.js", "get-set.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
  const frame = (t) => { const w = script(t); const sx = 320 - w.w * 320, a = (180 - w.e) * Math.PI / 180;
    return [{ name: "left_shoulder", x: sx, y: 240, score: .9 }, { name: "right_shoulder", x: 320 + w.w * 320, y: 240, score: .9 },
      { name: "left_elbow", x: sx, y: 300, score: .9 }, { name: "left_wrist", x: sx + 60 * Math.sin(a), y: 300 + 60 * Math.cos(a), score: .9 }]; };
  const pre = `
const log = [];
function requireSignIn() { return true; }
const pushWake = null, camWake = null; let plankLoop = false; function stopPlankCam() {}
const pushState = { reps: 0, running: false, startedAt: 0, elapsed: 0, tick: null, finished: false, tut: 0 };
let pushMode = ${JSON.stringify(mode)}; let challengeFlags = { standing: 0, knees: 0 };
const pushChallenge = window.ZabbadatChallenge.createChallenge({ durationMs: 180000, topCapMs: 10000 });
const postureGuard = window.ZabbadatSession.createPostureGuard();
let camStream = null, camOn = false, poseDetector = null, poseLoopOn = false, pushCounter = null;
async function loadCamLibs() { if (!pushCounter) pushCounter = window.ZabbadatPush.createCounter(); }
async function ensurePose() { return poseDetector || (poseDetector = { estimatePoses: async () => [{ keypoints: frame(performance.now()) }] }); }
function renderPush() {} function finishChallenge() { log.push("finishChallenge"); } let lastCamStatus = "";
`;
  const src = pre + ["const GET_SET_MS = 2000;", between("const getSet = ", ";\n"), fnSrc("getSetCountdown"), fnSrc("cancelGetSet"), fnSrc("unlockGetSet"),
    "let pushStarting = false, pushStartToken = 0;", fnSrc("cancelPushStart"), fnSrc("waitCalibrated"), "async " + fnSrc("startPush"), fnSrc("beginPushClock"),
    fnSrc("setCamStatus"), fnSrc("resetPoseBaseline"), "async " + fnSrc("poseTick"), "async " + fnSrc("openCam")].join("\n") +
    "\nthis.api = { startPush, openCam, pushState, get counter() { return pushCounter; }, log };";
  ctx.frame = frame;
  vm.runInContext(src, ctx);
  return (async () => {
    const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
    if (camAlreadyOn) { await ctx.api.openCam(); }
    ctx.api.startPush(); await flush();
    const trace = [];
    while (now < ms) {
      timers.sort((a, b) => a.at - b.at); const t = timers.find((x) => !x.dead && !x.done); if (!t) break;
      now = Math.max(now, t.at); if (t.every) t.at += t.every; else t.done = true; t.f(); await flush();
      const s = ctx.api.counter && ctx.api.counter.state();
      if (s && (!trace.length || trace[trace.length - 1].st !== s.status || trace[trace.length - 1].run !== ctx.api.pushState.running)) trace.push({ t: now, st: s.status, ph: s.phase, run: ctx.api.pushState.running, reps: ctx.api.pushState.reps });
    }
    return { reps: ctx.api.pushState.reps, running: ctx.api.pushState.running, counterReps: ctx.api.counter && ctx.api.counter.state().reps, trace, status: $("pushStatus").textContent, camNote: $("camNote").textContent };
  })();
};
