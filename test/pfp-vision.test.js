// iOS app push-up path (Apple Vision keypoints via pose-vision.js) with the PFP logo and auto full screen.
// Vision-shaped plugin results (normalized, unmirrored camera coords, by name, missing joints omitted) go through the real
// pose-vision toKeypoints (flipHorizontal like poseTick asks) and the real poseTick/startPush/openCam (native app path)
// sliced from index.html, with pfp.js in the same vm. Run: node test/pfp-vision.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, ".."), html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const PV = require("../pose-vision.js"), PF = require("../pfp.js"), S = require("./lib/push-synth.js"), run = require("./lib/push-flow-harness.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
// display-space synth frame -> what the ZabbaPose plugin returns (normalized 0..1, raw camera = unmirrored), ears added
function pluginResult(kps, W, H) {
  const by = {}; kps.forEach((k) => (by[k.name] = k));
  const out = kps.map((k) => ({ name: k.name, x: 1 - k.x / W, y: k.y / H, score: k.score }));
  if (by.left_eye && by.right_eye) { const d = by.right_eye.x - by.left_eye.x; out.push({ name: "left_ear", x: 1 - (by.left_eye.x - 0.6 * d) / W, y: by.left_eye.y / H, score: 0.8 }, { name: "right_ear", x: 1 - (by.right_eye.x + 0.6 * d) / W, y: by.right_eye.y / H, score: 0.8 }); }
  return { keypoints: out };
}
// 1. coordinate space: Vision output lands in video pixels, mirrored like the displayed video
{ const disp = [{ name: "nose", x: 400, y: 200, score: 0.9 }, { name: "left_eye", x: 380, y: 185, score: 0.9 }, { name: "right_eye", x: 420, y: 185, score: 0.9 }];
  for (const [W, H] of [[640, 480], [1280, 720], [480, 640]]) {
    const scaled = disp.map((k) => ({ ...k, x: (k.x * W) / 640, y: (k.y * H) / 480 }));
    const kps = PV.toKeypoints(pluginResult(scaled, W, H), W, H, true);
    const c = PF.headCircle(kps, W, H), want = PF.faceCircle(scaled.concat(kps.filter((k) => /ear/.test(k.name))));
    check(`Vision ${W}x${H}: names kept, mirrored back to display px; logo centred on the displayed face (x ${c.x.toFixed(1)} vs ${(400 * W / 640).toFixed(1)})`, kps.every((k) => typeof k.name === "string") && Math.abs(kps.find((k) => k.name === "nose").x - (400 * W) / 640) < 1e-6 && c && c.src === "face" && Math.abs(c.x - want.x) < 1e-6 && Math.abs(c.y - want.y) < 1e-6);
  }
  const kps = PV.toKeypoints(pluginResult(disp, 640, 480), 640, 480, true), c = PF.headCircle(kps, 640, 480);
  const ear = Math.abs(kps.find((k) => k.name === "left_ear").x - kps.find((k) => k.name === "right_ear").x), eye = 40;
  check(`1.65x proportional sizing on Vision points (r ${c.r.toFixed(1)} = max(ear ${ear.toFixed(0)}, eye x2.7 ${(eye * 2.7).toFixed(0)}) / 2 x 1.65)`, Math.abs(c.r - (Math.max(ear, eye * 2.7) / 2) * 1.65) < 1e-6);
  const m = PF.mapToBox(c, 640, 480, 390, 292.5, "contain"); check("video px -> on-screen box (contain, 390 px wide)", Math.abs(m.x - c.x * (390 / 640)) < 1e-6 && Math.abs(m.r - c.r * (390 / 640)) < 1e-6);
  const hood = PV.toKeypoints({ keypoints: [{ name: "left_shoulder", x: 0.62, y: 0.6, score: 0.9 }, { name: "right_shoulder", x: 0.38, y: 0.6, score: 0.9 }] }, 640, 480, true);
  const hc = PF.headCircle(hood, 640, 480); check(`Vision, hood / head down (shoulders only): logo above the shoulder midpoint (y ${hc.y.toFixed(0)} < 288)`, hc && hc.src === "shoulders" && Math.abs(hc.x - 320) < 1e-6 && hc.y < 288); }

