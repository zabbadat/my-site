// Push-up setup copy (on screen and spoken): only the leaned-up, camera-facing-you setup is described.
// The push-up copy describes only that one setup (no other phone placement is mentioned anywhere in it).
// The plank keeps its own side-on copy. Run: node test/push-copy-front-view.test.js
const fs = require("fs"), path = require("path"), G = require("../get-set.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS  " : "FAIL  ") + n); };
const BAD = /floor|ground|under (your|the) chest|chest[^.]*(camera|lens)|screen up|face-?up|flat\b|lies\b|lie\b/i;
const strings = [];
for (const k of ["pushups", "tut"]) { strings.push(G.COACH[k].place, G.COACH[k].criteria, G.positionPrompt(k)); }
const html = read("index.html");
const line = (id) => { const i = html.indexOf(`id="${id}"`); if (i < 0) throw new Error("missing " + id); return html.slice(i, html.indexOf("</p>", i)); };
strings.push(line("camNote"), line("pushGetSetNote"));
const lead = html.slice(html.indexOf("Same login as washers. Start the clock"), html.indexOf("</p>", html.indexOf("Same login as washers. Start the clock")));
strings.push(lead);
const tb = html.match(/\$\("tbCamNote"\)\.textContent = "([^"]*)"; requestAnimationFrame\(tbPose\)/);
strings.push(tb ? tb[1] : "", html.match(/tbStat\(!tbStream \? "([^"]*)"/)[1]);
const how = read("how-it-works.html"), hw = how.match(/<li><strong>Use the camera counter\.<\/strong>[^<]*<\/li>/)[0]; strings.push(hw);
check("push-up copy was found in every place (get-set.js x6, index.html x5, how-it-works)", strings.length === 6 + 5 + 1 && strings.every((s) => s && s.length > 10));
check("no push-up line mentions the floor, ground, under-the-chest, screen up, flat or face-up", strings.every((s) => !BAD.test(s)));
check("push-up setup says to lean the phone up in front of you, camera facing you", /Lean your phone up in front of you, camera facing you/.test(G.COACH.pushups.place) && /Lean your phone up in front of you/.test(G.positionPrompt("pushups")) && /Lean your phone up in front of you, camera facing you/.test(line("camNote")));
check("criteria: shoulders and hands in frame, then all the way down and back up", G.COACH.pushups.criteria === "Shoulders and hands in frame. Go all the way down and back up." && /Shoulders and hands in frame/.test(G.COACH.tut.criteria) && /shoulders and hands in frame/i.test(line("camNote")));
check("TUT shares the push-up setup lines", G.positionPrompt("tut") === G.positionPrompt("pushups"));
check("no calibration hold in the copy (zero calibration): no 'calibrate' / 'hold still' / 'sets the top' in push-up lines", strings.every((s) => !/calibrat|hold still|sets the top/i.test(s)));
check("setup lines are short and spoken-style (each under 80 characters)", [G.COACH.pushups.place, G.COACH.pushups.criteria, G.COACH.tut.place].every((s) => s.length < 80) && G.positionPrompt("pushups").split("\n").length <= 2);
check("the plank copy is untouched (side-on setup)", /off to your side/.test(G.COACH.plank.place) && /side-on, head to heels/.test(G.POSITION.plank[0]));
check("no location text in the push-up copy", strings.every((s) => !/jersey|yardley|south nj/i.test(s)));
{ const files = fs.readdirSync(path.join(__dirname, "..")).filter((f) => /\.(html|js|md|json|xml)$/.test(f) && f !== "package-lock.json");
  const hits = files.filter((f) => /face-?up|under (your|the) chest|screen up|flat on the ground|lies face/i.test(read(f)));
  check("repo sweep: no page, script or doc mentions the old face-up / under-the-chest push-up placement" + (hits.length ? " (" + hits.join(", ") + ")" : ""), hits.length === 0); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
