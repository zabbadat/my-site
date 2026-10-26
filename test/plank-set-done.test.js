// Plank failure ends say exactly "Set complete" once (own PLANK_SET_DONE_LINE; the TUT modes keep "Set done."); the Stop tap stays silent (there is no 60 s auto-end).
// Run: node test/plank-set-done.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const P = require("../plank-session.js"), G = require("../get-set.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const pose = (hipDy = 0, j = 0) => K({ left_shoulder: [100 + j, 300], left_elbow: [105, 360], left_wrist: [110, 400], left_hip: [300 - j, 310 + hipDy], left_knee: [400, 315 + hipDy / 2], left_ankle: [500 + j, 320] });
const jitter = (t) => pose(0, Math.sin(t / 37) * 1.5 + Math.cos(t / 91));
const sag = pose(60), pike = pose(-70);
const knees = K({ left_shoulder: [100, 300], left_hip: [300, 310], left_knee: [330, 400], left_ankle: [450, 400] });
const stand = K({ left_shoulder: [300, 50], left_hip: [300, 250], left_knee: [302, 350], left_ankle: [304, 450] });
const seq = (from, to, f, dt = 33) => { const a = []; for (let t = from; t < to; t += dt) a.push([t, f(t)]); return a; };
const hold = (frames) => { const h = P.createPlankHold(); let r; for (const [t, k] of frames) r = h.update(k, t); return { h, r }; };

check("plank line is exactly 'Set complete'; TUT lines (SET_DONE_LINE, TUT_FAIL_LINE) stay 'Set done.'", G.PLANK_SET_DONE_LINE === "Set complete" && G.SET_DONE_LINE === "Set done." && G.TUT_FAIL_LINE === "Set done.");

// Run the real plankEnded from index.html with stubs.
const m = /function plankEnded\(r\) \{[\s\S]*?\n\}\n/.exec(html);
check("plankEnded found", !!m);
function env() {
  const log = [], store = {}, el = () => ({ textContent: "", hidden: false, value: "" });
  const els = {}; const $ = (id) => els[id] || (els[id] = el());
  const ctx = { log, $, els, plankSaved: false, plankSessionStartedAt: 1, currentUser: null, PLANK_BEST_KEY: "b", ZT: null,
    plankTimeVoice: { end: () => log.push("voiceEnd") }, sessionTouch() {}, formatTut: (ms) => ms + "ms", renderPlankBest() {}, plankBest: () => 0,
    PD: { countsAsSet: (ms) => ms >= 10000, recordHold: () => ({ sets: 1 }), localDateKey: () => "2026-10-25" }, renderPlankDays() {}, paintPlankRows() {}, localPlanks: () => [],
    displayNameOf: () => "x", localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); log.push("save:" + k); } },
    window: { ZabbadatPlank: P, ZabbadatGetSet: { interruptSpeak: (w) => log.push("say:" + w), PLANK_SET_DONE_LINE: G.PLANK_SET_DONE_LINE } } };
  vm.createContext(ctx); vm.runInContext(m[0].replace(/^function plankEnded/, "plankEnded = function"), ctx);
  return ctx;
}
const says = (c) => c.log.filter((x) => x.startsWith("say:"));

const cases = [
  ["bad form: hips sag", seq(0, 5000, jitter).concat(seq(5000, 6500, () => sag)), "sag"],
  ["bad form: hips pike", seq(0, 5000, jitter).concat(seq(5000, 6500, () => pike)), "pike"],
  ["knees down", seq(0, 5000, jitter).concat(seq(5000, 6500, () => knees)), "knees"],
  ["stood up", seq(0, 5000, jitter).concat(seq(5000, 6500, () => stand)), "standing"],
  ["body left the frame", seq(0, 5000, jitter).concat(seq(5000, 6500, () => [])), "left_frame"],
  ["frozen (photo)", seq(0, 20000, () => pose()), "frozen"],
];
for (const [name, frames, reason] of cases) {
  const { r } = hold(frames); const c = env();
  check(`${name}: hold ends with reason ${reason}`, r.ended && r.reason === reason);
  c.plankEnded(r);
  check(`${name}: says exactly "Set complete" once`, JSON.stringify(says(c)) === JSON.stringify(["say:Set complete"]));
  check(`${name}: time held still saved, on-screen reason kept, not voided`, c.log.includes("save:b") && c.log.includes("save:zabbadat-plank-local") && /Hold ended: /.test(c.els.plankStatus.textContent) && c.els.plankStatus.textContent.includes(P.reasonText(reason)) && /Time \d+ms/.test(c.els.plankStatus.textContent));
  c.plankEnded(r); c.plankEnded(r);
  check(`${name}: a repeated end call does not speak again`, says(c).length === 1);
  check(`${name}: the 15 s voice is ended before the line (failure interrupts, no count after)`, c.log.indexOf("voiceEnd") < c.log.indexOf("say:Set complete"));
}
{ const c = env(); c.plankEnded({ reason: "repeat", ms: 5000 });
  check('repeating motion (video) failure: says "Set complete" once', JSON.stringify(says(c)) === JSON.stringify(["say:Set complete"])); }
