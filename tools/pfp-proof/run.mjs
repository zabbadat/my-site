#!/usr/bin/env node
// PFP face-exposure proof (frame by frame). With the profile-logo (PFP) switch ON, no displayed frame may show any face pixel.
// A fake camera plays a clip with a bright-green "face"; the pose model's output is replaced by keypoints measured from that
// green face in the model's own input frame (a perfect detector, real model latency). Every displayed frame is checked two ways:
//   1. screencast: the browser's real composited output (Chrome DevTools Page.startScreencast), every frame;
//   2. readback: after each repaint, every visible camera <video> and every PFP canvas is read back pixel by pixel.
// Screencast scans ONLY the on-screen camera area (the camera <video> / shield canvas rect plus its cover), still
// with a strict zero-pixel rule and the same green test as readback. Readback is unchanged. Page UI outside the
// camera (lime buttons, game art) is not scanned.
// Any frame with green face pixels = EXPOSED. Exit code 1 on any exposed frame, unproven scenario or error.
//
//   npm run pfp-proof                 full matrix (~25-35 min)
//   npm run pfp-proof:quick           short matrix (~5-7 min)
//   npm run pfp-proof -- --control    negative control: forces the raw video visible -> must FAIL (proves the checker works)
//   options: --only=push,match  --base=https://...  (test another server instead of this repo)  --headed  --keep
import { createRequire } from "module";
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const ARG = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const QUICK = !!ARG.quick, CONTROL = !!ARG.control;
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { console.error("Playwright is not installed. Run: npm install && npx playwright install chromium"); process.exit(2); }
const makeY4m = require("./make-face-y4m.js"), serve = require("./serve.js");
const KPS = JSON.parse(fs.readFileSync(path.join(HERE, "push-top-kps.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CACHE = process.env.PFP_PROOF_DIR || path.join(os.tmpdir(), "zab-pfp-proof"); // fake camera clips (reused)
const OUT = path.join(CACHE, "run-" + new Date().toISOString().replace(/[:.]/g, "-")); // this run's report, screenshots and exposed frames
const SURFACES = ["push", "plank", "squats", "tut", "zlSelf", "match"];
const VID = { push: "camVid", plank: "plankVid", squats: "sqVid", tut: "tbVid", zlSelf: "zlSelf", match: "zmCamVid" };
const only = ARG.only ? String(ARG.only).split(",") : null, want = (s) => !only || only.includes(s);

// ---------- in-page hooks (run before any page script) ----------
function hooks() {
  try { localStorage.setItem("zabPfpOn", "1"); } catch (e) {}
  // a signed-in test user all along (signed out = PFP off by design)
  let zp; Object.defineProperty(window, "ZabPfp", { configurable: true, get: () => zp, set(v) { zp = v; if (v && v.setUser && !v.setUser.__w) { const su = v.setUser; v.setUser = (u) => su(u && u.uid ? u : { uid: "proof", displayName: "Proof" }); v.setUser.__w = 1; } } });
  window.__mode = "normal"; window.__seg = "open"; window.__ex = {}; window.__fr = {}; window.__stage = {}; window.__exList = [];
  const sample = (img, flip) => { // keypoints from the green face in the model's input (the same pixels the model sees)
    const w = img.videoWidth || img.width, h = img.videoHeight || img.height; if (!(w > 0)) return null;
    const k = 4, c = sample.c || (sample.c = document.createElement("canvas")); c.width = Math.ceil(w / k); c.height = Math.ceil(h / k);
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height); const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0, sx = 0, sy = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 180 && d[i] < 90 && d[i + 2] < 90) { const p = i / 4; sx += p % c.width; sy += Math.floor(p / c.width); n++; }
    if (n < 4) return null; const cx = (sx / n) * k + k / 2, cy = (sy / n) * k + k / 2, F = (X) => (flip ? w - X : X);
    const s = window.__mode === "lowconf" ? 0.1 : 0.9, P = (name, X, Y, sc = s) => ({ name, x: F(X), y: Y, score: sc });
    const kp = [P("nose", cx, cy), P("left_eye", cx - 14, cy - 12), P("right_eye", cx + 14, cy - 12), P("left_ear", cx - 30, cy - 5), P("right_ear", cx + 30, cy - 5),
      P("left_shoulder", cx - 75, cy + 95, 0.9), P("right_shoulder", cx + 75, cy + 95, 0.9), P("left_elbow", cx - 95, cy + 170, 0.9), P("right_elbow", cx + 95, cy + 170, 0.9),
      P("left_wrist", cx - 100, cy + 240, 0.9), P("right_wrist", cx + 100, cy + 240, 0.9), P("left_hip", cx - 55, cy + 260, 0.9), P("right_hip", cx + 55, cy + 260, 0.9),
      P("left_knee", cx - 55, cy + 380, 0.9), P("right_knee", cx + 55, cy + 380, 0.9), P("left_ankle", cx - 55, cy + 480, 0.9), P("right_ankle", cx + 55, cy + 480, 0.9)];
    if (window.__body) { // push-up / plank surfaces: a recorded top-of-push-up body, moved so its nose sits on the green face
      const T = window.__body[(sample.i = (sample.i || 0) + 1) % window.__body.length], tn = T.find((q) => q.name === "nose"), dx = F(cx) - tn.x, dy = cy - tn.y;
      const out = T.filter((q) => !/nose|eye|ear/.test(q.name)).map((q) => ({ name: q.name, x: q.x + dx, y: q.y + dy, score: q.score == null ? 0.9 : q.score }));
      const kf = kp.slice(0, 5); if (window.__mode === "noface") for (const q of kf) q.score = 0.05; return kf.concat(out);
    }
    if (window.__mode === "noface") for (let i = 0; i < 5; i++) kp[i].score = 0.05;
    return kp;
  };
  let pd; Object.defineProperty(window, "poseDetection", { configurable: true, set(v) { pd = v; }, get() {
    if (pd && pd.createDetector && !pd.createDetector.__w) { const cd = pd.createDetector.bind(pd); const w = async (...a) => { const d = await cd(...a); const ep = d.estimatePoses.bind(d);
      d.estimatePoses = async (img, cfg) => { const kp = sample(img, cfg && cfg.flipHorizontal); await ep(img, cfg); while (window.__mode === "stall") await new Promise((r) => setTimeout(r, 50));
        return window.__mode === "lost" || !kp ? [] : [{ keypoints: kp, score: 0.9 }]; }; return d; }; w.__w = 1; pd.createDetector = w; }
    return pd; } });
  // readback after every repaint: rAF -> message (runs after the frame is painted, before the next one)
  const GREEN = (d, i) => d[i + 1] > 180 && d[i] < 90 && d[i + 2] < 90; // exact test-face green only (#00ff00 and its edge); plank guide (54,153,99) does not match
  const cnt = (cv, w, h) => { const d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (GREEN(d, i)) n++; return n; };
  const vc = document.createElement("canvas"), ch = new MessageChannel();
  ch.port1.onmessage = () => { try {
    const seg = window.__seg; window.__fr[seg] = (window.__fr[seg] || 0) + 1; window.__fi = (window.__fi || 0) + 1; let bad = 0; const src = [];
    for (const v of document.querySelectorAll("video")) { if (!v.srcObject || !(v.videoWidth > 0)) continue; const r = v.getBoundingClientRect(), op = parseFloat(getComputedStyle(v).opacity);
      if (r.width > 0 && op > 0.01 && (!v.checkVisibility || v.checkVisibility())) { vc.width = Math.ceil(v.videoWidth / 4); vc.height = Math.ceil(v.videoHeight / 4); vc.getContext("2d").drawImage(v, 0, 0, vc.width, vc.height); const n = cnt(vc, vc.width, vc.height); if (n) { bad += n; src.push("video#" + v.id + ":" + n); } } }
    for (const c of document.querySelectorAll("canvas.pfp-shield, canvas.pfp-mini")) { if (getComputedStyle(c).display === "none" || !c.width) continue; const n = cnt(c, c.width, c.height); if (n) { bad += n; src.push(c.className + ":" + n); } }
    if (bad) { window.__ex[seg] = (window.__ex[seg] || 0) + 1; window.__exList.push({ seg, frame: window.__fi, tMs: +performance.now().toFixed(1), pixels: src.join(",") }); }
    const S = window.ZabPfp && window.ZabPfp._shields; if (S) for (const k in S) { (window.__seen || (window.__seen = {}))[k] = 1; const s = S[k], now = performance.now(), st = s.lockT ? (now - s.lockT < 280 ? "shrink" : "locked") : (s.lostT && now - s.lostT < 160 ? "grow" : "cover"); window.__stage[st] = (window.__stage[st] || 0) + 1; }
    // camera/video area for the screencast check (video + cover/shield), timestamped so each composited frame can use the matching rect
    const boxes = []; const add = (el) => { if (!el) return; const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) boxes.push({ x: r.x, y: r.y, w: r.width, h: r.height }); };
    for (const v of document.querySelectorAll("video")) if (v.srcObject || (v.videoWidth > 0) || v.id) add(v);
    for (const c of document.querySelectorAll("canvas.pfp-shield, canvas.pfp-cover, canvas.pfp-mini")) add(c);
    (window.__camAreas || (window.__camAreas = [])).push({ t: Date.now(), boxes });
  } catch (e) { window.__probeErr = String(e); } };
  const loop = () => { ch.port2.postMessage(0); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
}
// Negative control (PROOF ONLY — must never ship in the site). Bypass the fail-safe shield in this hook only: force every
// camera video visible (raw green face) and hide the logo canvases. The site's hide rule is html.zab-pfp-shield video#id
// {opacity:0!important}, which beats a generic video[id] rule, and pfp.js re-adds the class; so this hook uses the same
// id-level selectors (and inline !important styles) and wins even while the class stays on. The checker must then FAIL
// on both readback and the camera-area screencast.
function controlHook() {
  const IDS = ["camVid", "plankVid", "tbVid", "sqVid", "zlSelf", "zmCamVid"];
  const vis = IDS.flatMap((id) => [`html.zab-pfp-shield video#${id}`, `html video#${id}`]).join(",");
  const st = document.createElement("style"); st.setAttribute("data-pfp-proof-control", "1");
  st.textContent = vis + "{opacity:1!important;visibility:visible!important;display:block!important;z-index:2147483647!important}" +
    "canvas.pfp-shield,canvas.pfp-cover,canvas.pfp-mini{display:none!important;opacity:0!important;visibility:hidden!important}";
  const put = () => {
    const h = document.head || document.documentElement; if (h && !st.isConnected) h.appendChild(st);
    for (const id of IDS) { const v = document.getElementById(id); if (!v) continue;
      v.style.setProperty("opacity", "1", "important"); v.style.setProperty("visibility", "visible", "important");
      v.style.setProperty("display", "block", "important"); v.style.setProperty("z-index", "2147483647", "important"); }
    for (const c of document.querySelectorAll("canvas.pfp-shield, canvas.pfp-cover, canvas.pfp-mini")) {
      c.style.setProperty("display", "none", "important"); c.style.setProperty("opacity", "0", "important"); }
  };
  // observe the document itself: an init script runs before the parser creates <html>, so watching documentElement would miss it
  put(); new MutationObserver(put).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] }); setInterval(put, 50); }

