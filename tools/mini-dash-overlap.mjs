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
    for (const sel of ["#miniDash", "#goToDash", "#miniDashNudge", "#miniDashZab", "#miniDashTut", "#miniDashBreath", "#miniDashStreak"]) {
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

// Cooling-box close-up hint, Proof of Sitkari caption, and alignment ring vs branding / caption / lower face.
{
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" });
  const p = await c.newPage();
  await p.route("**/.netlify/functions/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await p.goto(BASE + "/#cooling-box", { waitUntil: "domcontentloaded" });
  await sleep(800);
  const hits = await p.evaluate(() => {
    const box = (el) => {
      if (!el || el.hidden) return null;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) return null;
      return { x: r.left, y: r.top, w: r.width, h: r.height, id: el.id || el.className };
    };
    const overlap = (a, b) => {
      const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return x * y;
    };
    const play = document.getElementById("coolingPlay");
    if (play) {
      const navh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navh")) || 80;
      window.scrollTo(0, Math.max(0, play.getBoundingClientRect().top + window.scrollY - navh - 8));
    }
    const wrap = document.getElementById("coolingWrap");
    const hint = document.getElementById("coolingCloseHint");
    const cap = document.getElementById("coolingProofCaption");
    const vid = document.getElementById("coolingVid");
    const stage = document.getElementById("coolingStage");
    const align = document.getElementById("coolingAlignRing");
    if (wrap) wrap.hidden = false;
    if (hint) { hint.hidden = false; hint.textContent = "Sit up close so your mouth and chin show."; }
    if (cap) { cap.hidden = false; }
    if (vid) { vid.style.height = "180px"; }
    if (align && stage) {
      align.hidden = false;
      const sr = (document.querySelector(".cooling-stage") || stage).getBoundingClientRect();
      const vr = (vid || stage).getBoundingClientRect();
      align.style.left = (vr.left - sr.left + vr.width * 0.78) + "px";
      align.style.top = (vr.top - sr.top + vr.height * 0.62) + "px";
    }
    const hintB = box(hint), capB = box(cap), alignB = box(align), vidB = box(vid);
    const brand = [];
    const logo = document.querySelector("nav a.logo");
    if (logo && box(logo)) brand.push(Object.assign(box(logo), { id: "nav-logo" }));
    const hits = [];
    const lower = vidB ? { x: vidB.x, y: vidB.y + vidB.h * 0.62, w: vidB.w, h: vidB.h * 0.38, id: "mouth-chin-zone" } : null;
    const check = (a, b) => { if (a && b) { const px = overlap(a, b); if (px > 0) hits.push({ a: a.id, b: b.id, px }); } };
    check(hintB, capB);
    for (const b of brand) { check(hintB, b); check(capB, b); check(alignB, b); }
    check(alignB, capB);
    check(alignB, lower);
    check(hintB, lower);
    return { hits, hintB, capB, alignB, lower };
  });
  await p.screenshot({ path: path.join(OUT, "cooling-overlap-hint.png"), fullPage: false });
  if (hits.hits && hits.hits.length) allHits.push(...hits.hits.map((h) => Object.assign({ label: "cooling-hint" }, h)));
  await c.close();
}

await b.close();
const out = { ok: allHits.length === 0, overlaps: allHits, shots };
console.log(JSON.stringify(out, null, 2));
if (!out.ok) { console.error("OVERLAP FAIL: " + allHits.length + " hit(s)"); process.exit(1); }
console.log("OVERLAP PASS: 0 px between mini dashboard and branding at 390px and desktop; cooling hint, caption, and align ring stay clear");
