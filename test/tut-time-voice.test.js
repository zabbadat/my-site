// Spoken elapsed time every 15 s for TUT sets (push-up "One long set"), polite version of Plank's hold voice. Run: node test/tut-time-voice.test.js
const G = require("../get-set.js"), fs = require("fs");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const mk = (o) => { const said = [], stops = []; let busy = false; const v = G.makeHoldVoice(Object.assign({ polite: true, speak: (w) => said.push(w), stop: () => stops.push(1), busy: () => busy }, o || {})); return { v, said, stops, setBusy: (b) => { busy = b; } }; };
const frames = (to, dt = 200) => { const a = []; for (let ms = 0; ms <= to; ms += dt) a.push(ms); return a; };

// ---- same words as Plank
let a = mk(); frames(135000).forEach((ms) => a.v.tick(ms));
check("every 15 s: 15 seconds, 30 seconds, 45 seconds, 1 minute, 1 minute 15, 1 minute 30, 1 minute 45, 2 minutes, 2 minutes 15 (same words as Plank)",
  JSON.stringify(a.said) === JSON.stringify(["15 seconds", "30 seconds", "45 seconds", "1 minute", "1 minute 15", "1 minute 30", "1 minute 45", "2 minutes", "2 minutes 15"]));
check("nothing before 15 s", mk().v.tick(14999) === null);
check("polite: never cancels other speech (no stop call before any count)", a.stops.length === 0);
// ---- once per mark, never repeats
a = mk(); [15000, 15100, 15200, 20000, 29999].forEach((ms) => a.v.tick(ms));
check("each mark fires once however often tick() runs", JSON.stringify(a.said) === JSON.stringify(["15 seconds"]));
a = mk(); a.v.tick(16000); a.v.tick(31000); a.v.tick(8000); a.v.tick(16000); a.v.tick(31500); a.v.tick(46000);
check("a clock that stops and resumes (or jumps back) never repeats a mark; later marks still fire", JSON.stringify(a.said) === JSON.stringify(["15 seconds", "30 seconds", "45 seconds"]));
// ---- busy speech
a = mk(); a.v.tick(14900); a.setBusy(true); a.v.tick(15000); a.v.tick(16000); a.v.tick(17000);
check("busy at the mark: the count waits and says nothing over it", a.said.length === 0);
a.setBusy(false); a.v.tick(17500);
check("...speaks as soon as the speech ends (within 4 s of the mark)", JSON.stringify(a.said) === JSON.stringify(["15 seconds"]));
a = mk(); a.setBusy(true); a.v.tick(15000); a.v.tick(19500); a.setBusy(false); a.v.tick(19600); a.v.tick(20000);
check("busy for more than 4 s: that mark is skipped, not piled up late", a.said.length === 0);
a.v.tick(30000);
check("...and the next mark still speaks", JSON.stringify(a.said) === JSON.stringify(["30 seconds"]));
a = mk(); a.setBusy(true); a.v.tick(15000); a.v.tick(30500); a.setBusy(false); a.v.tick(30600);
check("a skipped mark is never spoken after a newer mark (no double count)", JSON.stringify(a.said) === JSON.stringify(["30 seconds"]));
// ---- end / reset
a = mk(); a.v.tick(16000); a.v.end(); a.v.tick(31000); a.v.tick(46000);
check("end(): silent after the set ends", JSON.stringify(a.said) === JSON.stringify(["15 seconds"]));
a.v.reset(); a.v.tick(1000); a.v.tick(15500);
check("reset(): a new set starts from 0 again", JSON.stringify(a.said) === JSON.stringify(["15 seconds", "15 seconds"]));
// ---- caps
a = mk(); [595000, 600000, 615000, 630000, 660000, 675000, 720000].forEach((ms) => a.v.tick(ms));
check("past 10 min only whole minutes are spoken (10 minutes, 11 minutes, 12 minutes), not every 15 s", a.said.join() === "10 minutes,11 minutes,12 minutes");
a = mk(); [3585000, 3600000, 3615000, 3660000, 3720000].forEach((ms) => a.v.tick(ms));
check("hard cap: the last count is 60 minutes, nothing is spoken after that", a.said.join() === "60 minutes");
// ---- Plank is unchanged (default, not polite)
{ const said = [], stops = []; const v = G.makeHoldVoice({ speak: (w) => said.push(w), stop: () => stops.push(1) }); v.tick(15000); v.tick(30000);
  check("Plank default behaviour unchanged: cancels queued speech before each count", said.length === 2 && stops.length === 2); }
