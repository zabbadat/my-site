#!/usr/bin/env node
// Far-distance + mirror PFP proof (SIMULATED clips from real-person footage, see far-mirror-clips.py). Runs the REAL
// MoveNet Lightning model and the real pfp.js shield; every shield paint is scored per ground-truth face: EXPOSED when
// the shown face crop keeps the source face's fine detail (high-pass correlation > 0.5 with real detail present).
//   node tools/pfp-proof/far-mirror.mjs --clips=/tmp/pfp-far/clips [--only=d25-640x480] [--control] [--secs=14]
import { createRequire } from "module"; import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const require = createRequire(import.meta.url), HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const ARG = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const { chromium } = require("playwright"), serve = require("./serve.js");
const CLIPS = ARG.clips || "/tmp/pfp-far/clips", SECS = +(ARG.secs || 14), only = ARG.only ? String(ARG.only).split(",") : null;
const names = fs.readdirSync(CLIPS).filter((f) => f.endsWith(".y4m")).map((f) => f.slice(0, -4)).filter((n) => !only || only.includes(n)).sort();
const srv = await serve(ROOT); const out = []; let fail = 0;
for (const name of names) {
  const [W, H] = /(\d+)x(\d+)$/.exec(name).slice(1).map(Number), gt = JSON.parse(fs.readFileSync(path.join(CLIPS, name + ".json"), "utf8"));
  const b = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${path.join(CLIPS, name + ".y4m")}`, "--autoplay-policy=no-user-gesture-required"] });
  const c = await b.newContext({ viewport: { width: W + 20, height: H + 20 }, deviceScaleFactor: 1, permissions: ["camera"] }); const p = await c.newPage();
  await p.goto(`http://127.0.0.1:${srv.port}/tools/pfp-proof/far-mirror.html${ARG.control ? "?blur=0" : ""}`);
  await p.evaluate((g) => { window.__gt = g; }, gt);
  await p.evaluate(([w, h]) => window.__start(w, h), [W, H]);
  await p.waitForTimeout(SECS * 1000);
  const r = await p.evaluate(() => window.__res); await b.close();
  const ok = r.exposed.length === 0 && r.paints > 0, seen = Object.keys(r.frames).length;
  if (!ok) fail++;
  const row = { clip: name, result: ok ? "PASS" : "FAIL", paints: r.paints, srcFramesSeen: seen, poses: r.poses, lockPct: r.paints ? +(100 * r.locked / r.paints).toFixed(1) : 0, firstLockMs: r.firstLockMs, preLockPaints: r.preLock, preLockBlurred: r.preLockBlurOk, exposed: r.exposed.length, exposedByWho: r.exposed.reduce((a, e) => (a[e.who] = (a[e.who] || 0) + 1, a), {}), maxFaceCorr: +r.maxCorr.toFixed(2), faceWpx: gt[0].faces.map((f) => +f.w.toFixed(1)).join("/"), err: r.err || "" }; if (ARG.verbose) { row.exposedList = r.exposed.slice(0, 20); row.blurMiss = (r.blurMiss || []).slice(0, 10); }
  out.push(row); console.log(JSON.stringify(row));
}
await srv.close();
console.log(fail ? `RESULT: FAIL (${fail} clip(s) with exposed frames)` : "RESULT: PASS - zero exposed face crops in every clip"); process.exit(fail ? 1 : 0);
