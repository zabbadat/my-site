// Programmatic overlap check + screenshots for the mini dashboard vs branding.
// Usage: node tools/mini-dash-overlap.mjs [baseUrl] [outDir]
import { chromium } from "/workspace/pwtools/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";

const BASE = process.argv[2] || "http://127.0.0.1:8977";
const OUT = process.argv[3] || "/workspace/zabbadat-notes";
const shots = {
  phoneTop: path.join(OUT, "mini-dash-top-phone.png"),
  phoneScrolled: path.join(OUT, "mini-dash-scrolled-phone.png"),
  desktop: path.join(OUT, "mini-dash-desktop.png"),
  bundlePhone: path.join(OUT, "bundle-final-top-phone.png")
};
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
      // Clip to overflow:hidden/auto/scroll ancestors so pre-clip overflow (e.g. .home-art img.big) is not counted.
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
    for (const sel of ["#miniDash", "#goToDash", "#miniDashNudge", "#miniDashZab", "#miniDashTut"]) {
      const box = vis(document.querySelector(sel));
      if (box) neu.push(box);
    }
    // The 10K tile is pre-existing; only count it if its new mini children are visible
    // and the tile itself is painting (not tucked under the nav).
    return { brand, neu, scrollY: window.scrollY || 0, navh: getComputedStyle(document.documentElement).getPropertyValue("--navh") };
  });
}

async function sweep(page, label, yMax) {
  const hits = [];
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const max = Math.min(yMax || height, height);
  for (let y = 0; y <= max; y += 40) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(30);
    const m = await measure(page);
    for (const n of m.neu) for (const b of m.brand) {
      const px = boxesOverlap(n, b);
      if (px > 0) hits.push({ label, y, px, newId: n.id, brandId: b.id, n, b });
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return hits;
}

const b = await chromium.launch({ args: ["--no-sandbox"], headless: true });
fs.mkdirSync(OUT, { recursive: true });
const allHits = [];

// iPhone 390
{
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" });
  const p = await c.newPage();
  await p.route("**/.netlify/functions/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await sleep(1200);
  await p.screenshot({ path: shots.phoneTop, fullPage: false });
  allHits.push(...await sweep(p, "phone-390", 2000));
  await p.evaluate(() => window.scrollTo(0, 420));
  await sleep(200);
  await p.screenshot({ path: shots.phoneScrolled, fullPage: false });
  const also = process.env.BUNDLE_FINAL_SHOT;
  if (also) {
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    await p.screenshot({ path: shots.bundlePhone, fullPage: false });
  }
  await c.close();
}

// Desktop
{
  const c = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const p = await c.newPage();
  await p.route("**/.netlify/functions/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await sleep(1200);
  await p.screenshot({ path: shots.desktop, fullPage: false });
  allHits.push(...await sweep(p, "desktop-1280", 2000));
  await c.close();
}

await b.close();
const out = { ok: allHits.length === 0, overlaps: allHits, shots };
console.log(JSON.stringify(out, null, 2));
if (!out.ok) { console.error("OVERLAP FAIL: " + allHits.length + " hit(s)"); process.exit(1); }
console.log("OVERLAP PASS: 0 px between mini dashboard and branding at 390px and desktop");
