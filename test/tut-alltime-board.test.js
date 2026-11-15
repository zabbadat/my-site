// All-time TUT sets board (owner, Nov 14): true all-time count of completed TUT sets (1:20 + 10 push-ups) per player.
const fs = require("fs"), vm = require("vm"), path = require("path"), S = require("../push-session.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const set = (uid, name, ms, reps, at) => ({ uid, name, ms, reps, tutMs: ms, at: at || 0 });

// More than 300 posts: 350 completed sets for one player plus 40 for another all count (no 300 cap).
const many = [];
for (let i = 0; i < 350; i++) many.push(set("a", "Ann", 90000, 12, i));
for (let i = 0; i < 40; i++) many.push(set("b", "Bo", 81000, 10, i));
let r = S.tutAllTime(many);
check("counts across more than 300 posts (350 + 40)", r.length === 2 && r[0].uid === "a" && r[0].sets === 350 && r[1].sets === 40);

// Threshold: 1:20 AND 10 push-ups; 79999 ms or 9 reps or tutMs 0 (Sets / challenge) don't count.
r = S.tutAllTime([set("a", "A", 80000, 10), set("a", "A", 79999, 50), set("a", "A", 600000, 9), { uid: "a", name: "A", ms: 90000, reps: 20, tutMs: 0 }]);
check("threshold: exactly 1:20 + 10 counts; 79.999 s, 9 reps, and non-long docs do not", r.length === 1 && r[0].sets === 1);
check("threshold constants unchanged (80000 ms, 10 reps)", S.TUT_DONE.minMs === 80000 && S.TUT_DONE.minReps === 10);

// Ranking + ties: ties share a rank (1, 1, 3) and sort by name; uid-less rows are skipped; latest name wins.
r = S.tutAllTime([set("z", "Zed", 90000, 10), set("z", "Zed", 90000, 10), set("y", "Amy", 90000, 10), set("y", "Amy", 90000, 10), set("x", "Cal", 90000, 10),
  set("w", "Old", 90000, 10, 1), set("w", "New", 90000, 10, 5), set("w", "New", 90000, 10, 3), { name: "Ghost", ms: 90000, reps: 10, tutMs: 90000 }]);
check("ranking: most sets first", r[0].sets === 3 && r[0].uid === "w" && r[0].name === "New");
check("ties share a rank and sort by name (1, 2, 2, 4)", r.map((p) => p.rank).join(",") === "1,2,2,4" && r[1].name === "Amy" && r[2].name === "Zed" && r[3].name === "Cal");
check("rows without a uid are not counted", !r.some((p) => p.name === "Ghost"));
check("limit n", S.tutAllTime(many, 1).length === 1 && S.tutAllTime([]).length === 0);

// Page wiring.
const i1 = html.indexOf('id="tutBoardBody"'), i2 = html.indexOf('id="tutAllBoardBody"'), i3 = html.indexOf("Your time under tension</h3>");
check("page: board sits after the drop your tuts table, before 'Your time under tension'", i1 > 0 && i2 > i1 && i2 < i3 && /All-time TUT sets<\/h3>/.test(html));
check("page: Tuts dropped stays removed", !/tutPeopleCount|tutTimesCount|Tuts dropped/.test(html));
check("page: true all-time query, no limit, tutMs >= 80000, shared by both TUT boards", html.includes('const tutAllQ = query(collection(db, "pushups"), where("tutMs", ">=", 80000));') && html.includes('boardSnap("tutAllBoardBody", tutAllQ, (snap) => paintTutAllRows(tutAllRowsOf(snap))') && !/limit\(300\)\), \(snap\) => paintTut/.test(html));
// Best day / All-time on drop your tuts come from every doc (not 300): 400 sets over two days for one player.
const old = []; for (let i = 0; i < 400; i++) old.push(Object.assign(set("a", "Ann", 90000, 10, i), { day: i < 250 ? "d1" : "d2" }));
const st = S.tutBoardStats(old, (r) => r.day, "d2");
check("drop your tuts stats over 400 docs: All-time 4000, Best day 2500, Today 1500", st.length === 1 && st[0].allTime === 4000 && st[0].bestDay === 2500 && st[0].today === 1500);
check("page: names go through publicName + escapeHtml", html.includes("escapeHtml(publicName(p.name))}</td><td>${p.sets}"));

// Render.
const src = html.match(/function paintTutAllRows\(rows\) \{[\s\S]*?\n\}/)[0];
const els = {}; const ctx = { $: (id) => els[id] || (els[id] = {}), escapeHtml: (s) => String(s).replace(/</g, "&lt;"), publicName: (s) => String(s).split("@")[0], window: { ZabbadatSession: S } };
vm.createContext(ctx); vm.runInContext(src, ctx);
ctx.paintTutAllRows([set("a", "ann@x.com", 90000, 10), set("b", "<b>", 90000, 10), set("b", "<b>", 90000, 10)]);
check("render: rank, name (no email, escaped), sets", /<td>1<\/td><td>&lt;b><\/td><td>2<\/td>/.test(els.tutAllBoardBody.innerHTML) && /<td>2<\/td><td>ann<\/td><td>1<\/td>/.test(els.tutAllBoardBody.innerHTML) && !/@/.test(els.tutAllBoardBody.innerHTML));
ctx.paintTutAllRows([]); check("render: empty", /No TUT sets completed yet/.test(els.tutAllBoardBody.innerHTML));
ctx.paintTutAllRows(null); check("render: error", /unavailable/.test(els.tutAllBoardBody.innerHTML));

console.log(pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
