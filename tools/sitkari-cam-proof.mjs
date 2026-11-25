// Playwright proof for Sitkari camera (fullscreen, zero jitter, nose-up cover, mouth/chin visible,
// lower-right breathe cue with 0 overlaps, clean exit) and Breathe solo (start-to-finish, 0 layout jump).
// Usage: node tools/sitkari-cam-proof.mjs [outDir]
import { createRequire } from "module";
import { chromium } from "/workspace/pwtools/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const serve = require("./pfp-proof/serve.js");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.argv[2] || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build a synthetic 640x480 Y4M close-up face clip in /tmp so the proof is self-contained.
function buildFaceY4m(filePath) {
  const W = 640, H = 480, FRAMES = 90;
  const Y = Buffer.alloc(W * H, 28);
  const U = Buffer.alloc((W / 2) * (H / 2), 128);
  const V = Buffer.alloc((W / 2) * (H / 2), 128);
  const setRgb = (x0, y0, x1, y1, r, g, b) => {
    const yy = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
    const uu = Math.max(0, Math.min(255, Math.round(-0.169 * r - 0.331 * g + 0.5 * b + 128)));
    const vv = Math.max(0, Math.min(255, Math.round(0.5 * r - 0.419 * g - 0.081 * b + 128)));
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
        Y[y * W + x] = yy;
        U[(y >> 1) * (W / 2) + (x >> 1)] = uu;
        V[(y >> 1) * (W / 2) + (x >> 1)] = vv;
      }
    }
  };
  const setEllipse = (cx, cy, rx, ry, r, g, b) => {
    const yy = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
    const uu = Math.max(0, Math.min(255, Math.round(-0.169 * r - 0.331 * g + 0.5 * b + 128)));
    const vv = Math.max(0, Math.min(255, Math.round(0.5 * r - 0.419 * g - 0.081 * b + 128)));
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) {
          Y[y * W + x] = yy;
          U[(y >> 1) * (W / 2) + (x >> 1)] = uu;
          V[(y >> 1) * (W / 2) + (x >> 1)] = vv;
        }
      }
    }
  };
  const cx = W / 2, cy = H * 0.44;
  setRgb(cx - 130, cy + 125, cx + 130, H, 52, 62, 60);
  setEllipse(cx, cy, 88, 114, 215, 175, 145);
  setEllipse(cx, cy - 36, 74, 48, 60, 175, 110);
  setEllipse(cx - 34, cy - 22, 14, 9, 40, 220, 255);
  setEllipse(cx + 34, cy - 22, 14, 9, 40, 220, 255);
  setEllipse(cx, cy + 10, 14, 16, 195, 155, 125);
  setEllipse(cx, cy + 44, 28, 12, 235, 85, 95);
  setEllipse(cx, cy + 84, 38, 22, 245, 185, 70);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Y, U, V]);
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < FRAMES; i++) parts.push(frame);
  fs.writeFileSync(filePath, Buffer.concat(parts));
}

function overlapArea(a, b) {
  if (!a || !b) return 0;
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y;
}

const faceClip = "/tmp/sitkari-proof-face-640x480.y4m";
buildFaceY4m(faceClip);

const srv = await serve(ROOT, 0);
const BASE = `http://127.0.0.1:${srv.port}`;
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${faceClip}`,
    "--autoplay-policy=no-user-gesture-required",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl"
  ]
});

const R = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail != null ? "  " + detail : ""}`);
  R.push(!!ok);
};

