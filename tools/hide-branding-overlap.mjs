// Branding overlap check for Today's Hide zoom/list/breath vs ZD and Zabbadat marks.
// Usage: node tools/hide-branding-overlap.mjs [baseUrl] [outDir]
import { chromium } from "/workspace/pwtools/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";

const BASE = process.argv[2] || "http://127.0.0.1:8765";
const OUT = process.argv[3] || "/workspace/zabbadat-notes/hide-pics";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boxesOverlap(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

async function measure(page) {
  return page.evaluate(() => {
    const intersect = (a, b) => {
      const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
      const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
      return { x, y, w: Math.max(0, r - x), h: Math.max(0, btm - y) };
    };
    const vis = (el) => {
      if (!el) return null;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return null;
      let box = el.getBoundingClientRect();
      box = { x: box.left, y: box.top, w: box.width, h: box.height };
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflowX !== "visible" || ps.overflowY !== "visible") {
          const cr = p.getBoundingClientRect();
          box = intersect(box, { x: cr.left, y: cr.top, w: cr.width, h: cr.height });
        }
      }
      box = intersect(box, { x: 0, y: 0, w: innerWidth, h: innerHeight });
      if (box.w < 0.5 || box.h < 0.5) return null;
      return { x: box.x, y: box.y, w: box.w, h: box.h, id: el.id || el.className || el.tagName };
    };
    const brand = [];
    const logo = document.querySelector("nav a.logo");
    if (logo) {
      const box = vis(logo);
      if (box) { box.id = "nav-logo"; brand.push(box); }
    }
    for (const sel of [".home-art img.big", ".home-art img.small", ".home-art .word"]) {
      const el = document.querySelector(sel);
      const box = vis(el);
      if (box) { box.id = sel; brand.push(box); }
    }
    const neu = [];
    for (const sel of [
      "#todaysHideLine", "#todaysHideList", "#todaysHideCue",
      "#todaysHideZoomIn", "#todaysHideZoomOut",
      "#todaysHideBreath", "#todaysHideHint", "#todaysHideReset",
      "#todaysHideShare", "#todaysHideMsg",
      "#todaysHideMake", "#todaysHideNew", "#todaysHideBack", "#todaysHideCreate",
      "#todaysHideControls"
    ]) {
      const box = vis(document.querySelector(sel));
      if (box) neu.push(box);
    }
    return { brand, neu, scrollY: window.scrollY || 0 };
  });
}

async function collectHits(page, label, y) {
  const hits = [];
  const m = await measure(page);
  for (const n of m.neu) for (const b of m.brand) {
    const px = boxesOverlap(n, b);
    if (px > 0) hits.push({ label, y, px, newId: n.id, brandId: b.id, n, b });
  }
  return hits;
}
async function sweep(page, label) {
  const hits = [];
  // Top of the page, where ZD / Zabbadat art and the nav logo live.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(80);
  hits.push(...await collectHits(page, label + "-top", 0));
  // Hide section parked just under the sticky nav, plus a short window as it slides up.
  // Intended play position: the hide section starts just under the sticky nav.
  const yPlay = await page.evaluate(() => {
    const navh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navh")) || 72;
    const sec = document.getElementById("todays-hide");
    return Math.max(0, Math.floor(sec.getBoundingClientRect().top + window.scrollY - navh - 8));
  });
  await page.evaluate((yy) => window.scrollTo(0, yy), yPlay);
  await sleep(80);
  hits.push(...await collectHits(page, label + "-play", yPlay));
  return hits;
}

const browser = await chromium.launch({ headless: true });
const hits = [];
fs.mkdirSync(OUT, { recursive: true });

for (const [label, w, h] of [["phone", 390, 844], ["desktop", 1280, 800]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(BASE + "/index.html#todays-hide", { waitUntil: "networkidle" });
  await page.evaluate(() => window.ZabbadatHide && window.ZabbadatHide.showDay("2026-11-24"));
  await sleep(400);
  hits.push(...await sweep(page, label));
  await page.evaluate(() => document.getElementById("todays-hide")?.scrollIntoView({ block: "start" }));
  await sleep(200);
  await page.screenshot({ path: path.join(OUT, `branding-${label}.png`), fullPage: false });
  await page.close();
}

await browser.close();
if (hits.length) {
  console.log("OVERLAP FAIL: " + hits.length + " hits");
  console.log(JSON.stringify(hits.slice(0, 12), null, 2));
  fs.writeFileSync(path.join(OUT, "branding-overlap.json"), JSON.stringify(hits, null, 2));
  process.exit(1);
}
console.log("OVERLAP PASS: 0 px between Today's Hide controls and ZD/Zabbadat branding at 390px and desktop");
fs.writeFileSync(path.join(OUT, "branding-overlap.json"), "[]\n");
process.exit(0);
