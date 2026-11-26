// Breath Equity: 2-min default, running clock, 2:00 cue, ZAB on complete, visible rename, Hide dial reuse.
// Run: node test/breath-equity.test.js
const fs = require("fs"), path = require("path");
const CB = require("../cooling-box.js");
const Z = require("../zab-balance.js");
const E = require("../zab-earn.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = fs.readFileSync(path.join(__dirname, "..", "cooling-box.js"), "utf8");
const hide = fs.readFileSync(path.join(__dirname, "..", "hide-daily.js"), "utf8");
const R = [];
const check = (n, ok, info) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${!ok && info != null ? "  " + info : ""}`); R.push(!!ok); };
const mem = () => { const m = {}; return { getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };

check("default session is 2 minutes / 7 rounds", CB.DEFAULT_MIN === 2 && CB.roundsForMinutes(2) === 7 && CB.sessionLabel(2) === "2 min · 7 rounds");
check("slider HTML defaults to 2 min · 7 rounds", /id="coolingSessionMin"[^>]*value="2"/.test(html) && /id="coolingSessionLabel">2 min · 7 rounds</.test(html));
check("breath ZAB: under 2 = 0, 2–4 = 1, 5+ = 3",
  [0, 1, 2, 3, 4, 5, 10].map(CB.breathZabFor).join(",") === "0,0,1,1,1,3,3"
  && Z.breathZabFor(2) === 1 && Z.breathZabFor(5) === 3 && Z.zabFor("breath", 5) === 3);

check("formatClock is m:ss", CB.formatClock(0) === "0:00" && CB.formatClock(2000) === "0:02" && CB.formatClock(120000) === "2:00" && CB.formatClock(125000) === "2:05");

{
  let t = 0;
  const box = CB.createBox({ store: mem(), now: () => t, sessionMinutes: 5 });
  box.start();
  check("clock starts at 0:00", CB.formatClock(box.sessionMs()) === "0:00");
  t += 2000; box.tick();
  check("clock runs in m:ss while the session is live", CB.formatClock(box.sessionMs()) === "0:02" && box.running());
  t += 118000; box.tick();
  check("clock reaches 2:00 mid-session for a 5-min set", CB.formatClock(box.sessionMs()) === "2:00" && box.running());
  const mid = CB.twoMinCue({ said: false, elapsedMs: 120000, running: true, minutes: 5 });
  check("2:00 mid-session cue speaks once if the set continues", mid.speak === CB.TWO_MIN_LINE && mid.said === true);
  const again = CB.twoMinCue({ said: true, elapsedMs: 130000, running: true, minutes: 5 });
  check("2:00 cue does not repeat", again.speak == null && again.said === true);
  const short = CB.twoMinCue({ said: false, elapsedMs: 120000, running: true, minutes: 2 });
  check("a 2-min session does not play the mid-session cue (completion line is used instead)", short.speak == null);
  const early = CB.twoMinCue({ said: false, elapsedMs: 119000, running: true, minutes: 5 });
  check("cue does not fire before 2:00", early.speak == null && early.said === false);
  box.stop();
  const frozen = box.sessionMs();
  t += 5000;
  check("clock freezes on Stop", box.sessionMs() === frozen && !box.running());
}

{
  let t = 0, ended = null;
  const box = CB.createBox({
    store: mem(),
    now: () => t,
    sessionMinutes: 2,
    onSessionEnd: (s) => { ended = s; }
  });
  box.start();
  for (let i = 0; i < 7; i++) { t += 16000; box.tick(); }
  check("2-min complete awards 1 ZAB and freezes the clock",
    !!(ended && ended.reason === "complete" && ended.zab === 1 && ended.rounds === 7
      && ended.elapsedMs === 7 * 16000 && CB.formatClock(ended.elapsedMs) === "1:52"),
    JSON.stringify(ended));
  check("completion line for a 2-min set", CB.completeSpeakLine(1) === "Session complete. One ZAB earned.");
  check("completion line for a 5-min set", CB.completeSpeakLine(3) === "Session complete. Three ZAB earned.");
  check("end copy is short", CB.zabEndCopy(1) === "Plus 1 ZAB." && CB.zabEndCopy(3) === "Plus 3 ZAB." && CB.zabEndCopy(0) === "");
}

{
  let t = 0, ended = null;
  const box = CB.createBox({
    store: mem(),
    now: () => t,
    sessionMinutes: 2,
    onSessionEnd: (s) => { ended = s; }
  });
  box.start();
  t += 30000; box.stop();
  check("Stop / early end awards 0 ZAB", !!(ended && ended.reason === "stop" && ended.zab === 0), JSON.stringify(ended));
}

{
  let t = 0, ended = null;
  const box = CB.createBox({
    store: mem(),
    now: () => t,
    sessionMinutes: 5,
    onSessionEnd: (s) => { ended = s; }
  });
  box.start();
  for (let i = 0; i < 18; i++) { t += 16000; box.tick(); }
  check("5-min complete awards 3 ZAB", !!(ended && ended.reason === "complete" && ended.zab === 3 && ended.rounds === 18), JSON.stringify(ended));
}

check("visible section label is Breath Equity; #cooling-box id is unchanged",
  /<a href="#cooling-box">Breath Equity<\/a>/.test(html)
  && /id="cooling-box"/.test(html)
  && /<h2> Breathwork & Meditation —<br>Zabsticking<br>Breath Equity <\/h2>/.test(html)
  && /allotted Breath Equity/.test(html)
  && /id="coolingStopBtn"[^>]*>Stop Breath Equity</.test(html));
check("Today's Hide cooling-box comparison line is unchanged",
  /Same 4-count as the cooling box\./.test(html));
check("visible Coolbox in this block is shown as Breath Equity; internal level name stays Coolbox",
  CB.levelLabel({ name: "Coolbox" }) === "Breath Equity"
  && CB.LEVELS.map((l) => l.name).join("|") === "Sitkari|Coolbox|Steady|Settled|Deep box|Zabbadat"
  && CB.STOP_LABEL === "Stop Breath Equity");

check("solo and camera clocks exist and camera dial matches the 168px solo ring",
  /id="coolingClock"/.test(html) && /id="coolingCamClock"/.test(html)
  && /id="coolingCamRing"/.test(html)
  && /cooling-cam-ring-wrap\{position:relative;width:168px;height:168px/.test(html)
  && /cooling-ring-wrap\{position:relative;width:168px;height:168px/.test(html)
  && /id="coolingCamCue"[\s\S]*width="168" height="168"/.test(html));

check("Today's Hide uses the exact camera/solo dial markup and can start a live session",
  /id="todaysHideBreath"/.test(html)
  && /id="todaysHideRing"/.test(html)
  && /id="todaysHideClock"/.test(html)
  && /id="todaysHideBreathStop"/.test(html)
  && /id="todaysHideCamLabel"/.test(html)
  && /todaysHideBreath[\s\S]*width="168" height="168"/.test(html)
  && /bindStartBtn\(hideCue, function \(\) \{ startSession\("solo"\); \}/.test(src)
  && /document\.getElementById\("todaysHideRing"\)/.test(hide));

check("speech helpers use the existing 0.88 rate path and respect mute",
  /maybeSpeak/.test(src) && /isMuted\(\)/.test(src) && /TWO_MIN_LINE/.test(src)
  && CB.TWO_MIN_LINE === "Two minutes. One ZAB earned.");

check("host awards breath ZAB through claimEarn without a client Firestore write",
  /saveAndAwardBreath/.test(html) && /awardZab\("breath"/.test(html)
  && !/addDoc|setDoc|collection\(/.test(src));

check("day cap for breath is 15 ZAB; breath is a claim source",
  E.DAY_CAP.breath === 15 && E.KINDS.breath && E.KINDS.breath.source === "breath"
  && Z.CLAIM_SOURCES.indexOf("breath") >= 0
  && Z.rateLines()[Z.rateLines().length - 1] === "Breath Equity: 2 minutes = 1 ZAB, 5 minutes = 3 ZAB");

(async () => {
  const now = 1_700_000_000_000;
  // Minimal in-memory fs adapter matching zab-earn tests.
  function memFs(seed) {
    const db = Object.assign({}, seed || {});
    const key = (p) => p.join("/");
    return {
      db,
      ts: () => now,
      toMs: (v) => (v == null ? null : Number(v)),
      tx(fn) {
        const t = {
          get: (p) => Promise.resolve(db[key(p)] || null),
          set: (p, d) => { db[key(p)] = d; },
          update: (p, patch) => { db[key(p)] = Object.assign({}, db[key(p)] || {}, patch); }
        };
        return Promise.resolve(fn(t));
      }
    };
  }
  try {
    const fs2 = memFs();
    const body = { source: "breath", id: "b2min", minutes: 2, rounds: 7, ms: 7 * 16000, mode: "solo" };
    const r = await E.claim(fs2, "u1", body, now, now - 1000);
    check("earn function credits 1 ZAB for a completed 2-min session without a breaths doc",
      r.credited === 1 && r.ok === true, JSON.stringify(r));
    const again = await E.claim(fs2, "u1", body, now, now - 1000).then(() => ({ ok: false }), (e) => e);
    check("second claim for the same breath session is rejected", again && again.status === 409);

    const r5 = await E.claim(memFs(), "u1", { source: "breath", id: "b5min", minutes: 5, rounds: 18, ms: 18 * 16000, mode: "camera" }, now, now - 1000);
    check("earn function credits 3 ZAB for a completed 5-min session", r5.credited === 3, JSON.stringify(r5));

    const early = await E.claim(memFs(), "u1", { source: "breath", id: "bearly", minutes: 2, rounds: 7, ms: 30000, mode: "solo" }, now, now - 1000)
      .then(() => ({ ok: false }), (e) => e);
    check("earn function rejects a short / early breath claim", early && early.status === 422);

    const oneMin = await E.claim(memFs(), "u1", { source: "breath", id: "b1", minutes: 1, rounds: 4, ms: 4 * 16000, mode: "solo" }, now, now - 1000)
      .then(() => ({ ok: false }), (e) => e);
    check("under 2 minutes cannot earn ZAB", oneMin && oneMin.status === 422);

    const posted = [];
    const cr = await Z.claimEarn(async (c) => { posted.push(c); return { credited: 1, balance: 1 }; }, mem(), "breath", "sess1", { minutes: 2, rounds: 7, ms: 112000, mode: "solo" });
    check("claimEarn posts breath session fields",
      cr.credited === 1 && posted[0] && posted[0].source === "breath" && posted[0].minutes === 2 && posted[0].rounds === 7 && posted[0].ms === 112000,
      JSON.stringify(posted));
  } catch (e) {
    check("breath earn path threw", false, e && e.stack || e);
  }
  const failed = R.filter((x) => !x).length;
  console.log(failed ? "FAIL  " + failed + " checks" : "breath-equity: ok");
  process.exit(failed ? 1 : 0);
})();
