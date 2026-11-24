// Cooling-box sitkari cover: mouth stays clear; other modes still cover the chin.
// Do not add cooling to the 69-scenario pfp-proof matrix (green mouth pixels would fail it).
// Run: node test/pfp-sitkari-cooling.test.js
const PF = require("../pfp.js");
const fs = require("fs"), path = require("path");
const R = [];
const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
function inside(c, x, y) { return Math.hypot(x - c.x, y - c.y) <= c.r + 1e-6; }

// Typical front-facing face in a 640x480 frame. Mouth is below the nose; chin lower still.
const kps = [
  { name: "nose", x: 320, y: 200, score: 0.95 },
  { name: "left_eye", x: 340, y: 185, score: 0.95 },
  { name: "right_eye", x: 300, y: 185, score: 0.95 },
  { name: "left_ear", x: 360, y: 195, score: 0.9 },
  { name: "right_ear", x: 280, y: 195, score: 0.9 },
  { name: "left_shoulder", x: 400, y: 320, score: 0.9 },
  { name: "right_shoulder", x: 240, y: 320, score: 0.9 }
];
const mouth = { x: 320, y: 236 }; // lips / open mouth, below the upper-lip line
const chin = { x: 320, y: 260 };
const forehead = { x: 320, y: 140 };
const leftEye = { x: 340, y: 185 };
const rightEye = { x: 300, y: 185 };

check("sitkariHead and sitkariFrame are exported", typeof PF.sitkariHead === "function" && typeof PF.sitkariFrame === "function");
const s = PF.sitkariHead(kps, 640, 480);
const h = PF.headCircle(kps, 640, 480);
const p = PF.plankHead(kps, 640, 480);
check("sitkariHead returns a circle for a front face", !!(s && s.r > 0 && s.src === "sitkari"), JSON.stringify(s));
check("sitkari leaves the mouth region uncovered", !!(s && !inside(s, mouth.x, mouth.y)), JSON.stringify({ s, mouth }));
check("sitkari leaves the chin uncovered", !!(s && !inside(s, chin.x, chin.y)), JSON.stringify({ s, chin }));
check("sitkari covers both eyes", !!(s && inside(s, leftEye.x, leftEye.y) && inside(s, rightEye.x, rightEye.y)), JSON.stringify({ s, leftEye, rightEye }));
check("sitkari covers the forehead", !!(s && inside(s, forehead.x, forehead.y)), JSON.stringify({ s, forehead }));
check("sitkari covers the nose (above the mouth)", !!(s && inside(s, 320, 200)), JSON.stringify(s));
check("headCircle still covers the chin (other modes unchanged)", !!(h && inside(h, chin.x, chin.y)), JSON.stringify(h));
check("plankHead still covers the chin (other modes unchanged)", !!(p && inside(p, chin.x, chin.y)), JSON.stringify(p));
check("headCircle and plankHead still cover the mouth", !!(h && inside(h, mouth.x, mouth.y) && p && inside(p, mouth.x, mouth.y)));
check("sitkari circle is not the same as the full-face cover", !!(s && h && (Math.abs(s.y - h.y) > 2 || Math.abs(s.r - h.r) > 2)));

const tr = PF.createTracker();
const c0 = tr.step(kps, 0, 640, 480, 0, PF.sitkariHead);
const held = tr.step([], 200, 640, 480, 200, PF.sitkariHead);
const at = tr.at(200);
check("tracker holds the last sitkari position when the face drops (no corner fallback)",
  !!(c0 && held && at && Math.abs(held.x - c0.x) < 8 && Math.abs(held.y - c0.y) < 8 && Math.abs(at.x - c0.x) < 8),
  JSON.stringify({ c0, held, at }));
check("sitkariHead is null when there is no face (tracker, not a corner logo, owns the hold)",
  PF.sitkariHead([], 640, 480) == null && PF.sitkariHead(null, 640, 480) == null);

const src = fs.readFileSync(path.join(__dirname, "..", "pfp.js"), "utf8");
const rec = fs.readFileSync(path.join(__dirname, "..", "rec.js"), "utf8");
const box = fs.readFileSync(path.join(__dirname, "..", "cooling-box.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
check("coolingVid is in the shared OPEN_IDS cover", /coolingVid: 1/.test(src));
check("cooling-box uses sitkariFrame, not a new getUserMedia pipeline of its own constraints",
  /ZabPfp\.sitkariFrame/.test(box) && /getUserMedia\(H\.CAM_CONSTRAINTS\)/.test(box)
  && !/facingMode: "user"/.test(box));
check("no corner fallback was added for sitkari", !/corner fallback|cornerFallback|sitkariCorner/i.test(src + box));
check("Proof of Sitkari caption sits under the video, not over the mouth or logo",
  /id="coolingProofCaption"/.test(html) && html.indexOf('id="coolingVid"') < html.indexOf('id="coolingProofCaption"')
  && /Proof of Sitkari/.test(html));
check("Record toggle is optional, off by default, remembered locally",
  /id="coolingRecBtn"/.test(html) && /data-rec="coolingWrap"/.test(html)
  && /zabbadat-breath-record/.test(box) && /=== "1"/.test(box));
check("recordings of the cooling box use a mouth-clear logo and the Proof of Sitkari HUD",
  /coolingWrap: "coolingVid"/.test(rec) && /Proof of Sitkari/.test(rec) && /r\.id === "coolingWrap"/.test(rec));
check("cooling host reuses attachCam / stopCamTracks / CAM_CONSTRAINTS and does not call camFs",
  /window\.ZabCoolingHost/.test(html) && /attachCam, stopCamTracks, camErrorText, isNativeApp, CAM_CONSTRAINTS/.test(html)
  && /Reuses the shared camera helpers, no sign-in, no camFs/.test(html));

const ok = R.filter(Boolean).length;
console.log(`\n${ok}/${R.length} passed`);
if (ok !== R.length) process.exit(1);
