// Record a short sample through rec.js (live frames + 2.5 s end card), save mid/end PNGs, then decode with ffmpeg.
import { chromium } from "/workspace/pwtools/node_modules/playwright/index.mjs";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const serve = require("./pfp-proof/serve.js");
const OUT = process.argv[2] || "/workspace/zabbadat-notes";
const liveMs = 2000;
const endMs = 2500;

fs.mkdirSync(OUT, { recursive: true });
const srv = await serve(ROOT, 0);
const base = `http://127.0.0.1:${srv.port}`;
console.log("serving", base);
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--no-sandbox"] });
console.log("browser up");
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => console.error("pageerror", String(e).slice(0, 200)));
page.on("console", (m) => console.log("page:", m.text()));
await page.goto(base + "/tools/rec-ads-harness.html", { waitUntil: "domcontentloaded" });
page.setDefaultTimeout(20000);
await page.waitForFunction(() => window.ZabRec && window.ZabRec.paintFrame && window.ZabRec.paintEndCard);
console.log("harness ready, recording…");

const result = await Promise.race([
  page.evaluate(async ({ liveMs, endMs }) => {
    console.log("eval start");

  const Z = window.ZabRec;
  const src = document.createElement("canvas");
  src.width = 640; src.height = 480;
  const sx = src.getContext("2d");
  const vid = document.getElementById("camVid");
  sx.fillStyle = "#1a8a8a"; sx.fillRect(0, 0, 640, 480);
  vid.srcObject = src.captureStream(30);
  console.log("playing video");
  await Promise.race([vid.play().catch((e) => console.log("play err", e)), new Promise((r) => setTimeout(r, 800))]);
  const until = performance.now() + 2000;
  while (performance.now() < until && vid.videoWidth === 0) await new Promise((r) => setTimeout(r, 30));
  console.log("videoWidth", vid.videoWidth);

  const mark = new Image();
  mark.src = "/zd-v2-mark.svg";
  const mk = await new Promise((r) => { mark.onload = () => r("ok"); mark.onerror = () => r("err"); setTimeout(() => r("timeout"), 1200); });
  console.log("mark", mk, mark.naturalWidth);

  // Fake a locked PFP logo so the mid-clip frame shows the face cover plus both watermarks.
  window.ZabPfp = {
    isOn: () => true,
    lastHead: () => ({ x: 320, y: 150, r: 72 }),
    recFrame: () => ({ img: src, c: { x: 320, y: 150, r: 72 } }),
    drawLogo: (x, hd) => {
      if (!hd) return;
      x.save();
      x.fillStyle = "#0e1412"; x.beginPath(); x.arc(hd.x, hd.y, hd.r, 0, Math.PI * 2); x.fill();
      x.strokeStyle = "#e8f0ea"; x.lineWidth = Math.max(2, hd.r * 0.06); x.stroke();
      x.fillStyle = "#f2f5f3"; x.font = "700 " + Math.round(hd.r * 0.7) + "px 'Cormorant Garamond', Georgia, serif";
      x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("ZD", hd.x, hd.y + hd.r * 0.05);
      x.restore();
    },
    P: {}
  };

  function paintSource(t) {
    sx.fillStyle = "#1a8a8a"; sx.fillRect(0, 0, 640, 480);
    sx.fillStyle = "#c45a8c";
    sx.beginPath(); sx.ellipse(320 + 8 * Math.sin(t / 400), 150, 36, 44, 0, 0, Math.PI * 2); sx.fill();
  }

  const cv = document.createElement("canvas");
  cv.width = 640; cv.height = 480;
  const rec = { id: "camWrap", vid, cv, x: cv.getContext("2d"), placer: Z.createWmPlacer(), ending: false };
  const stream = cv.captureStream(30);
  const types = ["video/webm;codecs=vp8", "video/webm", "video/mp4"];
  let mime = "";
  for (const t of types) { try { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) { mime = t; break; } } catch (e) {} }
  const chunks = [];
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : { videoBitsPerSecond: 2500000 });
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { mr.onstop = () => res(); });
  const mid = { dataUrl: "", layout: null }, endShot = { dataUrl: "" };
  const t0 = performance.now();
  paintSource(0);
  let finished = false, lastPhase = "", lastErr = "";
  console.log("before mr.start");
  try { mr.start(200); } catch (e) { lastErr = "mr.start " + String(e); }
  console.log("after mr.start", mr.state, lastErr);
  await new Promise((resolve) => {
    const step = () => {
      const now = performance.now();
      const elapsed = now - t0;
      try {
        paintSource(now);
        lastPhase = Z.tickRecording(rec, now,
          () => Z.paintFrame(rec, now),
          () => Z.paintEndCard(rec.x, rec.cv.width, rec.cv.height, { mark: mark }),
          () => { finished = true; }
        );
        if (!mid.dataUrl && elapsed >= 800 && lastPhase === "recording") {
          mid.dataUrl = cv.toDataURL("image/png");
          mid.layout = Z.wmCluster(cv.width, cv.height, rec.placer.side());
        }
        if (lastPhase === "ending" && elapsed >= liveMs + 400 && !endShot.dataUrl) endShot.dataUrl = cv.toDataURL("image/png");
        if (!rec.ending && elapsed >= liveMs) Z.beginEndCard(rec, now);
      } catch (e) { lastErr = String(e && e.message || e); }
      if (finished || lastPhase === "finished" || elapsed > liveMs + endMs + 1500) {
        try { if (mr.state !== "inactive") mr.stop(); } catch (e) {}
        resolve();
        return;
      }
      setTimeout(step, 33);
    };
    setTimeout(step, 33);
  });
  await Promise.race([stopped, new Promise((r) => setTimeout(r, 2000))]);
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: (mime || "video/webm").split(";")[0] });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let b64 = "";
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) {
    b64 += String.fromCharCode.apply(null, buf.subarray(i, i + step));
  }
  return {
    mime: blob.type || mime || "video/webm",
    size: buf.length,
    b64: btoa(b64),
    mid: mid.dataUrl,
    end: endShot.dataUrl,
    layout: mid.layout,
    endMs: Z.W.endMs,
    sponsor: Z.getSponsor(),
    finished,
    lastPhase,
    lastErr,
    videoWidth: vid.videoWidth,
    chunkCount: chunks.length
  };
}, { liveMs, endMs }),
  new Promise((resolve) => setTimeout(() => resolve({ error: "node-timeout" }), 15000))
]);

