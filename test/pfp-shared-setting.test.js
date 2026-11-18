// ONE shared PFP setting (pfp.js KEY "zabPfpOn", this device): ON = avatar on camera + head tracking that moves it + avatar in
// recordings; OFF = all three off with no leftover canvas, frozen picture, timers or head spot. Watermark stays either way.
// Live switching mid-camera and mid-recording. Rep counting never depends on it (see pfp.test.js / pfp-vision.test.js runs).
// Run: node test/pfp-shared-setting.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, ".."), RC = require("../rec.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const store = { zabPfpOn: "1" }, calls = [];
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, a[0]]); return { addColorStop() {} }; }), set: (t, k, v) => ((t[k] = v), true) });
const mk = () => ({ style: {}, children: [], width: 0, height: 0, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild(c) { this.children.push(c); c.parentNode = this; }, insertBefore(c) { this.children.push(c); c.parentNode = this; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }, getContext: () => ctx2d });
const parent = mk(), vid = { id: "camVid", parentNode: parent, clientWidth: 390, clientHeight: 292, offsetLeft: 0, offsetTop: 0, videoWidth: 640, videoHeight: 480 };
const timers = new Set();
const sT = (f, ms) => { const h = setTimeout(() => { timers.delete(h); f(); }, ms); timers.add(h); return h; };
const cT = (h) => { timers.delete(h); clearTimeout(h); };
const w = { document: { readyState: "complete", getElementById: (id) => (id === "camVid" ? vid : null), createElement: mk, addEventListener() {} },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  getComputedStyle: () => ({ objectFit: "fill" }), Image: function () {}, setTimeout: sT, clearTimeout: cT, Date, Math, performance: { now: () => 1000 } };
const ctx = Object.assign({}, w); ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "rec.js"), "utf8"), ctx);
const P = ctx.ZabPfp, REC = ctx.ZabRec || ctx.ZabbadatRec || null;
const paintFrame = (REC && REC.paintFrame) || (Object.values(ctx).find((v) => v && typeof v.paintFrame === "function") || {}).paintFrame;
P.setUser({ uid: "u" });
const face = [{ name: "nose", x: 320, y: 200, score: 0.9 }, { name: "left_eye", x: 300, y: 185, score: 0.9 }, { name: "right_eye", x: 340, y: 185, score: 0.9 }, { name: "left_ear", x: 280, y: 195, score: 0.9 }, { name: "right_ear", x: 360, y: 195, score: 0.9 }, { name: "left_shoulder", x: 240, y: 300, score: 0.9 }, { name: "right_shoulder", x: 400, y: 300, score: 0.9 }];
const cover = () => parent.children.find((c) => c.className === "pfp-cover");
const rec = { id: "camWrap", vid, cv: { width: 640, height: 480 }, x: ctx2d, placer: RC.createWmPlacer() };
const recFrame = (t) => { calls.length = 0; paintFrame(rec, t); return { logo: calls.some((c) => c[0] === "clip"), wm: calls.some((c) => c[0] === "fillText" && c[1] === "Zabbadat"), pix: calls.some((c) => c[0] === "drawImage" && c[1] && c[1].width === 16) }; };
check("rec.js paintFrame reachable for the recording checks", typeof paintFrame === "function");

// ON: all three together
P.frame(vid, face, 0); P.frame(vid, face, 33);
check("ON: avatar drawn over the head on camera", cover() && cover().style.display === "block");
check("ON: head tracking runs (head spot available)", !!P.lastHead("camVid", 33));
let f = recFrame(40);
check("ON: recording frame includes the avatar and the watermark", f.logo && f.wm && !f.pix);

// OFF mid-camera and mid-recording (top-bar or Show my PFP: same setting)
P.setOn(false);
check("OFF: stored on this device", store.zabPfpOn === "0" && P.isOn() === false);
check("OFF: overlay cleared and hidden, no pending clear timers", cover().style.display === "none" && timers.size === 0);
P.frame(vid, face, 66); P.frame(vid, face, 99);
check("OFF: new frames draw no avatar and leave no timers", cover().style.display === "none" && timers.size === 0);
check("OFF: head tracking for the avatar skipped (no head spot)", P.lastHead("camVid", 99) === null);
f = recFrame(120);
check("OFF mid-recording: no avatar and no pixelation, plain video; watermark still recorded", !f.logo && !f.pix && f.wm);
P.plankFrame(vid, face, "holding", 130);
check("OFF: plank head not tracked", P.lastHead("camVid", 130) === null && timers.size === 0);

// ON again mid-recording
P.setOn(true);
f = recFrame(140);
check("ON mid-recording before the head is found: live frame + large opening logo (never a plain face, never a dark full frame); watermark kept", f.logo && !f.pix && f.wm);
P.frame(vid, face, 150);
f = recFrame(160);
check("ON mid-recording once tracked: avatar back in the recording", f.logo && f.wm && !f.pix);
check("ON: avatar back on camera", cover().style.display === "block");
P.setOn(false); check("final OFF: no timers left", timers.size === 0);
const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
