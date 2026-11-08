// Boards are signed-in read only; the page subscribes while signed in and shows a sign-in prompt when signed out.
// Run: node test/boards-signin-read.test.js
const fsx = require("fs"), path = require("path"), vm = require("vm");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const rules = fsx.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8"), html = fsx.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const COLS = ["games/{id}", "pushups/{id}", "planks/{id}", "plankDaily/{id}", "dailySteps/{id}", "walkSessions/{id}", "washersBattleSeason/{id}", "tutBattleStats/{uid}"];
check("rules: the 8 boards need sign-in to read", COLS.every((c) => new RegExp("match /" + c.replace(/[{}]/g, "\\$&") + " \\{\\s*allow read: if signedIn\\(\\);").test(rules)));
check("rules: nothing is world-readable any more", !/allow read: if true/.test(rules));
const BODIES = ["boardBody", "pushBoardBody", "tbRankBody", "tutBoardBody", "plankBoardBody", "plankDailyBody", "dailyBoardBody", "walkBoardBody"];
check("page: every board is registered through boardSnap (no top-level public onSnapshot left)", BODIES.every((b) => html.includes('boardSnap("' + b + '"'))
  && !/^onSnapshot\(query\(collection\(db, "(games|pushups|planks|plankDaily|dailySteps|walkSessions|tutBattleStats)"/m.test(html) && !/^onSnapshot\((q|pq), /m.test(html));
check("page: boardsOnUser registered after the boards; season board gated on sign-in", html.lastIndexOf("onAuthStateChanged(auth, boardsOnUser)") > html.lastIndexOf('boardSnap("walkBoardBody"')
  && /function bbStart\(\) \{\s*if \(!BT \|\| !\$\("bbBody"\)\) return;\s*if \(!auth\.currentUser\)/.test(html) && /if \(!auth\.currentUser\) \{ signedOutRow\("bbBody"\); return; \}/.test(html));
const decl = html.indexOf("const boardSubs = [];");
const firstCall = html.indexOf('boardSnap("');
check("page: boardSubs is initialized before any boardSnap call", decl !== -1 && decl < firstCall);
check("page: ZAB auth listener is after boardSubs, so a boardSnap call cannot skip it", html.indexOf("onAuthStateChanged(auth, (u) => { showUser(u); zabOnUser(u);") > decl);
// run the helpers: signed out -> prompt in each board, no subscription; signed in -> subscribe; sign out again -> unsubscribe
const fnAt = html.indexOf("function boardsOnUser(u)", decl);
const src = html.slice(decl, html.indexOf("\n}", fnAt) + 2);
const callEnd = html.indexOf("}, () => {});", firstCall) + "}, () => {});".length;
let bootErr = "";
try {
  vm.runInContext(html.slice(decl, callEnd), vm.createContext({
    $: () => ({ innerHTML: "" }),
    query: () => "q", collection: () => "c", db: {}, orderBy: () => "o", limit: () => 1, onSnapshot: () => () => {}
  }));
} catch (e) { bootErr = e.name + ": " + e.message; }
check("page: first boardSnap runs after boardSubs exists", bootErr === "");
const els = {}; const mk = (id) => (els[id] = els[id] || { innerHTML: "", closest: () => ({ querySelectorAll: () => [1, 2, 3, 4] }) });
let live = 0, offs = 0;
const ctx = { $: mk, onSnapshot: () => { live++; return () => { offs++; }; } };
vm.createContext(ctx); vm.runInContext(src + "\nthis.boardSnap = boardSnap; this.boardsOnUser = boardsOnUser;", ctx);
ctx.boardSnap("a", "Q1", () => {}, () => {}); ctx.boardSnap("b", () => "Q2", () => {}, () => {});
ctx.boardsOnUser(null);
check("signed out: sign-in prompt in each board, nothing subscribed", live === 0 && /Sign in to see this board\./.test(els.a.innerHTML) && /colspan="4"/.test(els.b.innerHTML));
ctx.boardsOnUser({ uid: "u" });
check("signed in: each board subscribed", live === 2);
ctx.boardsOnUser(null);
check("signed out again: subscriptions closed", offs === 2);
const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
