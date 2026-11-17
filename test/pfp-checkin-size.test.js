// Check-in logo size (Nov 17, owner on iPhone: "the logo is entirely too big, almost looks broken" at camera start).
// Before lock the shield shows the opaque backing (no video) with the logo at check-in size, not a disc past every corner;
// the shrink onto the head and the grow back on loss stay nested (zero face exposure); stale is platform-aware.
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "..", "pfp.js"), "utf8");
let pass = 0, fail = 0; const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); c ? pass++ : fail++; };
const PF = require("../pfp.js");
// Pull the shield helpers out of the browser half (pure functions) without a DOM.
const pick = (name) => { const m = new RegExp("function " + name + "\\(([^)]*)\\) \\{").exec(src); const i = m.index; let d = 0, j = src.indexOf("{", i); for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; } return src.slice(i, j + 1); };
const ctx = { P: PF.P, Math }; vm.createContext(ctx);
vm.runInContext(["enclose", "picRect", "blanketLogo", "blanketAround", "staleOf", "lerpC", "ease"].map(pick).join("\n") + "\nthis.f = { enclose, picRect, blanketLogo, blanketAround, staleOf, lerpC, ease };", ctx);
const F = ctx.f;
const boxes = [[390, 791], [390, 293], [844, 390], [360, 640], [1280, 720], [358, 269]];
// 1. size
// picture-aware: g carries the video size + object-fit; the logo is ~1/4-1/3 of the camera picture height, upper-centre
const views = [["portrait 4:3 full screen", { bw: 390, bh: 791, vw: 640, vh: 480, fit: "contain" }], ["portrait 9:16", { bw: 390, bh: 791, vw: 720, vh: 1280, fit: "contain" }], ["landscape", { bw: 844, bh: 335, vw: 1280, vh: 720, fit: "contain" }], ["inline 4:3 (fill)", { bw: 358, bh: 269, vw: 640, vh: 480, fit: "fill" }], ["desktop", { bw: 1280, bh: 743, vw: 1280, vh: 720, fit: "contain" }]];
for (const [n, g] of views) { const c = F.blanketLogo(g), R = F.picRect(g), old = Math.hypot(g.bw, g.bh) / 2 + 2, f = 2 * c.r / R.h;
  check(`${n} (box ${g.bw}x${g.bh}, picture ${R.w.toFixed(0)}x${R.h.toFixed(0)}): opening logo ${(2 * c.r).toFixed(0)} px = ${f.toFixed(2)} of the picture height (was ${(2 * old).toFixed(0)} px = ${(2 * old / R.h).toFixed(2)}), upper-centre, inside the picture`,
    f >= 0.24 && f <= 0.34 && Math.abs(c.x - (R.x + R.w / 2)) < 1e-6 && c.y < R.y + R.h / 2 && c.y - c.r >= R.y - 1e-6 && c.x - c.r >= R.x - 1e-6 && c.x + c.r <= R.x + R.w + 1e-6); }
check("overlay cover is hidden while the shield draws the camera (the check-in logo is the shield's)", /if \(!m \|\| shields\[o\.vid\.id\]\) \{ o\.cv\.style\.display = "none"; return false; \}/.test(src));
check("locked size (Nov 17): coverPad 0.25, headRW 0.5, shR 0.25 (was 0.45 / 0.6 / 0.30)", PF.P.coverPad === 0.25 && PF.P.headRW === 0.5 && PF.P.shR === 0.25);
// 2. zero exposure: every intermediate circle of the shrink (check-in -> head) and of the grow (head -> check-in) contains the head
let worst = Infinity, worstG = Infinity;
for (let i = 0; i < 3000; i++) { const [bw, bh] = boxes[i % boxes.length], g = { bw, bh, vw: 640, vh: 480, fit: i % 2 ? "contain" : "fill" }, t = { x: Math.random() * bw, y: Math.random() * bh, r: 8 + Math.random() * 0.5 * Math.min(bw, bh) };
  const B = F.blanketAround(g, t);
  for (let p = 0; p <= 1.0001; p += 0.02) { const e = F.ease(p), m = F.lerpC(B, t, e), m2 = F.lerpC(t, B, e);
    worst = Math.min(worst, m.r - (Math.hypot(m.x - t.x, m.y - t.y) + t.r)); worstG = Math.min(worstG, m2.r - (Math.hypot(m2.x - t.x, m2.y - t.y) + t.r)); } }
