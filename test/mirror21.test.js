// Mirror-21 test build: timer / first-to-21, face-debug math, and wiring to the shared PFP pipeline.
// Run: node test/mirror21.test.js
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const M = require("../mirror21.js");
const PF = require("../pfp.js");
const html = fs.readFileSync(path.join(ROOT, "mirror21-test.html"), "utf8");
const page = fs.readFileSync(path.join(ROOT, "mirror21-page.js"), "utf8");
const pfpSrc = fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8");
let pass = 0, fail = 0;
const check = (n, c, info) => { console.log((c ? "PASS  " : "FAIL  ") + n + (!c && info != null ? "  " + info : "")); c ? pass++ : fail++; };

check("formatTime: 0, 1.2 s, 61.0 s", M.formatTime(0) === "0:00.0" && M.formatTime(1200) === "0:01.2" && M.formatTime(61000) === "1:01.0");

const s = M.createSession();
check("new session starts at 0, push mode, not running", s.state().count === 0 && s.state().mode === "push" && s.state().running === false && s.TARGET === 21);
s.start(1000);
s.setPushReps(10, 5000);
check("push-ups: 10 reps at 4.0 s does not finish", s.state().count === 10 && s.state().running === true && s.state().done === false && s.state().elapsedMs === 4000);
s.setPushReps(20, 9000);
check("20 reps still running", s.state().count === 20 && s.state().done === false);
s.setPushReps(21, 12500);
check("21 reps stops the timer and records 11.5 s", s.state().done === true && s.state().running === false && s.state().count === 21 && s.state().finalTimeMs === 11500 && M.formatTime(s.state().finalTimeMs) === "0:11.5");
s.setPushReps(22, 13000);
check("further push-up updates after 21 are ignored", s.state().count === 21 && s.state().finalTimeMs === 11500);

const w = M.createSession({ mode: "washers" });
w.start(0);
w.addWashers(3, 1000); w.addWashers(3, 2000); w.addWashers(3, 3000); w.addWashers(3, 4000); w.addWashers(3, 5000);
w.addWashers(3, 6000);
check("washers: six packs of 3 reach 18, still running", w.state().count === 18 && w.state().done === false);
w.addWashers(3, 8000);
check("washers: a +3 pack from 18 stops at 21 in 8.0 s", w.state().count === 21 && w.state().done === true && w.state().finalTimeMs === 8000);

const o = M.createSession({ mode: "washers" });
o.start(0); o.addWashers(19, 1000); o.addWashers(3, 2500);
check("washers: +3 from 19 stops at 22 (overshoot) and keeps the time", o.state().count === 22 && o.state().done === true && o.state().finalTimeMs === 2500);
o.addWashers(3, 3000);
check("washers: taps after 21 are ignored", o.state().count === 22);

const x = M.createSession();
check("setMode washers works before start", x.setMode("washers") === true && x.state().mode === "washers");
x.start(0);
check("setMode is blocked while running", x.setMode("push") === false && x.state().mode === "washers");
x.addWashers(0, 10); x.addWashers(-1, 10);
check("non-positive washer points are ignored", x.state().count === 0);
x.stop(1500);
check("early stop keeps elapsed time and is not a 21 finish", x.state().running === false && x.state().done === false && x.state().elapsedMs === 1500 && x.state().finalTimeMs == null);
x.reset();
check("reset clears count and time", x.state().count === 0 && x.state().elapsedMs === 0 && x.state().done === false && x.state().mode === "washers");

const front = [
  { name: "nose", x: 320, y: 200, score: 0.92 },
  { name: "left_eye", x: 300, y: 185, score: 0.88 },
  { name: "right_eye", x: 340, y: 185, score: 0.90 },
  { name: "left_ear", x: 280, y: 195, score: 0.80 },
  { name: "right_ear", x: 360, y: 195, score: 0.81 },
  { name: "left_shoulder", x: 250, y: 320, score: 0.9 }
];
const box = M.faceBox(front);
check("faceBox: a front face returns a box covering the keypoints with a confidence", !!(box && box.w > 0 && box.h > 0 && box.conf > 0.8 && box.x < 280 && box.x + box.w > 360 && box.y < 185));
check("approxYaw: a centred nose is about 0°", M.approxYaw(front) === 0);
const turned = front.map((k) => k.name === "nose" ? Object.assign({}, k, { x: 340 }) : k);
check("approxYaw: nose toward the right of the frame is positive", M.approxYaw(turned) > 20);
check("detectInfo: no keypoints -> off", M.detectInfo([]).on === false && M.detectInfo([]).box == null);
const faint = front.map((k) => Object.assign({}, k, { score: 0.1 }));
check("detectInfo: low-confidence face points are off at the default threshold", M.detectInfo(faint).on === false);

const openIds = /var OPEN_IDS = \{([^}]+)\}/.exec(pfpSrc)[1];
check("production OPEN_IDS is unchanged (six live cameras, no m21Vid hardcoded)",
  /camVid: 1/.test(openIds) && /sqVid: 1/.test(openIds) && !/m21Vid/.test(openIds) && (openIds.match(/: 1/g) || []).length === 6, openIds);
check("pfp.js adds registerCam as a read-only extra-id hook", /function registerCam\(id\)/.test(pfpSrc) && /api\.registerCam = registerCam/.test(pfpSrc) && /Never removes or changes the six production ids/.test(pfpSrc));
check("registerCam exists on the API and is a function", typeof PF.registerCam === "function");

check("test page has #m21Vid, early shield CSS, and first-paint shield class",
  html.includes('id="m21Vid"') && html.includes('id="pfpShieldCss"') && /html\.zab-pfp-shield video#m21Vid\{opacity:0!important\}/.test(html)
  && /localStorage\.getItem\("zabPfpOn"\) !== "0"/.test(html) && /noindex/.test(html));
check("overlay canvas sits on top of the shield (z-index 3) and does not use scaleX",
  html.includes('id="m21Overlay"') && /z-index:\s*3/.test(html) && /canvas\.m21-overlay/.test(html)
  && !/m21-overlay[^}]*scaleX/.test(html));
check("page registers #m21Vid and uses prepare / input / frame like #sqVid",
  /registerCam\(VID\)/.test(page) && /ZabPfp\.prepare/.test(page) && /ZabPfp\.input\(\s*vid,\s*d\s*\)/.test(page) && /ZabPfp\.frame\(\s*vid,\s*kps,\s*t\s*\)/.test(page)
  && /estimatePoses\([^,]+,\s*\{\s*flipHorizontal:\s*true\s*\}/.test(page));
check("page uses the existing push-up counter and washer +1/+3 taps; timer starts with the camera",
  /ZabbadatPush\.createCounter/.test(page) && /data-m21-add="1"/.test(html) && /data-m21-add="3"/.test(html)
  && /sess\.start\(now\)/.test(page) && /id="m21StartBtn"/.test(html));
check("PFP toggle defaults on; raw video is never drawn onto the overlay",
  /id="m21PfpToggle" checked/.test(html) && !/drawImage\(\s*vid/.test(page) && /x\.clearRect/.test(page));
check("no black hood / coverBack full-frame fill reintroduced on the test page",
  !/openMask/.test(page) && !/coverBack/.test(page) && !/openMask/.test(html));

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exitCode = 1;
