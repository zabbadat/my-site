// Nov 17 (owner: the "black screen" is a glitched top-half of the view). Root cause: the opening hood
// (openMask 0.62, a dark fill over the top of the picture) and the full-frame branded blanket. This test
// fails on b146dab (hood + blanket fills) and passes once those fills are gone: every prompt screen
// paints the live (or frozen) camera frame in full, with only the logo over the face.
const fs = require("fs"), path = require("path");
const PF = require("../pfp.js");
const src = fs.readFileSync(path.join(__dirname, "..", "pfp.js"), "utf8");
const R = []; const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const shield = src.slice(src.indexOf("Fail-safe shield"));

check("P.openMask is gone — no dark hood over the top of the picture", PF.P.openMask == null && !/openMask/.test(src));
check("shield paint never fills the whole canvas with coverBack (no branded blanket / placeholder)", !/x\.fillStyle = P\.coverBack; x\.fillRect\(0, 0, g\.bw, g\.bh\)/.test(src));
check("shield paint never fills a top-of-picture hood", !/R\.h \* P\.openMask/.test(src) && !/fillRect\(R\.x, R\.y, R\.w/.test(src));
check("opening / lost frames still draw a snapshot of the camera (full picture, not a raw <video>) under the logo", /function grabPreview/.test(src) && /if \(frame\) \{ var fw0[^\n]*if \(P\.blurOn\) drawBlur\(x, g, s, frame[^\n]*else drawSnap\(x, g, frame/.test(src) && /x\.clearRect\(0, 0, g\.bw, g\.bh\)/.test(shield) && !/x\.drawImage\((s\.vid|v),/.test(shield));
check("prepare() still stands the shield up on the tap so the logo can paint before the first frame", /function prepare\(vid\)/.test(src) && /api\.prepare = prepare/.test(src) && /s\.opening = 1/.test(src));
check("after lock, a lost or stale frame keeps the frozen snapshot (or a preview) and a large logo, not a dark fill", /\(lockedBefore && !P\.blurOn\) \? \(s\.snap \|\| grabPreview/.test(src) && /s\.lockSnap/.test(src));
check("the only dark fill left is the logo's own clipped backing (so the mark is not see-through)", /x\.fillStyle = P\.coverBack; x\.fillRect\(m\.x - m\.r - 1/.test(src) && (src.split("x.fillStyle = P.coverBack").length - 1) === 1);
check("opening logo is large (radius ~0.48 x picture width) so a pre-lock face stays inside, then shrinks to the resting size", PF.P.blankR === 0.48 && PF.P.blankY === 0.38 && PF.P.shrinkMs > 0);

check("raw camera videos stay opacity 0 (zero exposure); the live picture is painted on the shield canvas, never as a dark fill", /opacity:0!important/.test(src) && /if \(frame\) \{ var fw0[^\n]*if \(P\.blurOn\) drawBlur\(x, g, s, frame[^\n]*else drawSnap\(x, g, frame/.test(src) && !/x\.fillStyle = P\.coverBack; x\.fillRect\(0, 0, g\.bw, g\.bh\)/.test(src));
const rec = fs.readFileSync(path.join(__dirname, "..", "rec.js"), "utf8");
check("rec.js: no dark full-frame logo; recordings draw the live picture plus the opening-size logo when unlocked", /x\.drawImage\(rf \? rf\.img : v, 0, 0, fw, fh\)/.test(rec) && /blankR/.test(rec) && !/Math\.hypot\(fw, fh\) \/ 2 \+ 2/.test(rec));

const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
