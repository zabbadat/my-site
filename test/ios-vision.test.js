// iOS app: Apple Vision body pose (native ZabbaPose plugin, VNDetectHumanBodyPoseRequest) as the push-up pose engine.
// pose-vision.js maps the plugin's 17 MoveNet-named joints (normalized, top-left origin) to MoveNet pixel keypoints;
// index.html uses it only in the iOS app when the plugin exists, and falls back to MoveNet otherwise.
// Run: node test/ios-vision.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const V = require("../pose-vision.js"), PC = require("../push-counter.js"), S = require("./lib/push-synth.js");
let pass = 0, fail = 0; const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (x != null ? "  [" + x + "]" : "")); };
const cap = (native, platform, withPlugin) => ({ Capacitor: { isNativePlatform: () => native, getPlatform: () => platform, Plugins: withPlugin ? { ZabbaPose: { detect: async () => ({ keypoints: [] }) } } : {} } });
// 1. plugin gating
check("plugin(): browser (no Capacitor) -> none", V.plugin({}) === null);
check("plugin(): Capacitor web platform -> none", V.plugin(cap(false, "web", true)) === null);
check("plugin(): Android app -> none (Android keeps its own engine)", V.plugin(cap(true, "android", true)) === null);
check("plugin(): iOS app build without the plugin -> none (MoveNet fallback)", V.plugin(cap(true, "ios", false)) === null);
check("plugin(): iOS app with ZabbaPose -> the plugin", !!V.plugin(cap(true, "ios", true)));
// 2. mapping
check("17 MoveNet keypoint names, MoveNet order", V.NAMES.length === 17 && V.NAMES[5] === "left_shoulder" && V.NAMES[16] === "right_ankle");
{ const res = { keypoints: [{ name: "right_wrist", x: 0.75, y: 0.8, score: 0.9 }, { name: "left_shoulder", x: 0.25, y: 0.4, score: 0.8 }, { name: "neck", x: 0.5, y: 0.35, score: 1 }, { name: "left_knee", x: 1.2, y: 0.5, score: 0.9 }] };
  const k = V.toKeypoints(res, 640, 480, false), f = V.toKeypoints(res, 640, 480, true), by = (a, n) => a.find((p) => p.name === n);
  check("normalized -> video pixels (top-left origin)", by(k, "left_shoulder").x === 160 && by(k, "left_shoulder").y === 192 && by(k, "right_wrist").x === 480 && by(k, "right_wrist").y === 384);
  check("output in MoveNet order; Vision-only joints (neck) dropped", k.map((p) => p.name).join() === "left_shoulder,right_wrist,left_knee" && !by(k, "neck"));
  check("flipHorizontal mirrors x like TF.js (labels kept)", by(f, "left_shoulder").x === 480 && by(f, "left_shoulder").y === 192);
  check("a joint outside the picture is a guess: score <= 0.1", by(k, "left_knee").score <= 0.1 && by(k, "left_shoulder").score === 0.8); }
