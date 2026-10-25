// Push-up camera pipeline, static checks: camera only, nothing drawn over the video, one smoother (the counter's
// One Euro filter), frames stamped before inference. Run: node test/push-camera-only.test.js
const fs = require("fs"), path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + n); };
const html = read("index.html");
const between = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); return html.slice(i, html.indexOf(b, i + a.length)); };
const solo = between("async function ensurePose()", "async function openCam()"), tbPose = between("async function tbPose()", "// 3:00 reached");
const camBlock = between('<div id="camWrap"', "</div>"), tbBlock = html.slice(html.indexOf('id="tbCamWrap"'), html.indexOf("</div>", html.indexOf('id="tbCamWrap"')));
check("no stick figure / skeleton overlay: no canvas inside the push-up camera boxes", !/<canvas/i.test(camBlock) && !/<canvas/i.test(tbBlock));
check("no drawing code on the page (no canvas context, keypoint or skeleton drawing)", !/getContext\(|drawKeypoints|drawSkeleton|skeleton|stick ?figure|strokeStyle|fillRect|drawImage/i.test(html));
check("MoveNet runs with enableSmoothing: false (the counter's One Euro filter is the only smoother)", /enableSmoothing:\s*false/.test(solo) && !/enableSmoothing:\s*true/.test(html));
check("solo: frame stamped BEFORE inference and that time is what the counter gets", /const tFrame = performance\.now\(\);[^\n]*\n\s*const poses = await det\.estimatePoses/.test(solo) && /pushCounter\.update\([^)]*tFrame/.test(solo));
check("TUT battle: same, stamped before inference", /tFrame = performance\.now\(\), poses = await poseDetector\.estimatePoses/.test(tbPose) && /tbCounter\.update\(kps, now, w\)/.test(tbPose) && /now = tFrame/.test(tbPose));
check("posture guards get the counter's topSize (shoulder width), not the signal level", /postureGuard\.update\([^\n]*st\.topSize/.test(html) && /tbJudge\.update\([^\n]*st\.topSize/.test(html));
const srcs = ["push-counter.js", "push-session.js", "push-challenge.js"].map(read).join("\n");
check("camera only: no motion / orientation / proximity sensor use in the push-up counter, session or challenge code", !/devicemotion|deviceorientation|accelerometer|gyroscope|Sensor\b|proximity/i.test(srcs));
const poseFn = between("async function poseTick()", "async function openCam()");
check("camera only: the pose loop uses no motion sensor", !/devicemotion|deviceorientation|accelerometer|gyroscope|Sensor\b|proximity/i.test(poseFn));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
