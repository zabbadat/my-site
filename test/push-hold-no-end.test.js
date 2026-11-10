// Holding the top (press / plank) never ends a push-up set, however long. Knees, collapse, standing up, and picking the phone up do. Plus the 30-second
// top-hold bonus (once per set). Run: node test/push-hold-no-end.test.js
const fs = require("fs"), path = require("path");
const S = require("./lib/push-synth.js"), PC = require("../push-counter.js"), SS = require("../push-session.js"), CH = require("../push-challenge.js"), TB = require("../tut-battle.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const kneel = () => K({ left_shoulder: [256, 170], right_shoulder: [384, 170], left_hip: [300, 400], left_knee: [330, 300], left_ankle: [310, 420], right_hip: [340, 400], right_knee: [350, 300], right_ankle: [330, 420] });

// Real counter + failure watch + hold reward on synthetic front-view frames.
function sim(segs, cfg, extra) {
  const c = Object.assign({}, S.BASE, cfg || {}), ctr = PC.createCounter(), w = SS.createFailureWatch(), hr = SS.createHoldReward(); w.reset(0);
  let out = null, outAt = null, awards = [], maxHold = 0, repsAt = [];
  const T = S.total(segs) + (extra ? extra.ms : 0);
  for (let t = 0; t <= T; t += 1000 / c.fps) {
    const kps = extra && t > S.total(segs) ? extra.f(t) : S.frameFor(S.fracAt(segs, t), c, t);
    const r = ctr.update(kps, t, c.W); if (r.counted) repsAt.push(t);
    const st = ctr.state(), f = w.update(kps, t, st.topSize ? st.topSize * c.W : 0, { frameW: c.W, atTop: CH.atTopFrom(st) }); if (f && !out) { out = f; outAt = t; }
    const h = hr.update(CH.atTopFrom(st), t, false); maxHold = Math.max(maxHold, h.holdMs); if (h.awarded) awards.push(t);
  }
  return { out, outAt, reps: ctr.state().reps, awards, maxHold, repsAt };
}
const HOLD5 = 5 * 60 * 1000;
{ const segs = [...S.reps(5, 1800), [HOLD5, 0, 0], ...S.reps(5, 1800)], x = sim(segs);
  check(`5-minute top hold mid-set never ends the set (failure: ${x.out}) and reps keep counting after it (${x.reps} reps; ${x.repsAt.filter((t) => t > 9000 + HOLD5).length} after the hold)`, x.out === null && x.reps >= 9 && x.repsAt.filter((t) => t > 9000 + HOLD5).length >= 4);
  check(`30-second hold bonus earned once in that set (awards: ${x.awards.length}, at ${Math.round((x.awards[0] || 0) / 1000)} s)`, x.awards.length === 1); }
{ const x = sim([...S.reps(3, 1800), [HOLD5, 0, 0]], { noise: 0.004, drop: 0.15 });
  check("noisy, dropped keypoints during a 5-minute hold: still no end", x.out === null); }
{ const x = sim([...S.reps(30, 1500)]); check(`30 reps in a row: no end, no hold bonus (${x.reps} reps)`, x.out === null && x.reps >= 28 && x.awards.length === 0); }
{ const x = sim([...S.reps(3, 1800), [3000, 0, 0]], null, { ms: 3000, f: kneel });
  check(`knees down ~1 s ends the set as 'knees' (${x.out})`, x.out === "knees"); }
{ const x = sim([...S.reps(3, 1800), [3000, 0, 0]], null, { ms: 9000, f: () => [] });
  check("out of frame 9 s: still going (give-up needs 10 s)", x.out === null); }
{ const x = sim([...S.reps(3, 1800), [3000, 0, 0]], null, { ms: 11000, f: () => [] });
  check("out of frame 10 s ends the set as 'frame' (left / gave up)", x.out === "frame"); }
{ const x = sim([...S.reps(3, 1800), [3000, 0, 0]], null, { ms: 8000, f: () => K({ left_shoulder: [256, 170], right_shoulder: [384, 170] }).concat(K({ left_hip: [300, 400], left_knee: [330, 300], left_ankle: [310, 420] }, 0.1)) });
  check("knees out of frame / low confidence never trigger", x.out === null); }
// The 3:00 challenge keeps its clock and 10 s top-hold TUT cap, but holding still never ends it before 3:00.
{ const c = CH.createChallenge({ durationMs: 180000, topCapMs: 10000 }); c.start(0); let ended = null;
  for (let t = 0; t <= 200000; t += 100) { const s = c.update(t, { atTop: true }); if (s.ended && ended == null) ended = t; }
  check(`challenge: a full top hold runs to 3:00 (ended at ${ended / 1000} s), TUT capped at 10 s`, ended === 180000 && c.result().topTutMs === 10000); }
check("TUT Battles: 3:00 clock + 10 s top cap kept; shoulders-shrink 'standing' no longer loses; out of frame 10 s", TB.RULES.durationMs === 180000 && TB.RULES.topCapMs === 10000 && TB.RULES.outOfFrameMs === 10000);
check("failure watch: knees and 10 s out of frame end; shoulder-shrink standing does not; leaving the plank does; phone lift does not", SS.FAIL.frameMs === 10000 && SS.FAIL.endOn.knees && SS.FAIL.endOn.frame && !SS.FAIL.endOn.standing && !SS.FAIL.endOn.lifted && SS.FAIL.endOn.left);
check("no idle / no-rep / TUT-cap timer ends a set in the page (finishPushSet callers are buttons, challenge 3:00, camera stop, failure watch)", (html.match(/finishPushSet\(/g) || []).length === 8 && !/noRepMs|idleMs/.test(html));
check("regular Sets: knees down / 10 s out of frame ends via finishPushSet (posts once) with reps; with 0 reps it keeps going", /pushMode === "sets" && pushState\.running[\s\S]{0,500}if \(pushState\.reps >= 1\) \{ freezePushClock\(failWatch\.failedAt && failWatch\.failedAt\(\)\); finishPushSet\(why\); \} else \{ failWatch\.reset/.test(html));
check("'I give up' button exists for the 3:00 challenge (Sets has Finish set, One long set has End session)", /id="pushGiveUpBtn"[^>]*>I give up</.test(html) && /\$\("pushGiveUpBtn"\)\.onclick = /.test(html));

// ---- 30-second hold bonus
{ const h = SS.createHoldReward(); let a = []; for (let t = 0; t <= 29900; t += 100) if (h.update(true, t).awarded) a.push(t);
  check("hold bonus: not before 30 s", a.length === 0);
  const r = h.update(true, 30000); check("hold bonus: awarded at 30 s", r.awarded === true && r.done === true);
  let more = 0; for (let t = 30100; t < 120000; t += 100) if (h.update(true, t).awarded) more++;
  h.update(false, 120000); for (let t = 120100; t < 200000; t += 100) if (h.update(true, t).awarded) more++;
  check("hold bonus: once per set (no stacking for extra 30 s or a second long hold)", more === 0);
  h.reset(); let b = 0; for (let t = 0; t <= 30000; t += 100) if (h.update(true, t).awarded) b++; check("hold bonus: a new set (reset) can earn it again", b === 1); }
{ const h = SS.createHoldReward(); for (let t = 0; t <= 20000; t += 100) h.update(true, t); h.update(true, 20100, true);
  let a = null; for (let t = 20200; t <= 52000; t += 100) if (h.update(true, t).awarded) a = t;
  check(`hold bonus: knees down resets the hold timer (earned 30 s after, at ${a / 1000} s)`, a != null && a >= 50200 && a <= 50300); }
{ const h = SS.createHoldReward(); for (let t = 0; t <= 25000; t += 100) h.update(true, t); h.update(false, 25100);
  let a = null; for (let t = 25200; t <= 56000; t += 100) if (h.update(true, t).awarded && a == null) a = t;
  check("hold bonus: leaving the top restarts the 30 s", a != null && a >= 55200); }
check("hold bonus: 0.5 ZAB constant, on-screen + spoken '30-second hold!', hold timer element, reset per set", SS.HOLD_REWARD.zab === 0.5 && SS.HOLD_REWARD.holdMs === 30000 && /"30-second hold!"/.test(html) && /id="pushHoldTimer"/.test(html) && /holdReward\.reset\(\)/.test(html));
check("hold bonus credit is live as two halves = 1 ZAB (whole-number ledger; see hold-half-zab.test.js)", /const HOLD_ZAB_LIVE = true;/.test(html));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