check("frameSize: longest side 320, aspect kept", JSON.stringify(V.frameSize(640, 480)) === '{"w":320,"h":240}' && JSON.stringify(V.frameSize(480, 640)) === '{"w":240,"h":320}');
// 3. detector bridge with a fake plugin
(async () => {
  let sent = null; const plug = { isAvailable: async () => ({ available: true, engine: "vision-2d" }), detect: async (a) => { sent = a; return { keypoints: [{ name: "left_shoulder", x: 0.25, y: 0.5, score: 0.9 }] }; } };
  const d = await V.createDetector({ plugin: plug, grab: () => "QUJD" }), vid = { videoWidth: 640, videoHeight: 480, readyState: 4 };
  const out = await d.estimatePoses(vid, { flipHorizontal: true });
  check("estimatePoses sends one base64 JPEG frame and returns TF.js-shaped [{ keypoints }]", sent && sent.image === "QUJD" && out.length === 1 && out[0].keypoints[0].name === "left_shoulder" && out[0].keypoints[0].x === 480 && out[0].keypoints[0].y === 240);
  const none = await V.createDetector({ plugin: { detect: async () => ({ keypoints: [] }) }, grab: () => "x" }).then((x) => x.estimatePoses(vid, {}));
  check("no person -> [] (counter sees an empty frame, like MoveNet)", Array.isArray(none) && none.length === 0);
  check("video not ready -> [] without calling the plugin", (await d.estimatePoses({ videoWidth: 640, videoHeight: 480, readyState: 1 }, {})).length === 0);
  let rejected = false; await V.createDetector({ plugin: { isAvailable: async () => ({ available: false }), detect: async () => ({}) } }).catch(() => { rejected = true; });
  check("plugin says unavailable -> createDetector rejects (page falls back to MoveNet)", rejected);
  // 4. counter fed through the Vision bridge counts exactly like direct keypoints
  { const segs = [[2000, 0, 0], ...S.reps(8, 2000)], c = Object.assign({}, S.BASE), H = 480;
    const a = PC.createCounter({ app: true }), b = PC.createCounter({ app: true }); let ra = 0, rb = 0;
    for (let t = 0; t <= S.total(segs); t += 1000 / 30) {
      const k = S.frameFor(S.fracAt(segs, t), c, t);
      const res = { keypoints: k.map((p) => ({ name: p.name, x: p.x / c.W, y: p.y / H, score: p.score })) };
      if (a.update(k, t, c.W).counted) ra++;
      if (b.update(V.toKeypoints(res, c.W, H, false), t, c.W).counted) rb++;
    }
    check("counter through the Vision mapping: same reps as direct keypoints (8 of 8)", ra === 8 && rb === 8, ra + "/" + rb); }
  // 5. page wiring (real functions sliced from index.html)
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const line = (start) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf("\n", i)); };
  const block = (start) => { const i = html.indexOf(start); if (i < 0) throw new Error("missing " + start); return html.slice(i, html.indexOf("\n}\n", i) + 2); };
  const src = [line("function isNativeApp()"), line("function useVision()"), line("let visionFailed = false"), line("const VISION_CAM_SCRIPTS"), block("async function ensurePushPose()")].join("\n");
  const make = (win, visionOk) => { const ctx = Object.assign({ console: { warn() {} }, calls: [] }, win); ctx.window = ctx;
    ctx.loadCamLibs = async () => { ctx.calls.push("libs"); }; ctx.ensurePose = async () => { ctx.calls.push("movenet"); return "MOVENET"; };
    ctx.ZabbadatVision = { createDetector: async () => { if (!visionOk) throw new Error("no"); return "VISION"; } };
    vm.createContext(ctx); vm.runInContext(src + "\nthis.api = { useVision, ensurePushPose, get failed() { return visionFailed; } };", ctx); return ctx; };
  const W = make({}), A = make(cap(true, "android", true)), I0 = make(cap(true, "ios", false)), I = make(cap(true, "ios", true), true), IF = make(cap(true, "ios", true), false);
  check("page: useVision() only in the iOS app with the plugin", !W.api.useVision() && !A.api.useVision() && !I0.api.useVision() && I.api.useVision());
  check("page: browser push-ups -> ensurePose() (MoveNet) exactly as before", (await W.api.ensurePushPose()) === "MOVENET" && W.calls.join() === "movenet");
  check("page: Android app / older iOS build -> MoveNet", (await A.api.ensurePushPose()) === "MOVENET" && (await I0.api.ensurePushPose()) === "MOVENET");
  check("page: iOS app with plugin -> Apple Vision, no MoveNet loaded", (await I.api.ensurePushPose()) === "VISION" && !I.calls.includes("movenet"));
  check("page: Vision failing -> falls back to MoveNet and stays there", (await IF.api.ensurePushPose()) === "MOVENET" && IF.api.failed && !IF.api.useVision());
  check("page: Vision script list has no downloaded model (no TF.js / MoveNet URLs)", /const VISION_CAM_SCRIPTS = \["\/push-counter\.js", "\/push-coach\.js", "\/pose-vision\.js"\];/.test(html));
  check("page: browser CAM_SCRIPTS unchanged and still the browser choice", /useVision\(\) \? VISION_CAM_SCRIPTS : isNativeApp\(\) \? CAM_SCRIPTS\.concat\(\["\/push-coach\.js"\]\) : CAM_SCRIPTS/.test(html));
  check("page: solo push-ups, app camera open and TUT battle use ensurePushPose; plank stays on MoveNet", (html.match(/typeof ensurePushPose === "function" \? ensurePushPose\(\) : ensurePose\(\)/g) || []).length === 3 && /async function plankTick[\s\S]{0,200}const det = await ensurePose\(\);/.test(html));
  check("page: TF.js loads on demand in the app when MoveNet is needed after the Vision path", /if \(!window\.poseDetection && isNativeApp\(\)\) await loadTfLibs\(\);/.test(html));
  check("page: no drawing code on the page (the off-screen frame copy lives in pose-vision.js)", !/getContext\(|drawImage/.test(html));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
