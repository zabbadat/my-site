// Double pose-loop guard (push-ups + planks): one rAF chain, idempotent starts, Stop camera releases the stream. Run: node test/pose-loop-guard.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const between = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); const j = html.indexOf(b, i + a.length); return html.slice(i, j + b.length); };
const fnSrc = (name) => between("function " + name + "(", "\n}");

// --- push: real poseTick / stopCam / syncPushStartBtn in a vm with a manual rAF queue
function pushEnv() {
  let raf = []; const els = {}; const $ = (id) => (els[id] = els[id] || { id, textContent: "", hidden: false, disabled: false, srcObject: null });
  const ctx = { $, els, Promise, console, performance: { now: () => 0 }, requestAnimationFrame: (f) => raf.push(f), estimates: 0, stopped: 0 };
  ctx.flushRaf = async () => { const q = raf; raf = []; for (const f of q) await f(); return q.length; };
  ctx.queued = () => raf.length;
  vm.createContext(ctx);
  vm.runInContext(`
let camOn = true, poseLoopOn = true, poseLoopId = 0, camStream = { getTracks: () => [{ stop() { stopped++; } }] }, camWake = null;
let pushStarting = false; const pushState = { running: false, finished: false };
const det = { estimatePoses: async () => { estimates++; return []; } };
async function ensurePose() { estimates++; return det; }
function endPushOnCameraStop() {} function cancelPushStart() {} function camExitFs() {} function setCamStatus() {}
${fnSrc("syncPushStartBtn")}
async ${fnSrc("poseTick")}
${fnSrc("stopCam")}
`, ctx);
  return ctx;
}
(async () => {
  const e = pushEnv();
  vm.runInContext("$('camVid').srcObject = camStream; poseTick(++poseLoopId); poseTick(++poseLoopId);", e); // a double start
  for (let i = 0; i < 5; i++) await e.flushRaf();
  check("push: two starts leave exactly one rAF chain", e.queued() === 1);
  vm.runInContext("estimates = 0", e); for (let i = 0; i < 4; i++) await e.flushRaf();
  check("push: one inference per frame (no doubled loop)", e.estimates === 4);
  vm.runInContext("stopCam()", e); await e.flushRaf();
  check("push: Stop camera ends the chain", e.queued() === 0);
  check("push: Stop camera stops the tracks and clears srcObject", e.stopped === 1 && e.els.camVid.srcObject === null && vm.runInContext("camStream", e) === null);
  vm.runInContext("pushStarting = true; syncPushStartBtn()", e);
  check("push: Start disabled while starting", e.els.pushStartBtn.disabled === true);
  vm.runInContext("pushStarting = false; pushState.running = true; syncPushStartBtn()", e);
  check("push: Start disabled while a set runs", e.els.pushStartBtn.disabled === true);
  vm.runInContext("pushState.finished = true; syncPushStartBtn()", e);
  check("push: Start re-enabled when the set ends", e.els.pushStartBtn.disabled === false);

  // static guards
  check("openCam is idempotent (returns early when the camera + loop already run)", /async function openCam\(\) \{\n\s*if \(camOn && poseLoopOn\) return true;/.test(html));
  check("startPush ignores a tap while running or starting", /async function startPush\(\) \{\n\s*if \(pushState\.running \|\| pushStarting\) return;/.test(html));
  check("startPlankCam ignores a tap while running or starting", /async function startPlankCam\(\) \{\n\s*if \(plankLoop \|\| plankStarting\) return;/.test(html));
  check("plank loop starts with a fresh loop id", html.includes("plankLoop = true; plankTick(++plankLoopId);"));
  check("plank rAF chain re-arms only for the current loop id", html.includes("if (plankLoop && id === plankLoopId) requestAnimationFrame(() => plankTick(id));"));
  const sp = fnSrc("stopPlankCam");
  check("stopPlankCam bumps the loop id, stops tracks and clears srcObject", sp.includes("plankLoopId += 1") && sp.includes("getTracks().forEach((t) => t.stop())") && sp.includes('$("plankVid").srcObject = null'));
  check("nav height drives scroll-padding / scroll-margin (tiles clear the 120 px phone nav)", html.includes("scroll-padding-top: calc(var(--navh") && html.includes('setProperty("--navh"') && /#push \.stats[^{]*\{ scroll-margin-top: calc\(var\(--navh/.test(html));
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); process.exit(ok === R.length ? 0 : 1);
})();
