// Plank House: no fixed-time (60 s) end, and spoken elapsed time every PLANK_TIME_EVERY_MS for the whole hold (get-set.js makePlankTimeVoice).
// A hold ends only on alignment failure (1000 ms grace, unchanged) or Stop. Run: node test/plank-no-cap.test.js
const fs = require("fs"), path = require("path");
const P = require("../plank-session.js"), G = require("../get-set.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const pose = (hipDy = 0, j = 0) => K({ left_shoulder: [100 + j, 300], left_elbow: [105, 360], left_wrist: [110, 400], left_hip: [300 - j, 310 + hipDy], left_knee: [400, 315 + hipDy / 2], left_ankle: [500 + j, 320] });
const jitter = (t) => pose(0, Math.sin(t / 37) * 1.5 + Math.cos(t / 91));
const sag = pose(60);
const frames = (from, to, f, dt = 33) => { const a = []; for (let t = from; t < to; t += dt) a.push([t, f(t)]); return a; };

// ---- wording
const w = G.plankTimeCallout;
check("constant: PLANK_TIME_EVERY_MS is 15000", G.PLANK_TIME_EVERY_MS === 15000);
const expectFirst = ["15 seconds", "30 seconds", "45 seconds", "One minute", "One minute fifteen", "One minute thirty", "One minute forty-five", "Two minutes", "Two minutes fifteen", "Two minutes thirty", "Two minutes forty-five", "Three minutes"];
check("wording for the first marks", expectFirst.every((e, i) => w((i + 1) * 15) === e));
check("wording: 5, 10, 11, 21 and 30 minutes", w(300) === "Five minutes" && w(600) === "Ten minutes" && w(660 + 15) === "Eleven minutes fifteen" && w(21 * 60 + 45) === "Twenty-one minutes forty-five" && w(1800) === "Thirty minutes" && w(1800 + 30) === "Thirty minutes thirty");
check("wording: 59 min 45 s and past an hour", w(59 * 60 + 45) === "Fifty-nine minutes forty-five" && w(3600) === "One hour" && w(3615) === "One hour fifteen seconds" && w(3600 + 5 * 60) === "One hour five minutes" && w(3600 + 5 * 60 + 15) === "One hour five minutes fifteen" && w(7200) === "Two hours");
check("wording: every mark up to 2 hours is non-empty, has no digits except under a minute, and no punctuation but hyphens", (() => { for (let i = 1; i <= 480; i++) { const t = w(i * 15); if (!t || (i > 3 && /\d/.test(t)) || /[.,!?;:]/.test(t)) return false; } return true; })());
check("wording: all marks are distinct", new Set(Array.from({ length: 480 }, (_, i) => w((i + 1) * 15))).size === 480);

// ---- voice behaviour
function voice(o) { const said = []; const v = G.makePlankTimeVoice(Object.assign({ speak: (t) => said.push(t), busy: () => false }, o)); return { v, said }; }
{ const { v, said } = voice(); for (let ms = 0; ms <= 600100; ms += 33) v.tick(ms);
  check("10 min simulated clock: one callout per 15 s mark, 40 in total, in order, no repeats", said.length === 40 && said[0] === "15 seconds" && said[3] === "One minute" && said[39] === "Ten minutes" && said.every((t, i) => t === w((i + 1) * 15)) && new Set(said).size === 40); }
{ const { v, said } = voice(); for (let ms = 0; ms <= 1800000; ms += 250) v.tick(ms);
  check("30 min simulated clock: 120 callouts, last one 'Thirty minutes'; nothing capped at 60 s, 10 min or 60 min", said.length === 120 && said[119] === "Thirty minutes" && said[7] === "Two minutes"); }
{ const { v, said } = voice(); for (let ms = 0; ms <= 7300000; ms += 1000) v.tick(ms);
  check("2 h: keeps speaking past 60 min with no end cap", said.length === 486 && said[239] === "One hour"); }
{ const { v, said } = voice(); v.tick(14000); v.tick(47000); v.tick(47100); v.tick(61000);
  check("clock jump: only the latest mark is spoken (no catch-up burst), then normal", JSON.stringify(said) === JSON.stringify(["45 seconds", "One minute"])); }
{ const { v, said } = voice(); v.tick(100000); v.tick(100000); v.tick(99999); v.tick(104000); v.tick(105000);
  check("the same mark is never spoken twice", JSON.stringify(said) === JSON.stringify(["One minute thirty", "One minute forty-five"])); }{ let busy = true; const { v, said } = voice({ busy: () => busy }); v.tick(15000); busy = false; v.tick(15200); v.tick(20000); v.tick(30000);
  check("a mark is skipped while the previous line is still playing: not queued, not spoken late, next mark is normal", JSON.stringify(said) === JSON.stringify(["30 seconds"])); }
{ let muted = true; const { v, said } = voice({ muted: () => muted }); v.tick(15000); muted = false; v.tick(15500); v.tick(30000);
  check("muted: silent, and the muted mark is not replayed", JSON.stringify(said) === JSON.stringify(["30 seconds"])); }
{ const { v, said } = voice(); v.tick(15000); v.end(); v.tick(30000); v.tick(45000); const n = said.length; v.reset(); v.tick(15000);
  check("not spoken after end(); reset() starts a new hold from 0", n === 1 && said.length === 2 && said[1] === "15 seconds"); }
{ let returned; const v = G.makePlankTimeVoice({ speak: () => new Promise(() => {}), busy: () => false }); returned = v.tick(15000);
  check("speak is never awaited: tick returns at once with the word even if speech never finishes", returned === "15 seconds"); }
{ const v = G.makePlankTimeVoice({ speak: () => { throw new Error("speech broke"); }, busy: () => { throw new Error("x"); } });
  check("a throwing speech engine never throws out of tick", (() => { try { v.tick(15000); v.tick(30000); return true; } catch (e) { return false; } })()); }
{ // default speak: never cancels other speech
  const log = []; global.window = { speechSynthesis: { speaking: false, pending: false, cancel: () => log.push("cancel"), speak: (u) => log.push("speak:" + u.text) }, SpeechSynthesisUtterance: function (t) { this.text = t; } };
  const v = G.makePlankTimeVoice(); v.tick(15000); window.speechSynthesis.speaking = true; v.tick(30000); window.speechSynthesis.speaking = false; v.tick(45000); delete global.window;
  check("default speech is polite: no cancel(), skips while speaking, speaks otherwise", JSON.stringify(log) === JSON.stringify(["speak:15 seconds", "speak:45 seconds"])); }

// ---- the hold itself: no 60 s end, failure and Stop still end it, grace window unchanged
const run = (fr, onFrame) => { const h = P.createPlankHold(); let r, ended = null; for (const [t, k] of fr) { r = h.update(k, t); if (onFrame) onFrame(r, t); if (r.ended && !ended) ended = { t, r }; } return { h, r, ended }; };
{ const { v, said } = voice(); let maxMs = 0;
  const { r, ended } = run(frames(0, 600000, jitter), (rr) => { if (rr.phase === "holding") { v.tick(rr.ms); maxMs = Math.max(maxMs, rr.ms); } });
  check("10 min hold with good form: never ends (no 60 s cap), still holding, clock past 9:50", !ended && r.phase === "holding" && maxMs > 590000);
  check("10 min hold: callouts every 15 s from the credited hold clock (about 39 to 40)", said.length >= 39 && said.length <= 40 && said[0] === "15 seconds" && said.every((t, i) => t === w((i + 1) * 15)));
  const stop = run(frames(0, 130000, jitter)).h.stop(130000);
  check("Stop after 2 min still ends it: reason stopped, time credited", stop.ended && stop.reason === "stopped" && stop.ms > 120000); }
{ const fr = frames(0, 300000, jitter).concat(frames(300000, 302000, () => sag));
  const { ended } = run(fr);
  check("form failure at 5 min still ends the set (reason sag)", ended && ended.r.reason === "sag" && ended.r.ms > 295000 && ended.r.ms < 301000);
  // grace window: sag for 1000 ms or more ends; the credited time is rolled back to when the bad stretch began
  const startBad = 300000; const e2 = ended.r.ms;
  const base = run(frames(0, 300000, jitter)).r.ms;
  check("grace window unchanged: ends about 1 s into the bad stretch with the credited time rolled back to its start", ended.t - startBad >= 1000 && ended.t - startBad <= 1100 && Math.abs(e2 - base) < 100); }
{ const fr = frames(0, 120000, jitter).concat(frames(120000, 120700, () => sag), frames(120700, 125000, jitter));
  const { r, ended } = run(fr);
  check("grace window unchanged: a 0.7 s sag that is fixed in time does not end the set", !ended && r.phase === "holding"); }
{ const { v, said } = voice(); let n = 0;
  const fr = frames(0, 70000, jitter).concat(frames(70000, 72000, () => sag));
  run(fr, (r) => { if (r.phase === "holding") { v.tick(r.ms); } else if (r.ended && !n) { n = 1; v.end(); } });
  check("spoken callouts stop when the hold ends and none run past the credited time", said.length === 4 && said[3] === "One minute"); }

// ---- page wiring
const tick = html.slice(html.indexOf("async function plankTick"), html.indexOf("function newPlankHold"));
check("page: no PLANK_SET_MS and no 'Minute set done' anywhere; plankTick has no fixed-time end", !/PLANK_SET_MS|Minute set done/.test(html) && !/r\.ms\s*>=/.test(tick));
check("page: plankTimeVoice is the uncapped voice, ticked once per frame without await, only while holding and not saved", /const plankTimeVoice = [^\n]*makePlankTimeVoice\(\)/.test(html) && /!plankSaved\) plankTimeVoice\.tick\(r\.ms\)/.test(tick) && !/await[^\n]*plankTimeVoice/.test(html));
check("page: plankEnded ends the voice first; a new hold resets it", /function plankEnded\(r\) \{\s*if \(typeof plankTimeVoice[^\n]*\.end\(\)/.test(html) && /createPlankHold\(\{ cue: true \}\)[^\n]*\n[^\n]*plankTimeVoice\.reset\(\)/.test(html));
check("page: the old 60 s generic voice is not used for Plank House (Plank Battle keeps makeHoldVoice)", /const pbTimeVoice = [^\n]*makeHoldVoice\(\) : null;/.test(html));
const fails = R.filter((x) => !x).length;
console.log(`\n${R.length - fails} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
