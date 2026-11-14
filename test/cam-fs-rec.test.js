// Auto full screen on start / exit on end, web plank logo pin, Record & Share arm/auto-start/stop and the recording
// watermark placement. Run: node test/cam-fs-rec.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, ".."), html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const RC = require("../rec.js"), PF = require("../pfp.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const fnSrc = (n) => { const i = html.indexOf("function " + n + "("); return html.slice(i, html.indexOf("\n}", i) + 2); };

// 1. camFs (real source) with fake elements
{ const cls = (el) => ({ set: new Set(), toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); }, add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } });
  const mk = (id) => { const e = { id, children: [], appendChild(c) { this.children.push(c); }, querySelector(q) { return this.children.find((c) => q === "." + c.className.split(" ").pop()) || null; } }; e.classList = cls(e); return e; };
  const els = { camWrap: mk("camWrap"), tbCamWrap: mk("tbCamWrap"), plankWrap: mk("plankWrap"), camFsBtn: { textContent: "" } };
  const recLog = [];
  const ctx = { $: (id) => els[id], document: { createElement: () => ({ className: "", type: "", textContent: "" }) }, window: { ZabRec: { onFs: (id, on) => recLog.push(id + ":" + on) } } };
  vm.createContext(ctx); vm.runInContext([fnSrc("camIsFs"), fnSrc("camExitFs"), fnSrc("camFsLabel"), fnSrc("camFs")].join("\n"), ctx);
  ctx.camFs("camWrap", true); check("push/TUT: full screen class on at start, label says Exit", els.camWrap.classList.contains("cam-fs") && els.camFsBtn.textContent === "Exit full screen");
  ctx.camFs("camWrap", false); check("push/TUT: off at end, label back", !els.camWrap.classList.contains("cam-fs") && els.camFsBtn.textContent === "Full screen");
  ctx.camFs("plankWrap", true); const ex = els.plankWrap.children.find((c) => /cam-fs-exit/.test(c.className));
  check("plank: full screen + its own Exit button", els.plankWrap.classList.contains("cam-fs") && ex && ex.textContent === "Exit full screen");
  ex.onclick(); check("plank: Exit button leaves full screen", !els.plankWrap.classList.contains("cam-fs"));
  ctx.camFs("tbCamWrap", true); ctx.camFs("tbCamWrap", false); check("TUT Battle: on/off", !els.tbCamWrap.classList.contains("cam-fs") && els.tbCamWrap.children.length === 1);
  check("camFs tells Record & Share about every enter/exit", recLog.join(",") === "camWrap:true,camWrap:false,plankWrap:true,plankWrap:false,tbCamWrap:true,tbCamWrap:false");
  let threw = false; try { ctx.$ = () => null; ctx.camFs("camWrap", true); } catch (e) { threw = true; } check("camFs never throws (missing element)", !threw); }
// call sites: start and end of every camera exercise
const has = (re, n) => check(n, re.test(html));
has(/\$\("camWrap"\)\.hidden = false;\n\s+if \(typeof camFs === "function"\) camFs\("camWrap", true\); \/\/ full screen at once\n/, "push/TUT browser: full screen when the camera opens");
has(/\$\("camWrap"\)\.hidden = false;\n\s+if \(typeof camFs === "function"\) camFs\("camWrap", true\); \/\/ full screen at once \(app\)/, "push/TUT app: full screen when the camera opens");
has(/pushStarting = true; \$\("pushStartBtn"\)\.disabled = true;\n\s+if \(camOn && typeof camFs === "function"\) camFs\("camWrap", true\);/, "push/TUT next set with the camera already on: full screen at Start");
{ const fin = fnSrc("finishPushSet"); check("push/TUT: set end (finishPushSet) leaves full screen", /camFs\("camWrap", false\)/.test(fin)); }
has(/pushState\.running = false; pushState\.finished = true;\n\s+if \(typeof camFs === "function"\) camFs\("camWrap", false\);/, "push/TUT: failed set end leaves full screen");
check("push/TUT: Stop camera leaves full screen (camExitFs)", /camExitFs\(\);/.test(fnSrc("stopCam")));
check("TUT Battle: full screen at Go (tbGoLive), off when the camera turns off", /camFs\("tbCamWrap", true\)/.test(fnSrc("tbGoLive")) && /camFs\("tbCamWrap", false\)/.test(fnSrc("tbCamOff")));
check("web plank: full screen when the camera shows, off at hold end and on stop", (html.match(/\$\("plankWrap"\)\.hidden = false; if \(typeof camFs === "function"\) camFs\("plankWrap", true\);/g) || []).length === 2 && /camFs\("plankWrap", false\)/.test(fnSrc("plankEnded")) && /camFs\("plankWrap", false\)/.test(fnSrc("stopPlankCam")));
check("countdown / counter untouched: camFs is never called from poseTick or the counter", !/camFs/.test(html.slice(html.indexOf("async function poseTick("), html.indexOf("async function openCam()"))));

