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
  // scrollIntoView keeps the picture in the phone viewport. window.scrollTo can
  // leave #todaysHideImg below the fold (img top past vh), so hunt taps miss.
  const loc = page.locator("#todaysHideStage");
  if (await loc.count()) await loc.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const stage = document.getElementById("todaysHideStage") || document.getElementById("todays-hide");
    if (!stage) return;
    const navh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navh")) || 72;
    const el = document.scrollingElement || document.documentElement;
    const top = stage.getBoundingClientRect().top + el.scrollTop - navh - 8;
    el.scrollTop = Math.max(0, top);
  });
  await page.waitForFunction(() => {
    const img = document.getElementById("todaysHideImg");
    if (!img) return true;
    const r = img.getBoundingClientRect();
    const navh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navh")) || 72;
    return r.bottom > navh && r.top < window.innerHeight;
  }, { timeout: 5000 }).catch(() => {});
  await sleep(120);
}
async function scrollSection(page) {
  const loc = page.locator("#todays-hide");
  await loc.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const sec = document.getElementById("todays-hide");
    if (!sec) return;
    const navh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navh")) || 72;
    const top = sec.getBoundingClientRect().top + (document.scrollingElement.scrollTop || window.scrollY) - navh - 8;
    document.scrollingElement.scrollTop = Math.max(0, top);
  });
  await page.waitForFunction(() => {
    const line = document.getElementById("todaysHideLine");
    if (!line) return false;
    const r = line.getBoundingClientRect();
    return line.textContent.trim().length > 5 && r.top >= 0 && r.bottom <= (window.innerHeight + 20);
  }, { timeout: 5000 }).catch(() => {});
  await sleep(160);
}
async function layoutMetrics(page) {
  return page.evaluate(() => {
    const box = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return { y: r.top, b: r.bottom, fs: parseFloat(getComputedStyle(el).fontSize) || 0, text: (el.textContent || "").trim() };
    };
    const line = box("todaysHideLine"), list = box("todaysHideList"), stage = box("todaysHideStage");
    const hint = box("todaysHideHint"), zoomIn = box("todaysHideZoomIn"), zoomOut = box("todaysHideZoomOut");
    const breath = box("todaysHideBreath"), cue = box("todaysHideCue");
    let maxFs = 0;
    document.querySelectorAll("#todays-hide *").forEach((el) => {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return;
      const fs = parseFloat(st.fontSize);
      if (fs > maxFs) maxFs = fs;
    });
    return { line, list, stage, hint, zoomIn, zoomOut, breath, cue, maxFs };
  });
}
async function assertLayout(page, label) {
  const m = await layoutMetrics(page);
  check(label + " line sits above the list", !!(m.line && m.list && m.line.b <= m.list.y + 2));
  check(label + " extra space between the line and the item pills", !!(m.line && m.list && (m.list.y - m.line.b) >= 20));
  check(label + " list sits above the picture", !!(m.list && m.stage && m.list.b <= m.stage.y + 2));
  check(label + " Hint and zoom sit directly under the picture", !!(m.stage && m.hint && m.zoomOut && m.zoomIn &&
    m.stage.b <= m.hint.y + 2 && Math.abs(m.hint.y - m.zoomOut.y) < 8 && Math.abs(m.hint.y - m.zoomIn.y) < 8));
  check(label + " breath ring sits under the Hint and zoom buttons", !!(m.hint && m.breath && m.hint.b <= m.breath.y + 2));
  check(label + " Breathe and look sits under the picture", !!(m.cue && m.stage && m.cue.y >= m.stage.b - 2));
  check(label + " daily line is the largest text in the section", !!(m.line && m.line.fs >= m.maxFs - 0.5));
  check(label + " shows the daily line", m.line && m.line.text === "Breathe still. The hidden reveal themselves to the calm.");
  if (!(m.line && m.list && m.line.b <= m.list.y + 2 && m.list.b <= m.stage.y + 2 && m.hint && m.stage.b <= m.hint.y + 2)) {
    console.log("debug layout", label, JSON.stringify(m));
  }
  return m;
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
await scrollSection(page);
await assertLayout(page, "phone");
await page.locator("#todays-hide").screenshot({ path: path.join(OUT, "layout-phone.png") });

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

const desk = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await desk.goto(BASE + "/index.html", { waitUntil: "networkidle" });
await desk.evaluate(() => window.ZabbadatHide.showDay("2026-11-24"));
await desk.waitForFunction(() => {
  const list = document.getElementById("todaysHideList");
  return list && !list.hidden && list.querySelectorAll("button").length === 5;
}, { timeout: 8000 });
await scrollSection(desk);
await assertLayout(desk, "desktop");
await desk.locator("#todays-hide").screenshot({ path: path.join(OUT, "layout-desktop.png") });
await desk.close();

await browser.close();

const ok = results.every((r) => r.ok);
console.log((ok ? "OK" : "NOT OK") + "  " + results.filter((r) => r.ok).length + " passed, " + results.filter((r) => !r.ok).length + " failed");
process.exit(ok ? 0 : 1);
