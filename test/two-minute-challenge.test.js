// Two-minute challenge (Nov 16, owner): a 2:00 clock counting down while you hold a push-up plank (high plank, arms straight).
// Complete at 0:00; a form break (knees / sag / pike / collapse / stood up), End set or Stop camera = failed, time held shown.
// Start shows the intro card AND speaks the intro line together, before the One, two, three, Go count.
// Run: node test/two-minute-challenge.test.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const C = require("../push-challenge.js"), SS = require("../push-session.js"), ET = require("../et-day.js"), G = require("../get-set.js");
const run = require("./lib/push-flow-harness.js"), SY = require("./lib/break-synth.js");
const R = []; const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const fnSrc = (n) => { const a = "function " + n + "("; const i = html.indexOf(a); if (i < 0) throw new Error("missing " + n); const eol = html.indexOf("\n", i), l = html.slice(i, eol);
  if (/\}\s*$/.test(l) && (l.match(/\{/g) || []).length === (l.match(/\}/g) || []).length) return l; return html.slice(i, html.indexOf("\n}", i) + 2); };

// ---- 1. pure clock
{ const h = C.createHoldChallenge(); h.start(1000);
  check("clock: 2:00 duration, counts down from 2:00", C.HOLD_CHALLENGE.durationMs === 120000 && h.snapshot(1000).remainingMs === 120000 && h.update(31000).remainingMs === 90000 && !h.update(31000).ended);
  const d = h.update(121000); check("clock: reaching 2:00 = complete, held 2:00, 0:00 left", d.ended && d.success && d.heldMs === 120000 && d.remainingMs === 0 && C.holdResultText(d) === "Two-minute challenge complete: held 2:00.");
  check("clock: nothing credited past 2:00; a late End set after 2:00 still counts as complete", h.stop(400000, "ended").success && h.snapshot(400000).heldMs === 120000); }
{ const h = C.createHoldChallenge(); h.start(0); const f = h.fail(72500, "knees");
  check("break at 1:12: failed, time held 1:12 shown with the reason", f.ended && !f.success && f.heldMs === 72500 && C.holdResultText(f, "Knees down") === "Two-minute challenge failed: held 1:12 (Knees down).");
  check("a second end after a failure changes nothing", h.fail(90000, "standing").heldMs === 72500 && h.state().reason === "knees"); }
{ const h = C.createHoldChallenge(); check("not started: update/fail are no-ops", !h.update(5000).ended && !h.fail(5000, "knees").ended); }
check("TUT Battle's own 3:00 clock (createChallenge) is untouched", C.createChallenge({ durationMs: 180000 }).options.durationMs === 180000 && /durationMs: 180000/.test(fs.readFileSync(path.join(ROOT, "tut-battle.js"), "utf8")));

