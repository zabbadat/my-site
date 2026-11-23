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
  H.pickDay(man, "2026-11-24").key === "2026-11-23" && H.pickDay(man, "2026-11-24").fallback === true);
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
  /<h2>Today's Hide<\/h2>/.test(html) && /Breathe and look\./.test(html) &&
  /Pinch to look closer\. Tap when you see it\./.test(html) &&
  /Same 4-count as the cooling box\./.test(html));
check("index.html loads hide-daily.js immediately after et-day.js",
  html.indexOf('src="/et-day.js"') > 0 &&
  html.indexOf('src="/et-day.js"') < html.indexOf('src="/hide-daily.js"') &&
  html.indexOf('src="/hide-daily.js"') < html.indexOf('src="/plank-daily.js"'));
check("asset file exists", fs.existsSync(path.join(root, "hide/2026-11-23.webp")));
check("module does not touch pfp, camera, auth, Firebase, or Netlify config",
  !/pfp\.js|ZabPfp|signInWith|firebase|netlify\.toml|firestore/.test(src));
check("no ZAB pay in this module", !/zab-earn|zabEarn|ZAB/.test(src));
check("share text is spoiler-free",
  !/washer/i.test(H.shareText(2, 3)) && /Found today's hide on Zabbadat\. 2 looks\. Day 3\./.test(H.shareText(2, 3)) &&
  H.shareUrl() === "https://www.zabbadat.com/#todays-hide");

const ok = R.every(Boolean);
console.log((ok ? "OK" : "NOT OK") + "  " + R.filter(Boolean).length + " passed, " + (R.length - R.filter(Boolean).length) + " failed");
process.exit(ok ? 0 : 1);
