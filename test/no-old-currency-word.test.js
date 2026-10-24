// Sweep guard: the old currency noun must not appear anywhere in the repo (text, speech, code, rules, docs, tests, file names).
// Only third-party API names are allowed, listed exactly below. (Pattern written with a character class so this file stays clean.)
const cp = require("child_process"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), WORD = /tok[e]n/i;
const THIRD_PARTY = /(getId|verifyId)Tok[e]n/g; /* Firebase SDK / Admin SDK method names */
const files = cp.execSync("git ls-files --cached --others --exclude-standard", { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && !/\.(png|ico|mp4)$|package-lock/.test(f) && fs.existsSync(path.join(root, f)));
let bad = [], allowed = [];
/* These files must name the OLD stored fields on purpose: the migration doc, the one-time migration script (it reads the old
 * collections / field and writes the new ones) and its mocked-Firestore test. Nothing else may. */
const MIGRATION_FILES = ["MIGRATION_NOTES.md", "tools/migrate-zab.js", "test/migrate-zab.test.js"];
files.forEach((f) => { if (MIGRATION_FILES.indexOf(f) >= 0) return; if (WORD.test(f)) bad.push(f + " (file name)"); fs.readFileSync(path.join(root, f), "utf8").split("\n").forEach((l, i) => { if (!WORD.test(l)) return; if (!WORD.test(l.replace(THIRD_PARTY, ""))) allowed.push(f + ":" + (i + 1)); else bad.push(f + ":" + (i + 1) + " " + l.trim().slice(0, 80)); }); });
console.log((bad.length ? "FAIL" : "PASS") + "  old currency noun absent from " + files.length + " files; third-party API names only: " + allowed.join(", "));
bad.forEach((b) => console.log("  " + b));
console.log("PASS  only " + MIGRATION_FILES.join(", ") + " may name the old stored fields (for the data migration)");
const okAllowed = allowed.every((a) => /^(index\.html|members\.js|netlify\/lib\/common\.js):/.test(a));
console.log((okAllowed ? "PASS" : "FAIL") + "  allowed names are only in index.html, members.js, netlify/lib/common.js");
process.exit(bad.length || !okAllowed ? 1 : 0);