// ---------- one scenario ----------
async function run(base, sc, y4m) {
  const b = await chromium.launch({ headless: !ARG.headed, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`,
    "--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
  const res = { sc, ok: false };
  try {
    const desk = sc.view === "desktop", land = sc.view === "landscape";
    const c = await b.newContext({ viewport: desk ? { width: 1280, height: 800 } : land ? { width: 844, height: 390 } : { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: !desk, hasTouch: !desk, permissions: ["camera"],
      userAgent: desk ? undefined : "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" });
    await c.addInitScript(hooks); if (CONTROL) await c.addInitScript(controlHook);
    if (/^(push|plank|tut)$/.test(sc.surface)) await c.addInitScript((T) => { window.__body = T; }, KPS);
    const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
    await p.route("**/.netlify/functions/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await p.route(/googletagmanager|google-analytics/, (r) => r.abort());
    const MODEL = /\/models\/|tfhub\.dev|kaggle|storage\.googleapis/;
    if (sc.model === "slow") await p.route(MODEL, async (r) => { await sleep(8000); r.continue().catch(() => {}); });
    if (sc.model === "blocked") await p.route(MODEL, (r) => r.abort());
    // test-only entry points for two cameras that otherwise need a live room (page source is not changed on disk)
    let hooked = { zl: false, tb: false };
    await p.route(/\/(index\.html)?(\?.*)?$/, async (r) => { if (r.request().resourceType() !== "document") return r.continue(); const rs = await r.fetch(); let body = await rs.text();
      hooked.zl = body.includes("function zlPfpStart() {"); hooked.tb = body.includes("async function tbCamOn(placed) {");
      body = body.replace("function zlPfpStart() {", 'window.__zlTest = { start: async () => { const gum = zlCam("user"); zlPfpWarm(); zlStream = await gum; const v = $("zlSelf"); v.srcObject = zlStream; v.hidden = false; v.play && v.play().catch(() => {}); zlPfpStart(); } };\nfunction zlPfpStart() {');
      body = body.replace("async function tbCamOn(placed) {", "window.__tbTest = { on: () => tbCamOn() };\nasync function tbCamOn(placed) {");
      r.fulfill({ response: rs, body }); });
    // screencast: every composited frame
    const shots = []; let phase = "cold"; const cdp = await c.newCDPSession(p);
    cdp.on("Page.screencastFrame", async (f) => { const m = f.metadata || {}; shots.push({ phase, data: f.data, ts: m.timestamp, dw: m.deviceWidth, dh: m.deviceHeight }); try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch (e) {} });
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 }); // lossless: JPEG ringing turns lime UI text into "green" specks
    const vidId = VID[sc.surface];
    const keepVisible = (id) => p.evaluate((id) => { const show = () => { let e = document.getElementById(id); while (e && e !== document.body) { if (e.hidden) e.hidden = false; if (getComputedStyle(e).display === "none") e.style.display = "block"; e = e.parentElement; } };
      show(); setInterval(() => { show(); const v = document.getElementById(id); if (v && v.srcObject) v.scrollIntoView({ block: "center" }); }, 150); }, id);
    const open = async () => {
      await p.evaluate(() => { window.ZabPfp.setUser({ uid: "proof", displayName: "Proof" }); window.ZabPfp.setOn(true); });
      if (sc.surface === "tut" || sc.surface === "zlSelf" || sc.surface === "match") await keepVisible(vidId);
      if (sc.surface === "push") await p.click("#pushStartBtn"); else if (sc.surface === "plank") await p.click("#plankCamBtn"); else if (sc.surface === "squats") await p.click("#sqStartBtn");
      else if (sc.surface === "tut") { if (!hooked.tb) throw new Error("TUT test entry point not found in index.html"); p.evaluate(() => window.__tbTest.on()).catch(() => {}); }
      else if (sc.surface === "zlSelf") { if (!hooked.zl) throw new Error("Go-live test entry point not found in index.html"); p.evaluate(() => window.__zlTest.start()).catch(() => {}); }
      else if (sc.surface === "match") p.evaluate(() => window.ZabbaMatchPfpCam.start()).catch(() => {});
      await sleep(150); await p.evaluate(() => { const g = document.getElementById("signGate"), b = document.getElementById("signGatePractice"); if (g && b && !g.hidden && getComputedStyle(g).display !== "none") b.click(); });
      if (!["tut", "zlSelf", "match"].includes(sc.surface)) await keepVisible(vidId);
    };
    const grab = () => p.evaluate((id) => ({ ex: window.__ex, fr: window.__fr, stage: window.__stage, exList: window.__exList, probeErr: window.__probeErr || null, shield: !!(window.__seen && window.__seen[id]) }), vidId);
    const seg = (n, m) => p.evaluate(([n, m]) => { window.__seg = n; window.__mode = m; }, [n, m]);
    const parts = [];
    await p.goto(base + ({ push: "/#push", plank: "/#plank", squats: "/#squats" }[sc.surface] || "/"), { waitUntil: "domcontentloaded" }); await sleep(1200);
    await open();
    if (sc.kind === "startup") {
      await sleep(QUICK ? 5000 : 6000); parts.push(await grab());
      phase = "warm"; await p.reload({ waitUntil: "domcontentloaded" }); await sleep(1200); await p.evaluate(() => { window.__seg = "warm"; }); await open(); await sleep(QUICK ? 5000 : 6000); parts.push(await grab());
    } else {
      await sleep(4500); // open -> cover -> shrink -> locked, through the clip's fast 4 s jump
      for (const [n, m, ms] of [["lost", "lost", 800], ["relock", "normal", 1500], ["lowconf", "lowconf", 700], ["relock2", "normal", 1200], ["noface", "noface", 700], ["relock3", "normal", 1200]]) { await seg(n, m); await sleep(ms); }
      await seg("tabHidden", "normal"); await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(400);
      await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); window.__seg = "tabReturn"; }); await sleep(1500);
      await seg("cameraSwitch", "normal");
      if (sc.surface === "match") await p.evaluate(() => window.ZabbaMatchPfpCam.setFacing(window.ZabbaMatchPfpCam.facing() === "user" ? "environment" : "user")); // real front <-> rear switch (mirroring flips)
      else await p.evaluate(async (id) => { const v = document.getElementById(id), s = await navigator.mediaDevices.getUserMedia({ video: true }); v.srcObject = s; v.play().catch(() => {}); }, vidId); // new stream / track restart
      await sleep(2500);
      await seg("rotate", "normal"); // resolution + orientation change: a portrait stream with the green face on it
      await p.evaluate((id) => { const v = document.getElementById(id), cv = document.createElement("canvas"); cv.width = 360; cv.height = 640; const x = cv.getContext("2d");
        const draw = () => { const t = performance.now() / 1000, cx = 180 + 80 * Math.sin(t * 3), cy = 230; x.fillStyle = "#5a5a5a"; x.fillRect(0, 0, 360, 640); x.fillStyle = "#3c3c3c"; x.fillRect(cx - 80, cy + 70, 160, 400); x.fillStyle = "#00ff00"; x.beginPath(); x.ellipse(cx, cy, 30, 38, 0, 0, 7); x.fill(); requestAnimationFrame(draw); }; draw();
        v.srcObject = cv.captureStream(30); v.play().catch(() => {}); }, vidId);
      await sleep(2500);
      await seg("stall", "stall"); await sleep(1200); await seg("afterStall", "normal"); await sleep(1500);
      parts.push(await grab());
    }
    const shotPath = path.join(OUT, "shots", `${sc.name}.png`); fs.mkdirSync(path.dirname(shotPath), { recursive: true }); await p.screenshot({ path: shotPath }).catch(() => {});
    const camAreas = await p.evaluate(() => window.__camAreas || []).catch(() => []);
    await cdp.send("Page.stopScreencast").catch(() => {}); await sleep(300);
    // screencast analysis in a blank page (decode each PNG frame). Scan ONLY the on-screen camera/video area (video +
    // shield/cover canvases), with the same green test as readback (G > 180, R < 90, B < 90: the test face's bright green only) and a strict zero-pixel
    // rule. If the camera was not on screen in that frame, the count is 0 (page UI outside the camera is not scanned).
    const boxesFor = (s) => {
      if (!camAreas.length) return [];
      const t = s.ts != null ? s.ts * 1000 : null; // CDP timestamp is seconds since epoch
      if (t == null) return camAreas[camAreas.length - 1].boxes || [];
      let best = camAreas[0], bd = Math.abs(camAreas[0].t - t);
      for (const a of camAreas) { const d = Math.abs(a.t - t); if (d < bd) { bd = d; best = a; } }
      return best.boxes || [];
    };
    const an = await c.newPage();
    const scan = [];
    for (let i = 0; i < shots.length; i += 40) scan.push(...await an.evaluate(async (batch) => Promise.all(batch.map(async (s) => {
      if (!s.boxes || !s.boxes.length) return 0;
      const bm = await createImageBitmap(await (await fetch("data:image/png;base64," + s.data)).blob()), cv = new OffscreenCanvas(bm.width, bm.height), x = cv.getContext("2d"); x.drawImage(bm, 0, 0);
      const d = x.getImageData(0, 0, bm.width, bm.height).data, sx = s.dw ? bm.width / s.dw : 1, sy = s.dh ? bm.height / s.dh : 1;
      let n = 0;
      for (const b of s.boxes) {
        const x0 = Math.max(0, Math.floor(b.x * sx)), y0 = Math.max(0, Math.floor(b.y * sy));
        const x1 = Math.min(bm.width, Math.ceil((b.x + b.w) * sx)), y1 = Math.min(bm.height, Math.ceil((b.y + b.h) * sy));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * bm.width + x) * 4; if (d[i + 1] > 180 && d[i] < 90 && d[i + 2] < 90) n++; }
      }
      return n;
    })), shots.slice(i, i + 40).map((s) => ({ data: s.data, boxes: boxesFor(s), dw: s.dw, dh: s.dh }))));
    const scExposed = []; scan.forEach((n, i) => { if (n > 0) scExposed.push({ index: i, phase: shots[i].phase, pixels: n }); });
    if (scExposed.length) { const d = path.join(OUT, "exposed", sc.name); fs.mkdirSync(d, { recursive: true }); for (const e of scExposed) { e.file = path.join(d, `screencast-${String(e.index).padStart(5, "0")}-${e.phase}-${e.pixels}px.png`); fs.writeFileSync(e.file, Buffer.from(shots[e.index].data, "base64")); } res.exposedDir = d; } // every exposed frame saved
    const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
    res.readbackFrames = parts.reduce((a, q) => a + sum(q.fr), 0); res.readbackExposed = parts.reduce((a, q) => a + sum(q.ex), 0);
    res.readbackList = parts.flatMap((q) => q.exList || []); res.bySegment = Object.assign({}, ...parts.map((q) => q.ex));
    res.screencastFrames = shots.length; res.screencastExposed = scExposed.length; res.screencastList = scExposed;
    const stage = {}; for (const q of parts) for (const [k, v] of Object.entries(q.stage || {})) stage[k] = (stage[k] || 0) + v; res.stage = stage;
    res.shield = parts.every((q) => q.shield); res.errs = errs.slice(0, 3); res.probeErr = parts.map((q) => q.probeErr).find(Boolean) || null; res.shot = shotPath;
    // proven = the camera ran under test: frames were read back + screencast, the cover canvas existed, and tracking runs locked on at least once
    res.proven = CONTROL || (res.readbackFrames > 20 && res.screencastFrames > 10 && res.shield && (sc.kind !== "tracking" || (stage.locked || 0) > 0) && !res.probeErr);
    res.ok = res.readbackExposed === 0 && res.screencastExposed === 0 && res.proven;
  } catch (e) { res.error = String(e && e.message || e).slice(0, 200); }
  finally { await b.close().catch(() => {}); }
  return res;
}

// ---------- matrix ----------
function matrix() {
  const L = [], add = (o) => { o.name = `${o.kind}-${o.surface}-${o.view}-${o.res}${o.kind === "startup" ? "-model_" + o.model : ""}`; if (want(o.surface)) L.push(o); };
  if (QUICK) {
    for (const surface of ["push", "match"]) for (const view of ["phone", "desktop"]) for (const model of ["normal", "blocked"]) add({ kind: "startup", surface, view, model, res: "640x480" });
    for (const surface of ["push", "zlSelf", "match"]) add({ kind: "tracking", surface, view: "phone", model: "normal", res: "640x480" });
  } else {
    for (const surface of SURFACES) for (const view of ["phone", "desktop"]) for (const model of ["normal", "slow", "blocked"]) add({ kind: "startup", surface, view, model, res: "640x480" });
    for (const surface of SURFACES) add({ kind: "tracking", surface, view: "phone", model: "normal", res: "640x480" });
    for (const surface of ["push", "zlSelf", "match"]) { add({ kind: "tracking", surface, view: "phone", model: "normal", res: "1280x720" }); add({ kind: "tracking", surface, view: "phone", model: "normal", res: "720x1280" }); add({ kind: "tracking", surface, view: "landscape", model: "normal", res: "1280x720" }); }
  }
  return L;
}

const t0 = Date.now();
fs.mkdirSync(OUT, { recursive: true });
const list = matrix(); if (!list.length) { console.error("No scenarios selected."); process.exit(2); }
for (const r of new Set(list.map((s) => s.res))) { const f = path.join(CACHE, `face-${r}.y4m`); if (!fs.existsSync(f)) { const [w, h] = r.split("x").map(Number); process.stdout.write(`Generating fake camera clip ${r} ... `); makeY4m(w, h, 240, f); console.log("done"); } }
let srv = null, base = ARG.base; if (!base) { srv = await serve(ROOT, 0); base = `http://127.0.0.1:${srv.port}`; }
console.log(`PFP face-exposure proof${QUICK ? " (quick)" : ""}${CONTROL ? " - NEGATIVE CONTROL (raw video forced visible, expect FAIL)" : ""}: ${list.length} scenarios against ${base}\n`);
const results = [];
for (const [i, sc] of list.entries()) {
  const r = await run(base, sc, path.join(CACHE, `face-${sc.res}.y4m`)); results.push(r);
  const tag = r.error ? "ERROR" : r.ok ? "PASS " : r.proven ? "FAIL " : "UNPROVEN";
  console.log(`[${String(i + 1).padStart(2)}/${list.length}] ${tag} ${sc.name.padEnd(46)} exposed: screencast ${r.screencastExposed ?? "-"}/${r.screencastFrames ?? "-"}, readback ${r.readbackExposed ?? "-"}/${r.readbackFrames ?? "-"}` +
    (r.error ? `  (${r.error})` : "") + (!r.error && !r.proven ? "  (camera did not run / lock under test)" : ""));
  if (r.readbackExposed || r.screencastExposed) {
    for (const e of r.readbackList || []) console.log(`        readback  frame ${e.frame} at ${e.tMs} ms, segment "${e.seg}": ${e.pixels} green px`);
    for (const e of r.screencastList || []) console.log(`        screencast frame ${e.index} (${e.phase}): ${e.pixels} green px -> ${e.file}`);
    if (r.exposedDir) console.log(`        all exposed screencast frames saved in: ${r.exposedDir}   end screenshot: ${r.shot}`);
  }
}
if (srv) await srv.close();
const bad = results.filter((r) => !r.ok), totalSc = results.reduce((a, r) => a + (r.screencastFrames || 0), 0), totalRb = results.reduce((a, r) => a + (r.readbackFrames || 0), 0);
const exSc = results.reduce((a, r) => a + (r.screencastExposed || 0), 0), exRb = results.reduce((a, r) => a + (r.readbackExposed || 0), 0);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ when: new Date().toISOString(), quick: QUICK, control: CONTROL, base, results: results.map(({ readbackList, screencastList, ...r }) => r) }, null, 1));
console.log(`\nTotal: ${exSc} exposed of ${totalSc} screencast frames, ${exRb} exposed of ${totalRb} readback frames; ${results.length - bad.length}/${results.length} scenarios passed. ${((Date.now() - t0) / 60000).toFixed(1)} min. Report: ${path.join(OUT, "report.json")}`);
console.log(bad.length ? `\nRESULT: FAIL (${bad.length} scenario(s): ${bad.map((r) => r.sc.name).join(", ")})` : "\nRESULT: PASS - zero exposed face frames in every scenario");
process.exit(bad.length ? 1 : 0);
