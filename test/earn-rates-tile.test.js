// Earn rates (ZAB tab, #ztRates): nine tiles that fill evenly (2 x 4 phone, 4 x 2 desktop), built from the real rates.
const fs = require("fs"), path = require("path"), assert = require("assert");
const Z = require("../zab-balance.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const L = Z.rateLines();
assert.strictEqual(L.length, 9, "nine earn-rate tiles");
assert.deepStrictEqual(L, [
  "1 push-up = 0.1 ZAB",
  "1 ZAB for a 60-second plank",
  "1 ZAB for an 80-second plank TUT",
  "1 minute of TUT = 1 ZAB",
  "10 minutes of walking = 1 ZAB",
  "One set of 10 Gyatt Squats = 1 ZAB",
  "4 ZAB for 10,000 steps",
  "Won Zabba Washers game = 1 ZAB",
  "30-second plank push press = 0.5 ZAB bonus"
]);
assert(Z.RATES.squats.per === 10 && Z.zabFor("squats", 10) === 1, "squats rate matches");
assert(Z.RATES.hold.zab === 0.5 && Z.zabFor("hold", 1) === 0.5, "plank push press bonus matches");
assert(/NO_DAY_CAP = \{ squats: true \}/.test(fs.readFileSync(path.join(__dirname, "..", "zab-earn.js"), "utf8")), "squats really has no daily cap on the server");
assert(/#zab \.zt-rates\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html), "phone: 2 columns");
assert(/@media \(min-width:760px\)\{#zab \.zt-rates\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/.test(html), "desktop: 4 columns");
assert(/A plank pays once per set, at 60 seconds\. An 80-second plank TUT pays 1 more ZAB, once per set\. The 10K steps bonus pays once per Eastern day\. Gyatt Squats have no daily cap\./.test(html), "fine print keeps the rules");
console.log("earn-rates-tile: ok");
