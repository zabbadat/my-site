// Today's Hide: 8 AM ET rollover, hit-test, early-day fallback, homepage slot.
const fs = require("fs");
const path = require("path");
const ET = require("../et-day.js");
const H = require("../hide-daily.js");

const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const T = (s) => Date.parse(s);
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const manText = fs.readFileSync(path.join(root, "hide/manifest.json"), "utf8");
const src = fs.readFileSync(path.join(root, "hide-daily.js"), "utf8");
const man = JSON.parse(manText);

check("7:59 AM ET Nov 23 is still Nov 22", H.teaserKey(T("2026-11-23T12:59:00Z")) === "2026-11-22");
check("8:00 AM ET Nov 23 rolls to Nov 23", H.teaserKey(T("2026-11-23T13:00:00Z")) === "2026-11-23");
check("7:59 AM ET uses et-day keyAtHour 8", ET.keyAtHour(T("2026-11-23T12:59:00Z"), 8) === "2026-11-22");
check("8:00 AM ET uses et-day keyAtHour 8", ET.keyAtHour(T("2026-11-23T13:00:00Z"), 8) === "2026-11-23");
check("just before 8 AM ET Nov 22 stays Nov 21", H.teaserKey(T("2026-11-22T12:59:59Z")) === "2026-11-21");
check("8:00 AM ET Nov 22 is Nov 22", H.teaserKey(T("2026-11-22T13:00:00Z")) === "2026-11-22");
check("DST spring 7:59 AM EDT March 8 is March 7", H.teaserKey(T("2026-03-08T11:59:00Z")) === "2026-03-07");
check("DST spring 8:00 AM EDT March 8 is March 8", H.teaserKey(T("2026-03-08T12:00:00Z")) === "2026-03-08");
check("DST spring atHourMs is 12:00Z", ET.atHourMs(T("2026-03-08T16:00:00Z"), 8) === T("2026-03-08T12:00:00Z"));
check("DST fall 7:59 AM EST Nov 1 is Oct 31", H.teaserKey(T("2026-11-01T12:59:00Z")) === "2026-10-31");
check("DST fall 8:00 AM EST Nov 1 is Nov 1", H.teaserKey(T("2026-11-01T13:00:00Z")) === "2026-11-01");
check("DST fall atHourMs is 13:00Z", ET.atHourMs(T("2026-11-01T16:00:00Z"), 8) === T("2026-11-01T13:00:00Z"));
check("next rollover at 7:59 AM ET is today's 8:00", H.nextRolloverMs(T("2026-11-23T12:59:00Z")) === T("2026-11-23T13:00:00Z"));
check("next rollover at 8:00 AM ET is tomorrow 8:00", H.nextRolloverMs(T("2026-11-23T13:00:00Z")) === T("2026-11-24T13:00:00Z"));
check("next rollover after spring 8 AM is March 9 8 AM EDT",
  H.nextRolloverMs(T("2026-03-08T12:00:00Z")) === T("2026-03-09T12:00:00Z"));
check("midnight key() is unchanged (not the 8 AM teaser key)",
  ET.key(T("2026-11-23T12:59:00Z")) === "2026-11-23" && H.teaserKey(T("2026-11-23T12:59:00Z")) === "2026-11-22");

const ans = H.unpackAnswer(man.days["2026-11-23"].k);
check("manifest unpacks a usable target", !!(ans && ans.x > 0.1 && ans.x < 0.25 && ans.y > 0.8 && ans.y < 0.95 && ans.r > 0 && ans.name));
check("packed name is the reveal line, not in the file as plaintext", ans && ans.name === "A washer.");
check("manifest and filename have no plaintext name or coords",
  !/washer/i.test(manText) && !/0\.161|0\.865/.test(manText) && man.days["2026-11-23"].src === "/hide/2026-11-23.webp");
check("HTML alt has no object name", /alt="Today's hide\. Breathe and look\."/.test(html));
check("hide-daily.js does not hard-code the object name or raw coords",
  !/washer/i.test(src) && !/0\.1615|186\s*\/\s*1152/.test(src));

const tw = 390, th = 292.5;
check("a tap on the object is a hit", H.hitTest(ans.x, ans.y, ans, tw, th));
check("a tap near the object, within the generous radius, is a hit", H.hitTest(ans.x + 0.03, ans.y, ans, tw, th));
check("a miss far from the object is not a hit", !H.hitTest(0.8, 0.2, ans, tw, th));
check("decoy upper-right is a miss", !H.hitTest(0.72, 0.42, ans, tw, th));
check("quadrant of the hide is southwest", H.quadrant(ans.x, ans.y) === "sw");

check("Nov 22 and Nov 23 both have the first picture",
  man.days["2026-11-22"] && man.days["2026-11-23"] &&
  man.days["2026-11-22"].src === man.days["2026-11-23"].src);
check("today's key is used when the entry exists",
  H.pickDay(man, "2026-11-23").key === "2026-11-23" && H.pickDay(man, "2026-11-23").fallback === false);