// ---- 2. intro copy (card + spoken line)
check("spoken intro line, verbatim", C.INTRO.spoken === "Hold yourself up in a push press plank position. Hold for two minutes.");
check("written intro card: title + 2:00 clock + hold a push-up plank", C.INTRO.title === "Two-minute challenge" && /runs from 2:00 down to 0:00/.test(C.INTRO.lines[0]) && /Hold a push-up plank, arms straight, the whole two minutes/.test(C.INTRO.lines[1]));
check("page: intro card element present, hidden until Start", /<div class="twomin-intro" id="twoMinIntro" hidden/.test(html) && /\.twomin-intro\{position:fixed;inset:0;z-index:10001/.test(html));
check("intro speaks at the plank pace (VOICE rate 0.88) and resumes the speech engine first", G.VOICE.rate === 0.88 && /resume: true/.test(fnSrc("showTwoMinIntro")) && /ss\.resume\(\)/.test(fs.readFileSync(path.join(ROOT, "get-set.js"), "utf8")));

// ---- 3. labels / panel
check("mode button says Two-minute challenge; no three-minute copy left in the solo challenge", /id="modeChallengeBtn"[^>]*>Two-minute challenge</.test(html) && !/Three-minute|three-minute challenge/.test(html + fs.readFileSync(path.join(ROOT, "tut.html"), "utf8")));
check("challenge note: 2:00 down, hold a push-up plank, what ends it, today's line", /id="challengeNote"[^>]*>Two-minute challenge: the clock runs from 2:00 down to 0:00\. Hold a push-up plank, arms straight, the whole two minutes\./.test(html) && /id="twoMinToday"/.test(html));
check("I give up removed (DOM + handler); no Pause / Finish set / Reset total in the panel (Start-set-only panel on main); End set stays on the camera", !/pushGiveUpBtn|I give up/.test(html) && !/id="(pushPauseBtn|pushFinishBtn|pushTotalResetBtn)"/.test(html) && /<button class="btn cam-end-btn" id="camEndBtn" type="button"[^>]*>End set<\/button>/.test(html));
{ // renderPushMode in challenge: only Start challenge is visible in the panel row
  const els = {}; const $ = (id) => els[id] || (els[id] = { id, hidden: false, disabled: false, textContent: "", setAttribute() {} });
  const recs = [{ style: {} }];
  const ctx = vm.createContext({ $, pushMode: "challenge", pushState: { running: false, finished: false, elapsed: 0, reps: 0 }, postureGuard: null, currentUser: null, localStorage: { getItem: () => null, setItem() {} }, JSON, Date,
    document: { querySelectorAll: () => recs }, window: { ZabbadatSession: SS, ZabbadatChallenge: C, ZabbadatEtDay: ET } });
  vm.runInContext([fnSrc("renderPushMode"), fnSrc("pushRecBtns"), fnSrc("twoMinDayKey"), fnSrc("twoMinToday"), fnSrc("paintTwoMinToday")].join("\n") + "\nrenderPushMode();", ctx);
  const visible = ["pushStartBtn", "pushEndBtn"].filter((id) => !els[id].hidden);
  check("challenge panel: Start challenge is the only button (End session / Record hidden)", visible.join() === "pushStartBtn" && els.pushStartBtn.textContent === "Start challenge" && els.pushTargetWrap.hidden && recs[0].style.display === "none", visible.join());
  check("challenge panel: label Time left; today's line painted", els.pushSetLabel.textContent === "Time left" && els.twoMinToday.textContent === "Today: no tries yet.");
  vm.runInContext('pushMode = "sets"; renderPushMode();', ctx);
  check("Sets panel: Start set only (End session hidden), Record comes back", els.pushEndBtn.hidden && els.pushStartBtn.textContent === "Start set" && recs[0].style.display === ""); }

// ---- 4. today's totals reset at Eastern midnight on their own
{ const before = Date.UTC(2026, 10, 17, 4, 59), after = Date.UTC(2026, 10, 17, 5, 1); // 11:59 PM / 12:01 AM Eastern (EST, UTC-5)
  const kb = C.dayStatsKey("u1", ET.key(before)), ka = C.dayStatsKey("u1", ET.key(after));
  check("challenge totals key = uid + Eastern day: new key after Eastern midnight", kb === "zabbadat-twomin-u1-2026-11-16" && ka === "zabbadat-twomin-u1-2026-11-17");
  check("page keys today's challenge totals by ZabbadatEtDay.key()", /ZabbadatEtDay[\s\S]{0,200}dayStatsKey\(who, ET \? ET\.key\(\)/.test(fnSrc("twoMinDayKey")));
  let st = C.addDayStats(null, { success: false, heldMs: 45000 }); st = C.addDayStats(st, { success: true, heldMs: 120000 });
  check("totals: tries, completes, best hold", st.tries === 2 && st.done === 1 && st.bestMs === 120000 && C.dayStatsText(st) === "Today: 2 tries, 1 complete, best hold 2:00."); }

// ---- 5. endHoldChallenge: complete / failed / End set / Stop camera, and what is saved
function page(o) {
  o = o || {}; let now = o.now || 50000; const log = [], store = {};
  const els = {}; const $ = (id) => els[id] || (els[id] = { id, hidden: false, textContent: "", innerHTML: "", value: "" });
  const pc = C.createHoldChallenge({ durationMs: 120000 }); pc.start(o.start || 0);
  const ctx = vm.createContext({ $, log, store, pushState: { running: true, finished: false, reps: 0, tut: 0, elapsed: 0, startedAt: 1, tick: 1 }, pushMode: "challenge", pushChallenge: pc, TWO_MIN_MS: 120000,
    challengeFlags: { standing: 0, knees: 0 }, pushHoldsThisSet: o.holds || 0, currentUser: o.user === false ? null : { uid: "u1" }, displayNameOf: () => "Zab",
    performance: { now: () => now }, Date, JSON, Object, Promise, escapeHtml: String, formatTime: (ms) => Math.round(ms / 1000) + "s", clearInterval() {}, pushWake: { stop: () => ({ catch() {} }) },
    tutTimeVoice: { end: () => log.push("tutVoice.end") }, camFs: (id, on) => log.push("fs:" + on), renderPush() {}, exitPushCam: () => log.push("exitCam"), speakSetDone: () => log.push("say:done"),
    freshPushSet: () => { log.push("fresh"); Object.assign(ctx.pushState, { running: false, finished: false, reps: 0, elapsed: 0 }); pc.reset(); },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } },
    saveRemotePush: async (r) => { log.push("post:" + r.reps + ":" + r.ms + ":" + r.holds); return "id1"; }, awardZab: async (s, id) => { log.push("award:" + s + ":" + id); return { credited: 0.5 }; }, zabNote: (t) => " +" + t.credited + " ZAB.", zabRing() {},
    window: { ZabbadatChallenge: C, ZabbadatSession: SS, ZabbadatEtDay: ET } });
  vm.runInContext([fnSrc("twoMinDayKey"), fnSrc("twoMinToday"), fnSrc("paintTwoMinToday"), fnSrc("saveTwoMinDay"), fnSrc("showChallengeResult"), fnSrc("finishChallenge"), fnSrc("endHoldChallenge")].join("\n"), ctx);
  return { ctx, log, store, els, run: (s) => vm.runInContext(s, ctx), set now(v) { now = v; } };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
(async () => {
  let p = page({ now: 130000 }); p.run("finishChallenge()"); await tick();
  const k = Object.keys(p.store).find((x) => x.startsWith("zabbadat-twomin-u1-"));
  check("2:00 reached: complete card + status, camera mode exited, today's totals saved under the Eastern day", /Two-minute challenge complete: held 2:00\./.test(p.els.challengeResult.innerHTML) && /^Two-minute challenge complete: held 2:00\. Today: 1 try, 1 complete, best hold 2:00\./.test(p.els.pushStatus.textContent) && p.log.includes("exitCam") && k === "zabbadat-twomin-u1-" + ET.key());
  check("complete with no 30 s hold bonus earned: nothing posted (push-up totals untouched)", !p.log.some((x) => /^post:/.test(x)) && !Object.keys(p.store).some((x) => /push-total|push-sets|push-tut|zabbadat-pushups/.test(x)));
  p = page({ now: 72500 }); p.run('endHoldChallenge("knees", 72500)'); await tick();
  check("form break: failed, time held shown with the reason, Set complete spoken once, camera exited", /Two-minute challenge failed: held 1:12 \(Knees down\)\./.test(p.els.pushStatus.textContent) && p.log.filter((x) => x === "say:done").length === 1 && p.log.includes("exitCam") && p.ctx.pushState.running === false);
  p.run('endHoldChallenge("standing")'); check("a second end does nothing", p.log.filter((x) => x === "say:done").length === 1);
  p = page({ now: 45000 }); p.run('endHoldChallenge("ended")'); await tick();
  check("End set: failed, 'Ended by you', time held 0:45", /failed: held 0:45 \(Ended by you\)/.test(p.els.pushStatus.textContent));
  p = page({ now: 45000 }); p.run('endHoldChallenge("stopped")'); await tick();
  check("Stop camera: failed, 'Camera stopped', time held 0:45", /failed: held 0:45 \(Camera stopped\)/.test(p.els.pushStatus.textContent));
  p = page({ now: 130000, holds: 1 }); p.run("finishChallenge()"); await tick(); await tick();
  check("30 s hold bonus earned + signed in: posts the hold once (reps 0, ms 2:00, holds 1) and claims 'hold' (same 0.5 ZAB rule)", p.log.filter((x) => /^post:/.test(x)).join() === "post:0:120000:1" && p.log.includes("award:hold:id1") && /\+0\.5 ZAB\./.test(p.els.pushStatus.textContent));
  p = page({ now: 130000, holds: 1, user: false }); p.run("finishChallenge()"); await tick();
  check("signed out: nothing posted", !p.log.some((x) => /^post:/.test(x)));

  // ---- 6. page wiring
  const pt = html.slice(html.indexOf("async function poseTick("), html.indexOf("const CAM_CONSTRAINTS"));
  check("form breaks: the challenge uses the TUT failure watch (knees / collapse / stood up / sag-pike vs start pose), out of frame never ends it", /pushMode === "challenge" \? twoMinFailExtra\(performance\.now\(\)\)/.test(pt) && /settling \? \{ skipFrame: true, atTop: true, reps: 1 \} : \{ skipFrame: true, atTop: false, reps: 2 \}/.test(fnSrc("twoMinFailExtra")) && /if \(failed\) voidTutSet\(failed/.test(pt) && /if \(pushMode === "challenge" && pushChallenge\) \{ endHoldChallenge\(reason, failedAtPerf\); return; \}/.test(fnSrc("voidTutSet")));
  check("no rep counting and no stall end in the challenge (a hold has no reps); 2:00 ends it", /pushChallenge\.update\(performance\.now\(\)\); \/\/ a hold/.test(pt) && /pushSetEnd && pushState\.running && !pushState\.finished && pushMode !== "challenge"/.test(pt) && /now >= TWO_MIN_MS\) \{ finishChallenge\(\); return; \}/.test(html));
  check("clock shows 2:00 and counts down (HUD + page clock)", /const shown = pushMode === "challenge" \? Math\.max\(0, TWO_MIN_MS - now\) : now;/.test(html) && /"Challenge on\. 2:00 on the clock: hold your push-up plank, arms straight\."/.test(html));
  check("End set and Stop camera end the challenge as failed with time held", /if \(open && pushMode === "challenge" && pushChallenge\) \{ if \(pushState\.running\) endHoldChallenge\("ended"\); \}/.test(html) && /endHoldChallenge\("stopped"\)/.test(fnSrc("endPushOnCameraStop")));

  check("challenge uses its own watch with the plank-hold breaks on (form + elbows); push-up sets keep the definitive-break watch", /createFailureWatch\(window\.ZabbadatChallenge\.HOLD_FAIL_OPTS\)/.test(html) && /pushMode === "challenge" && typeof twoMinWatch !== "undefined" && twoMinWatch \? twoMinWatch : failWatch/.test(html) && C.HOLD_FAIL_OPTS.endOn.form === true && C.HOLD_FAIL_OPTS.endOn.elbows === true && SS.FAIL.endOn.form === false);
  // ---- 7. failure watch with the challenge settings: a steady hold never ends; knees / sag / collapse / stand do
  const X = vm.createContext({ pushChallenge: (() => { const h = C.createHoldChallenge(); h.start(0); return h; })() }); vm.runInContext("const TWO_MIN_BASE_MS = 1500;\n" + fnSrc("twoMinFailExtra"), X);
  const hold = (pose, from) => { const w = SS.createFailureWatch(C.HOLD_FAIL_OPTS); w.reset(0); for (let t = 0; t <= 125000; t += 1000 / 15) { const k = SY.kpsOf(t < from ? SY.POSE.top : SY.POSE[pose]); const f = w.update(k, t, 0, Object.assign({ frameW: 640 }, X.twoMinFailExtra(t))); if (f) return { f, t }; } return null; };
  check("a steady 2:00 high-plank hold never ends", hold("top", 1e9) === null);
  { const w = SS.createFailureWatch(C.HOLD_FAIL_OPTS); w.reset(0); let f = null; for (let t = 0; t <= 125000 && !f; t += 1000 / 15) f = w.update(SY.kpsOf(SY.POSE.top, { hood: true }), t, 0, Object.assign({ frameW: 640 }, X.twoMinFailExtra(t)));
    check("hood / head down (no nose) for the full 2:00 never ends it", f === null, f); }
  for (const [pose, want] of [["knees", "knees"], ["sag", "form"], ["pike", "form"], ["collapse", "collapse|elbows"], ["stand", "standing"]]) {
    const r = hold(pose, 20000); check(`${pose} at 0:20 ends it as '${want}' within ~1.5 s`, r && new RegExp("^(" + want + ")$").test(r.f) && r.t - 20000 < 2500, JSON.stringify(r)); }

  // ---- 8. Start flow (real startPush / beginPushClock / poseTick): card + spoken line together, then One two three Go, then the 2:00 clock
  const sp = []; let card = [];
  const res = await run(path.join(ROOT, "index.html"), { mode: "challenge", spoken: sp, script: () => ({ d: 0 }), ms: 40000, setup: (ctx, now) => {
    const el = ctx.$("twoMinIntro"); let h = true; Object.defineProperty(el, "hidden", { get: () => h, set: (v) => { if (v !== h) card.push({ hidden: v, at: now() }); h = v; } }); } });
  const intro = sp.find((x) => x.w === C.INTRO.spoken), shown = card.find((x) => x.hidden === false), gone = card.find((x) => x.hidden === true);
  check("Start: intro card shown and intro line spoken together in the tap (same moment)", intro && shown && intro.at === 0 && shown.at === 0, JSON.stringify({ intro, shown }));
  check("card stays up until the line has finished speaking, then the count", gone && gone.at >= 1000 && gone.at >= 2500, JSON.stringify(gone));
  const go = sp.findIndex((x) => /go/i.test(x.w) && x.at >= (gone ? gone.at : 0));
  check("after the card: One, two, three, Go, then the clock starts", go > sp.indexOf(intro) && res.startedAt > 0, JSON.stringify(sp.map((x) => x.w)));
  check("holding the plank 30 s after Go: still running, no reps counted, nothing ended", res.running === true && res.reps === 0);

  // ---- 9. PFP on every camera start (cover from the moment the camera opens; same Enable profile - PFP switch)
  const seg = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));
  check("PFP: push-ups / TUT / Two-minute challenge camera (#camVid): every pose frame, before the set starts", /ZabPfp\.frame\(vid, pose \? pose\.keypoints : \[\], tFrame\)/.test(pt) && pt.indexOf("ZabPfp.frame") < pt.indexOf("pushCounter.update"));
  check("PFP: plank / plank push press (#plankVid) from camera open", /ZabPfp\.plankFrame\(vid, kps/.test(seg("async function plankTick(", "function newPlankHold(")));
  check("PFP: TUT Battle (#tbVid) before Go", /ZabPfp\.frame\(v, kps, tFrame\)/.test(seg("async function tbPose()", "// 3:00 reached")));
  check("PFP: Go live self preview (#zlSelf) starts its PFP loop as soon as the camera is attached (and on camera flip), clears on stop", /v\.srcObject = zlStream; v\.hidden = false;[^\n]*zlPfpStart\(\)/.test(html) && /\$\("zlSelf"\)\.srcObject = s; zlPfpStart\(\)/.test(html) && /function zlStopTracks\(\) \{ zlPfpStop\(\);/.test(html) && /window\.ZabPfp\.frame\(v, p && p\[0\] \? p\[0\]\.keypoints : \[\], t\)/.test(fnSrc("zlPfpLoop")) && /ZabPfp\.clear\("zlSelf"\)/.test(fnSrc("zlPfpStop")));
  check("PFP: #zlSelf overlay has a positioned parent (cover sits on the video)", /<div class="zl-self-wrap" style="position:relative"><video class="zl-self" id="zlSelf"/.test(html));
  check("PFP: #zlSelf follows the same switch (isOn) and is unmirrored (flipHorizontal false)", /ZabPfp\.isOn\(\)/.test(fnSrc("zlPfpLoop")) && /flipHorizontal: false/.test(fnSrc("zlPfpLoop")));
  check("PFP: Live Match camera keeps its PFP from camera open (shared switch)", /applyShow\(\); \/\/ starts the avatar loop/.test(fs.readFileSync(path.join(ROOT, "match-pfp-cam.js"), "utf8")));
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
})().catch((e) => { console.log("FAIL harness", e); process.exit(1); });