console.log("recorded", result && { size: result.size, mime: result.mime, finished: result.finished, lastPhase: result.lastPhase, lastErr: result.lastErr, chunkCount: result.chunkCount, videoWidth: result.videoWidth });
await browser.close();
await srv.close();

if (result && result.error) {
  console.error(result);
  process.exit(1);
}
if (!result || !result.b64) {
  console.error("No recorded bytes", result && { size: result.size, mime: result.mime, finished: result.finished, lastErr: result && result.lastErr, lastPhase: result && result.lastPhase, chunkCount: result && result.chunkCount });
  process.exit(1);
}

function writePng(dataUrl, dest) {
  if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) return false;
  fs.writeFileSync(dest, Buffer.from(dataUrl.split(",")[1], "base64"));
  return fs.statSync(dest).size > 0;
}

const ext = /mp4/i.test(result.mime) ? "mp4" : "webm";
const videoPath = path.join(OUT, "video-sponsor-sample." + ext);
const midPath = path.join(OUT, "video-sponsor-mid.png");
const endPath = path.join(OUT, "video-sponsor-end.png");
fs.writeFileSync(videoPath, Buffer.from(result.b64, "base64"));
if (!writePng(result.mid, midPath) || !writePng(result.end, endPath)) {
  console.error("Failed to write evidence PNGs");
  process.exit(1);
}

