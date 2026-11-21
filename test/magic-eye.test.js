// Daily Magic Eye: Eastern-date seed, Python toordinal shape rotation, cross-eyed
// union-find stereogram, homepage #cooling-box markup. Run: node test/magic-eye.test.js
const fs = require("fs"), path = require("path");
const M = require("../magic-eye.js");
const ET = require("../et-day.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = fs.readFileSync(path.join(__dirname, "..", "magic-eye.js"), "utf8");
const R = [];
const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !why ? "" : " :: " + why}`); R.push(!!ok); };

const NAMES = ["heart", "star", "letter Z", "lightning bolt", "smiley face", "crescent moon", "dumbbell", "number 7", "arrow", "crown"];
check("shape list and order match daily.py exactly", M.SHAPE_NAMES.length === 10 && M.SHAPE_NAMES.join("|") === NAMES.join("|"));

const ords = [
  ["0001-01-01", 1], ["2000-02-29", 730179], ["2024-02-29", 738945],
  ["2025-12-31", 739616], ["2026-01-01", 739617], ["2026-11-20", 739940],
  ["2026-11-21", 739941], ["2026-11-22", 739942]
];
check("toOrdinal matches Python date.toordinal() on the reference dates", ords.every(([k, o]) => M.ordinalFromKey(k) === o && M.toOrdinal.apply(null, k.split("-").map(Number)) === o));
check("2026-11-21 is 'star' (toordinal 739941 % 10 === 1)", M.shapeName("2026-11-21") === "star" && M.shapeIndex("2026-11-21") === 1);
check("rotation follows toordinal % 10: 11/20 heart, 11/21 star, 11/22 letter Z",
  M.shapeName("2026-11-20") === "heart" && M.shapeName("2026-11-22") === "letter Z");
check("every list index is reachable from a known date", NAMES.every((n, i) => {
  // 2026-11-20 is index 0; add i days
  const d = new Date(Date.UTC(2026, 10, 20 + i));
  const key = d.toISOString().slice(0, 10);
  return M.shapeIndex(key) === i && M.shapeName(key) === n;
}));

const a = M.renderBitmap("2026-11-21"), b = M.renderBitmap("2026-11-21"), c = M.renderBitmap("2026-11-22");
check("same Eastern date yields identical pixels", a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]));
check("a different day (different shape) yields different pixels", a.name !== c.name && !a.data.every((v, i) => v === c.data[i]));

function sepOk(key) {
  const bmp = M.renderBitmap(key);
  const s = M.meanSeparation(bmp);
  return s.nIn > 1000 && s.nOut > 1000 && s.inside > s.outside + 8 && s.outside > 55 && s.outside < 65 && s.inside > 68;
}
check("cross-eyed decode: separation inside the shape is wider than the background (star)", sepOk("2026-11-21"));
check("cross-eyed decode also holds for heart and crown", sepOk("2026-11-20") && sepOk("2026-11-29"));

const big = M.scaleNearestAndDots(a);
check("2x nearest-neighbor scale is 1400×900 with ~2px dots", big.width === 1400 && big.height === 900 && M.SCALE === 2);
function isBlack(x, y) {
  const j = (y * big.width + x) * 4;
  return big.data[j] === 0 && big.data[j + 1] === 0 && big.data[j + 2] === 0 && big.data[j + 3] === 255;
}
check("two black guide dots at the top (W-base, W+base)", isBlack(M.W - M.BASE, 24) && isBlack(M.W + M.BASE, 24));

check("todayKey uses et-day.js (Eastern date)", M.todayKey(Date.parse("2026-11-21T04:59:59Z")) === "2026-11-20" && M.todayKey(Date.parse("2026-11-21T05:00:00Z")) === "2026-11-21" && ET.key(Date.parse("2026-11-21T05:00:00Z")) === "2026-11-21");

const sec = (html.match(/<section id="cooling-box">([\s\S]*?)<\/section>/) || [])[1] || "";
check("#cooling-box has the centered Magic Eye figure after the Sitkari lead and before How to sitkari",
  /id="magicEye"/.test(sec) && sec.indexOf("Sitkari through the inhale") < sec.indexOf('id="magicEye"') && sec.indexOf('id="magicEye"') < sec.indexOf('id="sitkari-how"'));
check("canvas is 1400×900, caption and tip match the brief, no shape name shown by default",
  /id="magicEyeCanvas" width="1400" height="900"/.test(sec) &&
  />Today's Magic Eye</.test(sec) &&
  /Cross your eyes until the two dots become three\./.test(sec) &&
  /id="magicEyeShape" hidden/.test(sec) &&
  !/Today's shape:/.test(sec) &&
  /id="magicEyeReveal"/.test(sec));
check("layout A CSS: centered, max-width 52rem, full-width canvas",
  /#magicEye\.me-centered\{[^}]*max-width:52rem/.test(html) && /#magicEye canvas\{[^}]*width:100%/.test(html));
check("index.html loads magic-eye.js immediately after et-day.js",
  html.indexOf('src="/et-day.js"') > 0 && html.indexOf('src="/et-day.js"') < html.indexOf('src="/magic-eye.js"') &&
  html.indexOf('src="/magic-eye.js"') < html.indexOf('src="/plank-daily.js"'));
check("draw is lazy: IntersectionObserver + requestIdleCallback, not on script parse in Node",
  /IntersectionObserver/.test(src) && /requestIdleCallback/.test(src) && /rootMargin:\s*"200px/.test(src) &&
  typeof M.mount === "function");
check("does not touch pfp, camera, auth, Firebase, or Netlify config from this file",
  !/pfp\.js|ZabPfp|signInWith|firebase|netlify\.toml/.test(src));

const fail = R.filter((x) => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed`);
process.exit(fail ? 1 : 0);
