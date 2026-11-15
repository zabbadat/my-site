// Home games tile: Zabba Washers uses the original stacked-washer mark (three washers), not the six-lobe medal.
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

const m = html.match(/<div class="home-games"[\s\S]*?<\/div>/);
check("home-games tile row found", !!m);
const tiles = m ? m[0] : "";
const washers = (tiles.match(/<a href="#washers">[\s\S]*?<\/a>/) || [])[0] || "";
check("Zabba Washers tile is first in the home-games row and labeled Zabba Washers", washers.includes("<span>Zabba Washers</span>") && tiles.indexOf('href="#washers"') < tiles.indexOf('id="tileTut"'));
check("uses the original stacked-washer mark: three washer ellipses with holes, line stroke like the other tiles", /class="tile-ic"(?! tile-medal)/.test(washers) && /<ellipse cx="24" cy="34" rx="16" ry="6"\/>/.test(washers) && /<ellipse cx="24" cy="23" rx="16" ry="6"\/>/.test(washers) && /<ellipse cx="24" cy="12" rx="16" ry="6"\/>/.test(washers) && /<ellipse cx="24" cy="34" rx="4.5" ry="1.7"\/>/.test(washers) && /<ellipse cx="24" cy="23" rx="4.5" ry="1.7"\/>/.test(washers) && /<ellipse cx="24" cy="12" rx="4.5" ry="1.7"\/>/.test(washers) && /fill="none" stroke="currentColor" stroke-width="2.5"/.test(washers));
check("does not use the six-lobe medal mark or tile-medal class on the Washers tile or elsewhere in the row", !/tile-medal/.test(tiles) && !/tile-medal/.test(washers) && !washers.includes("A7.68") && (washers.match(/<ellipse /g) || []).length === 6);
const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
