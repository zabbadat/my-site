// Step Equity boards: Daily Earn keeps today's steps in a Drop Your Tuts cabinet;
// a separate all-time board at the bottom of #steps uses the plain Live-walk table style.
const fs = require("fs"), vm = require("vm"), path = require("path");
const D = require("../daily-steps.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };

const steps = (html.match(/<section id="steps"[^>]*>[\s\S]*?<\/section>/) || [""])[0];
const tutCss = html.slice(html.indexOf("/* Drop your tuts:"), html.indexOf("#push #tut-board"));
check("Daily Earn cabinet shares the Drop Your Tuts arcade selectors", /#tut-board, #dailyStepBoard \{/.test(html) && /#dailyStepBoard table/.test(html) && /#dailyStepBoard th/.test(html) && /#dailyStepBoard td/.test(html) && /#dailyStepBoard h3/.test(html));
check("cabinet chrome (gold/cyan/pink pulse, Press Start 2P) applies to #dailyStepBoard", /#tut-board, #dailyStepBoard \{/.test(tutCss + html.slice(html.indexOf("#tut-board, #dailyStepBoard"), html.indexOf("#tut-board h2"))) && /Press Start 2P/.test(html) && /#steps #dailyStepBoard/.test(html));
check("all-time board is a plain h3 + lead + table, not in the cabinet", /id="stepAllBoardTitle">Step Equity scoreboard<\/h3>/.test(steps) && /id="stepAllBoardSub">All-time steps/.test(steps) && /<th>#<\/th><th>Player<\/th><th>Total steps<\/th>/.test(steps) && !/#stepAllBoardBody/.test(tutCss) && steps.indexOf("id=\"stepAllBoardTitle\"") > steps.indexOf("id=\"walkBoardBody\""));

// rankAllTime
const day = (uid, name, date, steps) => ({ uid, name, date, steps });
let r = D.rankAllTime([
  day("a", "Ann", "2026-11-01", 1000),
  day("a", "Ann", "2026-11-02", 2500),
  day("b", "Bo", "2026-11-02", 400),
  day("b", "Bo", "2026-11-03", 100)
]);
check("all-time sums every day per uid, most first", r.length === 2 && r[0].uid === "a" && r[0].steps === 3500 && r[1].uid === "b" && r[1].steps === 500);

r = D.rankAllTime([
  day("z", "Zed", "2026-01-01", 100),
  day("y", "Amy", "2026-01-01", 100),
  day("x", "Cal", "2026-01-01", 50),
  day("w", "Old", "2026-01-01", 200),
  day("w", "New", "2026-01-02", 0),
  { name: "Ghost", date: "2026-01-01", steps: 999 },
  day("w", "New", "2026-01-03", 50)
]);
// w: 200 + 0 skipped + 50 = 250, name New (later date). Then Amy & Zed tie at 100, Cal 50.
check("latest name wins; zero-step and uid-less rows skipped", r[0].uid === "w" && r[0].name === "New" && r[0].steps === 250 && !r.some((p) => p.name === "Ghost" || p.name === "Old"));
check("ties share a rank and sort by name (1, 2, 2, 4)", r.map((p) => p.rank).join(",") === "1,2,2,4" && r[1].name === "Amy" && r[2].name === "Zed" && r[3].name === "Cal" && r[3].rank === 4);
check("limit n and empty", D.rankAllTime(r, 1).length === 1 && D.rankAllTime([]).length === 0);

// Daily board still ranks only today (rankDaily unchanged).
const todayRows = [
  day("a", "Ann", "2026-11-14", 100),
  day("b", "Bo", "2026-11-13", 9999),
  day("c", "Cy", "2026-11-14", 500),
  day("d", "Dee", "2026-11-14", 0)
];
const today = D.rankDaily(todayRows, "2026-11-14");
check("Daily Earn still ranks today's docs only", today.length === 2 && today[0].name === "Cy" && today[1].name === "Ann");

// Render helpers
const paintDaily = html.match(/function paintDailyRows\(rows\) \{[\s\S]*?\n\}/)[0];
const paintAll = html.match(/function paintStepAllRows\(rows\) \{[\s\S]*?\n\}/)[0];
const els = {};
const ctx = {
  $: (id) => els[id] || (els[id] = {}),
  escapeHtml: (s) => String(s).replace(/</g, "&lt;"),
  publicName: (s) => String(s).split("@")[0],
  DS: D
};
vm.createContext(ctx);
vm.runInContext(paintDaily + "\n" + paintAll, ctx);

ctx.paintDailyRows([day("a", "ann@x.com", D.localDateKey(), 12000), day("b", "<b>", D.localDateKey(), 12000), day("c", "Cal", D.localDateKey(), 100)]);
check("daily render: shared rank, name (no email, escaped), today's steps, no source column",
  /<td>1<\/td><td>&lt;b><\/td><td>12,000<\/td>/.test(els.dailyBoardBody.innerHTML)
  && /<td>1<\/td><td>ann<\/td><td>12,000<\/td>/.test(els.dailyBoardBody.innerHTML)
  && /<td>3<\/td><td>Cal<\/td><td>100<\/td>/.test(els.dailyBoardBody.innerHTML)
  && !/Phone|Walk/.test(els.dailyBoardBody.innerHTML) && !/@/.test(els.dailyBoardBody.innerHTML));
ctx.paintDailyRows([]);
check("daily render: empty today", /No steps posted today yet/.test(els.dailyBoardBody.innerHTML));

ctx.paintStepAllRows([
  day("a", "ann@x.com", "2026-11-01", 4000),
  day("a", "ann@x.com", "2026-11-02", 8000),
  day("b", "<b>", "2026-11-02", 500)
]);
check("all-time render: rank, name (no email, escaped), summed steps",
  /<td>1<\/td><td>ann<\/td><td>12,000<\/td>/.test(els.stepAllBoardBody.innerHTML)
  && /<td>2<\/td><td>&lt;b><\/td><td>500<\/td>/.test(els.stepAllBoardBody.innerHTML)
  && !/@/.test(els.stepAllBoardBody.innerHTML));
ctx.paintStepAllRows([]);
check("all-time render: empty", /No steps posted yet/.test(els.stepAllBoardBody.innerHTML));
ctx.paintStepAllRows(null);
check("all-time render: error", /unavailable/.test(els.stepAllBoardBody.innerHTML));

check("page: daily query still today-only (equality, limit 300, no new index)",
  html.includes('boardSnap("dailyBoardBody", () => query(collection(db, "dailySteps"), where("date", "==", DS ? DS.localDateKey() : ""), limit(300))'));
check("page: all-time query is a plain collection list (no where/orderBy/limit)",
  html.includes('boardSnap("stepAllBoardBody", query(collection(db, "dailySteps")), (snap) => paintStepAllRows')
  && !/boardSnap\("stepAllBoardBody"[^;]*where\(/.test(html)
  && !/boardSnap\("stepAllBoardBody"[^;]*limit\(/.test(html));
check("page: names go through publicName + escapeHtml on both boards",
  html.includes("escapeHtml(publicName(r.name))}</td><td>${Number(r.steps).toLocaleString()}"));
check("10K pay, ET-midnight reset, walk board, and daily posting were not rewritten away",
  html.includes('awardZab("steps10k"') && html.includes("daily.checkDay()") && html.includes('boardSnap("walkBoardBody"') && html.includes("function postDaily("));

const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
const indexes = fs.readFileSync(path.join(__dirname, "../firestore.indexes.json"), "utf8");
check("no Firestore rules or index changes for dailySteps",
  /match \/dailySteps\/\{id\} \{\s*allow read: if signedIn\(\);/.test(rules) && !/dailySteps/.test(indexes));

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