// 2. real app push flow, Vision-shaped frames, toggle off vs on
function fakeDom(store) {
  const calls = []; const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }), set: (t, k, v) => ((t[k] = v), true) });
  const mk = (tag) => ({ tag, style: {}, children: [], className: "", classList: { add() {}, remove() {}, contains: () => false }, setAttribute() {}, appendChild(c) { this.children.push(c); c.parentNode = this; }, insertBefore(c) { this.children.push(c); c.parentNode = this; }, removeChild() {}, getContext: () => ctx2d, querySelector: () => null });
  const parent = mk("div"); const document = { readyState: "complete", getElementById: () => null, createElement: mk, addEventListener() {} };
  return { document, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } }, parent, calls };
}
(async () => {
  const script = (t) => ({ d: t < 4000 ? 0 : (Math.sin(((t - 4000) / 1800) * Math.PI * 2 - Math.PI / 2) + 1) / 2 });
  const vframe = (t) => { const w = script(t); return PV.toKeypoints(pluginResult(S.frameFor(w.d, S.BASE, t).map((k) => ({ ...k, score: 0.85 })), 640, 480), 640, 480, true); }; // fixed scores: deterministic frames
  const seen = {};
  const go = (on) => run(path.join(ROOT, "index.html"), { mode: "sets", native: true, frames: vframe, ms: 30000, setup: (ctx, now) => {
    const D = fakeDom({ zabPfpOn: on ? "1" : "0" }); Object.assign(ctx, { document: D.document, localStorage: D.localStorage, getComputedStyle: () => ({ objectFit: "contain" }), devicePixelRatio: 3, Image: function () {} });
    vm.runInContext(fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8"), ctx); ctx.ZabPfp.setUser({ uid: "u1", displayName: "Zab" });
    const fv = { id: "camVid", parentNode: D.parent, clientWidth: 390, clientHeight: 292.5, offsetLeft: 0, offsetTop: 60, videoWidth: 640, videoHeight: 480 };
    const real = ctx.ZabPfp.frame, kIn = [], circles = []; ctx.ZabPfp.frame = (v, k, t) => { kIn.push(JSON.stringify(k)); real(fv, k, t); circles.push(ctx.ZabPfp.lastHead("camVid")); };
    const fsLog = []; ctx.camFs = (id, v) => fsLog.push({ id, on: v, at: now() });
    seen[on ? "on" : "off"] = { D, kIn, circles, fsLog };
  } });
  const off = await go(false), on = await go(true);
  const sum = (x) => `start ${x.startedAt} reps ${x.reps} running ${x.running}`; console.log("  off:", sum(off)); console.log("  on: ", sum(on));
  check("app/Vision, toggle OFF: set starts, user recognized, reps count, not instantly ended", off.startedAt > 0 && off.reps >= 5 && off.running === true);
  check("app/Vision, toggle ON: set starts, user recognized, reps count, not instantly ended", on.startedAt > 0 && on.reps >= 5 && on.running === true);
  check("app/Vision: identical session on vs off (start, reps, counter states, full trace)", on.startedAt === off.startedAt && on.reps === off.reps && on.counterReps === off.counterReps && JSON.stringify(on.trace) === JSON.stringify(off.trace));
  check(`app/Vision: the keypoints the overlay saw are identical on vs off (${seen.on.kIn.length} frames)`, seen.on.kIn.length > 100 && JSON.stringify(seen.on.kIn) === JSON.stringify(seen.off.kIn));
  check("app/Vision ON: logo canvas over #camVid drew a clipped circle; OFF: nothing drawn", seen.on.D.parent.children.length === 1 && seen.on.D.calls.includes("clip") && seen.off.D.parent.children.length === 0);
  const last = seen.on.circles.filter(Boolean).pop(); check(`app/Vision ON: logo tracks the head (${last && last.src}, x ${last && last.x.toFixed(0)} ~ 320)`, last && last.src === "face" && Math.abs(last.x - 320) < 20);
  const fsOn = seen.on.fsLog.find((e) => e.on === true);
  check(`auto full screen: camWrap goes full screen at camera start, before Go (fs at ${fsOn && fsOn.at} ms, Go at ${on.startedAt} ms) - both toggle states`, fsOn && fsOn.id === "camWrap" && fsOn.at < on.startedAt && seen.off.fsLog.some((e) => e.id === "camWrap" && e.on === true));
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
})().catch((e) => { console.log("FAIL harness", e); process.exit(1); });