// 2. plank pin (pfp.js, fake DOM)
{ const store = { zabPfpOn: "1" }, calls = []; const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => { calls.push(k); return { addColorStop() {} }; }), set: (t, k, v) => ((t[k] = v), true) });
  const mk = () => ({ style: {}, children: [], classList: { add() {}, remove() {} }, setAttribute() {}, appendChild(c) { this.children.push(c); c.parentNode = this; }, insertBefore(c) { this.children.push(c); c.parentNode = this; }, getContext: () => ctx2d });
  const parent = mk(), vid = { id: "plankVid", parentNode: parent, clientWidth: 390, clientHeight: 292, offsetLeft: 0, offsetTop: 0, videoWidth: 640, videoHeight: 480 };
  const w = { document: { readyState: "complete", getElementById: () => null, createElement: mk, addEventListener() {} }, localStorage: { getItem: (k) => store[k] || null, setItem() {} }, getComputedStyle: () => ({ objectFit: "fill" }), Image: function () {}, setTimeout, clearTimeout, Date, Math };
  const ctx = Object.assign({}, w); ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, "pfp.js"), "utf8"), ctx); const P = ctx.ZabPfp; P.setUser({ uid: "u" });
  const side = (dx) => [{ name: "left_shoulder", x: 200 + dx, y: 250, score: 0.9 }, { name: "left_hip", x: 380 + dx, y: 270, score: 0.9 }, { name: "left_ankle", x: 590, y: 300, score: 0.9 }];
  P.plankFrame(vid, side(0), "ready", 0); check("plank getting set: no pin yet", P._pin("plankVid") === null);
  P.plankFrame(vid, side(0), "holding", 40); const pin = P._pin("plankVid");
  check(`plank hold start: logo pinned at the head past the shoulder on the hip->shoulder line (x ${pin && pin.x.toFixed(0)}, y ${pin && pin.y.toFixed(0)}, r ${pin && pin.r.toFixed(0)})`, pin && Math.abs(pin.x - (200 - 180 * 0.45)) < 1e-6 && Math.abs(pin.y - (250 - 20 * 0.45)) < 1e-6 && Math.abs(pin.r - Math.hypot(180, 20) * 0.25) < 1e-6);
  for (let t = 80; t < 2000; t += 40) P.plankFrame(vid, side(30 * Math.sin(t / 200)), "holding", t);
  const p2 = P._pin("plankVid"); check("plank hold: the pin stays fixed while the body sways", p2 && p2.x === pin.x && p2.y === pin.y && p2.r === pin.r);
  P.plankFrame(vid, side(0), "ended", 2100); check("plank hold over: pin released", P._pin("plankVid") === null);
  const face = [{ name: "nose", x: 150, y: 230, score: 0.9 }, { name: "left_eye", x: 160, y: 220, score: 0.9 }, { name: "left_ear", x: 185, y: 225, score: 0.9 }].concat(side(0));
  P.plankFrame(vid, face, "holding", 2200); const pf = P._pin("plankVid"); check("plank: a visible face cluster wins for the pin", pf && Math.abs(pf.x - 165) < 1 && pf.r >= 10);
  let threw = false; try { P.plankFrame(vid, null, "holding", 2300); P.plankFrame(null, face, "holding", 2400); } catch (e) { threw = true; } check("plankFrame never throws", !threw);
  has(/plankHold\.update\([^\n]*\n\s+if \(window\.ZabPfp\) window\.ZabPfp\.plankFrame\(vid, poses && poses\[0\] \? poses\[0\]\.keypoints : \[\], r && r\.phase, tFrame\);/, "plankTick feeds the pin after plankHold.update with the same keypoints"); }

