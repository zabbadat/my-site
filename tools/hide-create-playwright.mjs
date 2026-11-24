// Phone + desktop upload flow for Create-your-own Hide.
import { chromium } from "/workspace/pwtools/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";

const BASE = process.argv[2] || "http://127.0.0.1:8765";
const OUT = process.argv[3] || "/workspace/zabbadat-notes/hide-create";
const REAL = path.resolve("test/fixtures/hide-create/sample-real.jpg");
const CARTOON = path.resolve("test/fixtures/hide-create/sample-cartoon.jpg");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(n, ok) { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); results.push({ n, ok: !!ok }); }

async function scrollHide(page) {
  await page.evaluate(() => {
    const stage = document.getElementById("todaysHideStage") || document.getElementById("todays-hide");
    if (!stage) return;
    const navh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navh")) || 72;
    const y = stage.getBoundingClientRect().top + window.scrollY - navh - 8;
    window.scrollTo(0, Math.max(0, y));
  });
  await sleep(140);
}

async function scrollSection(page) {
  await page.locator("#todays-hide").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const sec = document.getElementById("todays-hide");
    if (!sec) return;
    const navh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--navh")) || 72;
    const top = sec.getBoundingClientRect().top + (document.scrollingElement.scrollTop || window.scrollY) - navh - 8;
    document.scrollingElement.scrollTop = Math.max(0, top);
  });
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
    const controls = box("todaysHideControls"), hint = box("todaysHideHint");
    const breath = box("todaysHideBreath"), cue = box("todaysHideCue");
    let maxFs = 0;
    document.querySelectorAll("#todays-hide *").forEach((el) => {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return;
      const fs = parseFloat(st.fontSize);
      if (fs > maxFs) maxFs = fs;
    });
    return { line, list, stage, controls, hint, breath, cue, maxFs };
  });
}

async function assertLayout(page, label, expectedLine) {
  const m = await layoutMetrics(page);
  check(label + " line sits above the list", !!(m.line && m.list && m.line.b <= m.list.y + 2));
  check(label + " list sits above the picture", !!(m.list && m.stage && m.list.b <= m.stage.y + 2));
  check(label + " Hint/-/+ sit under the picture", !!(m.stage && m.hint && m.stage.b <= m.hint.y + 2));
  check(label + " Hint/-/+ sit above the ring", !!(m.controls && m.breath && m.controls.b <= m.breath.y + 2));
  check(label + " Breathe and look sits under the picture", !!(m.cue && m.stage && m.cue.y >= m.stage.b - 2));
  check(label + " line is the largest text in the section", !!(m.line && m.line.fs >= m.maxFs - 0.5));
  if (expectedLine) check(label + " shows the expected line", m.line && m.line.text === expectedLine);
  if (!(m.stage && m.hint && m.controls && m.breath)) console.log("debug layout", label, JSON.stringify(m));
  return m;
}

async function tapNorm(page, img, nx, ny) {
  const box = await img.boundingBox();
  if (!box) throw new Error("no image box");
  const px = Math.max(1, Math.min(box.width - 1, nx * box.width));
  const py = Math.max(1, Math.min(box.height - 1, ny * box.height));
  await img.click({ position: { x: px, y: py }, force: true, timeout: 8000 });
  await sleep(450);
}

function buildStamp(page) {
  return page.evaluate(() => {
    const b = window.ZabbadatHideCreate && window.ZabbadatHideCreate.lastBuild;
    return b ? String(b.seed) + ":" + String(b.src || "") : "";
  });
}
async function waitCustomReady(page, prevStamp) {
  try {
    await page.waitForFunction((prev) => {
      const list = document.getElementById("todaysHideList");
      const img = document.getElementById("todaysHideImg");
      const custom = window.ZabbadatHide && window.ZabbadatHide.isCustom && window.ZabbadatHide.isCustom();
      const b = window.ZabbadatHideCreate && window.ZabbadatHideCreate.lastBuild;
      const stamp = b ? String(b.seed) + ":" + String(b.src || "") : "";
      if (prev && stamp === prev) return false;
      return !!(custom && b && list && !list.hidden && list.querySelectorAll("button").length === 5 &&
        img && img.complete && img.naturalWidth > 0);
    }, prevStamp || "", { timeout: 45000 });
  } catch (err) {
    const state = await page.evaluate(() => ({
      custom: window.ZabbadatHide && window.ZabbadatHide.isCustom && window.ZabbadatHide.isCustom(),
      err: (document.getElementById("todaysHideCreateErr") || {}).textContent,
      listN: document.querySelectorAll("#todaysHideList button").length,
      listHidden: (document.getElementById("todaysHideList") || {}).hidden,
      imgW: (document.getElementById("todaysHideImg") || {}).naturalWidth,
      last: !!(window.ZabbadatHideCreate && window.ZabbadatHideCreate.lastBuild)
    }));
    console.log("waitCustomReady state", state);
    if (typeof pageLogs !== "undefined") console.log("page logs\n" + pageLogs.slice(-20).join("\n"));
    throw err;
  }
}