// Not on success or Stop
{ const { h } = hold(seq(0, 20000, jitter)); const c = env(); c.plankEnded(h.stop(20000));
  check("Stop button (reason stopped): silent, time still saved", says(c).length === 0 && c.log.includes("save:b")); }
{ const { h } = hold(seq(0, 4000, jitter)); const c = env(); c.plankEnded(h.stop(4000));
  check("Stop during hold ready/early: silent", says(c).length === 0); }
{ const h = P.createPlankHold(); let r; for (const [t, k] of seq(0, 1000, jitter)) r = h.update(k, t); const c = env(); c.plankEnded(h.stop(1000));
  check("Stop before the clock started (ready phase): silent", says(c).length === 0 && !c.log.includes("save:b")); }
// no 60 s auto-end any more: Stop is the only silent end (reason "stopped")
check("no fixed-time auto-end in plankTick (PLANK_SET_MS and 'Minute set done' are gone)", !/PLANK_SET_MS|Minute set done/.test(html));
{ const { h } = hold(seq(0, 62000, jitter)); const c = env(); const r = h.stop(62000); c.plankEnded(r);
  check("Stop after 62 s: reason stopped, silent, time credited", r.reason === "stopped" && r.ms > 50000 && says(c).length === 0); }
check("stopPlankCam and the Stop button also end via hold.stop (silent)", /const r = plankHold\.stop\(performance\.now\(\)\); plankEnded\(r\)/.test(html) && /\$\("plankStopBtn"\)\.onclick = \(\) => \{ if \(plankLoop && plankHold && !plankSaved\) plankEnded\(plankHold\.stop\(/.test(html));
// single speaking site for plank failure, no per-failure lines
check("plankEnded is the only plank place that speaks the failure line; guarded by reason !== 'stopped' after plankSaved = true", (html.match(/PLANK_SET_DONE_LINE/g) || []).length === 1 && /plankSaved = true;[\s\S]{0,400}r\.reason !== "stopped"\) \{ const GS = window\.ZabbadatGetSet; if \(GS && GS\.interruptSpeak\) GS\.interruptSpeak\(GS\.PLANK_SET_DONE_LINE\)/.test(html));
check("no other spoken failure text in plank code ('Set done' never in plank-session.js / plank.html)", !/Set done/.test(fs.readFileSync(path.join(__dirname, "../plank-session.js"), "utf8")) && !/Set done/.test(fs.readFileSync(path.join(__dirname, "../plank.html"), "utf8")));
// Hold plank cue is unaffected (a failure only happens during a hold, after the cue) and cancelled() stops a late cue
check("'Hold plank.' cue untouched and its begin is cancelled once the hold is saved", G.COACH.plank.cue === "Hold plank." && /cancelled = \(\) => hold !== plankHold \|\| !plankLoop \|\| plankSaved/.test(html));
// Plank Battle: no camera-detected failure there
const battleSeg = html.slice(html.indexOf("let battleRoom = null, battleCode = null;"), html.indexOf("$(\"battleLeave\").onclick"));
check("Plank Battle has no camera failure path (hold ends by Drop/Forfeit buttons, never plankEnded/plankHold), so it speaks nothing", !/plankEnded|plankHold|plankTick/.test(battleSeg));
console.log(`\n${R.filter(Boolean).length} passed, ${R.filter((x) => !x).length} failed`); process.exit(R.every(Boolean) ? 0 : 1);
