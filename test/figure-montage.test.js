// Title-screen montage: one in-flow, dismissible intro of all eight home-games figures,
// with product-rule captions. Tiles and sign-in must stay unchanged.
const fs = require("fs"), path = require("path"), assert = require("assert");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !why ? "" : " :: " + why}`); R.push(!!ok); };

const section = (html.match(/<div id="figMontage"[\s\S]*?<\/div>\s*<div class="home-games"/) || [""])[0];
check("figMontage title-screen section is on the homepage", section.length > 0);
check("section sits after the home lockup and before the games grid",
  html.indexOf('class="home-lockup"') < html.indexOf('id="figMontage"') &&
  html.indexOf('id="figMontage"') < html.indexOf('class="home-games"'));
check("Zabbadat title is in the heading font (Cormorant Garamond)",
  /<p class="fm-title">Zabbadat<\/p>/.test(section) &&
  /\.fm-title\{[^}]*font-family:'Cormorant Garamond',serif/.test(html));
check("spelling is Zabbadat, not Zabadat, in the montage title and captions",
  /Zabbadat/.test(section) && !/Zabadat/.test(section) && !/ZabbaDat/.test(section));

const names = [...section.matchAll(/<span class="fm-name">([^<]+)<\/span>/g)].map((m) => m[1]);
check("montage shows all eight tile figures in tile order",
  JSON.stringify(names) === JSON.stringify(["Zabba Washers", "Sets", "Plank House", "TUTS", "Battles", "Gyatt Squats", "Plank Push Press", "Step Equity"]));

const capBlock = (section.match(/<p class="fm-caps"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "";
const caps = [...capBlock.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
check("eight one-line captions, one per figure", caps.length === 8);
check("Washers caption: packs of 3, first to 21, Bariboshi style, 1 ZAB win",
  /Packs of 3, first to 21, Bariboshi style/.test(caps[0]) && /1 ZAB/.test(caps[0]));
check("Sets caption: 1 push-up = 0.1 ZAB", /1 push-up = 0\.1 ZAB/.test(caps[1]));
check("Plank House caption: 1 ZAB for a 60-second plank", /1 ZAB for a 60-second plank/.test(caps[2]));
check("TUTS caption: complete at 1:20 with at least 10 push-ups",
  /TUT set is complete at 1:20 with at least 10 push-ups/.test(caps[3]));
check("Battles caption names washer, TUT, and plank battles and optional ZAB wager (no invented payout)",
  /washer/.test(caps[4]) && /TUT/.test(caps[4]) && /plank/.test(caps[4]) && /optional ZAB wager/.test(caps[4]) && !/=\s*\d/.test(caps[4]));
check("Gyatt Squats caption: 10 = 1 ZAB, no daily cap, 4 s down / 4 s hold / 4 s up",
  /One set of 10 Gyatt Squats = 1 ZAB/.test(caps[5]) && /no daily cap/.test(caps[5]) && /4 s down \/ 4 s hold \/ 4 s up/.test(caps[5]));
check("plank push press caption uses that wording and the 0.5 ZAB 30-second bonus",
  /plank push press/.test(caps[6]) && /30-second plank push press = 0\.5 ZAB bonus/.test(caps[6]));
check("Step Equity caption: 4 ZAB for 10,000 steps in an Eastern day",
  /4 ZAB for 10,000 steps/.test(caps[7]) && /Eastern day/.test(caps[7]));

check("reuses exact tile washer ellipses (rx 16 / 4.5)",
  /<ellipse cx="0" cy="0" rx="16" ry="6"\/>/.test(section) && /<ellipse cx="0" cy="0" rx="4.5" ry="1.7"\/>/.test(section));
check("reuses exact Sets / TUTS / Plank House / squats / swords / footprints / plank push press paths",
  /<circle cx="38" cy="16" r="3.5"\/>/.test(section) &&
  /M24 12\.5v17M24 29\.5l-6 13/.test(section) &&
  /M8 20 24 8l16 12M12 18v4M36 18v4/.test(section) &&
  /M22\.8 22\.2 A6\.6 6\.6 0 1 1 34 22\.4/.test(section) &&
  /M8 8l22 22M8 8h6M8 8v6/.test(section) &&
  /M14 10c4 0 6 4 6 9s-2 8-5 8/.test(section) &&
  /M22 18V6M17 11l5-5 5 5/.test(section));
check("montage SVGs keep the tile stroke style (viewBox 48, stroke 2.5, currentColor, fill none)",
  (section.match(/class="tile-ic" viewBox="0 0 48 48"/g) || []).length === 8 &&
  (section.match(/stroke-width="2\.5"/g) || []).length === 8 &&
  !/stroke-width="(?!2\.5")/.test(section.replace(/stroke-width="2\.5"/g, "")));

check("skip button is a type=button control and session-dismiss is wired",
  /<button type="button" class="fm-skip" id="figMontageSkip">Skip intro<\/button>/.test(section) &&
  /sessionStorage\.setItem\("zabFigMontageOff","1"\)/.test(section) &&
  /sessionStorage\.getItem\("zabFigMontageOff"\)==="1"/.test(section));
check("reduced-motion rule shows a static lineup (animations off, roster visible)",
  /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.fig-montage \*\{animation:none!important/.test(html) &&
  /prefers-reduced-motion:reduce/.test(html) && /\.fm-roster\{position:static/.test(html));
check("title screen is not a full-page overlay (no fixed/sticky cover, nav sign-in stays reachable)",
  !/\.fig-montage\{[^}]*(position:\s*fixed|position:\s*sticky)/.test(html) &&
  !/#figMontage\{[^}]*(position:\s*fixed|position:\s*sticky)/.test(html));

const row = (html.match(/<div class="home-games"[\s\S]*?<\/div>/) || [""])[0];
const tiles = [...row.matchAll(/<a\b([^>]*)>[\s\S]*?<span>([^<]+)<\/span><\/a>/g)].map((m) => ({ attrs: m[1], label: m[2] }));
const href = (label) => ((tiles.find((t) => t.label === label) || {}).attrs.match(/href="([^"]+)"/) || [])[1];
check("home-games still has 8 tiles in the original order",
  JSON.stringify(tiles.map((t) => t.label)) === JSON.stringify(["Zabba Washers", "TUTS", "Sets", "Plank Push Press", "Plank House", "Step Equity", "Gyatt Squats", "Battles"]));
check("each tile still links to its route",
  href("Zabba Washers") === "#washers" && href("TUTS") === "#push" && href("Sets") === "#push" &&
  href("Plank Push Press") === "#push" && href("Plank House") === "#plank" && href("Step Equity") === "#steps" &&
  href("Gyatt Squats") === "#squats" && href("Battles") === "#battles-hub");

check("sign-in buttons and same-tab startPhoneGoogle path are untouched",
  /<button class="btn" id="signInBtn" type="button">Sign in with Google<\/button>/.test(html) &&
  /<button class="btn ghost" id="signInXBtn" type="button">Sign in with X<\/button>/.test(html) &&
  /startPhoneGoogle\(\)/.test(html) && !/id="signInBtn"/.test(section) && !/id="signInXBtn"/.test(section));

const f = R.filter((x) => !x).length;
console.log(`\n${R.length - f}/${R.length} passed`);
process.exit(f ? 1 : 0);
