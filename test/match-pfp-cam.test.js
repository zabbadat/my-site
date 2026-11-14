// Live Match PFP camera overlay: anchor math (above the face, shoulder fallback), lerp / hide-after-1s,
// photo vs logo/initial fallback, most-confident person, and page wiring. Does not open a camera.
// Run: node test/match-pfp-cam.test.js
const fs = require("fs"), path = require("path");
const CAM = require("../match-pfp-cam.js"), PF = require("../pfp.js"), ZM = require("../zabba-match.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
const face = K({ nose: [320, 200], left_eye: [300, 185], right_eye: [340, 185], left_ear: [280, 195], right_ear: [360, 195], left_shoulder: [240, 300], right_shoulder: [400, 300] });
const shOnly = K({ left_shoulder: [240, 300], right_shoulder: [400, 300] });

// 1. anchor math
const fc = PF.faceCircle(face), a = CAM.floatAnchor(face, 640, 480);
check("face present: anchors above the face, not on it", a && a.src === "face" && Math.abs(a.x - fc.x) < 1e-9 && a.y < fc.y - 8 && a.y === fc.y - fc.r * CAM.P.floatK);
check("face avatar is smaller than the face cover circle", a && a.r === Math.max(CAM.P.minR, Math.min(CAM.P.maxRFrac * 480, fc.r * CAM.P.floatR)));
const midY = 300, sw = 160, sh = CAM.floatAnchor(shOnly, 640, 480);
check(`shoulders only (back turned): above the shoulder midpoint (y ${sh && sh.y.toFixed(1)} < ${midY})`, sh && sh.src === "shoulders" && sh.x === 320 && Math.abs(sh.y - (midY - sw * CAM.P.shUp)) < 1e-9 && sh.y < midY);
check("face wins over shoulders when both are visible", CAM.floatAnchor(face, 640, 480).src === "face");
check("no keypoints -> no anchor", CAM.floatAnchor([], 640, 480) == null && CAM.floatAnchor(null, 640, 480) == null);
const low = K({ left_shoulder: [240, 300], right_shoulder: [400, 300] }, 0.1);
check("low-score shoulders ignored", CAM.floatAnchor(low, 640, 480) == null);
const big = CAM.floatAnchor(K({ left_shoulder: [0, 470], right_shoulder: [640, 470] }), 640, 480);
check(`radius capped at maxRFrac x shorter side (${big.r} <= ${CAM.P.maxRFrac * 480})`, big && Math.abs(big.r - CAM.P.maxRFrac * 480) < 1e-9);

// 2. floater: lerp, hold, hide
const fl = CAM.createFloater({ alpha: 0.5, hideMs: 1000 });
const s0 = fl.step(face, 0, 640, 480);
const shifted = K({ nose: [400, 200], left_eye: [380, 185], right_eye: [420, 185], left_ear: [360, 195], right_ear: [440, 195], left_shoulder: [320, 300], right_shoulder: [480, 300] });
const target = CAM.floatAnchor(shifted, 640, 480);
const s1 = fl.step(shifted, 16, 640, 480);
check("lerp moves part-way toward the new face (alpha 0.5)", s0 && s1 && !s1.held && Math.abs(s1.x - (s0.x + (target.x - s0.x) * 0.5)) < 1e-6 && s1.x > s0.x && s1.x < target.x);
const held = fl.step([], 16 + 400, 640, 480);
check("no detection: last spot held under 1 s", held && held.held && held.x === s1.x && held.y === s1.y);
const gone = fl.step([], 16 + 1001, 640, 480);
check("no detection: hidden after ~1 s", gone == null);
fl.reset();
check("reset clears the hold", fl.step([], 0, 640, 480) == null);

// 3. photo / logo / initial fallback
check("https photo is used", CAM.overlaySrc({ photo: "https://lh3.googleusercontent.com/a/x" }).kind === "photo" && CAM.overlaySrc({ photo: "https://lh3.googleusercontent.com/a/x" }).src === "https://lh3.googleusercontent.com/a/x");
check("photoURL accepted too", CAM.overlaySrc({ photoURL: "https://pbs.twimg.com/profile_images/1/me.jpg" }).kind === "photo");
check("invalid / missing photo falls back to the Zabbadat logo (with an initial)", CAM.overlaySrc({ photo: "javascript:alert(1)", name: "Ann" }).kind === "logo" && CAM.overlaySrc({ photo: "javascript:alert(1)", name: "Ann" }).src === "/zd-square.png" && CAM.overlaySrc({ name: "Ann" }).text === "A");
check("no player: logo + Z", CAM.overlaySrc(null).kind === "logo" && CAM.overlaySrc(null).text === "Z" && CAM.initialOf(null) === "Z");
check("match seat photo survives ZabbaMatch.photoOf (https only)", ZM.photoOf({ photo: "https://lh3.googleusercontent.com/a/x" }) === "https://lh3.googleusercontent.com/a/x" && ZM.photoOf({ photo: "javascript:alert(1)" }) === "" && CAM.overlaySrc({ photo: ZM.photoOf({ photo: "javascript:alert(1)" }), name: "Bo" }).kind === "logo");

// 4. most confident person only
const weak = { score: 0.2, keypoints: shOnly };
const strong = { score: 0.9, keypoints: face };
const picked = CAM.pickPerson([weak, strong]);
check("picks the most confident person", picked === strong);
check("empty / missing poses -> null", CAM.pickPerson([]) == null && CAM.pickPerson(null) == null);
const avg = CAM.pickPerson([{ keypoints: K({ nose: [1, 1] }, 0.2) }, { keypoints: K({ nose: [2, 2] }, 0.8) }]);
check("falls back to average keypoint score when pose.score is missing", avg && avg.keypoints[0].x === 2);

// 5. page wiring + do-not-touch guarantees
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = fs.readFileSync(path.join(__dirname, "..", "match-pfp-cam.js"), "utf8");
const zmjs = fs.readFileSync(path.join(__dirname, "..", "zabba-match.js"), "utf8");
check("page loads match-pfp-cam.js after zabba-match.js and pfp.js", html.indexOf('<script src="/pfp.js"></script>') > 0 && html.indexOf('<script src="/zabba-match.js"></script>') > html.indexOf('<script src="/pfp.js"></script>') && html.indexOf('<script src="/match-pfp-cam.js"></script>') > html.indexOf('<script src="/zabba-match.js"></script>'));
check("page: Camera button, facing toggle, preview, overlay canvas in #zabbaMatch; #zmLiveSlot still reserved/hidden", ["zmCamBtn", "zmCamFacing", "zmCamWrap", "zmCamVid", "zmCamOverlay", "zmCamNote", "zmCamBox"].every((id) => html.includes('id="' + id + '"')) && /id="zmLiveSlot" hidden/.test(html) && /reserved: future public Live tab/.test(html) && html.indexOf('id="zmCamBox"') > html.indexOf('id="zabbaMatch"') && html.indexOf('id="zmCamBox"') < html.indexOf('id="zmLiveSlot"'));
check("no streaming / no WebRTC in the new module or the match engine", !/getDisplayMedia|RTCPeerConnection/.test(src) && !/getDisplayMedia|RTCPeerConnection/.test(zmjs));
check("does not stop or start the push-up / TUT / plank camera (own stream, no openCam / stopCam / poseTick / camStream)", !/\b(openCam|stopCam|poseTick|camStream|poseLoopOn|tbStream|plankVid)\b/.test(src));
check("reuses the site pose engine (ensurePushPose / ensurePose / MoveNet Lightning) and pfp.js helpers", /ensurePushPose/.test(src) && /ensurePose/.test(src) && /SINGLEPOSE_LIGHTNING/.test(src) && /faceCircle/.test(src) && /mapToBox/.test(src));
check("default facing is the rear camera", /facing = "environment"/.test(src));
check("Google / X sign-in buttons and same-tab startPhoneGoogle are intact", /<button class="btn" id="signInBtn" type="button">Sign in with Google<\/button>/.test(html) && /<button class="btn ghost" id="signInXBtn" type="button">Sign in with X<\/button>/.test(html) && /startPhoneGoogle\(\)/.test(html));
check("firestore.rules / netlify / OAuth files were not required for this feature (rules block still present, unchanged keys)", fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8").includes("match /matches/{code}") && /mkBattleFs\("matches"\)/.test(html));

const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