check("a later day with no entry falls back to the last available",
  H.pickDay(man, "2026-12-01").key === "2026-11-26" && H.pickDay(man, "2026-12-01").fallback === true);
check("Nov 24 uses its own five-item picture",
  H.pickDay(man, "2026-11-24").key === "2026-11-24" && H.pickDay(man, "2026-11-24").fallback === false);
check("a day before the first entry still shows the earliest, so the slot is not empty",
  H.pickDay(man, "2026-11-21").key === "2026-11-22" && H.pickDay(man, "2026-11-21").fallback === true);
check("empty manifest returns null", H.pickDay({ days: {} }, "2026-11-23") === null);
const store = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); } };
H.writeFound("2026-11-23", { found: true, looks: 2, at: 1 }, store);
check("found-state persists per teaser-day", H.readFound("2026-11-23", store).found === true && !H.readFound("2026-11-22", store));
const s1 = H.bumpStreak("2026-11-22", store);
const s2 = H.bumpStreak("2026-11-23", store);
check("streak grows on consecutive teaser-days", s1.count === 1 && s2.count === 2 && s2.lastKey === "2026-11-23");
const s3 = H.bumpStreak("2026-11-25", store);
check("streak resets when a day is skipped", s3.count === 1);
const s4 = H.bumpStreak("2026-11-25", store);
check("finding the same day twice does not double the streak", s4.count === 1);

const hideAt = html.indexOf('id="todays-hide"');
const plankAt = html.indexOf('id="plank-prompt"');
const pushAt = html.indexOf('<section id="push">');
check("#todays-hide sits after #plank-prompt and before the TUT section",
  hideAt > 0 && plankAt > 0 && pushAt > 0 && plankAt < hideAt && hideAt < pushAt);
const hideSection = html.slice(hideAt, pushAt);
check("the hide section itself has no object name", !/washer/i.test(hideSection));
check("section copy and breath cue are present",
  /<h2(?:\s[^>]*)?>Today's Hide<\/h2>/.test(html) && /Breathe and look\./.test(html) &&
  /Pinch to look closer\. Tap when you see it\./.test(html) &&
  /Same 4-count as the cooling box\./.test(html));
check("list and zoom controls are in the hide section",
  html.includes('id="todaysHideList"') && html.includes('id="todaysHideZoomIn"') &&
  html.includes('id="todaysHideZoomOut"') && html.includes('id="todaysHideMarks"'));
const hideChunk = html.slice(html.indexOf('id="todays-hide"'), html.indexOf('<section id="push">'));
const at = (id) => hideChunk.indexOf(id);
check("layout order is kicker, line, list, picture, Hint and zoom, then breath and the cue",
  hideChunk.indexOf("th-kicker") >= 0 &&
  hideChunk.indexOf("th-kicker") < at('id="todaysHideLine"') &&
  at('id="todaysHideLine"') > 0 &&
  at('id="todaysHideLine"') < at('id="todaysHideList"') &&
  at('id="todaysHideList"') < at('id="todaysHideStage"') &&
  at('id="todaysHideStage"') < at('id="todaysHideHint"') &&
  at('id="todaysHideHint"') < at('id="todaysHideZoomOut"') &&
  at('id="todaysHideZoomOut"') < at('id="todaysHideZoomIn"') &&
  at('id="todaysHideZoomIn"') < at('id="todaysHideBreath"') &&
  at('id="todaysHideBreath"') < at('id="todaysHideCue"') &&
  /id="todaysHideCue">Breathe and look\./.test(hideChunk));
