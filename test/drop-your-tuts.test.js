// Dedicated TUT category: recorded order, two values, measured continuous hold (not session time or bonus count).
const fs = require("fs"), vm = require("vm"), path = require("path"), S = require("../push-session.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const fn = (n) => html.match(new RegExp("function " + n + "\\([^]*?\\n\\}"))[0];
const hold = S.createHoldReward();
hold.update(true, 1000, false); hold.update(true, 121000, false);
check("hold continues measuring past 30-second bonus, with no 120-second gate", hold.state().bestMs === 120000 && hold.state().done);
hold.update(false, 121001, false); hold.update(true, 122000, false); hold.update(true, 123000, false);
check("shorter later holds do not overwrite completed continuous hold or sum separate holds", hold.state().bestMs === 120000);
hold.reset(); hold.update(true, 0, false); hold.update(true, 12345, false);
check("actual sub-30-second hold is recorded, no bonus or minimum required", hold.state().bestMs === 12345 && !hold.state().done);
hold.reset(); check("new set resets measured hold", hold.state().bestMs === 0);
const ET = require("../et-day.js");
const els = {}, store = {}, ctx = { $: (id) => els[id] || (els[id] = {}), Number, Date, JSON, Math, String, Object, currentUser: { uid: "u1" }, formatTut: (ms) => Math.floor((Number(ms) || 0) / 1000) + "s", formatTime: (ms) => Math.floor((Number(ms) || 0) / 1000) + "s", publicName: (n) => n || "Player", escapeHtml: String, localStorage: { length: 0, getItem: (k) => store[k] || null }, window: { ZabbadatSession: S, ZabbadatEtDay: ET } };
vm.createContext(ctx); vm.runInContext(fn("tutDayOf") + "\n" + fn("paintTutRows") + "\n" + fn("paintTutLifetime") + "\n" + fn("renderTutHistory"), ctx);
// Rule helpers: 1:20 + 10 push-ups are minimums, never a cap.
check("tutCompleted: 1:20 + 10 push-ups (long mode only); minimums, not a cap", S.tutCompleted("long", 80000, 10) && S.tutCompleted("long", 600000, 200) && !S.tutCompleted("long", 79999, 50) && !S.tutCompleted("long", 300000, 9) && !S.tutCompleted("sets", 90000, 20) && !S.tutCompleted("challenge", 180000, 40));
check("isTutSetDoc: Firestore doc (no category) recognised by tutMs/ms/reps; Sets/challenge docs (tutMs 0) are not", S.isTutSetDoc({ reps: 12, ms: 81000, tutMs: 81000 }) && !S.isTutSetDoc({ reps: 12, ms: 81000, tutMs: 0 }) && !S.isTutSetDoc({ reps: 9, ms: 99000, tutMs: 99000 }) && !S.isTutSetDoc({ reps: 30, ms: 70000, tutMs: 70000 }) && S.isTutSetDoc({ category: "tut-set", reps: 10, ms: 80000 }));
const now = Date.now(), yest = ET.startMs(now) - 60000;
const rows = [
  { uid: "a", name: "Ann", reps: 15, ms: 95000, tutMs: 95000, at: now - 1000 },
  { uid: "b", name: "Bea", reps: 61, ms: 247000, tutMs: 247000, at: now - 2000 },
  { uid: "a", name: "Ann", reps: 11, ms: 80000, tutMs: 80000, at: now - 3000 },
  { uid: "a", name: "Ann", reps: 40, ms: 79000, tutMs: 79000, at: now - 4000 },   // under 1:20
  { uid: "c", name: "Cy", reps: 9, ms: 200000, tutMs: 200000, at: now - 5000 },     // under 10 reps
  { uid: "d", name: "Dee", reps: 99, ms: 99000, tutMs: 0, at: now - 6000 },         // Sets / challenge
  { uid: "e", name: "Eve", reps: 20, ms: 90000, tutMs: 90000, at: yest },           // yesterday (ET)
  { uid: "a", name: "Ann", reps: 30, ms: 90000, tutMs: 90000, at: yest - 1000 }     // Ann's better yesterday
];
ctx.rows = rows; vm.runInContext("paintTutRows(rows)", ctx);
check("public board: Today / Best day / All-time reps, people in order of latest set (Ann, Bea, Eve)", els.tutBoardBody.innerHTML === '<tr><td>Ann</td><td>26</td><td>30</td><td>56</td></tr><tr><td>Bea</td><td>61</td><td>61</td><td>61</td></tr><tr><td>Eve</td><td>0</td><td>20</td><td>20</td></tr>');
check("sub-1:20, sub-10-rep and non-TUT sets are not counted on the public board", !/Cy|Dee/.test(els.tutBoardBody.innerHTML) && !/>40</.test(els.tutBoardBody.innerHTML));
ctx.paintTutRows([]);
check("empty board: no completed-sets message, no tutPeopleCount/tutTimesCount writes", /No TUT sets completed yet/.test(els.tutBoardBody.innerHTML) && !/today yet/.test(els.tutBoardBody.innerHTML) && !els.tutPeopleCount && !els.tutTimesCount);
const daily = S.tutDaily(rows, (r) => ET.key(r.at), ET.key(yest));
check("ET day boundary: yesterday's key returns only yesterday's sets", daily.length === 2 && daily[0].name === "Eve" && daily[1].name === "Ann");
const dayOf = (r) => ET.key(r.at);
const todayKey = ET.key(now);
const nextKey = ET.key(ET.startMs(now) + 36 * 3600 * 1000);
const todayStats = S.tutBoardStats(rows, dayOf, todayKey);
const nextStats = S.tutBoardStats(rows, dayOf, nextKey);
const byName = (list, n) => list.find((p) => p.name === n);
check("tutBoardStats today: Ann 26/30/56, Bea 61/61/61, Eve 0/20/20", byName(todayStats, "Ann").today === 26 && byName(todayStats, "Ann").bestDay === 30 && byName(todayStats, "Ann").allTime === 56 && byName(todayStats, "Bea").today === 61 && byName(todayStats, "Bea").bestDay === 61 && byName(todayStats, "Bea").allTime === 61 && byName(todayStats, "Eve").today === 0 && byName(todayStats, "Eve").bestDay === 20 && byName(todayStats, "Eve").allTime === 20 && todayStats.length === 3);
check("after ET midnight, Today resets to 0 and Best day / All-time persist", byName(nextStats, "Ann").today === 0 && byName(nextStats, "Ann").bestDay === 30 && byName(nextStats, "Ann").allTime === 56 && byName(nextStats, "Bea").today === 0 && byName(nextStats, "Bea").bestDay === 61 && byName(nextStats, "Bea").allTime === 61 && byName(nextStats, "Eve").today === 0 && byName(nextStats, "Eve").bestDay === 20 && byName(nextStats, "Eve").allTime === 20 && nextStats.map((p) => p.name).join(",") === todayStats.map((p) => p.name).join(","));
ctx.rows = rows; ctx.paintTutRows.day = "force-old";
// paintTutRows uses Date.now() for today, so we also confirm a midnight-driven repaint path still calls tutBoardStats
check("paintTutRows midnight interval is still wired (Today column refreshes, no people/times counters)", /paintTutRows\.last && paintTutRows\.day !== tutDayOf\(\{ at: Date\.now\(\) \}\)\) paintTutRows\(paintTutRows\.last\)/.test(html) && !/tutPeopleCount|tutTimesCount/.test(fn("paintTutRows")));
// Lifetime counter on the profile
check("tutLifetime counts this uid's completed TUT sets only", S.tutLifetime(rows, "a") === 3 && S.tutLifetime(rows, "b") === 1 && S.tutLifetime(rows, "c") === 0 && S.tutLifetime(rows, "e") === 1);
ctx.paintTutLifetime(7);
check("profile shows 'TUT sets completed: N'", els.tutLifetime.hidden === false && els.tutLifetimeN.textContent === "7" && /id="tutLifetime"[^>]*hidden[^>]*>TUT sets completed: <span id="tutLifetimeN"/.test(html));
ctx.paintTutLifetime(null); check("profile counter hidden when signed out", els.tutLifetime.hidden === true);
check("lifetime counter reads the user's own pushups docs by uid (equality only, no index) and is wired to sign-in", /onSnapshot\(query\(collection\(db, "pushups"\), where\("uid", "==", u\.uid\)\)/.test(html) && /function boardsOnUser\(u\) \{\n  try \{ tutLifetimeOnUser\(u\); \} catch \(e\) \{\}/.test(html));
check("visible title Time Under Tension Sets with Sets on its own line, TUTS highlight, Drop Your Tuts scoreboard and Today · Best day · All-time, no midnight/reset wording on the board", /<h2><span class="tuts-hl">T<\/span>ime <span class="tuts-hl">U<\/span>nder <span class="tuts-hl">T<\/span>ension <span class="tuts-sets"><span class="tuts-hl">S<\/span>ets<\/span><\/h2>/.test(html) && (html.match(/<section[^>]*id="tut-board"[\s\S]*?<h2>([\s\S]*?)<\/h2>/) || ["",""])[1].replace(/<[^>]+>/g, "") === "Time Under Tension Sets" && html.includes('id="tutBoardSub">Drop Your Tuts scoreboard') && html.includes("Today · Best day · All-time") && html.includes("<th>Today</th><th>Best day</th><th>All-time</th>") && html.includes("1:20 with at least 10 push-ups, or an 80-second regular plank") && html.includes("You can't fail just by holding.") && !/reset at midnight|Today's scoreboard/.test((html.match(/<section[^>]*id="tut-board"[\s\S]*?<\/section>/) || [""])[0]) && !/rankTut|sort\(/.test(fn("paintTutRows")));
check("TUTS letters pulse with a unique arcade keyframe, 1.8s ease-in-out, 0.15s stagger, and reduced-motion off", /@keyframes tuts-hl-pulse/.test(html) && /animation:\s*tuts-hl-pulse 1\.8s ease-in-out infinite/.test(html) && html.includes("animation-delay: .15s") && html.includes("animation-delay: .3s") && html.includes("animation-delay: .45s") && !/@keyframes tuts-hl-pulse[^]*@keyframes tut-marquee/.test(html) && /prefers-reduced-motion: reduce\) \{\s*#tut-board, #tut-board \.eyebrow \{ animation: none; \}\s*#tut-board h2 \.tuts-hl \{ animation: none; transform: none; \}/.test(html));
check("TUTS peak glow is gold plus cyan (gold core, cyan outer glow) and keeps the pink", /50% \{[^}]*#fff6a8[^}]*#ffe566[^}]*0 0 24px var\(--arcade-cyan\)[^}]*var\(--arcade-pink\)[^}]*rgba\(45,226,230,\.9\)/.test(html));
check("Tuts dropped block is gone; personal Your time under tension block is unchanged; no leftover recent-sessions board", !html.includes("Tuts dropped") && !html.includes('id="tutPeopleCount"') && !html.includes('id="tutTimesCount"') && !html.includes("Times done") && html.includes("Your time under tension") && html.includes('id="tutToday"') && html.includes('id="tutBestDay"') && html.includes('id="tutAll"') && html.includes('id="tutTodayReps"') && html.includes('id="tutBestDayInfo"') && html.includes('id="tutAllReps"') && !html.includes("Your recent drop your tuts") && !html.includes("tutSessBody"));
check("Firestore board: all-time query (no 300 cap), shown in recorded order newest first, not longest ms", /boardSnap\("tutBoardBody", tutAllQ/.test(html) && /const plankTutQ = query\(collection\(db, "planks"\), where\("holdSec", ">=", 80\)\)/.test(html) && /const tutAllRowsOf = \(snap\) => tutRowsOf\(snap\)\.sort\(\(a, b\) => \(b\.at \|\| 9e15\) - \(a\.at \|\| 9e15\)\)/.test(html));
(async () => {
  let saved;
  Object.assign(ctx, { auth: { currentUser: { uid: "u1" } }, db: {}, collection: (db, col) => col, addDoc: async (col, r) => { saved = r; return { id: "id1" }; }, serverTimestamp: () => "now" });
  vm.runInContext(html.match(/saveRemotePush = async \(record\) => \{[^]*?\n\};/)[0], ctx);
  await ctx.saveRemotePush({ name: "Z", reps: 12, ms: 80000, tutMs: 80000, holds: 1, category: "tut-set", holdMs: 34567 });
  // Root cause (Nov 13): the client sent category + holdMs, which the pushups create rule (keys().hasOnly) refuses, so every push-up post failed.
  const rules = fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8");
  const allowed = JSON.parse(rules.match(/match \/pushups\/\{id\} \{[^]*?keys\(\)\.hasOnly\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  check("Firestore pushups payload only uses keys the create rule allows (" + Object.keys(saved).join(",") + ")", Object.keys(saved).every((k) => allowed.includes(k)) && !("category" in saved) && !("holdMs" in saved));
  check("payload keeps full time, reps and reward fields", saved.reps === 12 && saved.ms === 80000 && saved.tutMs === 80000 && saved.holds === 1 && saved.uid === "u1");
  vm.runInContext(html.match(/const tutRowsOf = \(snap\) =>[^]*?\n\}\);/)[0], ctx);
  ctx.snap = { docs: [{ data: () => Object.assign({}, saved, { createdAt: { toMillis: () => now, toDate: () => new Date(now) } }) }] };
  const mapped = vm.runInContext("tutRowsOf(snap)", ctx)[0];
  check("read mapper keeps tutMs and the server time, so a saved doc counts as a TUT set today", mapped.tutMs === 80000 && mapped.at === now && mapped.uid === "u1" && S.isTutSetDoc(mapped));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
