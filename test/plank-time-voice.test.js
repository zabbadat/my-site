// Spoken plank hold time every 15 s (get-set.js holdCallout / makeHoldVoice) + Plank House wiring in index.html.
const G = require("../get-set.js"), fs = require("fs");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const f = G.holdCallout;
check("format", f(15) === "15 seconds" && f(30) === "30 seconds" && f(45) === "45 seconds" && f(60) === "1 minute" && f(75) === "1 minute 15" && f(90) === "1 minute 30" && f(120) === "2 minutes" && f(135) === "2 minutes 15" && f(0) === null);
function run(msList, endAt) { const said = [], stops = []; const v = G.makeHoldVoice({ speak: (w) => said.push(w), stop: () => stops.push(1) });
  for (const ms of msList) { if (endAt != null && ms >= endAt) v.end(); v.tick(ms); } return { said, stops, v }; }
const frames = []; for (let ms = 0; ms <= 130000; ms += 33) frames.push(ms);
const a = run(frames);
check("fires every 15 s, no duplicates", JSON.stringify(a.said) === JSON.stringify(["15 seconds", "30 seconds", "45 seconds", "1 minute", "1 minute 15", "1 minute 30", "1 minute 45", "2 minutes"]));
check("cancels queued speech before each callout", a.stops.length === a.said.length);
check("nothing before 15 s", run([0, 5000, 14999]).said.length === 0);
check("no callouts after the hold ended", JSON.stringify(run(frames, 40000).said) === JSON.stringify(["15 seconds", "30 seconds"]));
check("skipped marks speak only the latest", JSON.stringify(run([14000, 47000, 47100]).said) === JSON.stringify(["45 seconds"]));
const b = run([16000, 31000]); b.v.end(); b.v.tick(50000); b.v.reset(); b.v.tick(1000); b.v.tick(15500);
check("reset: a new hold restarts from 0", JSON.stringify(b.said) === JSON.stringify(["15 seconds", "30 seconds", "15 seconds"]));
check("silent fallback (no speechSynthesis) never throws", (() => { try { const v = G.makeHoldVoice(); v.tick(16000); return true; } catch (e) { return false; } })());
const h = fs.readFileSync(__dirname + "/../index.html", "utf8");
check("Plank House: ticks while holding, ends on hold end, resets per new hold, speaks '1 minute' at set end",
  /plankTimeVoice\.tick\(r\.ms\)/.test(h) && /function plankEnded\(r\) \{\s*if \(typeof plankTimeVoice[^\n]*\.end\(\)/.test(h) && /createPlankHold\(\{ front: true \}\)[^\n]*\n[^\n]*plankTimeVoice\.reset\(\)/.test(h) && /PLANK_SET_MS && !plankSaved\) \{ if \(typeof plankTimeVoice[^\n]*tick\(r\.ms\); plankEnded/.test(h));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
