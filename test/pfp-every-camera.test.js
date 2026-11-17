// PFP on every camera start + instant first lock (Nov 16, owner). Static wiring checks on index.html plus pfp.js warm-up.
// Run: node test/pfp-every-camera.test.js
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const R = []; const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const fnSrc = (n) => { const a = "function " + n + "("; const i = html.indexOf(a); if (i < 0) throw new Error("missing " + n); const eol = html.indexOf("\n", i), l = html.slice(i, eol);
  if (/\}\s*$/.test(l) && (l.match(/\{/g) || []).length === (l.match(/\}/g) || []).length) return l; return html.slice(i, html.indexOf("\n}", i) + 2); };
const seg = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
const pt = seg("async function poseTick(", "const CAM_CONSTRAINTS");
(async () => {
  // ---- PFP on every camera start (same Enable profile - PFP switch)
  check("push-ups / TUT camera (#camVid): every pose frame, before the set starts", /ZabPfp\.frame\(vid, pose \? pose\.keypoints : \[\], tFrame\)/.test(pt) && pt.indexOf("ZabPfp.frame") < pt.indexOf("pushCounter.update"));
  check("plank / plank push press (#plankVid) from camera open", /ZabPfp\.plankFrame\(vid, kps/.test(seg("async function plankTick(", "function newPlankHold(")));
  check("TUT Battle (#tbVid) before Go", /ZabPfp\.frame\(v, kps, tFrame\)/.test(seg("async function tbPose()", "// 3:00 reached")));
  check("Go live self preview (#zlSelf): PFP loop starts as soon as the camera is attached (and on flip), clears on stop", /v\.srcObject = zlStream; v\.hidden = false;[^\n]*zlPfpStart\(\)/.test(html) && /\$\("zlSelf"\)\.srcObject = s; zlPfpStart\(\)/.test(html) && /function zlStopTracks\(\) \{ zlPfpStop\(\);/.test(html));
  check("#zlSelf overlay has a positioned parent", /<div class="zl-self-wrap" style="position:relative"><video class="zl-self" id="zlSelf"/.test(html));
  check("#zlSelf follows the same switch (isOn) and is unmirrored", /ZabPfp\.isOn\(\)/.test(fnSrc("zlPfpLoop")) && /flipHorizontal: false/.test(fnSrc("zlPfpLoop")));
  check("Live Match camera keeps its PFP from camera open", /applyShow\(\); \/\/ starts the avatar loop/.test(fs.readFileSync(path.join(ROOT, "match-pfp-cam.js"), "utf8")));
  // ---- instant first lock: the model loads (once) while the camera opens, with a warm-up inference
  check("ensurePose: one shared load (memoized promise), reset on failure", /let posePromise = null;/.test(html) && /if \(!posePromise\) posePromise = loadPoseModel\(\)\.catch\(\(e\) => \{ posePromise = null; throw e; \}\);/.test(html));
  check("model load runs a blank-frame warm-up before the first camera frame", /await window\.ZabPfp\.warmDetector\(poseDetector\)/.test(fnSrc("loadPoseModel")));
  const order = (s) => { const g = s.indexOf("getUserMedia("), e = s.indexOf("ensurePose().catch(() => {})"), a = s.indexOf("await gum"); return g >= 0 && e > g && a > e; };
  check("push camera: model load starts right after the camera request, before it resolves", order(seg("async function openCam()", "async function poseTick(")));
  check("plank camera: same", order(seg("async function startPlankCam(", "async function plankTick(")) || order(html.slice(html.indexOf("if (plankStream) plankStream.getTracks()") - 10, html.indexOf("if (plankStream) plankStream.getTracks()") + 600)));
  check("TUT Battle camera: same", order(seg("async function tbCamOn(", "tbCounter =")));
  check("Go live: PFP model load starts with the camera request", /const gum = zlCam\(zlFacing\);\s*if \(window\.ZabPfp && window\.ZabPfp\.isOn && window\.ZabPfp\.isOn\(\)\) zlPfpWarm\(\);[^\n]*\n\s*zlStream = await gum;/.test(html));
  // ---- pfp.js: warm-up never throws; logo preloads at page load; first detection draws at once
  const pfpSrc = fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8");
  check("pfp.js preloads the logo at page load", /var wire = function \(\) \{[\s\S]{0,700}?try \{ ensureLogo\(\); \} catch \(e\) \{\}/.test(pfpSrc));
  const PF = require("../pfp.js");
  check("warmDetector: no document / bad detector -> resolves, never throws", typeof PF.warmDetector === "function" && (await PF.warmDetector(null)) === undefined && (await PF.warmDetector({ estimatePoses: () => { throw new Error("x"); } })) === undefined);
  const tr = PF.createTracker(); const k = [{ name: "nose", x: 320, y: 200, score: 0.9 }, { name: "left_eye", x: 330, y: 190, score: 0.9 }, { name: "right_eye", x: 310, y: 190, score: 0.9 }, { name: "left_ear", x: 345, y: 195, score: 0.9 }, { name: "right_ear", x: 295, y: 195, score: 0.9 }, { name: "left_shoulder", x: 380, y: 300, score: 0.9 }, { name: "right_shoulder", x: 260, y: 300, score: 0.9 }];
  const c0 = tr.step(k, 0, 640, 480, 0); const a0 = tr.at(0);
  check("first detection draws at once on the detected spot (no fade / min-frames gate)", !!c0 && !!a0 && Math.abs(a0.x - c0.x) < 1e-6 && Math.abs(a0.y - c0.y) < 1e-6, JSON.stringify({ c0, a0 }));
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
})().catch((e) => { console.log("FAIL harness", e); process.exit(1); });
