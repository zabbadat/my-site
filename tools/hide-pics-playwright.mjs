// Phone + touchscreen.tap check for Today's Hide (5-item day and legacy 1-item day).
import { chromium } from "/workspace/pwtools/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const H = require("../hide-daily.js");
const man = JSON.parse(fs.readFileSync(new URL("../hide/manifest.json", import.meta.url), "utf8"));

const BASE = process.argv[2] || "http://127.0.0.1:8765";
const OUT = process.argv[3] || "/workspace/zabbadat-notes/hide-pics";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function scrollHide(page) {
  await page.evaluate(() => {
    const stage = document.getElementById("todaysHideStage") || document.getElementById("todays-hide");
    if (!stage) return;
    const navh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navh")) || 72;
    const y = stage.getBoundingClientRect().top + window.scrollY - navh - 8;
    window.scrollTo(0, Math.max(0, y));
  });
  await sleep(120);
}
function check(n, ok) { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); results.push({ n, ok: !!ok }); }

async function tapNorm(page, img, nx, ny) {
  const box = await img.boundingBox();
  if (!box) throw new Error("no image box");
  await page.touchscreen.tap(box.x + nx * box.width, box.y + ny * box.height);
  await sleep(420);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2
});
const page = await context.newPage();
await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await scrollHide(page);
await page.evaluate(() => window.ZabbadatHide.showDay("2026-11-24"));
await page.waitForFunction(() => {
  const list = document.getElementById("todaysHideList");
  const img = document.getElementById("todaysHideImg");
  return list && !list.hidden && list.querySelectorAll("button").length === 5 && img && img.complete && img.naturalWidth > 0;
}, { timeout: 8000 });
await scrollHide(page);

check("five-item list is shown", true);

// Zoom via + button
const panBefore = await page.evaluate(() => document.getElementById("todaysHidePan").style.transform || "");
await page.locator("#todaysHideZoomIn").click();
await sleep(150);
const panAfter = await page.evaluate(() => document.getElementById("todaysHidePan").style.transform || "");
check("zoom in button scales the picture", /scale\(([0-9.]+)\)/.test(panAfter) && parseFloat(RegExp.$1) > 1.05);
const resetShown = await page.evaluate(() => {
  const b = document.getElementById("todaysHideReset");
  return b && !b.hidden;
});
check("reset view appears after zoom", resetShown);
if (resetShown) {
  await page.locator("#todaysHideReset").click();
  await sleep(200);
}
await page.waitForFunction(() => {
  const img = document.getElementById("todaysHideImg");
  return img && img.complete && img.naturalWidth > 0;
});

// Fresh unzoomed day for the hunt, so zoom tests cannot clip taps.
await page.evaluate(() => { try { localStorage.removeItem("zabHideFound:2026-11-24"); } catch (e) {} });
await page.evaluate(() => window.ZabbadatHide.showDay("2026-11-24"));
await page.waitForFunction(() => {
  const list = document.getElementById("todaysHideList");
  const img = document.getElementById("todaysHideImg");
  const pan = document.getElementById("todaysHidePan");
  return list && list.querySelectorAll("button").length === 5 && img && img.complete && img.naturalWidth > 0 &&
    (!pan.style.transform || /scale\(1\)|scale\(1\.0+\)/.test(pan.style.transform) || pan.style.transform === "");
}, { timeout: 8000 });
await scrollHide(page);

const items = H.unpackDay(man.days["2026-11-24"]);
const washer = items.find((it) => /washer/i.test(it.name));
const img = page.locator("#todaysHideImg");
const xf = await page.evaluate(() => document.getElementById("todaysHidePan").style.transform);
console.log("hunt transform", xf);

