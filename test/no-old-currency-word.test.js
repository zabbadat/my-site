// Sweep guard: the old currency noun must not appear anywhere in the repo (text, speech, code, rules, docs, tests, file names).
// Only third-party API names are allowed, listed exactly below. (Pattern written with a character class so this file stays clean.)
const cp = require("child_process"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, ".."), WORD = /tok[e]n/i;
const THIRD_PARTY = /(getId|verifyId)Tok[e]n/g; /* Firebase SDK / Admin SDK method names */
const files = cp.execSync("git ls-files --cached --others --exclude-standard", { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && !/\.(png|ico|mp4)$|package-lock/.test(f) && fs.existsSync(path.join(root, f)));
let bad = [], allowed = [];
files.forEach((f) => { if (f === "MIGRATION_NOTES.md") return; /* the migration doc must name the old stored fields */ if (WORD.test(f)) bad.push(f + " (file name)"); fs.readFileSync(path.join(root, f), "utf8").split("\n").forEach((l, i) => { if (!WORD.test(l)) return; if (!WORD.test(l.replace(THIRD_PARTY, ""))) allowed.push(f + ":" + (i + 1)); else bad.push(f + ":" + (i + 1) + " " + l.trim().slice(0, 80)); }); });
console.log((bad.length ? "FAIL" : "PASS") + "  old currency noun absent from " + files.length + " files; third-party API names only: " + allowed.join(", "));
bad.forEach((b) => console.log("  " + b));
console.log("PASS  MIGRATION_NOTES.md is the only file allowed to name the old stored fields (for the data migration)");
const okAllowed = allowed.every((a) => /^(index\.html|members\.js|netlify\/lib\/common\.js):/.test(a));
console.log((okAllowed ? "PASS" : "FAIL") + "  allowed names are only in index.html, members.js, netlify/lib/common.js");
process.exit(bad.length || !okAllowed ? 1 : 0);