check(`shrink check-in -> head: every step contains the head circle (worst slack ${worst.toFixed(6)} px >= 0)`, worst >= -1e-6);
check(`grow head -> check-in on loss: every step contains the last head circle (worst slack ${worstG.toFixed(6)} px >= 0)`, worstG >= -1e-6);
const g0 = { bw: 390, bh: 791, vw: 640, vh: 480, fit: "contain" }, near = { x: 195, y: 280, r: 40 }, Bn = F.blanketAround(g0, near);
check(`lock starts from about the opening size, not a full-screen disc (start r ${Bn.r.toFixed(0)} px vs old ${(Math.hypot(390, 791) / 2 + 2).toFixed(0)})`, Bn.r < 0.3 * 390);
check("grow on loss starts from a circle holding the frozen frame's own head (s.circle), not only the last drawn logo", /var L0 = enclose\(s\.lostFrom, s\.circle \? mapToBox\(s\.circle, s\.vw, s\.vh, g\.bw, g\.bh, g\.fit\) : null\), B2 = blanketAround\(g, L0\); m = lerpC\(L0, B2,/.test(src));
// 3. no video while not locked: the blanket branch paints the opaque backing over the whole box and never draws the video
check("not locked: opaque backing over the whole box, then the logo; the live <video> is never drawn", /else \{ m = blanketAround\(g, null\); x\.fillStyle = P\.coverBack; x\.fillRect\(0, 0, g\.bw, g\.bh\); \}/.test(src) && !/drawImage\(s\.vid|drawImage\(v,/.test(src.slice(src.indexOf("Fail-safe shield"))));
// 4. platform-aware stale: browsers (fast MoveNet) keep staleMs; Apple Vision over the bridge (slow frames) gets 3x its interval, capped
check("stale: MoveNet at 60 ms/frame -> staleMs (450)", F.staleOf({ pi: 60 }) === PF.P.staleMs);
check("stale: no interval yet -> staleMs", F.staleOf({}) === PF.P.staleMs);
check("stale: Vision at 250 ms/frame -> 750 ms (no lock/blanket flapping)", F.staleOf({ pi: 250 }) === 750);
check("stale: very slow engine capped at staleMaxMs (1 s)", F.staleOf({ pi: 900 }) === PF.P.staleMaxMs && PF.P.staleMaxMs <= 1000);
check("shield measures this camera's pose-frame interval", /s\.poseT = pn; \/\/ pose-frame interval/.test(src));
// 5. iOS: Vision is warmed on the phone before the first camera frame (quicker first lock)
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
check("iOS: Vision detector warmed right after it is created (not awaited)", /pushVisionDet = await window\.ZabbadatVision\.createDetector\(\);\s*if \(window\.ZabPfp && window\.ZabPfp\.warmDetector\) window\.ZabPfp\.warmDetector\(pushVisionDet\);/.test(html));
console.log(`${pass}/${pass + fail} passed`); if (fail) process.exitCode = 1;
// 6. Apple Vision runs on the shield's snapshot (not a second read of the live <video>, which can be a newer frame)
{
  const PV = require("../pose-vision.js");
  check("pfp input(): the snapshot goes to every engine, Vision too", /return b; \/\/ every engine, Apple Vision too/.test(src) && !/engine === "vision" \? vid : b/.test(src));
  let sent = null; const plug = { detect: async (o) => { sent = o; return { keypoints: [{ name: "nose", x: 0.25, y: 0.5, score: 0.9 }] }; } };
  const drawn = []; const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (img, x, y, w, h) => drawn.push([w, h]) }), toDataURL: () => "data:image/jpeg;base64,AAA" }) };
  PV.createDetector({ plugin: plug, doc }).then((d) => d.estimatePoses({ width: 1280, height: 720 }, { flipHorizontal: true })).then((p) => {
    check(`pose-vision on a 1280x720 snapshot canvas: JPEG ${drawn[0]} (aspect kept), nose x ${p[0].keypoints[0].x} (mirrored, canvas px)`, drawn[0][0] === 320 && drawn[0][1] === 180 && p[0].keypoints[0].x === 960 && p[0].keypoints[0].y === 360);
    console.log(`${pass}/${pass + fail} passed`); if (fail) process.exitCode = 1;
  });
}
