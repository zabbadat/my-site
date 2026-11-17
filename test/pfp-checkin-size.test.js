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
vm.runInContext(["enclose", "blanketLogo", "blanketAround", "staleOf", "lerpC", "ease"].map(pick).join("\n") + "\nthis.f = { enclose, blanketLogo, blanketAround, staleOf, lerpC, ease };", ctx);
const F = ctx.f;
const boxes = [[390, 791], [390, 293], [844, 390], [360, 640], [1280, 720], [358, 269]];
// 1. size: check-in logo diameter well under the short side (old: 2.27x on a phone), centred upper-middle
for (const [bw, bh] of boxes) { const c = F.blanketLogo({ bw, bh }), s = Math.min(bw, bh), old = Math.hypot(bw, bh) / 2 + 2;
  check(`${bw}x${bh}: check-in logo ${(2 * c.r).toFixed(0)} px = ${(2 * c.r / s).toFixed(2)}x short side (was ${(2 * old / s).toFixed(2)}x), inside the box`, 2 * c.r <= 0.45 * s && c.x - c.r >= 0 && c.x + c.r <= bw && c.y - c.r >= 0 && c.y + c.r <= bh); }
check("overlay cover is hidden while the shield draws the camera (the check-in logo is the shield's)", /if \(!m \|\| shields\[o\.vid\.id\]\) \{ o\.cv\.style\.display = "none"; return false; \}/.test(src));
// 2. zero exposure: every intermediate circle of the shrink (check-in -> head) and of the grow (head -> check-in) contains the head
let worst = Infinity, worstG = Infinity;
for (let i = 0; i < 3000; i++) { const [bw, bh] = boxes[i % boxes.length], g = { bw, bh }, t = { x: Math.random() * bw, y: Math.random() * bh, r: 8 + Math.random() * 0.5 * Math.min(bw, bh) };
  const B = F.blanketAround(g, t);
  for (let p = 0; p <= 1.0001; p += 0.02) { const e = F.ease(p), m = F.lerpC(B, t, e), m2 = F.lerpC(t, B, e);
    worst = Math.min(worst, m.r - (Math.hypot(m.x - t.x, m.y - t.y) + t.r)); worstG = Math.min(worstG, m2.r - (Math.hypot(m2.x - t.x, m2.y - t.y) + t.r)); } }
check(`shrink check-in -> head: every step contains the head circle (worst slack ${worst.toFixed(6)} px >= 0)`, worst >= -1e-6);
check(`grow head -> check-in on loss: every step contains the last head circle (worst slack ${worstG.toFixed(6)} px >= 0)`, worstG >= -1e-6);
const g0 = { bw: 390, bh: 791 }, near = { x: 195, y: 280, r: 40 }, Bn = F.blanketAround(g0, near);
check(`lock starts from about the check-in size, not a full-screen disc (start r ${Bn.r.toFixed(0)} px vs old ${(Math.hypot(390, 791) / 2 + 2).toFixed(0)})`, Bn.r < 0.3 * 390);
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