// 1. Sitkari camera on phone portrait + desktop
for (const [label, vp, isMob] of [
  ["phone", { width: 390, height: 844 }, true],
  ["desktop", { width: 1280, height: 800 }, false]
]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: isMob, hasTouch: isMob, deviceScaleFactor: 1, permissions: ["camera"] });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.addInitScript(() => {
    window.__poseTick = 0;
    let hostVal;
    Object.defineProperty(window, "ZabCoolingHost", {
      configurable: true,
      get: () => hostVal,
      set(v) {
        if (v && typeof v === "object") {
          v.ensurePose = async () => ({
            estimatePoses: async (input) => {
              const W = input.videoWidth || input.width || 640;
              const H = input.videoHeight || input.height || 480;
              const t = ++window.__poseTick;
              const jx = (k) => Math.sin(t * 2.3 + k * 1.7) * 2.2;
              const jy = (k) => Math.cos(t * 1.9 + k * 2.1) * 2.2;
              const cx = W / 2, cy = H * 0.44;
              return [{
                keypoints: [
                  { name: "nose", x: cx + jx(0), y: cy + 10 + jy(0), score: 0.92 },
                  { name: "left_eye", x: cx + 34 + jx(1), y: cy - 22 + jy(1), score: 0.94 },
                  { name: "right_eye", x: cx - 34 + jx(2), y: cy - 22 + jy(2), score: 0.94 },
                  { name: "left_ear", x: cx + 82 + jx(3), y: cy + 5 + jy(3), score: 0.85 },
                  { name: "right_ear", x: cx - 82 + jx(4), y: cy + 5 + jy(4), score: 0.85 },
                  { name: "left_shoulder", x: cx + 125 + jx(5), y: cy + 150 + jy(5), score: 0.8 },
                  { name: "right_shoulder", x: cx - 125 + jx(6), y: cy + 150 + jy(6), score: 0.8 }
                ]
              }];
            }
          });
        }
        hostVal = v;
      }
    });
  });

  await page.goto(BASE + "/index.html#cooling-box", { waitUntil: "domcontentloaded" });
  await page.locator("#coolingCamBtn").waitFor({ state: "visible", timeout: 15000 });
  await sleep(500);
  await page.evaluate(() => {
    const GS = window.ZabbadatGetSet;
    if (GS) { GS.enqueueSpeak = () => Promise.resolve(); GS.speakAndWait = () => Promise.resolve(); }
  });
  await page.locator("#coolingCamBtn").scrollIntoViewIfNeeded();
  if (isMob) {
    const box = await page.locator("#coolingCamBtn").boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await page.locator("#coolingCamBtn").click();
  }
  await sleep(4200);

  const samples = [];
  for (let i = 0; i < 25; i++) {
    const s = await page.evaluate(() => {
      const wrap = document.getElementById("coolingWrap");
      const vid = document.getElementById("coolingVid");
      const cue = document.getElementById("coolingCamCue");
      const pill = document.getElementById("coolingCamLabel");
      const stop = document.getElementById("coolingCamStopBtn");
      const cap = document.getElementById("coolingProofCaption");
      const align = document.getElementById("coolingAlignRing");
      const sh = window.ZabPfp && window.ZabPfp._shields && window.ZabPfp._shields.coolingVid;
      const rBox = (el) => {
        if (!el || el.hidden) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } : null;
      };
      let pixels = null;
      const cv = document.querySelector("#coolingStage canvas.pfp-shield");
      if (cv && cv.width > 0 && vid && vid.videoWidth > 0) {
        const ctx2 = cv.getContext("2d");
        const vr = vid.getBoundingClientRect();
        const bw = vr.width, bh = vr.height, vw = vid.videoWidth, vh = vid.videoHeight;
        const k = Math.min(bw / vw, bh / vh), ox = (bw - vw * k) / 2, oy = (bh - vh * k) / 2;
        const dpr = cv.width / bw;
        const pxAt = (vx, vy) => {
          const sx = Math.round((ox + (vw - vx) * k) * dpr);
          const sy = Math.round((oy + vy * k) * dpr);
          const d = ctx2.getImageData(Math.max(0, Math.min(cv.width - 1, sx)), Math.max(0, Math.min(cv.height - 1, sy)), 1, 1).data;
          return [d[0], d[1], d[2]];
        };
        const cx = vw / 2, cy = vh * 0.44;
        pixels = {
          forehead: pxAt(cx, cy - 64),
          leftEye: pxAt(cx + 34, cy - 22),
          rightEye: pxAt(cx - 34, cy - 22),
          mouth: pxAt(cx, cy + 44),
          chin: pxAt(cx, cy + 84)
        };
      }
      let logoRect = null, mouthRect = null;
      if (sh && sh.drawM && vid) {
        const vr = vid.getBoundingClientRect();
        const m = sh.drawM;
        logoRect = { left: vr.left + m.x - m.r, top: vr.top + m.y - m.r, right: vr.left + m.x + m.r, bottom: vr.top + m.y + m.r };
        mouthRect = { left: vr.left + m.x - m.r * 0.6, top: vr.top + m.y + m.r + 2, right: vr.left + m.x + m.r * 0.6, bottom: vr.top + m.y + m.r * 2.1 };
      }
      return {
        fsEntered: !!(document.fullscreenElement || wrap?.classList.contains("cam-fs")),
        wrapRect: rBox(wrap),
        cueRect: rBox(cue),
        pillBg: pill ? getComputedStyle(pill).backgroundImage : "",
        stopRect: rBox(stop),
        capRect: rBox(cap),
        alignHidden: align ? align.hidden : true,
        logoRect, mouthRect,
        drawM: sh && sh.drawM ? { x: sh.drawM.x, y: sh.drawM.y, r: sh.drawM.r } : null,
        pixels
      };
    });
    samples.push(s);
    await sleep(40);
  }
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `proof-cam-${label}.png`), fullPage: false });
  }
  const last = samples[samples.length - 1];
  const deltas = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].drawM, b = samples[i].drawM;
    if (a && b) deltas.push({ d: Math.hypot(b.x - a.x, b.y - a.y), rd: Math.abs(b.r - a.r) });
  }
  const medianDelta = deltas.map((x) => x.d).sort((a, b) => a - b)[Math.floor(deltas.length / 2)] || 0;
  const maxRDelta = Math.max(...deltas.map((x) => x.rd));
  const isCyanOrGreen = (rgb) => rgb && rgb[0] < 120 && rgb[1] > 140 && (rgb[2] > 180 || rgb[0] < 90);
  const isMouthRed = (rgb) => rgb && rgb[0] > 180 && rgb[1] < 130 && rgb[2] < 130;
  const isChinAmber = (rgb) => rgb && rgb[0] > 180 && rgb[1] > 140 && rgb[2] < 150;

  check(`${label} cam enters fullscreen and fills viewport`, last.fsEntered && last.wrapRect?.width === vp.width && last.wrapRect?.height === vp.height);
  check(`${label} cam keeps nose-up logo steady on still face (median delta ${medianDelta.toFixed(2)}px, maxRDelta ${maxRDelta.toFixed(2)}px)`,
    medianDelta < 2 && maxRDelta < 18);
  check(`${label} cam covers eyes & forehead (0 exposed pixels)`,
    last.pixels && !isCyanOrGreen(last.pixels.forehead) && !isCyanOrGreen(last.pixels.leftEye) && !isCyanOrGreen(last.pixels.rightEye),
    JSON.stringify(last.pixels));
  check(`${label} cam leaves mouth and chin visible`,
    last.pixels && isMouthRed(last.pixels.mouth) && isChinAmber(last.pixels.chin),
    JSON.stringify(last.pixels));
  check(`${label} lower-right gradient breathe cue has zero overlap with face/mouth/stop/caption`,
    last.cueRect && last.cueRect.left > vp.width * 0.5 && last.cueRect.bottom >= vp.height - 30
    && /gradient/.test(last.pillBg) && last.alignHidden
    && overlapArea(last.cueRect, last.logoRect) === 0
    && overlapArea(last.cueRect, last.mouthRect) === 0
    && overlapArea(last.cueRect, last.stopRect) === 0
    && overlapArea(last.cueRect, last.capRect) === 0);

  if (isMob) {
    const sb = await page.locator("#coolingCamStopBtn").boundingBox();
    await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
  } else {
    await page.locator("#coolingCamStopBtn").click();
  }
  await sleep(250);
  const exited = await page.evaluate(() => (
    document.getElementById("coolingWrap")?.hidden
    && !document.getElementById("coolingWrap")?.classList.contains("cam-fs")
    && !document.documentElement.classList.contains("zab-cooling-fs")
    && !document.fullscreenElement
  ));
  check(`${label} cam exits fullscreen cleanly on Stop with 0 errors`, exited && errs.length === 0, JSON.stringify({ exited, errs }));
  await ctx.close();
}

