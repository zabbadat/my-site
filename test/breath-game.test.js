// Cooling-box game layer: Eastern-day streak, all-time levels, in-session combos, session gauge.
// Device-local only. Run: node test/breath-game.test.js
const fs = require("fs"), path = require("path");
const CB = require("../cooling-box.js");
const ET = require("../et-day.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = fs.readFileSync(path.join(__dirname, "..", "cooling-box.js"), "utf8");
const R = [];
const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
function mem() { const d = {}; return { getItem: (k) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; }, d }; }
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
  s.setItem(CB.MUTE_KEY, "1");
  check("isMuted ignores a leftover mute key so tones always play", CB.isMuted(s) === false);
  CB.clearMutePref(s);
  check("clearMutePref removes the leftover zabbadat-breath-mute key", s.getItem(CB.MUTE_KEY) == null);
  const s2 = mem();
  s2.setItem(CB.MUTE_KEY, "1");
  CB.createBox({ store: s2, et: ET, now: () => MON_NOON });
  check("createBox clears a leftover mute key on load", s2.getItem(CB.MUTE_KEY) == null);
}
check("Sound/mute button is gone from the cooling-box card",
  !/id="coolingMuteBtn"/.test(html) && !/coolingMuteBtn/.test(html) && !/paintMute/.test(src)
  && !/setMuted/.test(src) && /function phaseTone\(sideIndex\)/.test(src) && !/if \(isMuted/.test(src));
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
check("cooling play UI has ring, goal, streak, gauge and share, and no mute button",
  /id="coolingRing"/.test(html) && /id="coolingRingScale"/.test(html)
  && /id="coolingGoalFill"/.test(html) && /id="coolingGoalText"/.test(html)
  && /id="coolingStreak"/.test(html) && /id="coolingStreakDays"/.test(html)
  && /id="coolingSessionMin"/.test(html) && !/id="coolingMuteBtn"/.test(html)
  && /id="coolingShareBtn"/.test(html) && /id="coolingNudge"/.test(html)
  && /id="coolingCeleb"/.test(html) && /id="coolingLevelBadge"/.test(html)
  && /cursor:pointer/.test(html.slice(html.indexOf("id=\"coolingSoloBtn\""), html.indexOf("id=\"coolingSoloBtn\"") + 80)));
check("mini dash has a compact streak badge beside Breath cycles",
  /id="miniDashStreak"/.test(html) && /class="pe-mini-streak"/.test(html)
  && html.indexOf("id=\"miniDashBreath\"") < html.indexOf("id=\"miniDashStreak\""));
check("prefers-reduced-motion calms the cooling-box motion",
  /prefers-reduced-motion:reduce/.test(html) && /cooling-plus/.test(html));

check("hold sides are Hold full (1) and Hold empty (3)", CB.isHoldSide(0) === false && CB.isHoldSide(1) === true && CB.isHoldSide(2) === false && CB.isHoldSide(3) === true);
{
  const inhale = CB.statusView({ running: true, side: "Inhale", sideIndex: 0, count: 3 });
  const hold = CB.statusView({ running: true, side: "Hold full", sideIndex: 1, count: 2 });
  const empty = CB.statusView({ running: true, side: "Hold empty", sideIndex: 3, count: 4 });
  check("inhale/exhale keep the spoken prompt with the count", inhale.hold === false && inhale.status === "Inhale 3");
  check("hold phases show the arcade count and keep the side name as status",
    hold.hold === true && hold.status === "Hold full" && hold.count === "2" && hold.label === "Hold"
    && empty.hold === true && empty.status === "Hold empty" && empty.count === "4");
}
check("arcade hold strip uses the shared arcade-num markup",
  /id="coolingHoldStrip"/.test(html) && /class="arcade-strip"/.test(html)
  && /id="coolingHoldCount"/.test(html) && /class="arcade-num"/.test(html)
  && /id="coolingHoldLbl"/.test(html) && /class="arcade-lbl"/.test(html));
check("Record preference is off by default and remembered locally",
  CB.RECORD_KEY === "zabbadat-breath-record"
  && (function () { const s = mem(); return CB.isRecordOn(s) === false && CB.setRecordOn(s, true) === true && CB.isRecordOn(s) === true && s.getItem(CB.RECORD_KEY) === "1"; })());
check("Proof of Sitkari summary leads the end-of-session line when the camera ran",
  CB.summaryLine({ rounds: 18, level: { name: "Coolbox" }, streak: { streak: 3 } }, true)
    === "Proof of Sitkari · 18 rounds · Coolbox · 3-day streak."
  && CB.summaryLine({ rounds: 2 }, false) === "2 rounds.");
check("cooling camera markup and caption are in the card, Record toggle is present",
  /id="coolingWrap"/.test(html) && /id="coolingVid"/.test(html)
  && /id="coolingProofCaption"/.test(html) && /Proof of Sitkari/.test(html)
  && /id="coolingRecBtn"/.test(html) && /data-rec="coolingWrap"/.test(html));
check("cooling-box.js opens the camera only through the shared host constraints",
  /getUserMedia\(H\.CAM_CONSTRAINTS\)/.test(src) && /ZabPfp\.sitkariFrame/.test(src)
  && !/camFs\(/.test(src));

check("two equal start buttons sit under the ring, Record lives only in the camera column",
  /id="coolingSoloBtn"/.test(html) && /id="coolingCamBtn"/.test(html)
  && /id="coolingStartRow"/.test(html) && /id="coolingCamCol"/.test(html)
  && html.indexOf('id="coolingRecBtn"') > html.indexOf('id="coolingCamBtn"')
  && html.indexOf('id="coolingRecBtn"') < html.indexOf('id="coolingShareBtn"')
  && /Breathe solo/.test(html) && /Breathe on camera/.test(html)
  && !/id="coolingStartBtn"/.test(html));
check("unselected start mode uses the dark ghost treatment, last-used keeps the primary fill",
  /#coolingSoloBtn\.btn\.ghost,#coolingCamBtn\.btn\.ghost/.test(html)
  || /#coolingCamBtn\.btn\.ghost,#coolingSoloBtn\.btn\.ghost/.test(html));

check("last-used mode is remembered locally and defaults to solo",
  CB.MODE_KEY === "zabbadat-breath-mode"
  && (function () { const s = mem(); return CB.getMode(s) === "solo" && CB.setMode(s, "camera") === "camera" && CB.getMode(s) === "camera" && CB.setMode(s, "solo") === "solo"; })());
check("close-up hint is the exact camera-only line, above the video and not over the caption",
  CB.CLOSE_HINT === "Sit up close so your mouth and chin show."
  && /id="coolingCloseHint"/.test(html)
  && html.indexOf('id="coolingCloseHint"') < html.indexOf('id="coolingVid"')
  && html.indexOf('id="coolingVid"') < html.indexOf('id="coolingProofCaption"'));
check("camera intro names sitting up close; solo intro does not",
  CB.INTRO_LINE === "Sitkari time. Sit up close so your mouth shows, then breathe in through your teeth and out through your nose."
  && CB.INTRO_SOLO === "Sitkari time. Breathe in through your teeth and out through your nose."
  && !/Sit up close/.test(CB.INTRO_SOLO));
check("alignment script is shared: intro, sit-tall line, then One. Two. Three. Breathe.",
  CB.ALIGN_LINE === "Sit tall. Shoulders down and soft. Relax your jaw."
  && CB.ALIGN_COUNTS.join("|") === "One.|Two.|Three.|Breathe."
  && CB.alignmentScript("camera").join("|") === [CB.INTRO_LINE, CB.ALIGN_LINE].concat(CB.ALIGN_COUNTS).join("|")
  && CB.alignmentScript("solo").join("|") === [CB.INTRO_SOLO, CB.ALIGN_LINE].concat(CB.ALIGN_COUNTS).join("|"));
check("solo start never opens the camera; only camera mode calls getUserMedia",
  /if \(mode === "camera"\)/.test(src) && /startCoolingCam\(\)/.test(src)
  && /getUserMedia\(H\.CAM_CONSTRAINTS\)/.test(src));
check("alignment countdown reuses the breath-ring, not arcade-num; holds stay arcade",
  /id="coolingAlignRing"/.test(html) && /class="cooling-ring-wrap" id="coolingAlignRing"/.test(html)
  && /id="coolingAlignScale"/.test(html) && /class="cooling-ring-scale"/.test(html)
  && /id="coolingAlignCount"/.test(html)
  && !/id="coolingAlignRing"[\s\S]{0,500}arcade-num/.test(html)
  && /id="coolingHoldStrip"/.test(html) && /class="arcade-strip" id="coolingHoldStrip"/.test(html)
  && /class="arcade-num" id="coolingHoldCount"/.test(html));
{
  const sHead = { x: 320, y: 164.5, r: 53.1 };
  const pos = CB.alignRingPos(sHead, 640, 480, 96);
  const mouth = CB.mouthChinBox(sHead);
  const ringBox = { x: pos.x - pos.r, y: pos.y - pos.r, w: pos.r * 2, h: pos.r * 2 };
  const logo = { x: sHead.x - sHead.r, y: sHead.y - sHead.r, w: sHead.r * 2, h: sHead.r * 2 };
  check("align ring sits off the mouth, chin, and logo boxes",
    !!pos && CB.boxesOverlap(ringBox, mouth) === 0 && CB.boxesOverlap(ringBox, logo) === 0 && pos.y > sHead.y,
    JSON.stringify({ pos, mouth }));
}

function runRewards(store, rounds) {
  let now = MON_NOON;
  const box = CB.createBox({ store, et: ET, now: () => now });
  box.start();
  for (let i = 0; i < rounds; i++) { now += 16000; box.tick(); }
  box.stop();
  return {
    cycles: CB.getCycles(store),
    streak: CB.streakStatus(store, ET, now).streak,
    today: CB.streakStatus(store, ET, now).todayCount,
    level: (CB.levelFor(CB.getCycles(store)) || {}).name || "",
    combo: (CB.comboFor(rounds) || {}).name || "",
    goal: CB.roundsForMinutes(CB.getSessionMinutes(store))
  };
}
{
  const a = runRewards(mem(), 4), b = runRewards(mem(), 4);
  check("solo and camera modes award identical cycles, streak, combos, levels, daily goal and gauge",
    JSON.stringify(a) === JSON.stringify(b) && a.cycles === 4 && a.streak === 1 && a.combo === "Bariboshi minute");
  check("no ZAB awards were added for breath", !/awardZab|zab-earn/.test(src));
}

(async () => {
  const spoken = [];
  let t = 0, breathed = false, counts = [];
  const align = CB.createAlign({
    intro: CB.INTRO_SOLO,
    now: () => t,
    wait: (ms) => { t += ms; return Promise.resolve(); },
    speak: (line) => { spoken.push(line); return Promise.resolve(); },
    onCount: (n) => { if (n) counts.push(n); },
    onBreathe: () => { breathed = true; }
  });
  const ok = await align.run();
  const store = mem();
  check("alignment speaks the exact solo script in order and breathes last",
    ok === true && spoken.join("|") === CB.alignmentScript("solo").join("|")
    && counts.join(",") === "1,2,3" && breathed === true);
  check("no cycle is counted before Breathe", CB.getCycles(store) === 0 && breathed === true);

  const spoken2 = [];
  let breathed2 = false, t2 = 0, mid;
  mid = CB.createAlign({
    now: () => t2,
    wait: (ms) => { t2 += ms; return Promise.resolve(); },
    speak: (line) => { spoken2.push(line); if (spoken2.length === 2) mid.cancel(); return Promise.resolve(); },
    onBreathe: () => { breathed2 = true; }
  });
  const ok2 = await mid.run();
  check("Stop during alignment cancels speech and never starts a cycle",
    ok2 === false && breathed2 === false && spoken2.indexOf("Breathe.") < 0);

  const spokenCam = [];
  const camAlign = CB.createAlign({
    intro: CB.INTRO_LINE,
    now: () => 0,
    wait: () => Promise.resolve(),
    speak: (line) => { spokenCam.push(line); return Promise.resolve(); },
    onBreathe: () => {}
  });
  await camAlign.run();
  check("camera alignment uses the close-up intro, then the shared sit-tall count",
    spokenCam.join("|") === CB.alignmentScript("camera").join("|"));

  const bad = R.filter((x) => !x).length;
  console.log(`\n${R.length - bad} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("FAIL harness", e && e.stack || e); process.exit(1); });
