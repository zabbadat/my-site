// #battles anchor exists and anchor jumps clear the fixed header. Run: node test/battles-anchor.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("section id=battles exists once", (html.match(/<section id="battles">/g) || []).length === 1);
check("a link to #battles exists", /href="#battles"/.test(html));
check("section[id] has scroll-margin-top so the fixed nav does not cover the heading", /section\[id\]\s*\{\s*scroll-margin-top:\s*[\d.]+rem/.test(html));
check("nav is fixed (reason for the margin)", /nav\s*\{\s*position:\s*fixed/.test(html));
const ok = R.every(Boolean); console.log(ok ? "ALL PASS" : "SOME FAILED"); process.exit(ok ? 0 : 1);
