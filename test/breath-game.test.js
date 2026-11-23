// Cooling-box game layer: Eastern-day streak, all-time levels, in-session combos, session gauge.
// Device-local only. Run: node test/breath-game.test.js
const fs = require("fs"), path = require("path");
const CB = require("../cooling-box.js");
const ET = require("../et-day.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = fs.readFileSync(path.join(__dirname, "..", "cooling-box.js"), "utf8");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
function mem() { const d = {}; return { getItem: (k) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, d }; }
const T = (s) => Date.parse(s);
// Eastern standard time in late Nov 2026 is UTC-5.
const MON_NOON = T("2026-11-23T17:00:00Z");   // Mon 12:00 ET
const MON_1759 = T("2026-11-23T22:59:00Z");   // Mon 17:59 ET
const MON_1800 = T("2026-11-23T23:00:00Z");   // Mon 18:00 ET
const MON_1930 = T("2026-11-24T00:30:00Z");   // Mon 19:30 ET
const TUE_0900 = T("2026-11-24T14:00:00Z");   // Tue 9:00 ET
const WED_0900 = T("2026-11-25T14:00:00Z");   // Wed 9:00 ET
const SUN_2000 = T("2026-11-23T01:00:00Z");   // Sun 20:00 ET

check("et keys for fixture times", ET.key(MON_NOON) === "2026-11-23" && ET.key(TUE_0900) === "2026-11-24" && ET.key(SUN_2000) === "2026-11-22" && ET.parts(MON_1800).h === 18 && ET.parts(MON_1759).h === 17);

// --- Streak ---
{
  const s = mem();
  const a = CB.streakStatus(s, ET, MON_NOON);
  check("empty streak is 0 and not live", a.streak === 0 && a.todayCount === 0 && a.live === false);
  const b = CB.recordStreak(s, ET, MON_NOON, 1);
  check("first cycle today starts a 1-day streak", b.streak === 1 && b.todayCount === 1 && b.live === true && b.lastDay === "2026-11-23");
  const c = CB.recordStreak(s, ET, MON_NOON, 2);
  check("more cycles the same Eastern day keep the streak at 1 and add to today", c.streak === 1 && c.todayCount === 3);
  const d = CB.recordStreak(s, ET, TUE_0900, 1);
  check("a cycle the next Eastern day extends the streak", d.streak === 2 && d.todayCount === 1 && d.lastDay === "2026-11-24");
  const e = CB.recordStreak(s, ET, WED_0900, 1);
  check("a third consecutive Eastern day is a 3-day streak", e.streak === 3 && e.todayCount === 1);
}
{
  const s = mem();
  CB.recordStreak(s, ET, SUN_2000, 1);
  CB.recordStreak(s, ET, MON_NOON, 1);
  const skipped = CB.recordStreak(s, ET, WED_0900, 1);
  check("a missed Eastern day resets the streak to 1", skipped.streak === 1 && skipped.lastDay === "2026-11-25" && skipped.todayCount === 1);
}
{
  const s = mem();
  CB.writeStreak(s, { lastDay: "2026-11-22", streak: 5, todayCount: 2 });
  const live = CB.streakStatus(s, ET, MON_NOON);
  check("yesterday's streak is still live this morning with 0 cycles today", live.streak === 5 && live.todayCount === 0 && live.live === true);
  check("no evening nudge before 6 PM ET", CB.shouldNudge(s, ET, MON_1759) === false);
  check("keep-your-streak nudge after 6 PM ET when the streak is live and today is empty", CB.shouldNudge(s, ET, MON_1800) === true);
  check("nudge copy names the day count and stays short", CB.nudgeText(live) === "Keep your streak. 5 days. One cycle today keeps it.");
  CB.recordStreak(s, ET, MON_1930, 1);
  check("nudge clears once a cycle is done today", CB.shouldNudge(s, ET, MON_1930) === false && CB.streakStatus(s, ET, MON_1930).streak === 6);
}
{
  const s = mem();
  check("no nudge when there is no streak, even after 6 PM ET", CB.shouldNudge(s, ET, MON_1800) === false);
  check("singular nudge copy for a 1-day streak", CB.nudgeText({ streak: 1 }) === "Keep your streak. 1 day. One cycle today keeps it.");
}
{
  const s = mem();
  let t = MON_NOON, cycles = [];
  const box = CB.createBox({ store: s, et: ET, now: () => t, onCycle: (n) => cycles.push(n) });
  box.start();
  t += 16000; box.tick();
  check("createBox records a streak when a cycle completes", CB.streakStatus(s, ET, t).streak === 1 && CB.streakStatus(s, ET, t).todayCount === 1 && cycles[0] === 1);
}

// --- Levels ---
check("level names are Sitkari, Coolbox, Steady, Settled, Deep box, Zabbadat",
  CB.LEVELS.map((l) => l.name).join("|") === "Sitkari|Coolbox|Steady|Settled|Deep box|Zabbadat"
  && CB.LEVELS.map((l) => l.at).join(",") === "4,18,50,100,250,500");
check("no level under 4 cycles", CB.levelFor(0) == null && CB.levelFor(3) == null);
check("Sitkari at 4, Coolbox at 18, Steady at 50", CB.levelFor(4).name === "Sitkari" && CB.levelFor(17).name === "Sitkari" && CB.levelFor(18).name === "Coolbox" && CB.levelFor(50).name === "Steady");
check("Settled at 100, Deep box at 250, Zabbadat at 500", CB.levelFor(100).name === "Settled" && CB.levelFor(249).name === "Settled" && CB.levelFor(250).name === "Deep box" && CB.levelFor(500).name === "Zabbadat" && CB.levelFor(800).name === "Zabbadat");
check("levelsReached crosses only newly earned thresholds",
  CB.levelsReached(3, 4).map((l) => l.name).join() === "Sitkari"
  && CB.levelsReached(3, 18).map((l) => l.name).join() === "Sitkari,Coolbox"
  && CB.levelsReached(18, 18).length === 0
  && CB.levelsReached(17, 18).map((l) => l.name).join() === "Coolbox"
  && CB.levelsReached(99, 250).map((l) => l.name).join() === "Settled,Deep box");

// --- Combos ---
check("4 in-session cycles is Bariboshi minute; 18 is Full set",
  CB.comboFor(4) && CB.comboFor(4).name === "Bariboshi minute"
  && CB.comboFor(18) && CB.comboFor(18).name === "Full set");
check("combos do not fire off the 4 and 18 marks",
  CB.comboFor(0) == null && CB.comboFor(3) == null && CB.comboFor(5) == null && CB.comboFor(8) == null && CB.comboFor(17) == null && CB.comboFor(19) == null);
{
  const s = mem();
  let t = 1e6;
  const combos = [], levels = [];
  const box = CB.createBox({
    store: s, now: () => t, sessionRounds: 20,
    onCombo: (c) => combos.push(c.name),
    onLevel: (lv) => lv.forEach((x) => levels.push(x.name))
  });
  box.start();
  for (let i = 0; i < 18; i++) { t += 16000; box.tick(); }
  check("in-session combos fire at 4 and 18 cycles", combos.join("|") === "Bariboshi minute|Full set" && box.sessionCount() === 18);
  check("Sitkari and Coolbox levels fire on the same 18-cycle run from 0", levels.join("|") === "Sitkari|Coolbox");
}

// --- Gauge ---
check("default session is 5 min / 18 rounds", CB.roundsForMinutes(5) === 18 && CB.sessionLabel(5) === "5 min · 18 rounds");
check("1 min is 4 rounds (Bariboshi minute); 10 min is 36 rounds", CB.roundsForMinutes(1) === 4 && CB.roundsForMinutes(10) === 36);
check("gauge clamps to 1–10 minutes in 1-minute steps",
  CB.clampMinutes(0) === 1 && CB.clampMinutes(11) === 10 && CB.clampMinutes(2.9) === 2
  && [1,2,3,4,5,6,7,8,9,10].map(CB.roundsForMinutes).join(",") === "4,7,11,14,18,22,25,29,32,36");
{
  const s = mem();
  check("unset gauge preference reads as 5", CB.getSessionMinutes(s) === 5);
  check("setSessionMinutes persists and clamps", CB.setSessionMinutes(s, 8) === 8 && CB.getSessionMinutes(s) === 8 && CB.setSessionMinutes(s, 99) === 10);
}
{
  const s = mem();
  let t = 1e6;
  const ended = [];
  const box = CB.createBox({ store: s, now: () => t, sessionRounds: 4, onSessionEnd: (sum) => ended.push(sum) });
  box.start();
  check("session target follows the gauge override", box.sessionTarget() === 4);
  t += 16000 * 3; box.tick();
  check("under the target the box keeps running", box.running() && box.sessionCount() === 3 && ended.length === 0);
  t += 16000; box.tick();
  check("box auto-stops at the session target with a summary", !box.running() && box.sessionCount() === 4 && ended.length === 1 && ended[0].reason === "complete" && ended[0].rounds === 4 && ended[0].target === 4);
  t += 20000; box.tick();
  check("a completed session does not keep counting", box.getCycles() === 4);
}
{
  const s = mem();
  CB.setSessionMinutes(s, 1);
  let t = 1e6;
  const box = CB.createBox({ store: s, now: () => t });
  box.start();
  check("stored 1-minute gauge starts a 4-round session", box.sessionTarget() === 4);
  box.stop();
}

// --- Mute + share (supporting hooks) ---
{
  const s = mem();
  check("sound starts unmuted", CB.isMuted(s) === false);
  check("mute persists on the device", CB.setMuted(s, true) === true && CB.isMuted(s) === true && CB.setMuted(s, false) === false && CB.isMuted(s) === false);
}
{
  const p = CB.sharePayload({ streak: 3 }, { name: "Sitkari" });
  check("share card is streak plus level and links to #cooling-box",
    p.url === "https://zabbadat.com/#cooling-box" && p.title === "Zabbadat cooling box" && p.text === "3-day streak · Sitkari");
  const p2 = CB.sharePayload({ streak: 0 }, null);
  check("share card stays spoiler-free with no hide or object name",
    p2.text === "Cooling box" && !/washer|hide|found/i.test(p.text + p2.text + p.url));
  let called = null;
  const via = CB.shareFromTap({ share: (x) => { called = x; return Promise.resolve(); } }, { streak: 4 }, { name: "Coolbox" });
  check("shareFromTap calls navigator.share synchronously from the tap", via === "share" && called && called.url === CB.SHARE_URL && called.text === "4-day streak · Coolbox");
}

// --- Core cycle and local-only rules still hold ---
check("cycle is still 16 s with four 4-count sides", CB.CYCLE_MS === 16000 && CB.SIDE_MS === 4000 && CB.SIDES.length === 4);
check("ring grows on inhale, holds, shrinks on exhale, rests empty",
  CB.ringScale(0) === 0.55 && CB.ringScale(4000) === 1 && CB.ringScale(8000) === 1
  && Math.abs(CB.ringScale(2000) - 0.775) < 1e-9 && Math.abs(CB.ringScale(10000) - 0.775) < 1e-9
  && CB.ringScale(12000) === 0.55 && CB.ringScale(15000) === 0.55);
check("no Firestore writes or ZAB awards in cooling-box.js",
  !/addDoc|setDoc|updateDoc|collection\(|zab-earn|awardZab|zabBalance/.test(src));
check("start button still uses pointer or touch, not onclick",
  /bindStartBtn/.test(src) && /pointerdown/.test(src) && /touchend/.test(src)
  && /btn\.onclick = null/.test(src) && /cursor = "pointer"/.test(src) && /vibrate\(10\)/.test(src));
check("Sitkari how-to text is unchanged",
  /id="sitkari-how"/.test(html) && /How to sitkari/.test(html)
  && /Inhale mouth \(Sitkari\) — 4/.test(html)
  && /Full set:<\/strong> 18 cycles = about 5 minutes/.test(html)
  && /Bariboshi:<\/strong> both sides, one mandatory minute/.test(html));
check("Today's Hide section and script are left in place",
  /id="todays-hide"/.test(html) && /hide-daily\.js/.test(html));
check("cooling play UI has ring, goal, streak, gauge, mute and share",
  /id="coolingRing"/.test(html) && /id="coolingRingScale"/.test(html)
  && /id="coolingGoalFill"/.test(html) && /id="coolingGoalText"/.test(html)
  && /id="coolingStreak"/.test(html) && /id="coolingStreakDays"/.test(html)
  && /id="coolingSessionMin"/.test(html) && /id="coolingMuteBtn"/.test(html)
  && /id="coolingShareBtn"/.test(html) && /id="coolingNudge"/.test(html)
  && /id="coolingCeleb"/.test(html) && /id="coolingLevelBadge"/.test(html)
  && /cursor:pointer/.test(html.slice(html.indexOf("id=\"coolingStartBtn\""), html.indexOf("id=\"coolingStartBtn\"") + 80)));
check("mini dash has a compact streak badge beside Breath cycles",
  /id="miniDashStreak"/.test(html) && /class="pe-mini-streak"/.test(html)
  && html.indexOf("id=\"miniDashBreath\"") < html.indexOf("id=\"miniDashStreak\""));
check("prefers-reduced-motion calms the cooling-box motion",
  /prefers-reduced-motion:reduce/.test(html) && /cooling-plus/.test(html));

const bad = R.filter((x) => !x).length;
console.log(`\n${R.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
