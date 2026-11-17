// Time-to-first-visible camera frame (Nov 17, owner: no black screen before the camera comes on).
// Source order: getUserMedia starts on the tap, the box is shown (showCamBox / prepare) before the pose model,
// and the shield paints a branded placeholder then the first decoded frame. Run: node test/cam-first-frame.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const pfp = fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8");
const squat = fs.readFileSync(path.join(ROOT, "squat-page.js"), "utf8");
const match = fs.readFileSync(path.join(ROOT, "match-pfp-cam.js"), "utf8");
const R = []; const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const sliceFn = (start, end) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf(end, i)); };
const first = (src, a, b) => src.indexOf(a) >= 0 && src.indexOf(b) >= 0 && src.indexOf(a) < src.indexOf(b);
const openAll = sliceFn("async function openCam()", "function stopCam()");
const plankAll = sliceFn("async function startPlankCam()", "$(\"plankCamBtn\").onclick");
const tbAll = sliceFn("async function tbCamOn(", "function tbCamOff()");

check("showCamBox helper: unhides the wrap and calls ZabPfp.prepare", /function showCamBox\(wrapId, vid\)/.test(html) && /ZabPfp\.prepare/.test(html.slice(html.indexOf("function showCamBox"), html.indexOf("function showCamBox") + 400)));
check("pfp.js: prepare() stands the shield up before a stream exists", /function prepare\(vid\)/.test(pfp) && /api\.prepare = prepare/.test(pfp));
check("pfp.js: opening paint uses a snapshot + branded hood, never a bare #000 fill", /function grabPreview/.test(pfp) && /P\.openMask/.test(pfp) && !/#000|#000000/.test(pfp) && /coverBack/.test(pfp));

for (const [name, src] of [["openCam", openAll], ["startPlankCam", plankAll], ["tbCamOn", tbAll]]) {
  check(`${name}: getUserMedia starts before await loadCamLibs / await ensurePose`, first(src, "getUserMedia", "await loadCamLibs") && first(src, "getUserMedia", "await ensurePose"));
  check(`${name}: the camera box is shown and PFP-prepared before getUserMedia resolves`, (first(src, '$("' + (name === "openCam" ? "camWrap" : name === "startPlankCam" ? "plankWrap" : "tbCamWrap") + '").hidden = false', "getUserMedia") || first(src, "hidden = false", "getUserMedia")) && src.includes("ZabPfp.prepare"));
}
check("Gyatt Squats: wrap + prepare before getUserMedia, feed does not wait on the model to start GUM", first(squat, "ZabPfp.prepare", "getUserMedia") && first(squat, "sqWrap\").hidden = false", "getUserMedia"));
{ const st = match.slice(match.indexOf("async function start()"), match.indexOf("function stop()"));
  check("Live Match: wrap + prepare before the camera request, applyShow before awaiting the detector", st.indexOf("ZabPfp.prepare") >= 0 && st.indexOf("ZabPfp.prepare") < st.indexOf("await navigator.mediaDevices.getUserMedia") && st.indexOf("applyShow()") < st.indexOf("await getDetector()")); }
check("Go live: prepare on zlSelf before getUserMedia resolves", /v0\.hidden = false; try \{ if \(window\.ZabPfp && window\.ZabPfp\.prepare\) window\.ZabPfp\.prepare\(v0\)/.test(html));

// Timed harness: slow libs / pose must not delay the first visible box past getUserMedia.
(async () => {
  const log = [];
  const els = {};
  const $ = (id) => {
    if (els[id]) return els[id];
    const el = { id, textContent: "", disabled: false, setAttribute() {}, play: async () => { log.push("play:" + id); }, srcObject: null, parentNode: { clientWidth: 320, clientHeight: 240 } };
    let hidden = true;
    Object.defineProperty(el, "hidden", { get() { return hidden; }, set(v) { hidden = !!v; if (!hidden) log.push("box:" + id); } });
    return (els[id] = el);
  };
  const stream = { getTracks: () => [{ stop() {} }] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ctx = { $, console, Promise, String, Number, Date, Math, log, els, setTimeout, clearTimeout,
    performance: { now: () => Date.now() }, requestAnimationFrame(fn) { fn(); },
    navigator: { mediaDevices: { getUserMedia: async () => { log.push("gum-start"); await wait(20); log.push("gum-done"); return stream; } } },
    window: null, Capacitor: { isNativePlatform: () => false }
  };
  ctx.window = ctx;
  const STUBS = `
let camOn = false, poseLoopOn = false, camStream = null, poseLoopId = 0, camWake = { start() { return Promise.resolve(); }, stop() { return Promise.resolve(); } };
function camFs() { log.push("fs"); }
function showCamBox(wrapId, vid) { const w = $(wrapId); if (w) w.hidden = false; log.push("box:" + wrapId); if (window.ZabPfp && window.ZabPfp.prepare && vid) window.ZabPfp.prepare(vid); }
async function loadCamLibs() { log.push("libs-start"); await new Promise((r) => setTimeout(r, 80)); log.push("libs-done"); }
async function ensurePose() { log.push("pose-start"); await new Promise((r) => setTimeout(r, 80)); log.push("pose-done"); }
function resetPoseBaseline() {}
function poseTick() { log.push("tick"); }
function stopCamTracks(s) { if (s && s.getTracks) s.getTracks().forEach((t) => t.stop()); }
const CAM_CONSTRAINTS = { video: true, audio: false };
function camErrorText(e) { return String(e && e.message || e); }
`;
  vm.createContext(ctx);
  vm.runInContext(STUBS + openAll, ctx);
  let tBox = null;
  const orig = Object.getOwnPropertyDescriptor(els, "camWrap") || null;
  const t0 = Date.now();
  // measure when the wrap first becomes visible, not when openCam() finishes (it still awaits the model at the end)
  const boxWatch = setInterval(() => { if (tBox == null && log.includes("box:camWrap")) tBox = Date.now() - t0; }, 1);
  const done = ctx.openCam();
  // poll until the box is logged (it should be on the tap, before GUM)
  while (tBox == null && Date.now() - t0 < 2000) await wait(1);
  if (tBox == null && log.includes("box:camWrap")) tBox = Date.now() - t0;
  await done;
  clearInterval(boxWatch);
  const dt = tBox == null ? Date.now() - t0 : tBox;
  const i = (s) => log.indexOf(s);
  check("harness: camera box is shown before getUserMedia resolves (and before the pose model finishes)", i("box:camWrap") >= 0 && i("box:camWrap") < i("gum-done") && i("box:camWrap") < i("pose-done"), log);
  check("harness: first video play happens before pose-done (feed is not blocked on the model)", i("play:camVid") >= 0 && i("play:camVid") < i("pose-done"), log);
  check(`harness: measured time-to-first-visible-box ${dt} ms wall (box is first; pose still takes ~80 ms more)`, i("box:camWrap") === 0 || i("box:camWrap") < i("gum-start") || i("box:camWrap") < i("gum-done"));
  // Before this change the browser path awaited loadCamLibs then ensurePose before un-hiding the wrap, so
  // time-to-first-visible-box was libs+pose (~160 ms in this stub) after GUM. After: the box is shown on the tap (0 ms).
  check("harness: with PFP off the same start still plays the raw feed immediately (play is in the log, wrap unhidden)", els.camWrap && els.camWrap.hidden === false && i("play:camVid") >= 0);
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
