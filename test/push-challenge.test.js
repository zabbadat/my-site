// Tests for push-challenge.js (Three-minute challenge) + static checks. Run: node test/push-challenge.test.js
const fs = require("fs"), path = require("path");
const { createChallenge, atTopFrom, flagSummary } = require("../push-challenge.js");
const { createPostureGuard, tutToAdd } = require("../push-session.js");
const { tutForRep } = require("../push-counter.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const mk = () => createChallenge({ durationMs: 180000, topCapMs: 10000 });

// ---- clock duration
let c = mk(); c.start(1000);
check("clock: 3:00 remaining at start", c.remaining(1000) === 180000);
check("clock: counts down", c.remaining(61000) === 120000 && c.elapsed(61000) === 60000);
let s = c.update(180999, {});
check("clock: not ended at 2:59.999", !s.ended);
s = c.update(181000, {});
check("clock: auto-ends at exactly 180 s", s.ended && s.remainingMs === 0 && s.elapsedMs === 180000);
c.update(182000, { counted: true, repMs: 2000 });
check("clock: no reps after the end", c.result().reps === 0);
check("clock: elapsed never passes 180 s", c.elapsed(500000) === 180000);
c = mk(); c.start(0); c.update(179000, { atTop: true }); s = c.update(200000, { atTop: true });
check("clock: top hold spanning the end credits only up to 3:00", s.ended && s.topTutMs === 1000);
check("clock: not started = no credit", (() => { const x = mk(); x.update(5000, { counted: true, repMs: 1000 }); return x.result().reps === 0; })());

// ---- top-hold cap (10 s)
c = mk(); c.start(0);
for (let t = 0; t <= 9500; t += 100) s = c.update(t, { atTop: true });
check("cap: 9.5 s hold credits 9.5 s, no note", s.topTutMs === 9500 && !s.capped);
for (let t = 9600; t <= 30000; t += 100) s = c.update(t, { atTop: true });
check("cap: 30 s hold credits at most 10 s", s.topTutMs === 10000);
check("cap: note shown once hold passes 10 s", s.capped === true);
s = c.update(30100, { atTop: false });
check("cap: note cleared when lowering starts", s.capped === false && s.topTutMs === 10000);
s = c.update(32000, { atTop: false, counted: true, repMs: 1900 });
for (let t = 32100; t <= 50000; t += 100) s = c.update(t, { atTop: true });
check("cap: new hold gets a fresh 10 s", s.topTutMs === 20000 && s.capped);
check("cap: default topCapMs is 10000", createChallenge().options.topCapMs === 10000);
check("cap: at-top time only counts while at top", (() => { const x = mk(); x.start(0); x.update(0, {}); x.update(5000, {}); return x.result().topTutMs === 0; })());

// ---- at-top detection from push-counter state
const st = (o) => Object.assign({ phase: "ready", stage: "up", repStart: null, top: 100, bottom: 200, smooth: 105 }, o);
check("atTop: calibrated, up, rom < 0.15", atTopFrom(st({})) === true);
check("atTop: false while lowering (rom 0.2)", atTopFrom(st({ smooth: 120 })) === false);
check("atTop: false mid-rep (repStart set)", atTopFrom(st({ repStart: 5 })) === false);
check("atTop: false at bottom stage", atTopFrom(st({ stage: "down" })) === false);
check("atTop: false before calibration", atTopFrom(st({ phase: "first" })) === false && atTopFrom(null) === false);

// ---- scoring
c = mk(); c.start(0);
c.update(1000, { counted: true, repMs: 2000 }); c.update(3000, { counted: true, repMs: 2500 }); c.update(5000, { counted: true, repMs: 20000 });
for (let t = 6000; t <= 30000; t += 500) c.update(t, { atTop: true });
let r = c.result();
check("score: reps counted", r.reps === 3);
check("score: rep TUT uses tutForRep (10 s cap)", r.repTutMs === tutForRep(2000, 10000) + tutForRep(2500, 10000) + tutForRep(20000, 10000));
check("score: TUT = rep TUT + capped top TUT", r.topTutMs === 10000 && r.tutMs === r.repTutMs + 10000);
check("score: score = reps + whole TUT seconds", r.score === 3 + Math.floor(r.tutMs / 1000));
check("score: saved TUT uses rep path (non-long)", tutToAdd("challenge", 180000, r.tutMs) === r.tutMs);

// ---- plank-position flagging (same guard as One long set; clock keeps running)
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const plank = K({ left_shoulder: [220, 240], right_shoulder: [420, 240] });
const upright = K({ left_shoulder: [300, 50], left_hip: [300, 250], left_knee: [302, 350], left_ankle: [304, 450] });
const kneesDown = K({ left_shoulder: [100, 200], left_hip: [300, 220], left_knee: [400, 300], left_ankle: [300, 310] });
const g = createPostureGuard(); c = mk(); c.start(0);
const flags = { standing: 0, knees: 0 }; let t = 0;
const run = (kp, ms) => { for (let e = t + ms; t < e; t += 33) { const x = g.update(kp, t, 200); if (x.event) flags[x.event]++; c.update(t, {}); } };
run(plank, 1000); run(upright, 1500); run(plank, 1000); run(kneesDown, 1500); run(plank, 1000);
check("flags: stand up flagged once", flags.standing === 1);
check("flags: knees down flagged once", flags.knees === 1);
check("flags: guard count = 2", g.state().count === 2);
check("flags: clock keeps running through flags", c.remaining(t) === 180000 - t && !c.snapshot(t).ended);
check("flags: summary text", flagSummary(flags) === "2 flags: Stood up / left plank × 1, Knees down × 1" && flagSummary({}) === "No flags");

// ---- static checks on index.html
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
check("static: challenge mode button exists", html.includes('<button type="button" id="modeChallengeBtn" aria-pressed="false">Three-minute challenge</button>'));
check("static: existing mode buttons untouched", html.includes('<button type="button" id="modeLongBtn" aria-pressed="true"><span class="tuts-l">T</span>ime <span class="tuts-l">u</span>nder <span class="tuts-l">t</span>ension <span class="tuts-l">s</span>et<span class="btn-tut">TUT</span></button>') && html.includes('<button type="button" id="modeSetsBtn" aria-pressed="false">Sets</button>'));
check("static: push-challenge.js loaded", html.includes('<script src="/push-challenge.js"></script>'));
check("static: persisted mode accepts challenge", /m === "sets" \|\| m === "challenge" \? m : "long"/.test(html));
check("static: start uses same sign-in gate", html.includes('requireSignIn("pushups", () => startPush(), { practice: true })'));
check("static: flag messages unchanged", html.includes('" flagged. Clock keeps running."') && html.includes('"Knees down" : "Stood up / left plank"'));
check("static: top-hold note text", html.includes('"Top hold capped at 10 seconds"') && html.includes("at most 10 seconds of time under tension"));
check("static: long/sets status texts unchanged", html.includes('"Session on. The clock runs nonstop; the camera counts each full rep." : "Set on. The camera counts each full rep."'));
check("static: pause only in Sets", html.includes('pushMode !== "sets") return;'));
check("static: result card present", html.includes('id="challengeResult"') && html.includes("Three-minute challenge done"));

const fail = R.filter((x) => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed`);
if (fail) process.exit(1);
