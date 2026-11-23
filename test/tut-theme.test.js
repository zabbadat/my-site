// Time-under-tension theme copy + load clock (display / local summary only).
// Does not change ZAB, completion rules, or Firestore field lists.
const fs = require("fs"), path = require("path");
const SS = require("../push-session.js"), SQ = require("../squat-session.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const pg = fs.readFileSync(path.join(__dirname, "..", "squat-page.js"), "utf8");
const G = require("../get-set.js");
let pass = 0, fail = 0;
const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || why == null ? "" : " :: " + why}`); ok ? pass++ : fail++; };

function between(s, a, b) {
  const i = s.indexOf(a); if (i < 0) return "";
  const j = s.indexOf(b, i + a.length); return j < 0 ? s.slice(i) : s.slice(i, j);
}

check("highlighted theme class is defined", /\.tut-theme\s*\{/.test(html) && /font-weight:\s*700/.test(html));
const promptTxt = html.match(/id="plankPrompt">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, "");
const FULL_CUE = "Go on, hold on three. One, two, three, hold.";
check("plank prompt ends with the exact hold cue, with the TUT line before that ending",
  promptTxt === "Phone on the floor, on its side, off to your side. Step back until you're head to heels. Clock starts on a proper plank. Bad form fails the plank. You're under tension the whole hold, so breathe through it. " + FULL_CUE &&
  promptTxt.endsWith(FULL_CUE) && promptTxt.indexOf("You're under tension the whole hold, so breathe through it.") < promptTxt.indexOf(FULL_CUE));
function themeEl(id) { const m = html.match(new RegExp("<p class=\"tut-theme\" id=\"" + id + "\">[\\s\\S]*?</p>")); return m ? m[0] : ""; }
check("plank section has a highlighted TUT line inside the prompt, before the cue", /id="plankTutLine"/.test(html) && /You're under tension the whole hold, so breathe through it/.test(html) && html.indexOf("plankTutLine") < html.indexOf(FULL_CUE));
check("Plank House has the same highlighted TUT line", /You're under tension the whole hold, so breathe through it/.test(themeEl("plankHouseTutLine")));
check("TUT / push section has a highlighted line", /Stay under tension the whole set/.test(themeEl("pushTutLine")));
check("Gyatt Squats have a dedicated highlighted TUT line (no goblet squat)", /Every Gyatt Squat rep is time under tension/.test(themeEl("squatsTutLine")) && !/goblet/i.test(html));
check("hero tagline is highlighted", /Breathe through every second of it\./.test(themeEl("tutThemeTag")));
check("cooling box pairs tension with breath", /Breathe through the tension/.test(themeEl("coolingTutLine")));
check("TUT and plank battles get short highlighted lines", !!themeEl("tbTutLine") && !!themeEl("plankBattleTutLine"));
check("completion and pay rules are unchanged", /A TUT set is complete at 1:20 with at least 10 push-ups/.test(html) && /Hold the top 30 seconds straight for the hold bonus, once per set/.test(html) && /A set is ten reps\. 10 squats = 1 ZAB\./.test(html) && /1 ZAB once per set at a continuous 60 s hold/.test(html));
check("two-minute note still starts with the locked cue, and names TUT", /id="challengeNote"[^>]*>Two-minute challenge: hold a push-up plank, arms straight, while the clock runs from 2:00 to 0:00\. The start cue is "Go on, hold on three\. One, two, three, hold\." The clock starts at hold\./.test(html) && /Those two minutes are time under tension/.test(html));
check("live TUT timers exist for push, plank HUD, and Gyatt Squats HUD", /id="pushLiveTut"/.test(html) && /id="sqHudTut"/.test(html) && /id="plankHudClock"[\s\S]{0,80}>TUT</.test(html));
check("Gyatt spoken theme has no number words and is said after criteria, before the countdown", G.COACH.squats.theme === "Stay under tension: down, hold, and up." && /theme: "Stay under tension: down, hold, and up\."/.test(pg) && pg.indexOf("SAY.theme") > 0 && pg.indexOf("SAY.theme") < pg.indexOf("makeNextSetCountdown({ line: SAY.start })"));
check("plank spoken TUT line is before the go-cue", G.COACH.plank.theme === "You're under tension the whole hold, so breathe through it." && G.COACH.plank.next === "Go on, hold on three.");
check("existing spoken start lines are unchanged", G.COACH.plank.place === "Phone on the floor, on its side, off to your side." && G.COACH.plank.rules === "Bad form fails the plank." && G.COACH.plank.next === "Go on, hold on three." && G.COACH.plank.clock === "Clock starts on a proper plank." && G.COACH.squats.place === "Phone up in front of you, camera facing you.");
check("squat save still uses only the allowed fields (no tutMs written to Firestore)", /H\.save\(\{ name: H\.playerName\(\), reps: r\.reps, ms: r\.ms, sessionStartedAt: st\.startedAt \}\)/.test(pg));
check("push finish still posts tutMs only for long / TUT sets (pay path unchanged)", /record\.tutMs = pushMode === "long" && window\.ZabbadatSession \? Math\.round\(window\.ZabbadatSession\.tutToAdd\(pushMode, ms, doneTut\)\) : 0;/.test(html));
check("Magic Eye stays fully removed in the combined bundle", !/id="magicEye"/.test(html) && !/magic-eye\.js/.test(html) && !/id="magicEyeCanvas"/.test(html));

{ const c = SS.createTutClock();
  c.tick(1000, true); c.tick(2000, true); c.tick(2500, false); c.tick(4000, false); c.tick(4000, true); c.tick(5000, true);
  check("createTutClock accumulates only while loaded, pauses on rest or a break", c.ms() === 2000 && c.loaded() === true, String(c.ms()));
  c.reset();
  check("createTutClock reset returns to zero", c.ms() === 0 && c.loaded() === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