// 3. Record & Share controller
{ const log = []; const io = { start: (id) => { log.push("start:" + id); return true; }, stop: (id) => log.push("stop:" + id), paint() {} };
  let c = RC.createCtl(io);
  check("tap Record before the camera: armed, nothing recording yet", c.tap("camWrap") === "armed" && c.state().armed.camWrap === true && log.length === 0);
  check("camera goes full screen: recording starts by itself", c.onFs("camWrap", true) === "recording" && log.join() === "start:camWrap" && c.state().recording === "camWrap");
  check("set ends (full screen off): recording stops (preview opens), arm resets", c.onFs("camWrap", false) === "stopped" && log.join() === "start:camWrap,stop:camWrap" && c.state().armed.camWrap === false && c.state().recording === null);
  check("next set without re-arming: no recording", c.onFs("camWrap", true) === "" && log.length === 2);
  c.onFs("camWrap", false);
  check("tap twice: disarmed, then full screen does not record", c.tap("plankWrap") === "armed" && c.tap("plankWrap") === "disarmed" && c.onFs("plankWrap", true) === "" && log.length === 2);
  c.tap("tbCamWrap"); c.onFs("tbCamWrap", true); check("tap Record while recording: stops it", c.tap("tbCamWrap") === "stopped" && log.slice(-1)[0] === "stop:tbCamWrap" && c.state().armed.tbCamWrap === false);
  c.tap("camWrap"); c.onFs("camWrap", true); check("in-frame Stop recording button: stops it", c.stopNow() === "stopped" && c.state().recording === null && c.onFs("camWrap", false) === "");
  check("other exercise's full screen does not start an armed recording", (c.tap("plankWrap"), c.onFs("camWrap", true)) === "" && c.state().recording === null);
  const bad = RC.createCtl({ start: () => { throw new Error("no recorder"); }, stop() {}, paint() {} }); bad.tap("camWrap");
  check("recorder failure: no throw, disarmed, exercise goes on", bad.onFs("camWrap", true) === "failed" && bad.state().armed.camWrap === false);
  const io2 = Object.assign({}, io, { isFs: () => true }); const c2 = RC.createCtl(io2); check("arming while already full screen starts at once", c2.tap("camWrap") === "recording");
  check("Record buttons sit right before each start control, hidden until supported", /data-rec="camWrap" hidden[^\n]*<\/button>\n\s+<button class="btn" id="pushStartBtn"/.test(html) && /data-rec="tbCamWrap" hidden[^>]*>[^\n]*?<\/button><button class="btn ghost" id="tbCam"/.test(html) && /data-rec="plankWrap" hidden[^\n]*<\/button>\n\s+<button class="btn" id="plankCamBtn"/.test(html));
  check("rec.js loaded; no upload in it", html.includes('<script src="/rec.js"></script>') && !/fetch\(|XMLHttpRequest|firestore|sendBeacon/.test(fs.readFileSync(path.join(ROOT, "rec.js"), "utf8"))); }

// 4. watermark placement + collision
{ const b = RC.wmBox(720, 540, "right"), l = RC.wmBox(720, 540, "left");
  check(`watermark bottom-right, mark ~6% of width (${b.mark}px), inside a margin`, b.mark === Math.round(720 * 0.06) && b.x + b.w <= 720 - 25 && b.y + b.h <= 540 - 25 && b.y > 540 * 0.12);
  check("left box mirrors the right one", l.x === Math.round(720 * 0.035) && l.y === b.y && l.w === b.w);
  check("circle-rect hit test", RC.circleHitsRect({ x: b.x + 5, y: b.y + 5, r: 3 }, b) && !RC.circleHitsRect({ x: 100, y: 100, r: 40 }, b) && RC.circleHitsRect({ x: b.x - 20, y: b.y + 10, r: 25 }, b) && !RC.circleHitsRect(null, b));
  const pl = RC.createWmPlacer(), far = { x: 360, y: 150, r: 60 }, near = { x: b.x + b.w / 2, y: b.y, r: 50 };
  check("head far away: stays bottom-right", pl.step(far, 720, 540, 0).side === "right");
  check("head/logo touches it: hops to bottom-left at once", pl.step(near, 720, 540, 33).side === "left");
  const seq = []; let t = 66; for (; t < 66 + 400; t += 33) seq.push(pl.step(far, 720, 540, t).side);
  check("clear for < 0.5 s: stays left (no flicker)", seq.every((s) => s === "left"));
  pl.step(near, 720, 540, t); t += 33; const s2 = []; for (let k = 0; k < 10; k++, t += 33) s2.push(pl.step(far, 720, 540, t).side);
  check("a touch resets the 0.5 s clear timer", s2.every((s) => s === "left"));
  for (let k = 0; k < 10; k++, t += 33) pl.step(far, 720, 540, t);
  check("clear for 0.5 s: back to bottom-right", pl.step(far, 720, 540, t).side === "right");
  check("no head: bottom-right", RC.createWmPlacer().step(null, 720, 540, 0).side === "right"); }
const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
