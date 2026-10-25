// The Coordination card in The practice section reads "Coordination & strength" (same card markup/styling as its siblings).
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const sec = html.match(/<section id="approach">([\s\S]*?)<\/section>/)[1];
const cards = sec.match(/<div class="card">[\s\S]*?<\/div>/g) || [];
check("practice section has its four cards", cards.length === 4);
check("card heading is exactly 'Coordination & strength' (h3 inside a plain .card, like its siblings)", cards[1] === '<div class="card"><h3>Coordination &amp; strength</h3><p>Patterns that organize the body so movement costs less effort.</p></div>');
check("old 'Coordination Strength' heading is gone", !/<h3>Coordination Strength<\/h3>/.test(html));
check("the heading text reads 'Coordination & strength' once entities are decoded", cards[1].match(/<h3>(.*?)<\/h3>/)[1].replace(/&amp;/g, "&") === "Coordination & strength");
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
