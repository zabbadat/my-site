// Per-user lifetime dashboard: streaks, totals, washers, layout. Run: node test/lifetime-dash.test.js
const fs = require("fs"), path = require("path");
const D = require("../lifetime-dash.js");
const S = require("../push-session.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

const days = (keys) => keys.map((d) => ({ date: d, steps: 10000, zab: 4 }));
const base = { signedIn: true, uid: "a", today: "2026-11-14", session: S };

// --- 10K ledger ---
const ledger = [
  { source: "steps10k", setId: "2026-11-14", qty: 12400, amount: 4, id: "steps10k-2026-11-14" },
  { source: "walk", setId: "w1", qty: 90, amount: 9 },
  { source: "steps10k", setId: "2026-11-12", qty: 10000, amount: 4, id: "steps10k-2026-11-12" },
  { source: "steps10k", id: "steps10k-2026-11-13", qty: 15000, amount: 4 },
  { source: "steps10k", setId: "2026-11-14", qty: 10000, amount: 4 },
  { source: "pushups", qty: 20, amount: 2 },
  { source: "plank", qty: 180, amount: 3, createdAt: Date.UTC(2026, 10, 14) },
  { source: "hold", qty: 1, amount: 0.5, createdAt: Date.UTC(2026, 10, 13) },
  { source: "hold", qty: 1, amount: 0.5, createdAt: Date.UTC(2026, 10, 10) },
  { source: "washers", qty: 1, amount: 1, createdAt: Date.UTC(2026, 10, 11) }
];
const list = D.fromLedger(ledger);
check("fromLedger keeps only steps10k, unique by day, newest first", list.map((m) => m.date).join() === "2026-11-14,2026-11-13,2026-11-12");
check("fromLedger keeps higher step count on a duplicate day", list[0].steps === 12400 && list[0].zab === 4);
const ten = D.summarize10k(ledger, "2026-11-14");
check("summarize10k totals and +4 ZAB each", ten.count === 3 && ten.zab === 12 && ten.currentStreak === 3);

check("streak: three days ending today", (() => { const s = D.streaks(days(["2026-11-14","2026-11-13","2026-11-12"]), "2026-11-14"); return s.current === 3 && s.best === 3; })());
check("streak still current when last 10K day was yesterday", D.streaks(days(["2026-11-14","2026-11-13","2026-11-12"]), "2026-11-15").current === 3);
check("streak breaks if last 10K day was two days ago", D.streaks(days(["2026-11-14","2026-11-13","2026-11-12"]), "2026-11-16").current === 0);
check("best is the longest run, current is the tail", (() => { const s = D.streaks(days(["2026-11-14","2026-11-13","2026-11-11","2026-11-10","2026-11-09"]), "2026-11-14"); return s.current === 2 && s.best === 3; })());
check("month boundary (Feb 28 -> Mar 1) is consecutive", D.streaks(days(["2026-03-01","2026-02-28","2026-02-27"]), "2026-03-01").current === 3);
check("empty list is zero", D.streaks([], "2026-11-14").current === 0 && D.streaks([], "2026-11-14").best === 0);

check("lifetime steps sums this uid's posted days", D.lifetimeSteps([
  { uid: "a", date: "2026-11-10", steps: 8000 },
  { uid: "a", date: "2026-11-11", steps: 12000 },
  { uid: "b", date: "2026-11-11", steps: 20000 }
], "a") === 20000);
check("lifetime steps keeps the higher total if a day is duplicated", D.lifetimeSteps([
  { uid: "a", date: "2026-11-10", steps: 5000 }, { uid: "a", date: "2026-11-10", steps: 9000 }
], "a") === 9000);
check("todaySteps reads only today's posted total", D.todaySteps([{ uid: "a", date: "2026-11-14", steps: 8760 }, { uid: "a", date: "2026-11-13", steps: 12000 }], "a", "2026-11-14") === 8760);

check("lifetime push-ups sums reps across set, TUT and challenge docs", D.lifetimePushups([
  { uid: "a", reps: 15, tutMs: 0 }, { uid: "a", reps: 20, tutMs: 90000 }, { uid: "a", reps: 40, tutMs: 0 }, { uid: "b", reps: 99 }
], "a") === 75);
check("lifetime push-ups skips zero-rep rows", D.lifetimePushups([{ uid: "a", reps: 0 }, { uid: "a", reps: 3 }], "a") === 3);

const tutRows = [
  { uid: "a", reps: 12, ms: 81000, tutMs: 81000, createdAt: Date.UTC(2026, 10, 14) },
  { uid: "a", reps: 9, ms: 90000, tutMs: 90000 },
  { uid: "a", reps: 20, ms: 70000, tutMs: 70000 },
  { uid: "a", reps: 30, ms: 90000, tutMs: 0 },
  { uid: "a", reps: 11, ms: 80000, tutMs: 80000, createdAt: Date.UTC(2026, 10, 12) },
  { uid: "b", reps: 20, ms: 90000, tutMs: 90000 }
];
check("lifetimeTut reuses ZabbadatSession.tutLifetime (1:20 + 10 push-ups)", D.lifetimeTut(tutRows, "a", S) === 2 && D.lifetimeTut(tutRows, "a", S) === S.tutLifetime(tutRows, "a"));
check("TUT definition is unchanged: 80s and 10 reps, long/tutMs only", S.tutCompleted("long", 80000, 10) && S.tutCompleted("long", 600000, 200) && !S.tutCompleted("long", 79999, 50) && !S.tutCompleted("long", 90000, 9) && S.TUT_DONE.minMs === 80000 && S.TUT_DONE.minReps === 10);

check("one-minute threshold is 60,000 ms", D.ONE_MINUTE_MS === 60000);
check("59,999 ms counts zero; 60,000 ms counts one", !D.isOneMinutePlank({ ms: 59999, holdSec: 59 }) && D.isOneMinutePlank({ ms: 60000, holdSec: 60 }) && D.oneMinutePlanks([{ uid: "a", ms: 59999 }, { uid: "a", ms: 60000 }], "a") === 1);
check("a 3-minute hold counts as 1, not 3", D.oneMinutePlanks([{ uid: "a", ms: 180000, holdSec: 180 }], "a") === 1);
check("a form-break before 60 s counts zero", D.oneMinutePlanks([{ uid: "a", ms: 45000, holdSec: 45 }], "a") === 0);
check("oneMinutePlanks is the single counting function (switch note in source)", /Math\.floor\(plankHoldMs\(s\) \/ ONE_MINUTE_MS\)/.test(fs.readFileSync(path.join(__dirname, "..", "lifetime-dash.js"), "utf8")));

const planks = [
  { uid: "a", ms: 180000, holdSec: 180, createdAt: Date.UTC(2026, 10, 14, 15) },
  { uid: "a", ms: 70000, holdSec: 70, createdAt: Date.UTC(2026, 10, 12, 15) },
  { uid: "a", ms: 20000, holdSec: 20, createdAt: Date.UTC(2026, 10, 14, 16) },
  { uid: "b", ms: 120000, createdAt: Date.UTC(2026, 10, 14) }
];
const ps = D.plankStats(planks, ledger, "a", "2026-11-14", base);
check("plank section: completed sets, lifetime time, longest, today, week, ZAB, recent label", ps.setsCompleted === 2 && ps.totalMs === 270000 && ps.longestMs === 180000 && ps.today === 1 && ps.week === 2 && ps.zab === 3 && ps.recent[0].label === "plank set complete" && ps.recent[0].ms === 180000);
check("plank push press holds come from ledger source hold at 0.5 ZAB each", ps.holds.count === 2 && ps.holds.zab === 1);
check("week starts Monday Eastern (2026-11-14 is Saturday, week starts 2026-11-09)", D.weekStart("2026-11-14") === "2026-11-09");

const games = [
  { uid: "a", score: 21, verified: true, createdAt: Date.UTC(2026, 10, 11, 18) },
  { uid: "a", score: 21, verified: true, createdAt: Date.UTC(2026, 10, 13, 18) },
  { uid: "b", score: 21, verified: true, createdAt: Date.UTC(2026, 10, 14) }
];
const matches = [
  { status: "finished", uids: ["a", "c"], players: [{ uid: "a", name: "Ann" }, { uid: "c", name: "Cy" }], scores: [21, 15], winner: "a", reason: "score", updatedAt: Date.UTC(2026, 10, 14, 20), code: "MATCH" },
  { status: "finished", uids: ["a", "d"], players: [{ uid: "a", name: "Ann" }, { uid: "d", name: "Dee" }], scores: [18, 21], winner: "d", reason: "score", updatedAt: Date.UTC(2026, 10, 10, 20), code: "LOSS1" },
  { status: "finished", uids: ["a", "e"], players: [{ uid: "a", name: "Ann" }, { uid: "e", name: "Eve" }], scores: [21, 21], winner: null, reason: "tie", updatedAt: Date.UTC(2026, 10, 8, 20), code: "TIE01" },
  { status: "active", uids: ["a", "f"], scores: [5, 3], winner: null }
];
const seasons = [
  { uid: "a", season: "2026-Q4", wins: 4, losses: 2, battles: 6 },
  { uid: "a", season: "2026-Q3", wins: 1, losses: 1, battles: 2 },
  { uid: "b", season: "2026-Q4", wins: 9, losses: 0, battles: 9 }
];
const wr = D.washerRecord({ uid: "a", today: "2026-11-14", games: games, matches: matches, seasons: seasons, ledger: ledger });
check("washer wins add solo + all-season battles + Live Match wins", wr.soloWins === 2 && wr.battleWins === 5 && wr.liveWins === 1 && wr.wins === 8);
check("washer losses come from battles + Live Match (solo has none)", wr.battleLosses === 3 && wr.liveLosses === 1 && wr.losses === 4);
check("washer ties come from finished Live Matches (reason tie)", wr.ties === 1 && wr.liveTies === 1);
check("win pct is wins / (wins+losses+ties)", wr.winPct === D.winPct(8, 4, 1) && wr.winPct === 61.5);
check("recent washer list is newest first with mode, score, W/L/T, and no opponent on solo", wr.recent[0].mode === "Live Match" && wr.recent[0].result === "W" && wr.recent[0].opponent === "Cy" && wr.recent[0].score === "21–15" && wr.recent.some((g) => g.mode === "Solo" && g.result === "W" && !g.opponent));
check("win streak uses listed solo and Live Match results only (a win today after earlier games)", wr.currentStreak === 3 && wr.bestStreak >= 3);
check("ledger washers ZAB is solo-win earn only", wr.zab === 1);

const sum = D.summarize(Object.assign({}, base, {
  zabBalance: 17.5, ledger: ledger, daily: [{ uid: "a", date: "2026-11-10", steps: 8000 }, { uid: "a", date: "2026-11-14", steps: 8760 }],
  pushups: tutRows, planks: planks, games: games, matches: matches, seasons: seasons
}));
check("summarize rolls every section together", sum.signedIn && sum.steps === 16760 && sum.todaySteps === 8760 && sum.pushups === 82 && sum.tutSets === 2 && sum.planks === 2 && sum.plank.setsCompleted === 2 && sum.tenK.count === 3 && sum.washers.wins === 8 && sum.zabBalance === 17.5);
check("nudge is steps remaining to 10K when under the goal", sum.nudge === "1,240 steps to your next 10K");
check("activity streak counts any posted day and is still current", sum.activityStreak >= 1);
check("personal bests capture longest plank, best steps day, best push-up set", sum.bests.plankMs === 180000 && sum.bests.steps.steps === 8760 && sum.bests.pushups === 30);

const filled = D.cardHtml(sum);
check("card layout: summary, Zabba washer near the top, then Steps, 10K, Push-ups, TUT, Planks", (() => {
  const i = (s) => filled.indexOf(s);
  return i("Your dashboard") >= 0 && i("1,240 steps to your next 10K") < i("Zabba washer") && i("Zabba washer") < i(">Steps<") && i(">Steps<") < i("10K Milestones") && i("10K Milestones") < i("Push-ups") && i("Push-ups") < i(">TUT<") && i(">TUT<") < i(">Planks<") && i(">Planks<") < i("Plank push press") && i("Plank push press") < i("Personal bests");
})());
check("washer section shows W/L/T, win pct, streaks and recent Live Match line", /Wins/.test(filled) && /Losses/.test(filled) && /Ties/.test(filled) && /Win pct/.test(filled) && /Cy/.test(filled) && /Live Match/.test(filled) && /21–15/.test(filled));
check("plank section uses plank set complete and plank push press copy", /Plank sets completed/.test(filled) && /plank set complete/.test(filled) && /plank push press holds/.test(filled) && /Lifetime time held/.test(filled) && /Longest hold/.test(filled) && /Sets this week/.test(filled));
check("signed-in card keeps lifetime steps, TUT, 10K list newest first", /Lifetime steps/.test(filled) && /16,760/.test(filled) && /TUT sets completed/.test(filled) && /Nov 14, 2026/.test(filled) && filled.indexOf("Nov 14") < filled.indexOf("Nov 13"));

const empty = D.cardHtml(D.summarize(Object.assign({}, base, { ledger: [], daily: [], pushups: [], planks: [], games: [], matches: [], seasons: [] })));
check("empty 10K and plank and washer states are friendly", /No 10K days yet/.test(empty) && /No plank set complete yet/.test(empty) && /No Zabba washer games posted yet/.test(empty));
check("nudge at zero steps still points at 10K", /10,000 steps to your next 10K/.test(empty));
check("signed-out card asks the user to sign in", /Sign in to track your 10K days/.test(D.cardHtml({ signedIn: false })) && !/Lifetime steps/.test(D.cardHtml({ signedIn: false })));
check("nudge after a 10K day suggests a plank set complete if none today", D.nudge({ todaySteps: 10000, plank: { today: 0 }, tenK: { currentStreak: 1 } }) === "Hold 60 seconds for a plank set complete");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const indexes = fs.readFileSync(path.join(__dirname, "..", "firestore.indexes.json"), "utf8");
check("page loads lifetime-dash.js and renders the dashboard card in #steps", html.includes('<script src="/lifetime-dash.js"></script>') && /id="userDash"/.test(html) && html.indexOf('id="userDash"') > html.indexOf('id="tenKBonus"') && html.indexOf('id="userDash"') > html.indexOf("Daily Earn Steps Board"));
check("page has the signed-out line; section headings live in the dashboard module", /Sign in to track your 10K days/.test(html) && /10K Milestones/.test(fs.readFileSync(path.join(__dirname, "..", "lifetime-dash.js"), "utf8")) && /Zabba washer/.test(filled) && /plank push press/.test(filled));
check("dashboard listens without a new composite index", /collection\(db, "dailySteps"\), where\("uid", "==", u\.uid\)/.test(html) && /collection\(db, "planks"\), where\("uid", "==", u\.uid\)/.test(html) && /collection\(db, "games"\), where\("uid", "==", u\.uid\)/.test(html) && /collection\(db, "washersBattleSeason"\), where\("uid", "==", u\.uid\)/.test(html) && /collection\(db, "matches"\), where\("uids", "array-contains", u\.uid\)/.test(html) && /collection\(db, "users", u\.uid, "zabLedger"\), orderBy\("createdAt", "desc"\)/.test(html) && !/where\("source", "==", "steps10k"\)/.test(html));
check("TUT + push-ups still use the existing pushups-by-uid listener (no second query)", /onSnapshot\(query\(collection\(db, "pushups"\), where\("uid", "==", u\.uid\)\)/.test(html) && (html.split('collection(db, "pushups"), where("uid", "==", u.uid)').length === 2));
check("rules already let the owner read their own zabLedger; boards are signed-in readable; no rule edits for this card", /match \/zabLedger\/\{txId\} \{\s*allow read: if request\.auth != null && request\.auth\.uid == uid;/.test(rules) && /match \/dailySteps\/\{id\} \{\s*allow read: if signedIn\(\);/.test(rules) && /match \/pushups\/\{id\} \{\s*allow read: if signedIn\(\);/.test(rules) && /match \/planks\/\{id\} \{\s*allow read: if signedIn\(\);/.test(rules) && /match \/games\/\{id\} \{\s*allow read: if signedIn\(\);/.test(rules) && /match \/washersBattleSeason\/\{id\} \{\s*allow read: if signedIn\(\);/.test(rules) && /match \/matches\/\{code\}/.test(rules));
check("no new Firestore index was added", !/dailySteps/.test(indexes) && !/planks/.test(indexes) && !/"games"/.test(indexes) && (indexes.match(/zabLedger/g) || []).length === 1);

const fails = R.filter((x) => !x).length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
