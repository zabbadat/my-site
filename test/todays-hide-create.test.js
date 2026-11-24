"use strict";
const fs = require("fs");
const path = require("path");
const C = require("../hide-create.js");
const fn = require("../netlify/functions/hide-imagine.js");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const src = fs.readFileSync(path.join(root, "hide-create.js"), "utf8");
const hideChunk = html.slice(html.indexOf('id="todays-hide"'), html.indexOf('<section id="push">'));
const at = (id) => hideChunk.indexOf(id);

let failed = 0;
function check(n, ok) {
  console.log((ok ? "PASS" : "FAIL") + "  " + n);
  if (!ok) failed += 1;
}

check("Make your own entry is in the hide section",
  /id="todaysHideMake">Make your own</.test(hideChunk) &&
  /id="todaysHideFile"/.test(hideChunk) &&
  /accept="image\/\*"/.test(hideChunk) &&
  /id="todaysHideNew"/.test(hideChunk) &&
  /id="todaysHideBack"[^>]*>Today's picture</.test(hideChunk));

check("create copy says the photo stays on the device",
  /Five hides, on this device only\./.test(hideChunk) &&
  /Pick a photo or take one\./.test(hideChunk));

check("no AI button or notice in the hide section",
  !/Paint with AI|HIDE_AI|grok-imagine|XAI_API_KEY/i.test(hideChunk));

check("AI flag is hard-off and no UI is allowed",
  C.HIDE_AI_ENABLED === false && C.aiUiAllowed() === false &&
  /var HIDE_AI_ENABLED = false;/.test(src));

check("imagine model and daily cap are single constants",
  C.IMAGINE_MODEL === "grok-imagine-image-2.0" &&
  C.IMAGINE_DAILY_CAP === 5 &&
  fn.IMAGINE_MODEL === "grok-imagine-image-2.0" &&
  fn.IMAGINE_DAILY_CAP === 5);

check("layout order is line, list, picture, Hint/-/+, then ring and cue",
  at('id="todaysHideLine"') > 0 &&
  at('id="todaysHideLine"') < at('id="todaysHideList"') &&
  at('id="todaysHideList"') < at('id="todaysHideStage"') &&
  at('id="todaysHideStage"') < at('id="todaysHideHint"') &&
  at('id="todaysHideHint"') < at('id="todaysHideZoomOut"') &&
  at('id="todaysHideZoomOut"') < at('id="todaysHideZoomIn"') &&
  at('id="todaysHideZoomIn"') < at('id="todaysHideBreath"') &&
  at('id="todaysHideBreath"') < at('id="todaysHideCue"') &&
  /id="todaysHideCue">Breathe and look\./.test(hideChunk));

check("index.html loads hide-create.js after hide-daily.js",
  html.indexOf('src="/hide-daily.js"') > 0 &&
  html.indexOf('src="/hide-daily.js"') < html.indexOf('src="/hide-create.js"') &&
  html.indexOf('src="/hide-create.js"') < html.indexOf('src="/plank-daily.js"'));

check("prop cut-outs and sample fixtures are present",
  fs.existsSync(path.join(root, "hide/props/washer.png")) &&
  fs.existsSync(path.join(root, "hide/props/bottle.png")) &&
  fs.existsSync(path.join(root, "hide/props/jumprope.png")) &&
  fs.existsSync(path.join(root, "hide/props/glove.png")) &&
  fs.existsSync(path.join(root, "hide/props/chalk.png")) &&
  fs.existsSync(path.join(root, "test/fixtures/hide-create/sample-real.jpg")) &&
  fs.existsSync(path.join(root, "test/fixtures/hide-create/sample-cartoon.jpg")));

check("photo never leaves the device (no upload path in the compositor)",
  !/firebase|firestore|netlify\.toml|XAI_API_KEY|FormData|fetch\(/i.test(src) &&
  /never leaves this device/.test(src));

check("HEIC gets a friendly message",
  /Try a JPG or PNG/.test(C.HEIC_MSG));

const a = C.placeItems({ width: 1600, height: 1200, seed: 42 });
const b = C.placeItems({ width: 1600, height: 1200, seed: 42 });
const c = C.placeItems({ width: 1600, height: 1200, seed: 99 });

check("seeded placement is deterministic",
  a.length === 5 &&
  a.every((it, i) => it.id === b[i].id && it.x === b[i].x && it.y === b[i].y && it.r === b[i].r));

check("a different seed changes at least one position",
  c.length === 5 && a.some((it, i) => it.x !== c[i].x || it.y !== c[i].y));

check("placement always includes the steel ring and five items",
  a.length === 5 && a.some((it) => it.id === "washer" && /washer/i.test(it.name)) &&
  ["washer", "bottle", "jumprope", "glove", "chalk"].every((id) => a.some((it) => it.id === id)));

function validSet(items, w, h, label) {
  let inside = true, clear = true, okR = true;
  for (const it of items) {
    if (!C.inBounds(it, w, h)) inside = false;
    if (!(it.r > 0 && it.r < 0.2)) okR = false;
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (!C.boxesClear(items[i], items[j], w, h, C.SNAP_PX, 300)) clear = false;
    }
  }
  check(label + " boxes are in-bounds", inside);
  check(label + " boxes have a sensible radius", okR);
  check(label + " boxes do not overlap snap zones", clear);
}
validSet(a, 1600, 1200, "seed 42");
validSet(C.placeItems({ width: 1152, height: 864, seed: 7 }), 1152, 864, "1152 seed 7");
validSet(C.placeItems({ width: 800, height: 800, seed: 3 }), 800, 800, "square seed 3");

check("faces are skipped when a cheap box is given", (() => {
  const faces = [{ x: 0.35, y: 0.12, w: 0.3, h: 0.32 }];
  const items = C.placeItems({ width: 1600, height: 1200, seed: 42, faces });
  return items.every((it) => {
    const hw = it.r, hh = it.r * (1600 / 1200) / Math.max(0.2, it.aspect || 1);
    const fx0 = faces[0].x - 0.06, fy0 = faces[0].y - 0.06;
    const fx1 = faces[0].x + faces[0].w + 0.06, fy1 = faces[0].y + faces[0].h + 0.06;
    return !(it.x + hw > fx0 && it.x - hw < fx1 && it.y + hh > fy0 && it.y - hh < fy1);
  });
})());

const prevFlag = process.env.HIDE_AI_ENABLED;
const prevKey = process.env.XAI_API_KEY;
delete process.env.HIDE_AI_ENABLED;
delete process.env.XAI_API_KEY;

function restoreEnv() {
  if (prevFlag == null) delete process.env.HIDE_AI_ENABLED;
  else process.env.HIDE_AI_ENABLED = prevFlag;
  if (prevKey == null) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = prevKey;
}

Promise.resolve()
  .then(() => fn.handler({ httpMethod: "POST", body: "{}" }))
  .then((res) => {
    check("imagine function is 404/disabled without flag and key",
      res.statusCode === 404 && /disabled/.test(res.body));
    process.env.HIDE_AI_ENABLED = "true";
    delete process.env.XAI_API_KEY;
    return fn.handler({ httpMethod: "POST", body: "{}" });
  })
  .then((res) => {
    check("imagine function stays 404 with only the flag set",
      res.statusCode === 404 && /disabled/.test(res.body));
    delete process.env.HIDE_AI_ENABLED;
    process.env.XAI_API_KEY = "not-a-real-key";
    return fn.handler({ httpMethod: "POST", body: "{}" });
  })
  .then((res) => {
    check("imagine function stays 404 with only a key set",
      res.statusCode === 404 && /disabled/.test(res.body));
    restoreEnv();
    if (failed) {
      console.error("\n" + failed + " failed");
      process.exit(1);
    }
    console.log("\nAll create-hide checks passed.");
  })
  .catch((err) => {
    restoreEnv();
    console.error(err);
    process.exit(1);
  });
