// wager-sweep is a legacy (CommonJS) Netlify function: `exports.config = { schedule }` is IGNORED for those, so the
// 5-minute cron must be declared in netlify.toml ([functions."wager-sweep"] schedule). Without it nothing refunds stale wagers.
const fs = require("fs"), path = require("path");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const toml = fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8");
const m = /\[functions\."wager-sweep"\]([^\[]*)/.exec(toml);
check("netlify.toml declares [functions.\"wager-sweep\"]", !!m);
check("schedule is every 5 minutes (*/5 * * * *)", !!m && /^\s*schedule\s*=\s*"\*\/5 \* \* \* \*"\s*$/m.test(m[1]));
check("function file exists and keeps its in-file schedule too", fs.existsSync(path.join(__dirname, "..", "netlify", "functions", "wager-sweep.js")) && /schedule: "\*\/5 \* \* \* \*"/.test(fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "wager-sweep.js"), "utf8")));
check("secret-scan omit setting is still present", /SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES/.test(toml));
check("toml parses: every table header is well formed", toml.split("\n").filter((l) => /^\s*\[/.test(l)).every((l) => /^\s*\[[A-Za-z0-9_."-]+\]\s*$/.test(l)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
