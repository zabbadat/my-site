// Face logo centre / size / open sequence (owner, Nov 16). Run: node test/pfp-center.test.js
const PF = require("../pfp.js");
const R = []; const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
const S = 128;
// Where the cover's centre lands for a CSS transform string (transform-origin 0 0): centre of the S x S box.
const centreOf = (tf) => { const m = /translate\(([-\d.e]+)px,([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(tf); const tx = +m[1], ty = +m[2], s = +m[3]; return { x: tx + s * S / 2, y: ty + s * S / 2, r: s * S / 2 }; };
const oldTf = (m) => "translate(" + (m.x - S / 2) + "px," + (m.y - S / 2) + "px) scale(" + ((2 * m.r) / S) + ")";

// 1. Drift: the cover centre lands exactly on the mapped head for every size (old transform: off by r - S/2)
let worstOld = 0, worstNew = 0;
for (const r of [30, 45, 64, 90, 140, 200]) { const m = { x: 200, y: 300, r }; const a = centreOf(PF.coverTransform(m, S)), b = centreOf(oldTf(m));
  worstNew = Math.max(worstNew, Math.hypot(a.x - m.x, a.y - m.y), Math.abs(a.r - r)); worstOld = Math.max(worstOld, Math.hypot(b.x - m.x, b.y - m.y)); }
check(`cover centre on the head for every size: worst offset old ${worstOld.toFixed(1)} px -> new ${worstNew.toFixed(3)} px (< 1 px)`, worstNew < 1 && worstOld > 50);

// 2. Mirror + cover crop, phone portrait (9:16 video in a full-screen 390x844 view, front camera mirrored)
const vw = 720, vh = 1280, bw = 390, bh = 844;
const raw = { nose: [300, 470], left_eye: [330, 450], right_eye: [270, 450], left_ear: [370, 460], right_ear: [230, 460], left_shoulder: [460, 640], right_shoulder: [140, 640] };
const mir = {}; for (const [k, [x, y]] of Object.entries(raw)) mir[k] = [vw - x, y]; // flipHorizontal: true -> display (mirrored) px
const h = PF.headCircle(K(mir), vw, vh), shMid = (mir.left_shoulder[0] + mir.right_shoulder[0]) / 2;
check(`portrait: x on the shoulder midpoint in display px (${h.x.toFixed(2)} vs ${shMid}), zero offset`, Math.abs(h.x - shMid) < 1e-9);
for (const fit of ["cover", "contain", "fill"]) {
  const m = PF.mapToBox(h, vw, vh, bw, bh, fit), want = PF.mapToBox({ x: shMid, y: h.y, r: 1 }, vw, vh, bw, bh, fit), c = centreOf(PF.coverTransform(m, S));
  check(`portrait ${fit}: drawn centre vs shoulder midpoint on screen ${Math.hypot(c.x - want.x, c.y - want.y).toFixed(3)} px (< 1)`, Math.hypot(c.x - want.x, c.y - want.y) < 1);
}
// mirrored display: the user moving to THEIR left moves the logo the same way as their shoulders on screen
const shift = (o, dx) => { const q = {}; for (const [k, [x, y]] of Object.entries(o)) q[k] = [x + dx, y]; return q; };
const h2 = PF.headCircle(K(shift(mir, 40)), vw, vh); check("follows the shoulders 1:1 sideways (no drift)", Math.abs(h2.x - h.x - 40) < 1e-9);

// 3. Coverage: whole head inside with margin, sized from ears / shoulders (~0.96x on the size-sweep front pose, ~1.05x on this portrait fixture)
const w = Math.abs(mir.left_ear[0] - mir.right_ear[0]), earY = 460; // head width = ear to ear
const pts = [mir.nose, mir.left_eye, mir.right_eye, mir.left_ear, mir.right_ear, [h.x, earY - w * PF.P.topUp], [h.x, earY + w * PF.P.chinDn]];
const minMargin = Math.min(...pts.map(([x, y]) => h.r - Math.hypot(x - h.x, y - h.y)));
check(`covers every face point, head top and chin with margin (min margin ${minMargin.toFixed(1)} px >= ${(PF.P.coverPad * w).toFixed(1)} = ${PF.P.coverPad} x ear width)`, minMargin >= PF.P.coverPad * w - 1e-6);
const prop = 2 * h.r / 320; check(`chest-up on the shoulders: logo width ${prop.toFixed(2)} x shoulder width (1.3-2.0; covers head down to the upper chest)`, prop >= 1.3 && prop <= 2.0);
const far = {}; for (const [k, [x, y]] of Object.entries(mir)) far[k] = [360 + (x - 360) * 0.5, 640 + (y - 640) * 0.5];
const hf = PF.headCircle(K(far), vw, vh); check(`scales with distance (half as far -> half the size: ${(hf.r / h.r).toFixed(3)})`, Math.abs(hf.r / h.r - 0.5) < 0.02);

{ const lean = {}; for (const [k, [x, y]] of Object.entries(mir)) lean[k] = /shoulder/.test(k) ? [x, y] : [x + 150, y + 20]; // head leaned far to one side
  const hl = PF.headCircle(K(lean), vw, vh), fpts = ["nose", "left_eye", "right_eye", "left_ear", "right_ear"].map((k) => lean[k]);
  const mm = Math.min(...fpts.map(([x, y]) => hl.r - Math.hypot(x - hl.x, y - hl.y)));
  check(`head leaned 150 px off the shoulders: still on the shoulder midpoint, grows so nose / eyes / ears stay inside (min margin ${mm.toFixed(1)} px >= ${(PF.P.coverPad * w).toFixed(1)})`, Math.abs(hl.x - shMid) < 1e-9 && mm >= PF.P.coverPad * w - 1e-6); }
// 4. Open large -> lock (move + shrink ~250 ms) -> hold on loss (no jump back to the big start)
const tr = PF.createTracker(); const o0 = tr.open(vw, vh, 0);
check(`camera open: big logo at once, centred upper-middle (x ${o0.x}, y ${o0.y}, r ${o0.r})`, o0.x === vw / 2 && Math.abs(o0.y - vh * PF.P.openY) < 1e-9 && o0.r === PF.P.openR * vw && tr.at(10).r === o0.r);
check("no detection yet: step keeps the big start", tr.step([], 30, vw, vh, 30).r === o0.r);
const kp = K(mir); tr.at(100); const c1 = tr.step(kp, 100, vw, vh, 100);
const a0 = tr.at(100), a1 = tr.at(220), a2 = tr.at(100 + PF.P.lockMs + 1);
check(`first lock: centre snaps onto the shoulder midpoint at once (dx ${(a0.x - h.x).toFixed(3)} px, dy ${(a0.y - h.y).toFixed(3)} px), size glides from the opening logo to chest-up (r ${a0.r.toFixed(0)} -> ${a1.r.toFixed(0)} -> ${a2.r.toFixed(0)})`, Math.abs(a0.x - h.x) < 1 && Math.abs(a0.y - h.y) < 1 && Math.abs(a1.x - h.x) < 1 && Math.abs(a0.r - o0.r) < 1 && Math.abs(a2.r - h.r) < 1);
check(`on the chest-up lock (shoulder midpoint, head-to-chest size) within ${PF.P.lockMs} ms (dx ${(a2.x - h.x).toFixed(2)}, dr ${(a2.r - h.r).toFixed(2)})`, Math.abs(a2.x - h.x) < 1 && Math.abs(a2.y - h.y) < 1 && Math.abs(a2.r - h.r) < 1);
for (let t = 400; t < 6000; t += 66) tr.step([], t, vw, vh, t);
const lost = tr.at(6000); check(`lost for 5.6 s: holds the last locked chest-up spot (x ${lost.x.toFixed(0)}, r ${lost.r.toFixed(0)})`, lost && Math.abs(lost.x - h.x) < 2 && Math.abs(lost.y - h.y) < 4 && Math.abs(lost.r - h.r) < Math.max(4, 0.05 * h.r));
tr.reset(); check("camera restart (reset + open): big start again", tr.open(vw, vh, 0).r === o0.r);
const t2 = PF.createTracker(); t2.step(kp, 0, vw, vh, 0); const s0 = t2.at(0);
check("no open (camera already running): first detection draws right on the head (snap)", Math.abs(s0.x - h.x) < 1 && Math.abs(s0.r - h.r) < 1);
// 5. First frames, per frame (noisy landmarks, 15 fps pose, 60 Hz screen): open -> lock, horizontal offset vs the true shoulder midpoint
let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; const gn = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const noisy = (o, n) => K(Object.fromEntries(Object.entries(o).map(([k, [x, y]]) => [k, [x + gn() * n, y + gn() * n]])));
const faceIn = (c, o, pad) => ["nose", "left_eye", "right_eye", "left_ear", "right_ear"].every((k) => c.r - Math.hypot(o[k][0] - c.x, o[k][1] - c.y) >= pad);
for (const [name, pose] of [["front (mirrored)", mir], ["tilted 20 deg", (() => { const q = {}, a = 20 * Math.PI / 180, cx = 420, cy = 640; for (const [k, [x, y]] of Object.entries(mir)) { if (/shoulder/.test(k)) { q[k] = [x, y]; continue; } const dx = x - cx, dy = y - cy; q[k] = [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]; } return q; })()],
  ["turned (3/4)", (() => { const q = Object.assign({}, mir); q.nose = [mir.nose[0] + 45, mir.nose[1]]; q.left_eye = [mir.left_eye[0] + 30, mir.left_eye[1]]; q.right_eye = [mir.right_eye[0] + 30, mir.right_eye[1]]; q.left_ear = [mir.left_ear[0] + 40, mir.left_ear[1]]; return q; })()]]) {
  for (const nz of [0, 2]) {
  const tr = PF.createTracker(), mid = (pose.left_shoulder[0] + pose.right_shoulder[0]) / 2; tr.open(vw, vh, 0); let worst = 0, sum = 0, uncovered = 0, frames = 0, shown = 0, screens = 0;
  for (let t = 0, f = 0; t <= 10 * 66.7 + 1; t += 1000 / 60) {
    screens++; if (t >= f * 66.7) { tr.step(noisy(pose, nz), f * 66.7, vw, vh, t); f++; }
    const c = tr.at(t); if (!c) continue; shown++;
    if (f >= 1) { frames++; worst = Math.max(worst, Math.abs(c.x - mid)); sum += c.x - mid; if (!faceIn(c, pose, 0)) uncovered++; } }
  const bias = sum / frames, lim = nz ? 4.5 : 0.01; // with noise: 3 sigma of the 2-point midpoint (2 px each -> 1.4 px)
  check(`${name}, landmark noise ${nz} px: pose frames 0-10 = ${frames} screen frames after lock, cover on ${shown}/${screens} screen frames; mean offset ${bias.toFixed(3)} px, worst ${worst.toFixed(2)} px; face uncovered on ${uncovered}`, Math.abs(bias) < (nz ? 2 : 0.01) && worst < lim && uncovered === 0 && shown === screens);
  }
}
{ const tr = PF.createTracker(); let sum = 0, n = 0; for (let f = 0; f < 150; f++) { const t = f * 66.7; tr.step(noisy(mir, 2.5), t, vw, vh, t); if (f > 10) { const c = tr.at(t + 30); sum += c.x - h.x; n++; } }
  check(`still for 10 s: no accumulating offset (mean ${(sum / n).toFixed(3)} px)`, Math.abs(sum / n) < 0.5); }
// 6. Size sweep + per-camera gate (front mirrored / rear, 4:3 / 16:9 / portrait; front, tilted +-, turned, leaned head)
const SW = require("./lib/pfp-size-sweep.js");
const rows = [0.8, 0.9, 1.0, 1.1, 1.2].map((k) => SW(k)); rows.forEach((r) => console.log("  size sweep " + JSON.stringify(r)));
const pass = rows.filter((r) => r.minMarginEarW >= PF.P.coverPad - 1e-9 && r.maxOffsetPx < 1e-6 && r.headTopChinIn);
{ const k1 = rows.find((r) => r.k === 1.0), small = pass[0];
  check(`chosen size (k = 1.0: headRW ${PF.P.headRW}, shR ${PF.P.shR}) meets the gate on every camera and is no bigger than the smallest passing scale (k ${small && small.k}: logo ${small && small.logoOverShoulder.join("-")} x shoulders vs chosen ${k1.logoOverShoulder.join("-")})`, !!small && pass.includes(k1) && k1.logoOverShoulder[0] <= small.logoOverShoulder[0] + 1e-9 && k1.logoOverShoulder[1] <= small.logoOverShoulder[1] + 1e-9); }
for (const [name, vw2, vh2, mirr] of SW.cams) { const ps = SW.poses(vw2, vh2, mirr); let worst = 0, mm = Infinity, prop2 = [];
  for (const o of Object.values(ps)) { const c = PF.headCircle(K(o), vw2, vh2), mid = (o.left_shoulder[0] + o.right_shoulder[0]) / 2, ew = Math.hypot(o.left_ear[0] - o.right_ear[0], o.left_ear[1] - o.right_ear[1]);
    worst = Math.max(worst, Math.abs(c.x - mid)); mm = Math.min(mm, Math.min(...["nose", "left_eye", "right_eye", "left_ear", "right_ear"].map((n) => c.r - Math.hypot(o[n][0] - c.x, o[n][1] - c.y))) / ew); prop2.push(2 * c.r / Math.abs(o.left_shoulder[0] - o.right_shoulder[0])); }
  const tr = PF.createTracker(); const o0 = tr.open(vw2, vh2, 0); tr.at(0); tr.step(K(ps.front), 66, vw2, vh2, 66); const f0 = tr.at(66), hc = PF.headCircle(K(ps.front), vw2, vh2);
  check(`${name}: shoulder-midpoint offset ${worst.toFixed(4)} px over front / tilted / turned / leaned; face margin >= ${mm.toFixed(2)} ear widths; logo ${Math.min(...prop2).toFixed(2)}-${Math.max(...prop2).toFixed(2)} x shoulders; big start r ${o0.r.toFixed(0)} -> first-lock centre offset ${Math.abs(f0.x - hc.x).toFixed(3)} px`, worst < 1 && mm >= PF.P.coverPad - 1e-9 && Math.abs(f0.x - hc.x) < 1 && Math.abs(f0.y - hc.y) < 1);
}
const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