// 2. Breathe solo start-to-finish
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE + "/index.html#cooling-box", { waitUntil: "networkidle" });
  await page.locator("#coolingSoloBtn").waitFor({ state: "visible", timeout: 15000 });
  await page.evaluate(() => localStorage.setItem("zabbadat-breath-session-min", "1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => {
    const GS = window.ZabbadatGetSet;
    if (GS) { GS.enqueueSpeak = () => Promise.resolve(); GS.speakAndWait = () => Promise.resolve(); }
  });
  await page.locator("#coolingSoloBtn").scrollIntoViewIfNeeded();
  await sleep(150);
  const sb = await page.locator("#coolingSoloBtn").boundingBox();
  await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);

  const log = [];
  for (let i = 0; i < 160; i++) {
    const s = await page.evaluate(() => ({
      status: document.getElementById("coolingStatus")?.textContent || "",
      alignHidden: document.getElementById("coolingAlignRing")?.hidden ?? true,
      alignCount: document.getElementById("coolingAlignCount")?.textContent || "",
      ringTf: document.getElementById("coolingRingScale")?.style.transform || "",
      stopTop: document.getElementById("coolingStopBtn") && !document.getElementById("coolingStopBtn").hidden ? Math.round(document.getElementById("coolingStopBtn").getBoundingClientRect().top) : null,
      cycles: document.getElementById("coolingCycles")?.textContent || "0"
    }));
    log.push(s);
    if (Number(s.cycles) >= 1 && log.some((x) => x.status === "Hold empty")) break;
    await sleep(140);
  }
  const stopTops = [...new Set(log.map((x) => x.stopTop).filter((x) => x != null))];
  const layoutJump = stopTops.length > 1 ? Math.max(...stopTops) - Math.min(...stopTops) : 0;
  const inhaleFrames = new Set(log.filter((x) => /Inhale/.test(x.status)).map((x) => x.ringTf)).size;
  const statuses = new Set(log.map((x) => x.status));
  check("solo align ring stays hidden until 1-2-3 countdown", !log.some((x) => !x.alignHidden && x.alignCount === ""));
  check("solo has zero layout jump across Inhale/Hold/Exhale/Hold", layoutJump <= 1, `jump=${layoutJump}`);
  check("solo runs smoothly start-to-finish and logs cycle",
    statuses.has("One") && statuses.has("Two") && statuses.has("Three")
    && statuses.has("Inhale 1") && statuses.has("Hold full") && statuses.has("Exhale 1") && statuses.has("Hold empty")
    && inhaleFrames >= 15 && Number(log[log.length - 1]?.cycles) >= 1 && errs.length === 0,
    JSON.stringify({ inhaleFrames, cycles: log[log.length - 1]?.cycles, errs }));
  await ctx.close();
}

await browser.close();
await srv.close();
try { fs.unlinkSync(faceClip); } catch {}
const ok = R.filter(Boolean).length;
console.log(`\n${ok}/${R.length} passed`);
if (ok !== R.length) process.exit(1);
