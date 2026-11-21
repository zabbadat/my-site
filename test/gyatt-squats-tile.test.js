// Home games: 8 tiles in a 2-column grid (4 even rows), Gyatt Squats tile after Step Equity and before Battles,
// Battles no longer spans a full row, and #squats is the live Gyatt Squats section (front camera, Start set + End set only).
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

const row = (html.match(/<div class="home-games"[\s\S]*?<\/div>/) || [""])[0];
const tiles = [...row.matchAll(/<a\b([^>]*)>[\s\S]*?<span>([^<]+)<\/span><\/a>/g)].map((m) => ({ attrs: m[1], label: m[2] }));
check("home-games has 8 tiles (even 2x4 grid)", tiles.length === 8 && tiles.length % 2 === 0);
check("tile order: Zabba Washers, TUTS, Sets, Plank Push Press, Plank House, Step Equity, Gyatt Squats, Battles",
  JSON.stringify(tiles.map((t) => t.label)) === JSON.stringify(["Zabba Washers", "TUTS", "Sets", "Plank Push Press", "Plank House", "Step Equity", "Gyatt Squats", "Battles"]));
const sq = tiles.find((t) => t.label === "Gyatt Squats") || { attrs: "" };
check("Gyatt Squats tile links to #squats", /href="#squats"/.test(sq.attrs) && /id="tileSquats"/.test(sq.attrs));
const bt = tiles.find((t) => t.label === "Battles") || { attrs: "x" };
check("Battles tile is not wide (no full-row span)", !/class="[^"]*wide/.test(bt.attrs) && !/class="wide"/.test(row) && !/\.home-games a\.wide\{/.test(html) && /href="#battles-hub"/.test(bt.attrs));
check("2-column grid kept", /\.home-games\{display:grid;grid-template-columns:1fr 1fr;/.test(html));
const svg = (row.match(/<a href="#squats" id="tileSquats">(<svg[\s\S]*?<\/svg>)/) || [])[1] || "";
check("Gyatt logo inlined as tile-ic: 48 viewBox, stroke 2.5, currentColor, no fill, no XML comments",
  /class="tile-ic"/.test(svg) && /viewBox="0 0 48 48"/.test(svg) && /stroke-width="2\.5"/.test(svg) && /stroke="currentColor"/.test(svg) && /fill="none"/.test(svg) && !/<!--/.test(svg) && !/xmlns=/.test(svg));
check("Gyatt logo: floor line, head, body/leg strokes and the cheek contour (arc path)", /<path d="M5 42h38"\/>/.test(svg) && /<circle cx="13" cy="8\.4" r="3\.5"\/>/.test(svg) && /<path d="M22\.8 22\.2 A[^"]+"\/>/.test(svg));
// matches the final v9 logo file on the box when it exists (owner may tweak it; the tile is re-inlined from it)
const draft = "/workspace/gyatt-logo-draft-v9.svg";
if (fs.existsSync(draft)) {
  const inner = fs.readFileSync(draft, "utf8").replace(/<!--[\s\S]*?-->/g, "").match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1].split("\n").map((l) => l.trim()).join("");
  check("tile logo equals the final v9 logo", svg.includes(inner));
}
const sect = (html.match(/<section id="squats"[\s\S]*?<\/section>/) || [""])[0];
check("#squats section: title Gyatt Squats, front-camera copy, 10 squats = 1 ZAB", /<h2 id="squatsTitle">Gyatt Squats<\/h2>/.test(sect) && /Gyatt squats, camera facing you/.test(sect) && /10 squats = 1 ZAB/.test(sect) && !/Coming soon/.test(sect));
check("#squats buttons: only Start set in the panel; End set (cam-end-btn) on the camera; no Pause / Finish set / Reset total", /id="sqStartBtn"[^>]*>Start set</.test(sect) && /class="btn cam-end-btn" id="sqEndBtn"/.test(sect) && (sect.match(/<button/g) || []).length === 2 && !/Pause|Finish set|Reset total/i.test(sect));
check("#squats camera: mirrored front video in a positioned stage (face logo overlay), arcade HUD with reps + cadence", /<video id="sqVid" autoplay playsinline muted/.test(sect) && /id="sqStage" style="position:relative"/.test(sect) && /id="sqHudReps"/.test(sect) && /id="sqHudCount"/.test(sect));
check("#squats today: squats + sets today", /id="sqRepsToday"/.test(sect) && /id="sqSetsToday"/.test(sect));
check("#squats sits right before the Battles hub", html.indexOf('<section id="squats"') > 0 && html.indexOf('<section id="squats"') < html.indexOf('<section id="battles-hub">') && /<\/section>\s*<section id="battles-hub">/.test(html.slice(html.indexOf('<section id="squats"'))));
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
