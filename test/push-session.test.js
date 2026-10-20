// Tests for push-session.js. Run: node test/push-session.test.js
const { tutHistory, rankTut, tutToAdd, setsToAdd, canSwitchMode, classify, createPostureGuard } = require("../push-session.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
// floor camera, plank: shoulders wide (top width 200 px), legs out of view
const plank = K({ left_shoulder: [220, 240], right_shoulder: [420, 240] });
const away = K({ left_shoulder: [290, 240], right_shoulder: [350, 240] });           // width 60 < 0.55*200
const kneesDown = K({ left_shoulder: [100, 200], left_hip: [300, 220], left_knee: [400, 300], left_ankle: [300, 310] }); // ~ folded knee
const upright = K({ left_shoulder: [300, 50], left_hip: [300, 250], left_knee: [302, 350], left_ankle: [304, 450] });
const lowConf = K({ left_shoulder: [290, 240], right_shoulder: [350, 240], left_knee: [1, 1] }, 0.1);
const TOP = 200;

check("tutToAdd long = full session time", tutToAdd("long", 125000, 40000) === 125000);
check("tutToAdd sets = rep time", tutToAdd("sets", 125000, 40000) === 40000);
check("tutToAdd bad input = 0", tutToAdd("long", NaN, 0) === 0 && tutToAdd("sets", 1, -3) === 0);
check("setsToAdd: +1 only with reps", setsToAdd(12) === 1 && setsToAdd(0) === 0 && setsToAdd(undefined) === 0 && setsToAdd("3") === 1);
check("no switching mid-session", !canSwitchMode({ running: true, elapsed: 0, reps: 0 }) && !canSwitchMode({ running: false, elapsed: 5000, reps: 3 }));
check("switch allowed idle / finished", canSwitchMode({ running: false, elapsed: 0, reps: 0 }) && canSwitchMode({ running: false, elapsed: 9000, reps: 4, finished: true }));

check("classify plank = ok", classify(plank, TOP) === "ok");
check("classify left plank (far from camera) = standing", classify(away, TOP) === "standing");
check("classify upright body = standing", classify(upright, TOP) === "standing");
const plankLegs = K({ left_shoulder: [220, 240], right_shoulder: [420, 240], left_hip: [230, 330], left_knee: [235, 400], left_ankle: [238, 470] });
check("floor view of plank with legs down the frame = ok", classify(plankLegs, TOP) === "ok");
check("classify collapsed knee = knees", classify(kneesDown, TOP) === "knees");
check("classify low confidence = uncertain (null)", classify(lowConf, TOP) === null);
check("classify no calibration + shoulders only = uncertain", classify(plank, 0) === null);

function play(seq, fps = 30) { // seq: [[frames, ms], ...]
  const g = createPostureGuard(); let t = 0, evs = [];
  for (const [f, ms] of seq) for (let e = t + ms; t < e; t += 1000 / fps) { const r = g.update(f, t, TOP); if (r.event) evs.push(r.event); }
  return { count: g.state().count, evs };
}
check("brief 0.3 s blip not flagged", play([[plank, 1000], [away, 300], [plank, 1000]]).count === 0);
check("0.6 s standing flagged once", play([[plank, 1000], [away, 600], [plank, 1000]]).count === 1);
check("long 5 s standing counts once", play([[plank, 1000], [away, 5000], [plank, 1000]]).count === 1);
check("re-arms after plank: two events", play([[plank, 500], [away, 800], [plank, 500], [kneesDown, 800], [plank, 500]]).count === 2);
check("no re-arm without plank in between", play([[plank, 500], [away, 800], [kneesDown, 800], [plank, 500]]).count === 1);
check("uncertain frames never flag", play([[plank, 500], [lowConf, 3000], [plank, 500]]).count === 0);
check("uncertain gap does not re-arm", play([[plank, 500], [away, 800], [lowConf, 2000], [away, 800]]).count === 1);
check("event types recorded", play([[plank, 500], [kneesDown, 800], [plank, 500]]).evs.join() === "knees");
{ const P = "zabbadat-push-tut-u1-";
  const e = [[P + "2026-10-19", "90000"], [P + "2026-10-17", "300000"], [P + "2026-9-30", "60000"], ["zabbadat-push-tut-other-2026-10-19", "999999"],
    [P + "2026-10-18", "0"], [P + "junk", "5"], ["zabbadat-push-total-u1-2026-10-19", "40"], ["zabbadat-push-total-u1-2026-10-17", "120"], ["zabbadat-push-total-u1-2026-10-16", "15"]];
  const h = tutHistory(e, P, "2026-10-19", "zabbadat-push-total-u1-");
  check("history: today", h.today === 90000);
  check("history: best day", h.best && h.best.key === "2026-10-17" && h.best.ms === 300000);
  check("history: all-time total, own user only, zero/junk ignored", h.total === 450000 && h.days.length === 4);
  check("history: newest first across months", h.days.map((d) => d.key).join() === "2026-10-19,2026-10-17,2026-10-16,2026-9-30");
  check("history: reps per day / best-day reps / all-time reps", h.todayReps === 40 && h.best.reps === 120 && h.totalReps === 175 && h.days[2].reps === 15 && h.days[2].ms === 0);
  check("history: without reps prefix still works", tutHistory(e, P, "2026-10-19").totalReps === 0);
  check("history: empty", tutHistory([], P, "2026-10-19").best === null); }
{ const r = rankTut([{ reps: 0, ms: 9e5 }, { reps: 5, ms: 3000 }, { reps: 30, ms: 120000 }, { reps: 2, ms: 0 }]);
  check("rankTut: longest first, 0 reps dropped", r.length === 2 && r[0].ms === 120000); }
const fails = R.filter((x) => !x).length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