async function upload(page, filePath, seed) {
  await page.locator("#todaysHideMake").click();
  await page.waitForSelector("#todaysHideCreate:not([hidden])", { timeout: 5000 });
  await page.locator("#todaysHideFile").setInputFiles(filePath);
  if (seed != null) {
    // The change handler already started a build with Date.now(). Wait, then rebuild with a seed if needed.
    // Prefer a direct call when we want a known seed: intercept by running after files are set is racy.
    // Instead, after first build, we only seed via evaluate runWithFile for the reshuffle tests.
  }
  await waitCustomReady(page);
}

async function huntAll(page, label) {
  const img = page.locator("#todaysHideImg");
  const items = await page.evaluate(() => {
    const st = window.ZabbadatHide && window.ZabbadatHide.getPlayState && window.ZabbadatHide.getPlayState();
    return st && st.items ? st.items : [];
  });
  check(label + " built five items", items.length === 5);
  check(label + " includes the steel ring", items.some((it) => /washer/i.test(it.name)));
  if (!items.length) return;

  const first = items[0];
  const listBtn = page.locator(`#todaysHideList button[data-id="${first.id}"]`);
  try { await listBtn.tap(); } catch (e) { await listBtn.click(); }
  await page.waitForFunction((id) => {
    const btn = document.querySelector(`#todaysHideList button[data-id="${id}"]`);
    return btn && (btn.getAttribute("aria-pressed") === "true" || btn.classList.contains("th-done"));
  }, first.id);
  await scrollHide(page);
  let miss = { x: 0.12, y: 0.12 };
  const far = (x, y) => items.every((it) => Math.hypot(x - it.x, y - it.y) > 0.22);
  for (const cand of [{ x: 0.12, y: 0.12 }, { x: 0.88, y: 0.12 }, { x: 0.12, y: 0.88 }, { x: 0.5, y: 0.12 }]) {
    if (far(cand.x, cand.y)) { miss = cand; break; }
  }
  await tapNorm(page, img, miss.x, miss.y);
  await tapNorm(page, img, miss.x + 0.03, miss.y);
  await tapNorm(page, img, miss.x, miss.y + 0.03);
  const hinted = await page.evaluate(() => {
    const msg = (document.getElementById("todaysHideMsg") || {}).textContent || "";
    const pulse = !!document.querySelector("#todaysHideMarks .th-hint-pulse, .th-hint-pulse");
    return { msg, pulse };
  });
  if (!(/Look near there/.test(hinted.msg) || hinted.pulse)) console.log("debug hint", label, hinted);
  check(label + " hint after 3 misses", /Look near there/.test(hinted.msg) || hinted.pulse);
  await page.evaluate(() => { const b = document.getElementById("todaysHideReset"); if (b && !b.hidden) b.click(); });
  await sleep(120);

  for (const it of items) {
    const already = await page.evaluate((id) => {
      const btn = document.querySelector(`#todaysHideList button[data-id="${id}"]`);
      return !!(btn && btn.classList.contains("th-done"));
    }, it.id);
    if (already) continue;
    const btn = page.locator(`#todaysHideList button[data-id="${it.id}"]`);
    try { await btn.tap(); } catch (e) { await btn.click(); }
    await page.waitForFunction((id) => {
      const b = document.querySelector(`#todaysHideList button[data-id="${id}"]`);
      return b && (b.getAttribute("aria-pressed") === "true" || b.classList.contains("th-done"));
    }, it.id);
    await scrollHide(page);
    await tapNorm(page, img, it.x, it.y);
    const ok = await page.evaluate((id) => document.querySelector(`#todaysHideList button[data-id="${id}"]`)?.classList.contains("th-done"), it.id);
    if (!ok) await tapNorm(page, img, it.x, it.y);
  }
  const done = await page.evaluate(() => {
    const msg = (document.getElementById("todaysHideMsg") || {}).textContent || "";
    const share = document.getElementById("todaysHideShare");
    const n = document.querySelectorAll("#todaysHideList button.th-done").length;
    const st = window.ZabbadatHide.getPlayState && window.ZabbadatHide.getPlayState();
    return { msg, share: share && !share.hidden, n, custom: st && st.custom, line: (document.getElementById("todaysHideLine")||{}).textContent };
  });
  if (!(done.n === 5 && /Found them all/.test(done.msg))) console.log("debug five", label, done);
  check(label + " finds all five", done.n === 5 && /Found them all/.test(done.msg));
  check(label + " Share is shown", !!done.share);
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2
});
const page = await phone.newPage();
page.setDefaultTimeout(60000);
const pageLogs = [];
page.on("console", (m) => pageLogs.push(m.type() + ": " + String(m.text()).slice(0, 400)));
page.on("pageerror", (e) => pageLogs.push("PAGEERROR " + e.message));
const leaked = [];
function noteIfLeaked(req) {
  const url = req.url();
  const method = req.method();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const type = String((req.headers() && req.headers()["content-type"]) || "");
  if (/image|multipart|form-data/i.test(type) || /hide-imagine|api\.x\.ai|firebasestorage|googleapis\.com\/upload/i.test(url)) {
    leaked.push({ method, url, type });
  }
}
page.on("request", noteIfLeaked);

