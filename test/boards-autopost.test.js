// Boards auto-post: signed-in users' own scores and ZAB go live immediately (no approval step anywhere).
// Locks in: no approved/pending/moderation field in rules or client; boards are read without an approval filter;
// each board allows owner create with a field whitelist and server timestamp; ZAB ledger is server-only (zab-earn).
const fs = require("fs"), path = require("path");
const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const rules = R("firestore.rules"), html = R("index.html");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const block = (m) => { const i = rules.indexOf("match /" + m + "/"); if (i < 0) return ""; let d = 0, j = rules.indexOf("} {", i) + 2; for (let k = j; k < rules.length; k++) { if (rules[k] === "{") d++; if (rules[k] === "}" && !--d) return rules.slice(i, k + 1); } return ""; };
check("no approval / moderation fields in rules or page", !/approv|moderat|pendingReview|isApproved/i.test(rules + html));
const boards = { games: "createdAt", pushups: "createdAt", planks: "createdAt", plankDaily: "updatedAt", dailySteps: "updatedAt", walkSessions: "createdAt" };
for (const [c, ts] of Object.entries(boards)) {
  const b = block(c);
  check(`${c}: signed-in read (no public scraping)`, /allow read: if signedIn\(\);/.test(b));
  check(`${c}: signed-in owner create, whitelisted fields, server timestamp`, /allow create: if signedIn\(\) && ownsNew\(\)/.test(b) && /keys\(\)\.hasOnly\(|Ok\(request\.resource\.data\)/.test(b) && new RegExp(ts + " == request\\.time").test(b + rules));
  check(`${c}: board query has no approval filter`, new RegExp('collection\\(db, "' + c + '"\\)').test(html) && !new RegExp('collection\\(db, "' + c + '"\\)[^\\n]*where\\("(approved|status|verified)"').test(html));
}
const tx = block("users"), tb = block("zabBoard");
check("ZAB: the ledger is server-only (no earn or spend from the client; zab-earn credits checked sessions)", /allow create, update, delete: if false;/.test(tx));
check("zabBoard: signed-in read, server-only write (zab-board function: unique names, total from the real balance)", /allow read: if request\.auth != null;/.test(tb) && /allow write: if false;/.test(tb));
check("client posts boards directly on finish (addDoc/setDoc, no queue for review)", ["games", "pushups", "planks", "walkSessions"].every((c) => html.includes('addDoc(collection(db, "' + c + '")')) && ["plankDaily", "dailySteps"].every((c) => html.includes('setDoc(doc(db, "' + c + '"')));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