const framesDir = path.join(OUT, "video-sponsor-frames");
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time:stream=codec_name,width,height", "-of", "json", videoPath], { encoding: "utf8" });
if (probe.status !== 0) {
  console.error("ffprobe failed", probe.stderr);
  process.exit(1);
}
const info = JSON.parse(probe.stdout);
const pts = (info.frames || []).map((f) => Number(f.best_effort_timestamp_time)).filter((n) => Number.isFinite(n));
const duration = pts.length ? pts[pts.length - 1] - pts[0] : 0;
const vstream = (info.streams && info.streams[0]) || {};
const extract = spawnSync("ffmpeg", ["-y", "-i", videoPath, "-vsync", "vfr", path.join(framesDir, "f-%04d.png")], { encoding: "utf8" });
if (extract.status !== 0) {
  console.error("ffmpeg extract failed", extract.stderr.slice(-400));
  process.exit(1);
}
const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort();

function classify(file) {
  // Very small PNG reader via ffmpeg raw rgb
  const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
  if (raw.status !== 0) return { error: String(raw.stderr) };
  const buf = raw.stdout;
  const px = buf.length / 3;
  let dark = 0, teal = 0, pink = 0, brightCorner = 0;
  // assume 640x480 unless we parse; use ffprobe on the png
  const ip = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [w, h] = (ip.stdout || "").trim().split(",").map(Number);
  if (!w || !h || buf.length < w * h * 3) return { error: "size", w, h, bytes: buf.length };
  for (let i = 0, n = 0; n < px; n++, i += 3) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    if (r < 40 && g < 45 && b < 40) dark++;
    if (g > 90 && r < 80 && b < 160 && g > r + 20) teal++;
    if (r > 140 && g < 120 && b > 80) pink++;
  }
  // bottom-right 28% x 22% for watermark brightness vs teal field
  const x0 = Math.floor(w * 0.70), y0 = Math.floor(h * 0.78);
  for (let y = y0; y < h; y++) for (let x = x0; x < w; x++) {
    const i = (y * w + x) * 3, r = buf[i], g = buf[i + 1], bch = buf[i + 2];
    if (r > 170 && g > 170 && bch > 170) brightCorner++;
  }
  const fracDark = dark / px, fracTeal = teal / px;
  let kind = "other";
  if (fracDark > 0.55 && fracTeal < 0.05) kind = "end";
  else if (fracTeal > 0.25) kind = "live";
  return { w, h, fracDark, fracTeal, pink, brightCorner, kind };
}

const stats = frames.map((f) => Object.assign({ file: f }, classify(path.join(framesDir, f))));
const live = stats.filter((s) => s.kind === "live");
const end = stats.filter((s) => s.kind === "end");
const fps = duration > 0 && frames.length > 1 ? (frames.length - 1) / duration : 30;
let endSec = end.length / (fps || 30);
if (pts.length === frames.length) {
  const firstEnd = stats.findIndex((s) => s.kind === "end");
  const lastEnd = stats.findLastIndex ? stats.findLastIndex((s) => s.kind === "end") : (stats.length - 1);
  if (firstEnd >= 0 && lastEnd >= firstEnd) endSec = pts[lastEnd] - pts[firstEnd];
}
const midHasWm = (live[Math.floor(live.length / 2)] || live[0] || {}).brightCorner > 8;
const endHasNoLive = end.every((s) => s.fracTeal < 0.05 && s.pink < 80);
const endOk = endSec >= 1.8 && endSec <= 3.4;
const midOk = live.length > 0 && midHasWm;
const durOk = duration >= 3.8 && duration <= 6.5;

const report = {
  video: videoPath,
  mime: result.mime,
  size: result.size,
  duration,
  codec: vstream.codec_name,
  width: vstream.width,
  height: vstream.height,
  frames: frames.length,
  liveFrames: live.length,
  endFrames: end.length,
  endSec: Number(endSec.toFixed(3)),
  fps: Number((fps || 0).toFixed(2)),
  midHasWatermark: midHasWm,
  endHasNoLiveFrames: endHasNoLive,
  midPng: midPath,
  endPng: endPath,
  layout: result.layout,
  sponsor: result.sponsor,
  endMs: result.endMs,
  ok: !!(durOk && endOk && midOk && endHasNoLive && result.finished)
};
fs.writeFileSync(path.join(OUT, "video-sponsor-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  console.error("Sample checks failed");
  process.exit(1);
}
console.log("SAMPLE PASS");
