// PFP quicker follow (Nov 16): the head spot is predicted for any moment (tracker.at) and redrawn every screen refresh
// between pose frames; steady at rest; lead bounded; snaps back onto a returning face; the Live Match avatar uses the
// same tracker. Visual only. Run: node test/pfp-refresh.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const PF = require("../pfp.js"), CAM = require("../match-pfp-cam.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, s = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score: s }));
const F = (x, y = 200) => K({ nose: [x, y + 10], left_eye: [x - 20, y], right_eye: [x + 20, y], left_ear: [x - 40, y + 8], right_ear: [x + 40, y + 8] });

// 1. at(now): between pose frames the spot keeps moving with the head, bounded, and stays put at rest
{ const tr = PF.createTracker(); let t = 0, c; for (; t <= 1000; t += 66) c = tr.step(F(200 + t * 0.3), t, 640, 480, t + 50); // 300 px/s
  t -= 66; const a0 = tr.at(t + 50), a1 = tr.at(t + 100);
  check(`at(): same spot as step() at its draw time (${a0.x.toFixed(1)} vs ${c.x.toFixed(1)})`, Math.abs(a0.x - c.x) < 1e-9);
  check(`at(): keeps moving ahead between pose frames (+${(a1.x - a0.x).toFixed(1)} px in 50 ms)`, a1.x > a0.x + 3);
  const far = tr.at(t + 10000), cap = PF.P.leadCap * far.r;
  check(`at(): never more than leadCap x r ahead of the filtered spot, even long after the last frame (${(far.x - tr.at(t).x).toFixed(1)} <= ${cap.toFixed(1)} px)`, far.x - tr.at(t).x <= cap + 1e-6 && far.x === tr.at(t + PF.P.leadMax + 5000).x); }
{ const tr = PF.createTracker(); let sd = 3; const n = () => ((sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 4;
  let t = 0; for (; t < 3000; t += 66) tr.step(K({ nose: [320 + n(), 210 + n()], left_eye: [300 + n(), 200 + n()], right_eye: [340 + n(), 200 + n()], left_ear: [280 + n(), 208], right_ear: [360 + n(), 208] }), t, 640, 480, t + 50);
  t -= 66; const p = tr.at(t + 50), q = tr.at(t + 116);
  check(`at rest with keypoint noise: no drift between frames (${Math.hypot(q.x - p.x, q.y - p.y).toFixed(2)} px)`, Math.hypot(q.x - p.x, q.y - p.y) < 0.5); }
{ const tr = PF.createTracker(); tr.step(F(320), 0, 640, 480, 50); tr.step(F(320), 66, 640, 480, 116); const h = tr.step([], 132, 640, 480, 182);
  check("at(): face missing -> the held (enlarged) spot, not a prediction", h && h.held && tr.at(300) === h);
  tr.step([], 1300, 640, 480, 1350); check("at(): after the hold runs out -> nothing", tr.at(1400) === null);
  check("at(): fresh tracker -> nothing", PF.createTracker().at(0) === null); }
// 2. lead stops the moment the head stops (no fling past it)
{ const tr = PF.createTracker(); let t = 0; for (; t <= 600; t += 66) tr.step(F(200 + t * 0.5), t, 640, 480, t + 50); const stopX = 200 + (t - 66) * 0.5;
  for (let i = 0; i < 3; i++, t += 66) tr.step(F(stopX), t, 640, 480, t + 50); const s = tr.at(t + 40);
  check(`head stopped: drawn spot settles on it (${(s.x - stopX).toFixed(1)} px off)`, Math.abs(s.x - stopX) < 4); }
// 3. reacquire: face back after a gap -> snaps straight onto it
{ const tr = PF.createTracker(); tr.step(F(200), 0, 640, 480, 50); tr.step(F(200), 66, 640, 480, 116);
  for (let t = 132; t < 600; t += 66) tr.step([], t, 640, 480, t + 50); const b = tr.step(F(480), 600, 640, 480, 650), b2 = tr.at(700);
  check(`face back after ${PF.P.snapMs}+ ms: snaps onto it (${b.x.toFixed(1)} vs 480), no fling (${b2.x.toFixed(1)})`, Math.abs(b.x - 480) < 1 && Math.abs(b2.x - 480) < 1); }

// 4. browser: rAF redraws between pose frames, stops when the switch goes off / frames stop
{ const store = {}, calls = [], q = []; let now = 0;
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(k); return { addColorStop() {} }; }), set: (t, k, v) => ((t[k] = v), true) });
  const mk = (tag) => ({ tag, style: {}, children: [], className: "", classList: { add() {}, remove() {} }, setAttribute() {}, appendChild(c) { this.children.push(c); c.parentNode = this; }, insertBefore(c) { this.children.push(c); c.parentNode = this; }, removeChild() {}, getContext: () => ctx2d, querySelector: () => null });
  const parent = mk("div"), vid = { id: "camVid", parentNode: parent, nextSibling: null, clientWidth: 320, clientHeight: 240, offsetLeft: 0, offsetTop: 0, videoWidth: 640, videoHeight: 480 };
  const w = { document: { readyState: "complete", getElementById: () => null, createElement: mk, addEventListener() {} }, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } },
    getComputedStyle: () => ({ objectFit: "fill" }), devicePixelRatio: 1, Image: function () {}, setTimeout: () => 0, clearTimeout() {}, Date, Math, performance: { now: () => now }, requestAnimationFrame: (f) => { q.push(f); return q.length; } };
  const ctx = Object.assign({}, w); ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8"), ctx); const P = ctx.ZabPfp;
  P.setUser({ uid: "u1", displayName: "Zab" }); P.setOn(true);
  const flush = (ms) => { now += ms; const f = q.splice(0); f.forEach((g) => g()); };
  let t = 0; for (; t < 600; t += 66) { now = t + 40; P.frame(vid, F(200 + t * 0.4), t); }
  check("one rAF loop per camera (not one per pose frame)", q.length === 1);
  calls.length = 0; const h0 = P.lastHead("camVid", now).x; flush(16); flush(16); const h1 = P.lastHead("camVid", now).x;
  check(`between pose frames: redrawn every refresh (${calls.filter((c) => c === "arc").length / 2} draws in 2 refreshes) and moving (+${(h1 - h0).toFixed(1)} px)`, calls.filter((c) => c === "arc").length >= 4 && h1 > h0);
  P.setOn(false); flush(16); check("switch off: the refresh loop stops", q.length === 0);
  P.setOn(true); now = t + 40; P.frame(vid, F(200), t); check("switch on again: loop restarts with the next pose frame", q.length === 1);
  now += 2000; flush(16); check("pose frames stop (camera off): the refresh loop stops by itself", q.length === 0);
  const pf = Object.assign({}, vid, { id: "plankVid" }); now = 5040; P.plankFrame(pf, F(300), null, 5000); check("plank camera: same refresh loop", q.length === 1); }

// 5. Live Match avatar: same quick tracker by default (old lerp only when alpha is passed)
{ const fl = CAM.createFloater(), a = CAM.floatAnchor(F(320), 640, 480), b = CAM.floatAnchor(F(420), 640, 480);
  fl.step(F(320), 0, 640, 480); const s = fl.step(F(420), 66, 640, 480);
  check(`Live Match: follows a 100 px move in one frame (${(s.x - a.x).toFixed(0)} of ${(b.x - a.x).toFixed(0)} px; old lerp 45), above the head`, s.x - a.x > 85 && s.x <= b.x + 1 && s.y < 200);
  check("Live Match: at() between pose frames + hold then hide", typeof fl.at === "function" && fl.at(120) && fl.step([], 500, 640, 480).held && fl.step([], 1200, 640, 480) == null);
  const src = fs.readFileSync(path.join(ROOT, "match-pfp-cam.js"), "utf8");
  check("Live Match: frame stamped before inference, redrawn each refresh", /var t = perfNow\(\);[^\n]*\n\s+var poses = await/.test(src) && /paintLoop\(id\)/.test(src)); }

const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
