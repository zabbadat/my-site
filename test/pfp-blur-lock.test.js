// Blur-until-lock (owner, Nov 19): no lock = the live picture BLURRED under the opening logo; locked = sharp only on the
// locked person's focus box, blurred elsewhere (mirror reflections / second faces). Run: node test/pfp-blur-lock.test.js
const fs = require("fs"), path = require("path");
const PF = require("../pfp.js"), src = fs.readFileSync(path.join(__dirname, "..", "pfp.js"), "utf8"), rec = fs.readFileSync(path.join(__dirname, "..", "rec.js"), "utf8");
const R = []; const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
check("blur on by default, focus blur on, cells across the long side 12-32", PF.P && PF.P.blurOn === true && PF.P.focusBlur === true && PF.P.blurCells >= 12 && PF.P.blurCells <= 32);
check("blur by canvas resampling, never ctx.filter (off by default in Safari / WKWebView)", /function blurSmall/.test(src) && !/\.filter\s*=/.test(src));
check("no lock: the frame is drawn through drawBlur when blurOn", /if \(P\.blurOn\) drawBlur\(x, g, s, frame/.test(src));
check("locked + lost-grow frames go through drawLocked (blur + sharp focus box)", (src.match(/drawLocked\(x, g, s, s\.snap, s\.vw, s\.vh\)/g) || []).length === 2);
check("after a loss with blur on: the LIVE picture again (blurred), not the frozen frame", /\(lockedBefore && !P\.blurOn\) \? \(s\.snap \|\| grabPreview\(s, v\)\) : \(grabPreview\(s, v\) \|\| s\.snap\)/.test(src));
check("no dark cover / hood is back (coverBack fill, openMask)", !/x\.fillStyle = P\.coverBack; x\.fillRect\(0, 0, g\.bw, g\.bh\)/.test(src) && !/P\.openMask/.test(src));
const kps = K({ nose: [320, 150], left_eye: [312, 142], right_eye: [328, 142], left_ear: [302, 146], right_ear: [338, 146], left_shoulder: [280, 200], right_shoulder: [360, 200], left_hip: [290, 320], right_hip: [350, 320] });
const fb = PF.focusBox(kps, { x: 320, y: 150, r: 40 }, 640, 480);
check("focus box holds every confident keypoint and the head cover", fb && fb.x0 <= 280 && fb.x1 >= 360 && fb.y0 <= 110 && fb.y1 >= 320, JSON.stringify(fb));
check("focus box is padded (focusPad x larger side) and clipped to the frame", fb && fb.y0 >= 0 && fb.x1 <= 640 && fb.y1 <= 480 && fb.x0 < 280 - 30);
check("focus box ignores low-confidence points", (() => { const k2 = kps.concat(K({ left_ankle: [10, 470] }, 0.1)); const f2 = PF.focusBox(k2, null, 640, 480); return f2 && f2.x0 > 100; })());
check("focus box null with no confident points", PF.focusBox(K({ nose: [1, 1] }, 0.1), null, 640, 480) === null);
check("recordings: same blur pre-lock and sharp only in the focus box when locked", /Zb\.blurInto\(x, rf \? rf\.img : v, fw, fh, true\)/.test(rec) && /rf\.focus/.test(rec) && /focus: P\.blurOn && P\.focusBlur/.test(src));
check("outbound live stream stays the shield canvas (same blurred pixels)", /shieldCanvas/.test(fs.readFileSync(path.join(__dirname, "..", "washers-live-controls.js"), "utf8")));
const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad}/${R.length} passed`); process.exit(bad ? 1 : 0);
