// Recent earnings table header matches its columns: Source | ZAB earned | Activity (what you did) | When. Run: node test/earnings-header.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const ZB = require("../zab-balance.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const i = html.indexOf("<h3>Recent earnings</h3>"), t = html.slice(i, html.indexOf("</thead>", i));
const heads = [...t.matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim());
check("header columns read Source, ZAB, Activity, When", JSON.stringify(heads) === JSON.stringify(["Source", "ZAB", "Activity", "When"]));
check("ZAB header keeps the ring token", /<th><span class="zab">ZAB<svg class="zab-ring"/.test(t));
const row = ZB.txRowsHtml([{ source: "pushups", qty: 10, amount: 1 }], (x) => x);
check("row has 4 cells: source, +amount ZAB, activity text, when", (row.match(/<td>/g) || []).length === 4 && /<td>Push-ups<\/td><td>\+1/.test(row) && /<td>10 push-ups<\/td>/.test(row));
const ok = R.every(Boolean); console.log(ok ? "ALL PASS" : "SOME FAILED"); process.exit(ok ? 0 : 1);