// Select washer, miss 3 times far from it, hint appears
await page.locator(`#todaysHideList button[data-id="${washer.id}"]`).tap();
await page.waitForFunction((id) => {
  const btn = document.querySelector(`#todaysHideList button[data-id="${id}"]`);
  return btn && btn.getAttribute("aria-pressed") === "true";
}, washer.id);
const missX = 0.82;
const missY = 0.22;
const box = await img.boundingBox();
const wx = box.x + washer.x * box.width, wy = box.y + washer.y * box.height;
const mx = box.x + missX * box.width, my = box.y + missY * box.height;
const hitInfo = await page.evaluate(({ wx, wy, mx, my }) => {
  const at = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? { id: el.id, cls: String(el.className), tag: el.tagName, y } : { y };
  };
  const br = document.getElementById("todaysHideImg").getBoundingClientRect();
  return { vw: innerWidth, vh: innerHeight, scrollY, br, atWasher: at(wx, wy), atMiss: at(mx, my) };
}, { wx, wy, mx, my });
console.log("hitInfo", JSON.stringify(hitInfo));
await tapNorm(page, img, missX, missY);
await tapNorm(page, img, missX + 0.02, missY);
await tapNorm(page, img, missX, missY + 0.02);
const hintText = await page.locator("#todaysHideMsg").textContent();
const pulse = await page.locator(".th-hint-pulse").count();
if (!(/Look near there/.test(hintText) || pulse > 0)) {
  console.log("debug hint", { hintText, pulse });
}
check("hint after 3 misses on the selected item", /Look near there/.test(hintText) || pulse > 0);

await tapNorm(page, img, washer.x, washer.y);
const foundWasher = await page.evaluate((id) => {
  const btn = document.querySelector(`#todaysHideList button[data-id="${id}"]`);
  return !!(btn && btn.classList.contains("th-done"));
}, washer.id);
check("tapping the steel ring checks it off", foundWasher);

// Find the rest
for (const it of items) {
  if (it.id === washer.id) continue;
  await scrollHide(page);
  await page.locator(`#todaysHideList button[data-id="${it.id}"]`).tap();
  await page.waitForFunction((id) => {
    const btn = document.querySelector(`#todaysHideList button[data-id="${id}"]`);
    return btn && (btn.getAttribute("aria-pressed") === "true" || btn.classList.contains("th-done"));
  }, it.id);
  await scrollHide(page);
  await tapNorm(page, img, it.x, it.y);
  const done = await page.evaluate((id) => document.querySelector(`#todaysHideList button[data-id="${id}"]`)?.classList.contains("th-done"), it.id);
  if (!done) {
    await tapNorm(page, img, it.x, it.y);
  }
}
const solved = await page.locator("#todaysHideMsg").textContent();
const doneCount = await page.locator("#todaysHideList button.th-done").count();
if (!(doneCount === 5 && /Found them all/.test(solved))) {
  const pending = await page.evaluate(() => Array.from(document.querySelectorAll("#todaysHideList button")).map((b) => ({ id: b.getAttribute("data-id"), name: b.textContent, done: b.classList.contains("th-done") })));
  console.log("debug five", { doneCount, solved, pending });
}
check("finding all five solves the day", doneCount === 5 && /Found them all/.test(solved));

await page.screenshot({ path: path.join(OUT, "playwright-five-found.png") });

// Legacy single-item day: miss x3 shows hint, tap finds it
await page.evaluate(() => { try { localStorage.removeItem("zabHideFound:2026-11-23"); } catch (e) {} });
await page.evaluate(() => window.ZabbadatHide.showDay("2026-11-23"));
await page.waitForFunction(() => {
  const img = document.getElementById("todaysHideImg");
  return img && /2026-11-23/.test(img.src);
}, { timeout: 8000 });
await sleep(200);
const one = H.unpackDay(man.days["2026-11-23"])[0];
await tapNorm(page, img, 0.8, 0.2);
await tapNorm(page, img, 0.75, 0.25);
await tapNorm(page, img, 0.82, 0.18);
const legacyHint = await page.locator("#todaysHideMsg").textContent();
const legacyPulse = await page.locator(".th-hint-pulse").count();
check("legacy picture: 3 misses show a hint", /Look near there/.test(legacyHint) || legacyPulse > 0);
await tapNorm(page, img, one.x, one.y);
const legacyFound = await page.locator("#todaysHideMsg").textContent();
if (!/A washer\./.test(legacyFound)) console.log("debug legacy", { legacyFound, legacyHint });
check("legacy picture: tapping the object finds it", /A washer\./.test(legacyFound));

await page.screenshot({ path: path.join(OUT, "playwright-legacy-found.png") });
await browser.close();

const ok = results.every((r) => r.ok);
console.log((ok ? "OK" : "NOT OK") + "  " + results.filter((r) => r.ok).length + " passed, " + results.filter((r) => !r.ok).length + " failed");
process.exit(ok ? 0 : 1);