check("silent fallback (no speech engine) never throws", (() => { try { const v = G.makeHoldVoice({ polite: true }); v.tick(16000); v.tick(31000); return true; } catch (e) { return false; } })());
check("isSpeaking() is false when there is no speech engine", G.isSpeaking() === false);
// ---- mixed with rep callouts: simulate 200 ms render ticks + a spoken rep every 4 s that occupies 600 ms of speech
{ const said = []; let busyUntil = 0, now = 0; const v = G.makeHoldVoice({ polite: true, speak: (w) => { said.push([now, w]); busyUntil = now + 800; }, busy: () => now < busyUntil });
  for (now = 0; now <= 61000; now += 200) { if (now % 5000 === 0) busyUntil = Math.max(busyUntil, now + 600); v.tick(now); }
  check("with rep numbers spoken every 5 s the four counts up to 1 minute all still speak, one each, never during a rep", said.map((x) => x[1]).join() === "15 seconds,30 seconds,45 seconds,1 minute" && said.every((x) => x[0] % 5000 >= 600)); }

// ---- page wiring (index.html)
const h = fs.readFileSync(__dirname + "/../index.html", "utf8");
const idx = (s) => h.indexOf(s);
check("tutTimeVoice is a polite hold voice defined before renderPush (no temporal-dead-zone)", /const tutTimeVoice = window\.ZabbadatGetSet && window\.ZabbadatGetSet\.makeHoldVoice \? window\.ZabbadatGetSet\.makeHoldVoice\(\{ polite: true \}\) : null;/.test(h) && idx("const tutTimeVoice") < idx("function renderPush()"));
check("TUT modes (One long set + 3:00 challenge): ticks with the running clock only while running and not finished; regular Sets excluded", /if \(typeof tutTimeVoice !== "undefined" && tutTimeVoice && \(pushMode === "long" \|\| pushMode === "challenge"\) && pushState\.running && !pushState\.finished\) tutTimeVoice\.tick\(now\);/.test(h));
check("ended on finish, reset on every new clock start and on Reset", /pushState\.finished = true;\n  if \(typeof tutTimeVoice !== "undefined" && tutTimeVoice\) tutTimeVoice\.end\(\);/.test(h) && /if \(typeof tutTimeVoice !== "undefined" && tutTimeVoice\) tutTimeVoice\.reset\(\);\n  if \(typeof failWatch[^\n]*\n  pushState\.running = true;/.test(h) && /tut: 0 \}\);\n  if \(typeof tutTimeVoice !== "undefined" && tutTimeVoice\) tutTimeVoice\.reset\(\);/.test(h));
check("only that one call site ticks the solo TUT voice (it covers One long set + 3:00 challenge; regular Sets, Plank House and Plank Battles do not tick it; TUT Battles has its own tbTimeVoice)", h.split("tutTimeVoice.tick(").length === 2);
check("Plank House / Plank Battle voices untouched", /const plankTimeVoice = window\.ZabbadatGetSet && window\.ZabbadatGetSet\.makeHoldVoice \? window\.ZabbadatGetSet\.makeHoldVoice\(\) : null;/.test(h) && /const pbTimeVoice = window\.ZabbadatGetSet && window\.ZabbadatGetSet\.makeHoldVoice \? window\.ZabbadatGetSet\.makeHoldVoice\(\) : null;/.test(h));
check("the page still never mentions the speech engine directly", h.split("speechSynthesis").length === 1);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
