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
function isBlack(buf, x, y) {
  const j = (y * buf.width + x) * 4;
  return buf.data[j] === 0 && buf.data[j + 1] === 0 && buf.data[j + 2] === 0 && buf.data[j + 3] === 255;
}
// Default 2× of a 700×450 / BASE 60 bitmap: period is 120 px, dots centered one period apart.
check("two black guide dots one period apart, centered near the top",
  isBlack(big, 700 - 60, 47) && isBlack(big, 700 + 60, 47));

check("todayKey uses et-day.js (Eastern date)", M.todayKey(Date.parse("2026-11-21T04:59:59Z")) === "2026-11-20" && M.todayKey(Date.parse("2026-11-21T05:00:00Z")) === "2026-11-21" && ET.key(Date.parse("2026-11-21T05:00:00Z")) === "2026-11-21");

const sec = (html.match(/<section id="cooling-box">([\s\S]*?)<\/section>/) || [])[1] || "";
const fig = (html.match(/<figure class="me-centered" id="magicEye">([\s\S]*?)<\/figure>/) || [])[0] || "";
check("Magic Eye sits after the plank prompt and above TUTS & PUSH up sets, not inside #cooling-box",
  !/id="magicEye"/.test(sec) && /id="sitkari-how"/.test(sec) &&
  html.indexOf('id="plank-prompt"') < html.indexOf('id="magicEye"') &&
  html.indexOf('id="magicEye"') < html.indexOf('<section id="push">') &&
  /TUTS &amp; PUSH up sets/.test(html.slice(html.indexOf('<section id="push">'), html.indexOf('<section id="push">') + 80)));
check("canvas is 1400×900, caption and tip match the brief, no shape name shown by default",
  /id="magicEyeCanvas" width="1400" height="900"/.test(fig) &&
  />Today's Magic Eye</.test(fig) &&
  /Tap for full screen\. Relax your eyes and look through the picture/.test(fig) &&
  /until the two dots become three\. Hold still and the shape floats up\./.test(fig) &&
  /id="magicEyeShape" hidden/.test(fig) &&
  !/Today's shape:/.test(fig) &&
  /id="magicEyeReveal"/.test(fig));
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


const phone = M.layoutFor(343, 3);
check("phone layout: period 80–100 CSS px and depth step ≥ 20 CSS px",
  phone.periodCss >= 80 && phone.periodCss <= 100 && phone.ampCss >= 20 && phone.pixW === 343 * 3 && phone.dpr === 3);
const wide = M.layoutFor(844, 3);
check("wide / landscape full-screen period can reach 140 CSS px",
  wide.periodCss === 140 && wide.ampCss >= 20 && wide.pixW === 844 * 3);

const wall = M.renderBitmap("2026-11-21", { w: 172, h: 111, base: 48, amp: 15, mode: "wall", bold: 1.22 });
const wallSep = M.meanSeparation(wall);
check("wall-eyed decode: separation inside the shape is narrower than the background",
  wallSep.nIn > 200 && wallSep.nOut > 200 && wallSep.inside + 8 < wallSep.outside);

check("index has View full screen, viewing-mode toggle, pixelated canvas, and a tip id",
  /id="magicEyeFsBtn"/.test(fig) && /View full screen/.test(fig) &&
  /id="magicEyeMode"/.test(fig) && /id="magicEyeTip"/.test(fig) &&
  /image-rendering:\s*pixelated/.test(html));
check("wall-eyed is the default mode (inline markup and JS); cross-eyed remains a toggle",
  M.DEFAULT_MODE === "wall" &&
  /id="magicEyeMode"[^>]*aria-pressed="true"/.test(fig) &&
  />Viewing: Wall-eyed</.test(fig) &&
  /zabMagicEyeMode"\) === "cross"/.test(src) &&
  typeof M.tipFor === "function" &&
  /Tap for full screen/.test(M.TIP_WALL) &&
  /look through the picture/.test(M.TIP_WALL) &&
  /Tap the picture to go back/.test(M.TIP_WALL_FS));
check("magic-eye.js opens a full-screen overlay (Fullscreen API + 100dvh fallback) and redraws at screen size",
  /requestFullscreen|webkitRequestFullscreen/.test(src) &&
  /100dvh/.test(src) && /magicEyeFsClose/.test(src) &&
  typeof M.openFullscreen === "function" && typeof M.closeFullscreen === "function" &&
  typeof M.renderLegacyToCanvas === "function");
check("tapping the full-screen picture itself closes the overlay",
  /bindTap\(\s*fsCanvas/.test(src) &&
  /closeFullscreen\(\)/.test(src) &&
  /_fsOpenedAt/.test(src));
check("inline Magic Eye is a real phone tap target (cursor:pointer + touch/pointer, not click-only / zoom-in)",
  /#magicEye canvas\{[^}]*cursor:\s*pointer/.test(html) &&
  /touchend/.test(src) && /pointerup/.test(src) &&
  /function bindTap\(/.test(src));

const testPage = fs.readFileSync(path.join(__dirname, "..", "magic-eye-test.html"), "utf8");
check("magic-eye-test.html is noindex, not linked from nav, and compares live vs fix vs full screen",
  /name="robots" content="noindex/.test(testPage) &&
  /id="legacyCanvas"/.test(testPage) && /id="fixCanvas"/.test(testPage) && /id="fsOpen"/.test(testPage) &&
  /renderLegacyToCanvas/.test(testPage) && /openFullscreen/.test(testPage) &&
  !/<nav[\s>]/.test(testPage) &&
  !/href="\/magic-eye-test"/.test(html) && !/href="magic-eye-test/.test(html));
check("legacy renderer still paints a 1400×900 bitmap (live path) with old guide-dot placement", (() => {
  const out = M.renderLegacyToCanvas(null, "2026-11-21");
  return out && out.width === 1400 && out.height === 900 && out.bmp && out.bmp.name === "star";
})());

const fail = R.filter((x) => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed`);
process.exit(fail ? 1 : 0);
