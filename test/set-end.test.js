// End of set (Nov 16, owner): after the last rep a push-up set must END (complete or fail) and LEAVE CAMERA MODE in every
// push-up camera view, and every exercise camera screen has an End set button as a manual fallback.
// Bug reproduced: Sets with target 20 kept counting / stayed in camera mode after rep 20, and a set where the user stopped
// repping (lying down, sat back) never ended. Runs the real shared watch (push-session.js createSetEnd), the real poseTick /
// endPushSetAuto / exitPushCam from index.html through the push-flow harness, and checks the End set wiring on each screen.
// Run: node test/set-end.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), run = require("./lib/push-flow-harness.js");
const SS = require("../push-session.js");
const HTML = path.join(__dirname, "..", "index.html"), html = fs.readFileSync(HTML, "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const K = [{ name: "left_shoulder", x: 100, y: 100, score: 0.9 }, { name: "right_shoulder", x: 200, y: 100, score: 0.9 }];

// ---- 1. Shared rule (pure) ----
{
  const e = SS.createSetEnd(); e.reset(0);
  let got = null; for (let r = 1; r <= 60; r++) got = got || e.update({ mode: "sets", reps: r, target: 20, t: r * 2000, atTop: true, kps: K });
  check("sets: reaching and passing the target (20, then up to 60 reps) never ends the set (owner: target is not an end)", got === null);
  const e5 = SS.createSetEnd(); e5.reset(0); let g5 = null; for (let r = 1; r <= 12; r++) g5 = g5 || e5.update({ mode: "sets", reps: r, target: 5, t: r * 2000, atTop: true, kps: K });
  check("sets: a configured target (5) reached and passed never ends the set", g5 === null);
  const st = SS.createSetEnd(); st.reset(0); st.update({ mode: "sets", reps: 2, t: 1000, atTop: false, kps: K }); let s1 = null; for (let t = 1000; t <= 20000; t += 100) s1 = s1 || st.update({ mode: "sets", reps: 2, t, atTop: false, kps: K });
  check("sticky: once ended it stays ended until reset", s1 === "stalled" && st.update({ mode: "sets", reps: 3, t: 20100, kps: K }) === "stalled" && (st.reset(0), st.update({ mode: "sets", reps: 0, t: 1, kps: K }) === null));
}
for (const mode of ["sets", "long", "challenge", "battle"]) {
  const e = SS.createSetEnd(); e.reset(0); e.update({ mode, reps: 5, target: 0, t: 10000, atTop: true, kps: K });
  let at = null; for (let t = 10000; t <= 40000 && !at; t += 100) if (e.update({ mode, reps: 5, target: 0, t, atTop: false, kps: K })) at = t;
  check(`${mode}: no rep for 15 s while seen and off the top (lying down / sat back) -> 'stalled' at ~25 s (${at})`, at != null && at >= 25000 && at <= 25200);
  const f = SS.createSetEnd(); f.reset(0); f.update({ mode, reps: 5, target: 0, t: 10000, atTop: true, kps: K });
  let early = null; for (let t = 10000; t < 24900; t += 100) early = early || f.update({ mode, reps: 5, target: 0, t, atTop: false, kps: K });
  check(`${mode}: no instant end, nothing before 15 s`, early === null);
}
for (const mode of ["long", "challenge", "battle"]) {
  const e = SS.createSetEnd(); e.reset(0); e.update({ mode, reps: 4, t: 1000, atTop: true, kps: K });
  let any = null; for (let t = 1000; t <= 200000; t += 100) any = any || e.update({ mode, reps: 4, t, atTop: true, kps: K });
  check(`${mode}: holding the top (plank push press) never stalls`, any === null);
  const o = SS.createSetEnd(); o.reset(0); o.update({ mode, reps: 4, t: 1000, atTop: true, kps: K });
  let off = null; for (let t = 1000; t <= 200000; t += 100) off = off || o.update({ mode, reps: 4, t, atTop: false, kps: [] });
  check(`${mode}: frames with no body in view never stall (out of frame keeps its own rule)`, off === null);
}
{
  const e = SS.createSetEnd(); e.reset(0); e.update({ mode: "sets", reps: 3, target: 20, t: 1000, atTop: true, kps: K });
  let at = null; for (let t = 1000; t <= 60000 && !at; t += 100) if (e.update({ mode: "sets", reps: 3, target: 20, t, atTop: true, kps: K })) at = t;
  check(`sets: no rep at all for 45 s ends the set (top hold included; 30 s hold bonus still reachable) (${at})`, at === 46000);
  const z = SS.createSetEnd(); z.reset(0); let a0 = null; for (let t = 0; t <= 120000; t += 100) a0 = a0 || z.update({ mode: "sets", reps: 0, target: 20, t, atTop: false, kps: K });
  check("0 reps: never auto-ends (End set / Finish set ends it)", a0 === null);
  const h = SS.createSetEnd(); h.reset(0); h.update({ mode: "long", reps: 2, t: 1000, kps: K });
  const hood = [{ name: "left_shoulder", x: 1, y: 1, score: 0.8 }]; let hd = null; for (let t = 1000; t <= 15000; t += 100) hd = hd || h.update({ mode: "long", reps: 2, t, atTop: false, kps: hood });
  check("hood / head down (shoulders seen, no face) is a normal frame: no early end", hd === null);
  check("FAIL_TEXT has the new reasons; no target-reached end exists", SS.FAIL_TEXT.stalled && SS.FAIL_TEXT.ended && !("target" in SS.FAIL_TEXT) && !/"target"/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "push-session.js"), "utf8")));
}