check("the daily line has extra space above the item pills",
  /#todays-hide \.th-line \{[^}]*margin: 0 auto 1\.55rem/.test(html));
check("the daily line is styled as the largest text in the section",
  /#todays-hide \.th-line \{[^}]*font-size: clamp\(1\.5rem/.test(html) &&
  /h2\.th-kicker \{[^}]*font-size: \.7rem/.test(html));
check("index.html loads hide-daily.js immediately after et-day.js",
  html.indexOf('src="/et-day.js"') > 0 &&
  html.indexOf('src="/et-day.js"') < html.indexOf('src="/hide-daily.js"') &&
  html.indexOf('src="/hide-daily.js"') < html.indexOf('src="/plank-daily.js"'));
check("asset file exists", fs.existsSync(path.join(root, "hide/2026-11-23.webp")));
check("new hide pictures exist",
  fs.existsSync(path.join(root, "hide/2026-11-24.webp")) &&
  fs.existsSync(path.join(root, "hide/2026-11-25.webp")) &&
  fs.existsSync(path.join(root, "hide/2026-11-26.webp")));
check("design note is in the branch as a doc only",
  fs.existsSync(path.join(root, "docs/todays-hide-design.md")));
check("module does not touch pfp, camera, auth, Firebase, or Netlify config",
  !/pfp\.js|ZabPfp|signInWith|firebase|netlify\.toml|firestore/.test(src));
check("no ZAB pay in this module", !/zab-earn|zabEarn|ZAB/.test(src));
check("share text is spoiler-free",
  !/washer/i.test(H.shareText(2, 3)) && /Found today's hide on Zabbadat\. 2 looks\. Day 3\./.test(H.shareText(2, 3)) &&
  H.shareUrl() === "https://www.zabbadat.com/#todays-hide");


const ZOOM_UI = { x0: 0.86, y0: 0.82 };
const MARGIN = 0.04;
const cssW = 390, cssH = 292.5;
for (const day of ["2026-11-24", "2026-11-25", "2026-11-26"]) {
  const its = H.unpackDay(man.days[day]);
  check(day + " has five packed items", its.length === 5);
  check(day + " includes the steel ring in the list", its.some((it) => /washer/i.test(it.name)));
  check(day + " names and coords are packed, not plaintext",
    !/washer/i.test(JSON.stringify(man.days[day])) &&
    !its.some((it) => String(man.days[day].ks).includes(String(it.x.toFixed(3)))));
  check(day + " asset path matches the day", man.days[day].src === "/hide/" + day + ".webp");
  let inside = true, clearUi = true, okR = true;
  for (const it of its) {
    if (!(it.x > MARGIN && it.x < 1 - MARGIN && it.y > MARGIN && it.y < 1 - MARGIN)) inside = false;
    if (it.r <= 0 || it.r > 0.2) okR = false;
    if ((it.x + it.r) > ZOOM_UI.x0 && (it.y + it.r) > ZOOM_UI.y0) clearUi = false;
  }
  check(day + " hit boxes sit inside the picture", inside && okR);
  check(day + " hit boxes stay clear of the zoom-corner branding/UI zone", clearUi);
  let sep = true;
  for (let i = 0; i < its.length; i++) {
    for (let j = i + 1; j < its.length; j++) {
      const dx = (its[i].x - its[j].x) * cssW;
      const dy = (its[i].y - its[j].y) * cssH;
      const dist = Math.hypot(dx, dy);
      const need = H.objectRadiusCss(its[i], cssW) + H.objectRadiusCss(its[j], cssW) + 2 * H.SNAP_PX;
      if (dist < need) sep = false;
    }
  }
  check(day + " items are far enough that snap zones do not overlap at 1x", sep);
}

const A = { x: 0.5, y: 0.5, r: 0.02, name: "A", id: "0" };
const B = { x: 0.8, y: 0.5, r: 0.02, name: "B", id: "1" };
const core = H.objectRadiusCss(A, cssW);
function fh(nx, scale, target) { return H.fairHit(nx, 0.5, target || A, cssW, cssH, scale); }
check("1x tap on the object is a direct hit, not a snap", fh(A.x, 1).hit && fh(A.x, 1).snap === false);
check("1x near-hit within 26 screen px snaps", fh(A.x + (core + 20) / cssW, 1).hit && fh(A.x + (core + 20) / cssW, 1).snap);
check("1x tap beyond the 26 px tolerance misses", !fh(A.x + (core + 32) / cssW, 1).hit);
check("same image offset that snaps at 1x misses at 4x zoom", !fh(A.x + (core + 20) / cssW, 4).hit);
check("4x zoom still snaps a 20 screen-px near-hit", fh(A.x + (core + 20 / 4) / cssW, 4).hit && fh(A.x + (core + 20 / 4) / cssW, 4).snap);
check("a tap on a different item does not snap to the selected one", !fh(B.x, 1, A).hit);
check("that same tap is a hit only for the selected item", fh(B.x, 1, B).hit);
check("SNAP_PX is a fingertip-sized 24-28 screen px", H.SNAP_PX >= 24 && H.SNAP_PX <= 28);
check("legacy single-item days still unpack through unpackDay",
  H.unpackDay(man.days["2026-11-23"]).length === 1 &&
  H.unpackDay(man.days["2026-11-23"])[0].name === "A washer.");

const LINES = {
  "2026-11-22": "Know the field. Know your breath. Then strike.",
  "2026-11-23": "Know the field. Know your breath. Then strike.",
  "2026-11-24": "Breathe still. The hidden reveal themselves to the calm.",
  "2026-11-25": "Stay hard. One more breath. One more find.",
  "2026-11-26": "Breathe big, look bold. All five are yours."
};
for (const [day, line] of Object.entries(LINES)) {
  check(day + " has the exact daily line", man.days[day] && man.days[day].line === line);
}
check("dayLine falls back when a record has no line",
  H.dayLine({}) === "Breathe and look." &&
  H.dayLine({ line: "  " }) === "Breathe and look." &&
  H.dayLine(man.days["2026-11-24"]) === LINES["2026-11-24"]);
check("a later missing day falls back to the last picture and its line",
  H.dayLine(H.pickDay(man, "2026-12-01").rec) === LINES["2026-11-26"]);

const ok = R.every(Boolean);
console.log((ok ? "OK" : "NOT OK") + "  " + R.filter(Boolean).length + " passed, " + (R.length - R.filter(Boolean).length) + " failed");
process.exit(ok ? 0 : 1);