await page.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await scrollSection(page);

check("no AI button is shown", await page.evaluate(() => {
  const sec = document.getElementById("todays-hide");
  return !!(sec && !/Paint with AI/i.test(sec.textContent || "") && !document.getElementById("todaysHideAi"));
}));

await page.locator("#todaysHideMake").click();
await page.waitForSelector("#todaysHideCreate:not([hidden])", { timeout: 5000 });
check("Make your own opens the on-device picker", await page.locator("#todaysHideCreate").isVisible());

await page.locator("#todaysHideFile").setInputFiles(REAL);
await waitCustomReady(page, "");
await scrollSection(page);
await assertLayout(page, "phone custom", "Your hide. Breathe and look.");
await page.locator("#todays-hide").screenshot({ path: path.join(OUT, "ui-phone.png") });

const firstPos = await page.evaluate(() => {
  const b = window.ZabbadatHideCreate.lastBuild;
  return b.items.map((it) => ({ id: it.id, x: it.x, y: it.y }));
});
await huntAll(page, "phone real");
await scrollHide(page);
await page.locator("#todays-hide").screenshot({ path: path.join(OUT, "sample-real-found.png") });

const beforeNew = await buildStamp(page);
await page.locator("#todaysHideNew").click();
await waitCustomReady(page, beforeNew);
const secondPos = await page.evaluate(() => {
  const b = window.ZabbadatHideCreate.lastBuild;
  return b.items.map((it) => ({ id: it.id, x: it.x, y: it.y }));
});
const moved = firstPos.some((it, i) => !secondPos[i] || it.x !== secondPos[i].x || it.y !== secondPos[i].y);
check("New hide reshuffles placement", moved && secondPos.length === 5);

const beforeCartoon = await buildStamp(page);
await page.evaluate(() => { const p = document.getElementById("todaysHideCreate"); if (p) p.hidden = false; });
await page.locator("#todaysHideFile").setInputFiles(CARTOON);
await waitCustomReady(page, beforeCartoon);
await scrollSection(page);
await huntAll(page, "phone cartoon");
await scrollHide(page);
await page.locator("#todays-hide").screenshot({ path: path.join(OUT, "sample-cartoon-found.png") });

await page.locator("#todaysHideBack").click();
await page.waitForFunction(() => !(window.ZabbadatHide && window.ZabbadatHide.isCustom && window.ZabbadatHide.isCustom()), null, { timeout: 8000 });
check("Today's picture returns to the daily hide", await page.evaluate(() => !window.ZabbadatHide.isCustom()));

await phone.close();

const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const dpage = await desk.newPage();
dpage.setDefaultTimeout(60000);
const dpageLogs = [];
dpage.on("console", (m) => dpageLogs.push(m.type() + ": " + String(m.text()).slice(0, 400)));
dpage.on("pageerror", (e) => dpageLogs.push("PAGEERROR " + e.message));
dpage.on("request", noteIfLeaked);
await dpage.goto(BASE + "/index.html", { waitUntil: "domcontentloaded" });
await dpage.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await scrollSection(dpage);
await dpage.locator("#todaysHideMake").click();
await dpage.waitForSelector("#todaysHideCreate:not([hidden])", { timeout: 5000 });
await dpage.locator("#todaysHideFile").setInputFiles(REAL);
await waitCustomReady(dpage, "");
await scrollSection(dpage);
await assertLayout(dpage, "desktop custom", "Your hide. Breathe and look.");
await dpage.locator("#todays-hide").screenshot({ path: path.join(OUT, "ui-desktop.png") });
await huntAll(dpage, "desktop real");
await dpage.locator("#todays-hide").screenshot({ path: path.join(OUT, "sample-real-desktop-found.png") });
await desk.close();
await browser.close();

check("photo was not posted off the device", leaked.length === 0);
if (leaked.length) console.log("leaked requests", leaked);

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} failed` : "\nAll create-hide Playwright checks passed.");
process.exit(failed ? 1 : 0);
