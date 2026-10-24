// Regression: the signed-in header badge must show "<name> · <n> ZAB (ring)", not only the amount.
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
let pass = 0, fail = 0;
function check(n, ok) { if (ok) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } }
const fn = html.split("\n").find((l) => l.startsWith("function paintZabSection"));
check("paintZabSection found", !!fn);
check("badge shows name span via badgeParts", /zt-name/.test(fn) && /badgeParts/.test(fn));
check("badge shows amountHtml (ZAB + ring)", /amountHtml/.test(fn));
check("signed-out badge says Sign in", /Sign in/.test(fn));
check("zt-name css truncation present", /\.zt-badge \.zt-name\{[^}]*text-overflow:ellipsis/.test(html));
console.log("passed " + pass + " failed " + fail);
process.exit(fail ? 1 : 0);
