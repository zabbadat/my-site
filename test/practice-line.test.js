// The practice-section line: exact text, directly under The practice section's cards, before the Washers section.
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const LINE = "Learn coordination, strength, breath, and meditation \u2014 games that make being active the point.";
const m = html.match(/<section id="approach">([\s\S]*?)<\/section>\s*<section class="washers" id="washers">/);
check("practice section found (<h2>The practice</h2>) and followed directly by the Washers section", !!m && /<h2>The practice<\/h2>/.test(m[1]));
const sec = m ? m[1] : "";
check("exact line, em dash, 'make' (not 'makes')", html.includes(`>${LINE}</p>`) && !/games that makes/.test(html));
check("line appears once", html.split(LINE).length === 2);
const tail = sec.slice(sec.lastIndexOf("</div>") + 6).trim();
check("DOM order: heading, lede, card grid, then the new line as the last element of the practice section", tail === `<p class="lead" id="practiceLine" style="margin-top:1.6rem">${LINE}</p>`);
check("reuses the section's lede class (class=\"lead\"), no new CSS rule", /class="lead" id="practiceLine"/.test(sec) && !/practiceLine\s*\{/.test(html));
check("the original lede is untouched", sec.includes('<p class="lead">Learned coordination, breath, and attention \u2014 a game that makes being active the point.</p>'));
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
