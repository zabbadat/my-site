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


// 6. ONE shared PFP setting: "Show my PFP" (Live Match camera) == top-bar "Enable profile - PFP" (pfp.js KEY, this device)
const mem = (o = {}) => ({ d: Object.assign({}, o), getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = String(v); } });
check("same storage key as the top-bar switch (single source of truth)", CAM.SHOW_KEY === PF.KEY && PF.KEY === "zabPfpOn" && !/zdMatchShowPfp/.test(fs.readFileSync(path.join(__dirname, "..", "match-pfp-cam.js"), "utf8")));
check("follows the global setting: on -> on, off -> off, never set -> off (same default as the top-bar switch)", CAM.readShow(mem({ zabPfpOn: "1" })) === true && CAM.readShow(mem({ zabPfpOn: "0" })) === false && CAM.readShow(mem()) === false && CAM.readShow(null) === false);
const m1 = mem(); CAM.saveShow(m1, true);
check("the choice persists in localStorage on this device", m1.d.zabPfpOn === "1" && CAM.readShow(m1) === true && (CAM.saveShow(m1, false), CAM.readShow(m1) === false));
check("page: 'Show my PFP' switch inside #zmCamBox, styled like the Enable profile - PFP row", /<label class="pfp-row zm-pfp-row" id="zmShowPfpRow" for="zmShowPfp"[^>]*><input type="checkbox" id="zmShowPfp" role="switch"[^>]*><span class="pfp-sw" aria-hidden="true"><\/span><span class="pfp-lbl">Show my PFP<\/span>/.test(html) && html.indexOf('id="zmShowPfp"') > html.indexOf('id="zmCamBox"') && html.indexOf('id="zmShowPfp"') < html.indexOf('id="zmCamWrap"'));
(async () => {
  // Browser side in a sandbox (pfp.js + match-pfp-cam.js together): fake DOM, camera and pose detector.
  const vm = require("vm");
  const ops = [], els = {}, raf = [];
  let poseCalls = 0;
  const ctx2d = { setTransform() {}, clearRect() { ops.push("clear"); }, save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {}, arc() { ops.push("arc"); }, stroke() {}, fillRect() {}, fillText() {}, drawImage() { ops.push("img"); }, createLinearGradient() { return { addColorStop() {} }; } };
  const el = (id, extra) => (els[id] = Object.assign({ id, hidden: false, textContent: "", style: {}, attrs: {}, listeners: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; }, querySelector() { return null; } }, extra || {}));
  ["zmCamBtn", "zmCamFacing", "zmCamBox", "zmCamWrap", "zmCamNote", "pfpRow", "ztBadge"].forEach((id) => el(id));
  el("zmShowPfp", { checked: false }); el("pfpToggle", { checked: false });
  el("zmCamOverlay", { width: 0, height: 0, getContext: () => ctx2d });
  el("zmCamVid", { readyState: 4, videoWidth: 640, videoHeight: 480, clientWidth: 320, clientHeight: 240, offsetLeft: 0, offsetTop: 0, parentNode: {}, play: async () => {} });
  const store = mem({ zabPfpOn: "1" }), winL = {};
  const win = { document: { readyState: "complete", getElementById: (id) => els[id] || null, createElement: () => el("x" + Math.random()) }, localStorage: store, devicePixelRatio: 1,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    addEventListener: (t, f) => { winL[t] = f; }, requestAnimationFrame: (f) => raf.push(f), getComputedStyle: () => ({ objectFit: "fill" }),
    ensurePushPose: async () => ({ estimatePoses: async () => { poseCalls++; return [{ score: 0.9, keypoints: face }]; } }) };
  win.window = win;
  const sb = vm.createContext(Object.assign(win, { console, Promise, Math, Date, Object, String, Number, isFinite, Array, setTimeout, clearTimeout }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "pfp.js"), "utf8"), sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "match-pfp-cam.js"), "utf8"), sb);
  const B = sb.ZabbaMatchPfpCam, G = sb.ZabPfp;
  G.setUser({ uid: "u1", displayName: "Ann" });
  const flush = async (n = 3) => { for (let i = 0; i < n; i++) { const f = raf.splice(0); f.forEach((g) => g()); await new Promise((r) => setImmediate(r)); } };
  B.sync({ live: true, player: { name: "Ann" } });
  check("browser: Show my PFP starts from the shared setting (on) and both switches show on", B.isShow() === true && els.zmShowPfp.checked === true && els.pfpToggle.checked === true && G.isOn() === true);
  await B.start(); await new Promise((r) => setImmediate(r)); await flush();
  const onCalls = poseCalls, onArcs = ops.filter((o) => o === "arc").length;
  check(`ON: avatar tracking runs and the floating PFP is drawn (${onCalls} pose calls, ${onArcs} arcs)`, B.isOn() && onCalls > 0 && onArcs > 0);
  ops.length = 0; let before = poseCalls; els.zmShowPfp.checked = false; els.zmShowPfp.listeners.change();
  await flush(4);
  check("OFF via Show my PFP mid-camera: overlay cleared, no avatar drawn, avatar tracking skipped, no rAF loop left", B.isOn() && B.isShow() === false && ops.includes("clear") && poseCalls === before && !ops.includes("arc") && raf.length === 0);
  check("…and it is the same setting: top-bar switch now off too, stored off on this device", store.d.zabPfpOn === "0" && G.isOn() === false && els.pfpToggle.checked === false && els.zmShowPfp.attrs["aria-checked"] === "false");
  ops.length = 0; before = poseCalls; els.pfpToggle.checked = true; els.pfpToggle.listeners.change();
  await flush(4);
  check("ON via the top-bar switch mid-camera: Show my PFP flips on live, tracking and the floating PFP resume", els.zmShowPfp.checked === true && poseCalls > before && ops.includes("arc") && store.d.zabPfpOn === "1");
  ops.length = 0; before = poseCalls; els.pfpToggle.checked = false; els.pfpToggle.listeners.change();
  await flush(4);
  check("OFF via the top-bar switch mid-camera: match overlay cleared and its loop stops", els.zmShowPfp.checked === false && poseCalls === before && ops.includes("clear") && !ops.includes("arc") && raf.length === 0);
  store.d.zabPfpOn = "1"; winL.storage && winL.storage({ key: "zabPfpOn" }); await flush(3);
  check("flipped in another tab (storage event): camera follows", poseCalls > before && els.zmShowPfp.checked === true);
  B.stop(); await flush(2);
  check("camera off: no rAF loop left", raf.length === 0 && B.isOn() === false);
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
})().catch((e) => { console.log("FAIL  browser sandbox threw: " + (e && e.stack)); process.exit(1); });
