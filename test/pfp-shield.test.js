// PFP fail-safe shield (Nov 16, owner: zero face exposure): videos hidden from the first paint, the model runs on the frame
// the screen shows, blanket -> nested shrink -> lock, plausibility guard, native plank off while PFP is on, recordings.
const fs = require("fs"), path = require("path"), ROOT = path.join(__dirname, "..");
const PF = require("../pfp.js"), html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), pfpSrc = fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8");
let pass = 0, fail = 0; const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); c ? pass++ : fail++; };
const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
// 1. hidden from the first paint, in the initial HTML (head), before any script that could open a camera
const head = html.slice(0, html.indexOf("</head>")), css = /<style id="pfpShieldCss">([^<]*)<\/style>/.exec(head);
const ids = ["camVid", "plankVid", "tbVid", "sqVid", "zlSelf", "zmCamVid"];
check("index.html <head>: rule hides every camera video (opacity 0) while the switch is on", !!css && ids.every((i) => css[1].includes("html.zab-pfp-shield video#" + i)) && /opacity:0!important/.test(css[1]));
check("index.html <head>: shield on before first paint unless the key is explicitly off (unset or \"1\")", /<script>try \{ if \(localStorage\.getItem\("zabPfpOn"\) !== "0"\) document\.documentElement\.classList\.add\("zab-pfp-shield"\); \} catch \(e\) \{ try \{ document\.documentElement\.classList\.add\("zab-pfp-shield"\); \} catch \(e2\) \{\} \}<\/script>/.test(head) && head.indexOf("pfpShieldCss") < head.indexOf("<script async"));
function earlyShield(getItem, shouldThrow) {
  const added = { n: 0 }; const document = { documentElement: { classList: { add() { added.n++; } } } };
  const localStorage = { getItem(k) { if (shouldThrow) throw new Error("blocked"); return getItem(k); } };
  try { if (localStorage.getItem("zabPfpOn") !== "0") document.documentElement.classList.add("zab-pfp-shield"); } catch (e) { try { document.documentElement.classList.add("zab-pfp-shield"); } catch (e2) {} }
  return added.n === 1;
}
check("early shield: unset key adds the class (zero first-paint exposure)", earlyShield(() => null) === true);
check("early shield: stored on adds the class", earlyShield(() => "1") === true);
check("early shield: explicit off does not add the class", earlyShield(() => "0") === false);
check("early shield: storage throw still adds the class (fail closed)", earlyShield(() => null, true) === true);
check("every camera video exists in the page with those ids", ids.every((i) => html.includes('id="' + i + '"')));
// 2. the model runs on the snapshot the shield shows (every pose loop)
const sq = fs.readFileSync(path.join(ROOT, "squat-page.js"), "utf8"), mt = fs.readFileSync(path.join(ROOT, "match-pfp-cam.js"), "utf8");
const n = (html.match(/estimatePoses\(\(window\.ZabPfp && window\.ZabPfp\.input \? window\.ZabPfp\.input\(/g) || []).length;
check(`pose loops feed ZabPfp.input (push, plank, TUT, Go live: ${n}/4; squats; Live Match)`, n === 4 && /ZabPfp\.input\(vid, det\)/.test(sq) && /Z\.input\(vid, vid\._zmDet\)/.test(mt) && /Z\.frame\(vid, kps, t\)/.test(mt));
check("native plank screen (no logo) is skipped while PFP is on", /function nativePlank\(\) \{ try \{ if \(window\.ZabPfp && window\.ZabPfp\.isOn && window\.ZabPfp\.isOn\(\)\) return null;/.test(html));
// 3. plausibility guard
const front = { nose: [420, 210], left_eye: [405, 195], right_eye: [435, 195], left_ear: [390, 200], right_ear: [450, 200], left_shoulder: [345, 295], right_shoulder: [495, 295], left_hip: [360, 470], right_hip: [480, 470] };
const mv = (o, dx, dy) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /nose|eye|ear/.test(k) ? [v[0] + dx, v[1] + dy] : v]));
const pl = (o) => { const k = K(o), f = PF.faceCircle(k); return !!f && PF.plausible(k, f); };
check("plausible: a normal front head", pl(front));
check("implausible: head 300 px off the shoulders (wall between the hands) -> blanket", !pl(mv(front, -300, -150)));
check("implausible: head on the chest / between shoulders and hips -> blanket", !pl(mv(front, 0, 170)));
check("implausible: face points scattered", !pl(Object.assign({}, front, { nose: [600, 40] })));
check("plausible: close-up selfie without shoulders", pl({ nose: [320, 240], left_eye: [290, 200], right_eye: [350, 200], left_ear: [250, 215], right_ear: [390, 215] }));
// 4. nested shrink never uncovers the head circle: every step contains it (box 390x520, head anywhere)
let worst = Infinity;
for (let i = 0; i < 400; i++) { const bw = 390, bh = 520, t = { x: Math.random() * bw, y: Math.random() * bh, r: 20 + Math.random() * 120 };
  const c = { x: bw / 2, y: bh / 2 }, B = { x: c.x, y: c.y, r: Math.max(Math.hypot(bw, bh) / 2 + 2, Math.hypot(t.x - c.x, t.y - c.y) + t.r + 1) };
  for (let p = 0; p <= 1.0001; p += 0.05) { const m = { x: B.x + (t.x - B.x) * p, y: B.y + (t.y - B.y) * p, r: B.r + (t.r - B.r) * p }; worst = Math.min(worst, m.r - (Math.hypot(m.x - t.x, m.y - t.y) + t.r)); } }
check(`shrink blanket -> head: every intermediate circle contains the head circle (worst slack ${worst.toFixed(6)} px >= 0)`, worst >= -1e-6);
check("opening logo (no lock): 0.32 x the picture height via blanketLogo; first decoded frame is drawn with a branded hood over the head area (never a plain-black wait)", /function blanketLogo\(g\) \{ var R = picRect\(g\)/.test(pfpSrc) && /r: Math\.max\(P\.minR, Math\.min\(P\.blankR \* vis\.h, 0\.45 \* vis\.w\)\)/.test(pfpSrc) && /function grabPreview/.test(pfpSrc) && /R\.h \* P\.openMask/.test(pfpSrc) && /never plain black/.test(pfpSrc));
check("opening hood only before the first lock; after a lock, lost / low-conf frames use the full branded blanket", /var preview = !\(s\.wasLocked \|\| \(s\.vid && lockedOnce\[s\.vid.id\]\)\) \? grabPreview\(s, v\) : null/.test(pfpSrc) && /lockedOnce\[s\.vid.id\] = 1/.test(pfpSrc) && /delete lockedOnce/.test(pfpSrc));
check("shield: stale / hidden tab / size change unlock; live <video> never drawn raw (opening uses a snapshot + hood)", /now - s\.lastPoseT > staleOf\(s\)/.test(pfpSrc) && /visibilityState !== "visible"/.test(pfpSrc) && /grabPreview/.test(pfpSrc) && !/x\.drawImage\((s\.vid|v),/.test(pfpSrc.slice(pfpSrc.indexOf("Fail-safe shield"))));
check("logo has an opaque backing (transparent bits never show the face)", /x\.fillStyle = P\.coverBack; x\.fillRect\(m\.x - m\.r - 1/.test(pfpSrc));
check("lock needs steady tracking (lockFrames >= 2) and stale is under half a second (browser); slow engines capped at 1 s", PF.P.lockFrames >= 2 && PF.P.staleMs <= 500 && PF.P.staleMaxMs <= 1000 && PF.P.staleK <= 3);
const rec = fs.readFileSync(path.join(ROOT, "rec.js"), "utf8");
check("recordings: the covered pose-matched frame, else the logo full frame (no plain face, no pixelation)", /ZabPfp\.recFrame/.test(rec) && /blanket/.test(rec) && !/imageSmoothingEnabled = false/.test(rec));
console.log(`${pass}/${pass + fail} passed`); if (fail) process.exitCode = 1;
