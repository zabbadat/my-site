// PFP cover starts the moment the camera opens (before the set / hold starts), never counts
// reps or fails in that preview, and is torn down when the camera exits. Run: node test/pfp-on-open.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PF = require("../pfp.js"), run = require("./lib/push-flow-harness.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

const startPlank = html.slice(html.indexOf("async function startPlankCam()"), html.indexOf("let plankStarting"));
const plankTick = html.slice(html.indexOf("async function plankTick("), html.indexOf("function newPlankHold("));
const stopCam = html.slice(html.indexOf("function stopCam()"), html.indexOf("$(\"camStopBtn\").onclick = stopCam"));
const stopPlank = html.slice(html.indexOf("function stopPlankCam()"), html.indexOf("// ---- App-only native plank hook"));
const tbOff = html.slice(html.indexOf("function tbCamOff()"), html.indexOf("async function tbPose()"));
const poseTick = html.slice(html.indexOf("async function poseTick("), html.indexOf("const CAM_CONSTRAINTS"));
const tbPose = html.slice(html.indexOf("async function tbPose()"), html.indexOf("// 3:00 reached"));

check("plank: pose + PFP loop starts as soon as the camera is up, before newPlankHold (the hold / 3-2-1 still waits)", startPlank.indexOf("plankPreview = true; plankTick(++plankLoopId);") >= 0 && startPlank.indexOf("plankPreview = true; plankTick(++plankLoopId);") < startPlank.indexOf("newPlankHold()"));
check("plankTick draws PFP even when the hold has not started yet", /ZabPfp\.plankFrame\(vid, kps/.test(plankTick) && /if \(plankHold\) \{/.test(plankTick) && plankTick.indexOf("ZabPfp.plankFrame") < plankTick.indexOf("if (plankHold)"));
check("plankTick does not feed plankHold.update until the hold exists (no early clock / fail / cue)", /if \(plankHold\) \{[\s\S]*plankHold\.update/.test(plankTick));
check("push poseTick draws PFP on every pose frame, including before the set starts (not gated on pushState.running)", /ZabPfp\.frame\(vid, pose \? pose\.keypoints : \[\], tFrame\)/.test(poseTick) && !/pushState\.running[^\n]*ZabPfp\.frame/.test(poseTick) && poseTick.indexOf("ZabPfp.frame") < poseTick.indexOf("pushCounter.update"));
check("TUT Battle: PFP is drawn before the live-set gate (camera on, before Go)", /ZabPfp\.frame\(v, kps, tFrame\)/.test(tbPose) && tbPose.indexOf("ZabPfp.frame") < tbPose.indexOf("if (tbLiveT0 == null)"));
check("Stop camera / End set / fail exit clears the push-up cover at once", /function stopCam\(\)[\s\S]*ZabPfp\.clear\("camVid"\)/.test(html));
check("stopPlankCam and cancel during preview clear the plank cover", /ZabPfp\.clear\("plankVid"\)/.test(stopPlank) && /ZabPfp\.clear\("plankVid"\)/.test(html.slice(html.indexOf("function cancelPlankStart()"), html.indexOf("function stopPlankCam()"))));
check("tbCamOff clears the TUT Battle cover", /ZabPfp\.clear\("tbVid"\)/.test(tbOff));
check("Node require / no store: default is on (cover does not wait for a user)", PF.isOn() === true);

function fakeDom(store) {
  const calls = []; const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }), set: (t, k, v) => ((t[k] = v), true) });
  const mk = (tag) => ({ tag, style: {}, children: [], className: "", classList: { add() {}, remove() {} }, setAttribute() {}, appendChild(c) { this.children.push(c); c.parentNode = this; }, insertBefore(c) { this.children.push(c); c.parentNode = this; }, removeChild() {}, getContext: () => ctx2d, querySelector: () => null });
  const parent = mk("div"); const vid = { id: "camVid", parentNode: parent, nextSibling: null, clientWidth: 320, clientHeight: 240, offsetLeft: 0, offsetTop: 0, videoWidth: 640, videoHeight: 480 };
  const w = { document: { readyState: "complete", getElementById: () => null, createElement: mk, addEventListener() {} }, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } }, getComputedStyle: () => ({ objectFit: "fill" }), devicePixelRatio: 1, Image: function () {}, setTimeout: () => 0, clearTimeout() {}, Date, Math, performance: { now: () => 0 } };
  return { w, vid, parent, calls };
}

{ const D = fakeDom({ zabPfpOn: "1" }), ctx = Object.assign({}, D.w); ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8"), ctx);
  const P = ctx.ZabPfp, face = [{ name: "nose", x: 320, y: 200, score: 0.9 }, { name: "left_eye", x: 300, y: 185, score: 0.9 }, { name: "right_eye", x: 340, y: 185, score: 0.9 }, { name: "left_ear", x: 280, y: 195, score: 0.9 }, { name: "right_ear", x: 360, y: 195, score: 0.9 }];
  P.setUser({ uid: "u1", displayName: "Zab" }); P.setOn(true);
  P.frame(D.vid, face, 0);
  check("first pose frame after camera open (set not started): cover is drawn", D.parent.children.length === 1 && D.parent.children[0].className === "pfp-cover" && D.parent.children[0].style.display === "block" && !!P.lastHead("camVid"));
  P.clear("camVid");
  check("teardown on camera exit: cover hidden and lastHead gone", D.parent.children[0].style.display === "none" && P.lastHead("camVid") == null);
  P.setOn(false); P.frame(D.vid, face, 40);
  check("toggle off: no cover even if pose frames keep arriving", P.lastHead("camVid") == null && D.parent.children[0].style.display === "none"); }

(async () => {
  const script = (t) => ({ d: t < 4000 ? 0 : (Math.sin(((t - 4000) / 1800) * Math.PI * 2 - Math.PI / 2) + 1) / 2 });
  let pre = { frames: 0, heads: 0, reps: 0 }, postReps = 0, D;
  const result = await run(path.join(ROOT, "index.html"), { mode: "sets", script, ms: 25000, setup: (ctx) => {
    const store = { zabPfpOn: "1" }; D = fakeDom(store);
    Object.assign(ctx, { document: D.w.document, localStorage: D.w.localStorage, getComputedStyle: D.w.getComputedStyle, devicePixelRatio: 1, Image: function () {} });
    vm.runInContext(fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8"), ctx);
    ctx.ZabPfp.setUser({ uid: "u1", displayName: "Zab" });
    const real = ctx.ZabPfp.frame; let fv = null;
    ctx.ZabPfp.frame = (v, k, t) => {
      fv = fv || Object.assign({}, D.vid, { videoWidth: v.videoWidth || 640, id: "camVid" });
      const running = !!(ctx.api && ctx.api.pushState && ctx.api.pushState.running);
      const out = real(fv, k, t);
      if (!running) { pre.frames++; if (ctx.ZabPfp.lastHead("camVid")) pre.heads++; pre.reps = (ctx.api && ctx.api.pushState && ctx.api.pushState.reps) || 0; }
      else postReps = (ctx.api && ctx.api.pushState && ctx.api.pushState.reps) || postReps;
      return out;
    };
  } });
  check(`PFP draws on pose frames before the set starts (${pre.frames} pre-set frames, ${pre.heads} with a head cover)`, pre.frames > 0 && pre.heads > 0);
  check("no reps counted before the set starts", pre.reps === 0);
  check("after Go, reps still count as before", result.startedAt > 0 && result.reps >= 5 && result.running === true);
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
})().catch((e) => { console.log("FAIL harness", e); process.exit(1); });
