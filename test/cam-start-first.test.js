// Camera starts in the Start tap: getUserMedia before loadCamLibs / ensurePose, preview first, real error text.
// Covers openCam, startPlankCam, and tbCamOn. Run: node test/cam-start-first.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const between = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); const j = html.indexOf(b, i + a.length); if (j < 0) throw new Error("missing end " + b); return html.slice(i, j + b.length); };
const fnSrc = (name) => between("function " + name + "(", "\n}");
const sliceFn = (start, end) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf(end, i)); };

const openSrc = sliceFn("async function openCam()", "function stopCam()");
const plankSrc = sliceFn("async function startPlankCam()", "$(\"plankCamBtn\").onclick");
const tbSrc = sliceFn("async function tbCamOn(", "function tbCamOff()");
const startPushSrc = sliceFn("async function startPush()", "function beginPushClock()");
const tbClick = between('$("tbCam").onclick = ', "\n");

function first(src, a, b) { return src.indexOf(a) >= 0 && src.indexOf(b) >= 0 && src.indexOf(a) < src.indexOf(b); }

check("only three getUserMedia calls in index.html (openCam, startPlankCam, tbCamOn)", (html.match(/getUserMedia/g) || []).length === 3);
check("openCam: getUserMedia before loadCamLibs and ensurePose", first(openSrc, "getUserMedia", "loadCamLibs") && first(openSrc, "getUserMedia", "ensurePose"));
check("openCam: preview (#camWrap) shown before loadCamLibs", first(openSrc, '$("camWrap").hidden = false', "loadCamLibs"));
check("startPlankCam: getUserMedia before loadCamLibs and ensurePose", first(plankSrc, "getUserMedia", "loadCamLibs") && first(plankSrc, "getUserMedia", "ensurePose"));
check("startPlankCam: preview (#plankWrap) shown before loadCamLibs", first(plankSrc, '$("plankWrap").hidden = false', "loadCamLibs"));
check("tbCamOn: getUserMedia before loadCamLibs and ensurePose", first(tbSrc, "getUserMedia", "loadCamLibs") && first(tbSrc, "getUserMedia", "ensurePose"));
check("tbCamOn: preview (#tbCamWrap) shown before loadCamLibs", first(tbSrc, '$("tbCamWrap").hidden = false', "loadCamLibs"));
check("startPush still runs the sign-in gate (practice allowed) before openCam", /requireSignIn\("pushups", \(\) => startPush\(\), \{ practice: true \}\)/.test(startPushSrc) && startPushSrc.indexOf("requireSignIn") < startPushSrc.indexOf("openCam"));
check("startPlankCam still runs the sign-in gate (practice allowed) before getUserMedia", /requireSignIn\("plank", \(\) => startPlankCam\(\), \{ practice: true \}\)/.test(plankSrc) && plankSrc.indexOf("requireSignIn") < plankSrc.indexOf("getUserMedia"));
check("TUT battle camera tap still requires sign-in before tbCamOn", /requireSignIn\("tut battle"\)/.test(tbClick) && tbClick.indexOf("requireSignIn") < tbClick.indexOf("tbCamOn"));
check("idle prefetch of cam libs is installed and called", /function prefetchCamLibs\(\)/.test(html) && /requestIdleCallback/.test(fnSrc("prefetchCamLibs")) && /prefetchCamLibs\(\);/.test(html));
check("NotAllowedError copy points at Settings > ZabbaDat", html.includes("Camera blocked. Enable Camera in Settings > ZabbaDat."));
check("stopCam still stops tracks and clears srcObject", /function stopCam\(\) \{/.test(html) && fnSrc("stopCam").includes("getTracks().forEach((t) => t.stop())") && fnSrc("stopCam").includes('$("camVid").srcObject = null'));

function env(o = {}) {
  const log = [];
  const els = {};
  const $ = (id) => (els[id] = els[id] || { id, textContent: "", hidden: true, disabled: false, setAttribute() {}, play: async () => { log.push("play:" + id); }, srcObject: null });
  const stopped = { n: 0 };
  const stream = { getTracks: () => [{ stop() { stopped.n++; log.push("stop"); } }] };
  const ctx = { $, console, Promise, String, Number, Date, log, els, stopped,
    setTimeout() { return 1; }, clearTimeout() {}, requestIdleCallback: undefined,
    performance: { now: () => 0 }, requestAnimationFrame() {},
    navigator: { mediaDevices: { getUserMedia: async () => {
      log.push("camera");
      if (o.camBlocked) { const err = new Error(o.camMsg || "Permission denied"); err.name = o.camErrName || "NotAllowedError"; throw err; }
      return stream;
    } } } };
  ctx.window = ctx;
  vm.createContext(ctx);
  const STUBS = `
let camOn = false, poseLoopOn = false, camStream = null, poseLoopId = 0, pushStarting = false, camWake = { start() { log.push("camWake:start"); return Promise.resolve(); }, stop() { log.push("camWake:stop"); return Promise.resolve(); } };
let plankLoop = false, plankStarting = false, plankStartSeq = 0, plankStream = null, plankSessionStartedAt = 0, plankLoopId = 0, plankHold = null, plankSaved = false;
let plankWake = { start() { log.push("plankWake:start"); return Promise.resolve(); }, stop() { log.push("plankWake:stop"); return Promise.resolve(); } };
let tbStream = null, tbLoop = false, tbCounter = null, tbCoaching = false;
let signedIn = ${o.signedIn !== false}; let practiceCb = null;
function requireSignIn(f, cb, opt) { log.push("gate:" + f); if (signedIn) return true; practiceCb = cb; log.push("prompt"); return false; }
async function loadCamLibs() { log.push("libs"); ${o.libsFail ? "throw new Error(\"cdn down\");" : ""} }
async function ensurePose() { log.push("pose"); ${o.poseFail ? "throw new Error(\"webgl\");" : ""} }
function poseTick() { log.push("tick"); } function resetPoseBaseline() {} function camExitFs() {} function setCamStatus() {}
function cancelGetSet() {} function unlockGetSet() {} function sessionPlan() { return "restart"; } function sessionCommit() {}
function endPushOnCameraStop() {} function cancelPushStart() {} function syncPushStartBtn() {}
function showPositioning() { return Promise.resolve(true); }
function newPlankHold() { log.push("plankHold"); } function plankTick() {} function plankEnded() {}
let plankLeadUntil = 0; const PLANK_LEAD_MS = 5500;
window.ZabbadatPush = { createCounter: () => ({}) };
function tbPose() {} function tbPaint() { log.push("paint"); }
`;
  // Real helpers + camera functions from the page
  const helpers = [between("const CAM_CONSTRAINTS = ", "\n"), fnSrc("camErrorText"), fnSrc("stopCamTracks"), fnSrc("attachCam")].join("\n");
  vm.runInContext([STUBS, helpers, "async " + fnSrc("openCam"), fnSrc("stopCam"), "async " + fnSrc("startPlankCam"), fnSrc("cancelPlankStart"), fnSrc("stopPlankCam"), "async " + fnSrc("tbCamOn"), fnSrc("tbCamOff")].join("\n"), ctx);
  const run = (c) => vm.runInContext(c, ctx);
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  return { ctx, $, log, stopped, run, flush, els };
}

(async () => {
  // ---- openCam order + preview
  { const e = env(); const p = e.run("openCam()"); await e.flush(); const ok = await p;
    check("openCam: getUserMedia then play/preview then libs then pose", e.log.join(",") === "camWake:start,camera,play:camVid,libs,pose,tick" && ok === true);
    check("openCam: #camWrap unhidden and stream attached", e.$("camWrap").hidden === false && e.$("camStopBtn").hidden === false && e.$("camVid").srcObject != null && e.run("camOn") === true);
  }
  { const e = env({ camBlocked: true }); const ok = await e.run("openCam()"); await e.flush();
    check("openCam NotAllowedError: Settings message, no preview, wake released", ok === false && e.$("camNote").textContent === "Camera blocked. Enable Camera in Settings > ZabbaDat." && e.$("camWrap").hidden === true && e.run("camStream") === null && e.log.includes("camWake:stop"));
  }
  { const e = env({ camBlocked: true, camErrName: "NotFoundError", camMsg: "no device" }); const ok = await e.run("openCam()");
    check("openCam other error includes the error name", ok === false && e.$("camNote").textContent === "Camera or pose blocked (NotFoundError): no device.");
  }
  { const e = env({ libsFail: true }); const ok = await e.run("openCam()"); await e.flush();
    check("openCam libs fail after getUserMedia: tracks stopped, preview hidden", ok === false && e.stopped.n === 1 && e.$("camVid").srcObject === null && e.$("camWrap").hidden === true && e.log.indexOf("camera") < e.log.indexOf("libs") && e.log.includes("stop"));
  }
  { const e = env(); await e.run("openCam()"); e.run("stopCam()");
    check("stopCam stops the tracks and clears srcObject", e.stopped.n === 1 && e.$("camVid").srcObject === null && e.run("camStream") === null && e.run("camOn") === false);
  }

  // ---- startPlankCam
  { const e = env(); await e.run("startPlankCam()"); await e.flush();
    check("startPlankCam: gate then getUserMedia then play/preview then libs then pose", e.log[0] === "gate:plank" && e.log.indexOf("camera") > 0 && e.log.indexOf("camera") < e.log.indexOf("libs") && e.log.indexOf("libs") < e.log.indexOf("pose") && e.$("plankWrap").hidden === false && e.run("plankLoop") === true);
  }
  { const e = env({ camBlocked: true }); await e.run("startPlankCam()"); await e.flush();
    check("startPlankCam NotAllowedError: Settings message, wake released", e.$("plankStatus").textContent === "Camera blocked. Enable Camera in Settings > ZabbaDat." && e.log.includes("plankWake:stop") && e.run("plankStream") === null);
  }
  { const e = env({ libsFail: true }); await e.run("startPlankCam()"); await e.flush();
    check("startPlankCam libs fail: tracks stopped", e.stopped.n >= 1 && e.run("plankStream") === null && e.$("plankVid").srcObject === null);
  }

  // ---- tbCamOn
  { const e = env(); await e.run("tbCamOn(null)"); await e.flush();
    check("tbCamOn: getUserMedia then play/preview then libs then pose", e.log.indexOf("camera") < e.log.indexOf("libs") && e.log.indexOf("libs") < e.log.indexOf("pose") && e.$("tbCamWrap").hidden === false && e.run("tbLoop") === true);
  }
  { const e = env({ camBlocked: true }); await e.run("tbCamOn(null)"); await e.flush();
    check("tbCamOn NotAllowedError: Settings message, tracks not left running", e.$("tbCamNote").textContent === "Camera blocked. Enable Camera in Settings > ZabbaDat." && e.run("tbStream") === null && e.$("tbCamWrap").hidden === true);
  }
  { const e = env({ poseFail: true }); await e.run("tbCamOn(null)"); await e.flush();
    check("tbCamOn pose fail: tracks stopped, error name shown", e.stopped.n >= 1 && e.$("tbVid").srcObject === null && e.$("tbCamNote").textContent === "Camera or pose blocked (Error): webgl.");
  }

  const f = R.filter((x) => !x).length; console.log(`\n${R.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