// ---- 2. Real page flow (poseTick -> endPushSetAuto -> save path -> exitPushCam) ----
const between = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); return html.slice(i, html.indexOf(b, i)); };
const realEnd = between("function endPushSetAuto(kind) {", "// End set button (#camEndBtn");
function setup(ctx) {
  let se = null, fw = null;
  Object.defineProperty(ctx, "pushSetEnd", { get: () => se || (se = ctx.ZabbadatSession.createSetEnd()) });
  Object.defineProperty(ctx, "failWatch", { get: () => fw || (fw = ctx.ZabbadatSession.createFailureWatch()) });
  vm.runInContext(`
function finishPushSet(why) { if (pushState.finished) return; log.push("finish:" + why + ":" + pushState.reps); pushState.running = false; pushState.finished = true; exitPushCam(); }
function voidTutSet(reason) { if (pushState.finished || !pushState.running) return; log.push("void:" + reason + ":" + pushState.reps); pushState.running = false; pushState.finished = true; exitPushCam(); }
function freezePushClock() { return 0; } function failExtra(st, w) { return { frameW: w }; } function pwOpt() { return {}; }
function stopCam() { log.push("stopCam"); poseLoopOn = false; poseLoopId += 1; camOn = false; camStream = null; }
function camExitFs() {} var HOLD_CAPPED_TEXT = "capped";
` + realEnd, ctx);
}
const rep = (t0, per, n) => (t) => { if (t < t0) return { d: 0 }; const k = Math.floor((t - t0) / per); if (n != null && k >= n) return { d: 0 }; const p = (t - t0) % per, q = per / 2.5; return { d: p < q ? p / q : p < q * 1.3 ? 1 : p < q * 2.3 ? 1 - (p - q * 1.3) / q : 0 }; };
(async () => {
  let ctx; const grab = (c) => { ctx = c; setup(c); };
  // 24 reps at 2 s with the default target 20: reaching 20 must NOT end the set; the camera stays on and counting continues
  let r = await run(HTML, { mode: "sets", script: rep(10000, 2000, 24), ms: 10000 + 24 * 2000 + 1000, setup: grab });
  let L = ctx.api.log;
  check(`Sets, target 20: reaching 20 does not end the set, counting continues past it (${r.reps} reps), camera still on`, r.reps >= 22 && r.running === true && !L.some((x) => /^(finish|void):/.test(x)) && !L.includes("stopCam"));
  r = await run(HTML, { mode: "sets", script: rep(10000, 2000, 10), ms: 10000 + 10 * 2000 + 1000, setup: (c) => { grab(c); c.$("pushTarget").value = "5"; } });
  L = ctx.api.log;
  check(`Sets, configured target 5: reaching it does not end the set (${r.reps} reps), camera still on`, r.reps >= 8 && r.running === true && !L.some((x) => /^(finish|void):/.test(x)) && !L.includes("stopCam"));
  // 6 reps then the user lies down at the bottom: stalled -> ends + exits (every push-up mode)
  for (const mode of ["sets", "long"]) { // the Two-minute challenge has no reps, so no stall end (two-minute-challenge.test.js)
    const lie = (t) => { const x = rep(10000, 2000, 6)(t); return t >= 10000 + 6 * 2000 ? { d: 1 } : x; };
    r = await run(HTML, { mode, script: lie, ms: 10000 + 6 * 2000 + 25000, setup: grab });
    const l = ctx.api.log, endLine = l.find((x) => /^(finish|void):/.test(x)) || "";
    check(`${mode}: 6 reps then lying at the bottom ends the set (${endLine}) and exits camera mode`, /(No push-up for a while|stalled)/.test(endLine) && l.includes("stopCam") && r.running === false);
  }
  // a long top hold in TUT does not end
  r = await run(HTML, { mode: "long", script: (t) => (t < 10000 + 6 * 2000 ? rep(10000, 2000, 6)(t) : { d: 0 }), ms: 10000 + 6 * 2000 + 40000, setup: grab });
  check("TUT: a 40 s top hold after the reps keeps the set going (minimums not caps)", !ctx.api.log.some((x) => /^(finish|void):/.test(x)) && r.running === true);

  // ---- 3. End set button on every exercise camera screen ----
  const btn = (id, wrap) => new RegExp('<div id="' + wrap + '"[\\s\\S]{0,900}<button class="btn cam-end-btn" id="' + id + '" type="button"[^>]*>End set</button>').test(html);
  check("push-ups / TUT / Two-minute challenge camera (#camWrap) has End set", btn("camEndBtn", "camWrap"));
  check("TUT Battle camera (#tbCamWrap) has End set", btn("tbEndBtn", "tbCamWrap"));
  check("plank / plank push press camera (#plankWrap) has End set", btn("plankEndBtn", "plankWrap"));
  check("End set buttons are wired", /\$\("camEndBtn"\)\.onclick = endSetNow;/.test(html) && /\$\("tbEndBtn"\)\.onclick = tbEndSetNow;/.test(html) && /\$\("plankEndBtn"\)\.onclick = plankEndSetNow;/.test(html));
  const css = (html.match(/\.cam-end-btn\{[^}]*\}/) || [""])[0];
  check("End set: large 52px tap target, safe-area aware, bottom-left (clear of the top counters / PFP row and the bottom-right Full screen button)", /min-height:52px/.test(css) && /env\(safe-area-inset-bottom/.test(css) && /env\(safe-area-inset-left/.test(css) && /left:/.test(css) && /bottom:/.test(css) && !/right:/.test(css));
  check("End set is visually secondary (muted/outline, not a solid primary fill) but clearly visible", /background:rgba\(/.test(css) && /border:2px solid/.test(css) && !/#ff2d55/.test(css) && !/display:\s*none/.test(css));
  check("End set buttons are in the camera wraps without a hidden attribute (visible whenever the camera screen is on)", ["camEndBtn", "tbEndBtn", "plankEndBtn"].every((id) => { const m = html.match(new RegExp('<button class="btn cam-end-btn" id="' + id + '"[^>]*>')); return m && !/\bhidden\b/.test(m[0]); }));
  check("auto-end is primary: detectors end a set with no End set tap", (() => { const w = SS.createFailureWatch(); w.reset(0); const SY = require("./lib/break-synth.js"); let hit = null; for (let t = 0; t <= 8000; t += 1000 / 30) { const r = w.update(SY.kpsOf(t < 2000 ? SY.POSE.top : SY.POSE.knees), t, 0, { frameW: 640, atTop: false, reps: 2 }); if (r) { hit = r; break; } } return hit === "knees"; })());
  // push End set: real endSetNow in a small vm
  const endSrc = between("function endSetNow() {", "// Leave push-up camera mode") || "";
  const realEndSet = html.slice(html.indexOf("function endSetNow() {"), html.indexOf("\n}", html.indexOf("function endSetNow() {")) + 2);
  for (const [mode, reps, running, expect] of [["sets", 7, true, "finish:Ended by you:7"], ["long", 3, true, "finish:Ended by you:3"], ["sets", 4, false, "finish:Ended by you:4"], ["challenge", 0, true, "hold:ended"]]) {
    const log = []; const els = {}; const $ = (id) => els[id] || (els[id] = { hidden: false, textContent: "" });
    const c = vm.createContext({ log, $, performance: { now: () => 1 }, pushState: { reps, running, finished: false, elapsed: running ? 0 : 9000, startedAt: running ? 1 : 0 }, pushMode: mode, pushStarting: false, camOn: true, camStream: {}, repVoice: { reset: () => log.push("repVoice.reset") },
      pushChallenge: { update() {}, result: () => ({ reps, tutMs: 1000 }) }, showChallengeResult() {}, sessionTouch() {}, cancelPushStart() { log.push("cancelStart"); } });
    vm.runInContext(`function finishPushSet(w) { if (pushState.finished) return; log.push("finish:" + w + ":" + pushState.reps); pushState.finished = true; pushState.running = false; }
function voidTutSet(w) { log.push("void:" + w + ":" + pushState.reps); pushState.finished = true; pushState.running = false; }
function endHoldChallenge(w) { log.push("hold:" + w); pushState.finished = true; pushState.running = false; }
function stopCam() { log.push("stopCam"); camOn = false; camStream = null; }
` + realEndSet, c);
    vm.runInContext("endSetNow()", c);
    check(`End set (${mode}, ${reps} reps, ${running ? "running" : "paused"}): saved through the normal path (${expect}), camera off, wrap hidden`, log.includes(expect) && log.includes("stopCam") && els.camWrap.hidden === true && log.includes("repVoice.reset"));
  }
  check("TUT End set before 1:20 + 10 is saved as an ordinary long set (completion still decided by tutCompleted in finishPushSet)", !SS.tutCompleted("long", 60000, 30) && !SS.tutCompleted("long", 90000, 9) && SS.tutCompleted("long", 80000, 10));
  // TUT Battle / plank End set + battle fail exits camera at once
  check("TUT Battle: a judge loss or a stall ends my set at once (tbEndMySet: camera off, Set complete, loss written with retries)", /if \(lost\) tbEndMySet\(lost\);/.test(html) && /function tbEndMySet\(reason\) \{[\s\S]{0,900}tbCamOff\(\);/.test(html) && /createSetEnd\(\{ mode: "battle"|tbSetEnd && tbSetEnd\.update\(\{ mode: "battle"/.test(html));
  check("TUT Battle End set: live -> loss as 'left' (allowed by the rules) + camera off; before Go -> camera off only", /function tbEndSetNow\(\) \{\s*if \(tbRoom && tbRoom\.status === "live"[^\n]*tbEndMySet\("left"\)/.test(html) && /tbCamOff\(\); if \(tbWake/.test(html));
  check("Plank End set: saves through stopPlankCam -> plankEnded (under 10 s is not a set), stops the countdown and the hold voice", /function plankEndSetNow\(\) \{[\s\S]{0,400}plankCount\.cancel\(\)[\s\S]{0,200}stopPlankCam\(\);[\s\S]{0,200}plankTimeVoice\.end\(\)/.test(html));
  check("every set end leaves camera mode: finishPushSet and the 0-rep TUT fail call exitPushCam", (html.match(/exitPushCam\(\); \/\/ set over/g) || []).length === 2);
  check("Stop camera mid-set still posts once and does not re-enter stopCam (camStopping guard)", /camStopping = true;[^\n]*\n\s*try \{ finishPushSet\("Camera stopped"\); \} finally \{ camStopping = false; \}/.test(html));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
