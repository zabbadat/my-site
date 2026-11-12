// Arcade scoreboard crispness: vector 7-segment SVG, glow behind digits, no soft blur.
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "..", "arcade-crisp.js"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("index loads arcade-crisp.js", /<script src="\/arcade-crisp\.js"><\/script>/.test(html));
check("painter builds vector 7-segment SVG (no canvas, no fillText)", /svgFor/.test(js) && /7-segment/.test(js) && /createElement\("canvas"\)/.test(js) === false && /fillText/.test(js) === false && /<svg class="arcade-crisp"/.test(js));
check("glow is a separate behind layer; digits are opacity 1 with no filter", /class="arcade-glow"/.test(js) && /class="arcade-digits"/.test(js) && /opacity="1"/.test(js) && /arcade-digits" fill="/.test(js));
check("score / steps / clock keep integer 24/32px sizes and no CSS blur/drop-shadow/translate", /#score\.arcade-page/.test(html) && /font-size:32px/.test(html) && /font-size:24px/.test(html) && !/#score\.arcade-page[\s\S]{0,400}filter:\s*blur/.test(html) && !/#score\.arcade-page[\s\S]{0,400}drop-shadow/.test(html) && !/#score\.arcade-page[\s\S]{0,500}translateZ/.test(html) && !/\.arcade-strip \.arcade-num\{[^}]*0 0 14px/.test(html) && !/\.arcade-strip \.arcade-num\{[^}]*0 0 8px #2bff2b/.test(html));
check("visible digit CSS has no blur text-shadow and opacity 1", /\.arcade-crisp-on\{[^}]*opacity:1/.test(html) && /\.arcade-crisp \.arcade-digits\{filter:none;opacity:1\}/.test(html) && /\.arcade-strip \.arcade-num\{[^}]*text-shadow:none/.test(html));
check("nav TUTS label is compact Push-Ups-TUTS (tight dash), click path unchanged", /<a href="#push">Push-Ups-TUTS<\/a>/.test(html) && /navTuts\) navTuts\.onclick = \(e\) => heroGo\("long", e\)/.test(html) && !/nav-sep|nav-gap/.test(html));
check("traveling nav gap is the moderate +33% value (.73rem)", /nav a:not\(\.logo\) \{ margin-left: \.73rem; \}/.test(html) && /margin-left: 1\.86rem/.test(html));
check("SVG size snaps to integer device pixels via devicePixelRatio", /devicePixelRatio/.test(js) && /unitDev/.test(js) && /snapCss/.test(js));
check("toLocaleString grouping commas are stripped so step counts still paint", js.includes("replace(/,/g") && js.includes("function normalize"));
check("structured battle scores (.n / .c children) are left alone", /isSimple\(el\)/.test(js) && /clearPaint/.test(js));
const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); if (ok !== R.length) process.exit(1);
