// Tests for walk-session.js. Run: node test/walk-session.test.js
const W = require("../walk-session.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

check("clock mm:ss", W.formatClock(65000) === "01:05");
check("clock h:mm:ss", W.formatClock(3723000) === "1:02:03");
check("clock zero/neg", W.formatClock(-5) === "00:00");

let s = W.createSession(1000, 500);
check("elapsed runs", s.elapsed(61000) === 60000);
let r = s.stop(121000, 700);
check("stop result", r.ms === 120000 && r.steps === 200 && r.reason === "stopped");
check("stop idempotent", s.stop(999999, 9999) === r);
check("qualifies 100 spm", W.qualifies(r).ok);

check("under 60s rejected", !W.qualifies({ ms: 59999, steps: 100 }).ok);
check("idle clock rejected", !W.qualifies({ ms: 600000, steps: 100 }).ok);
check("30 spm ok", W.qualifies({ ms: 600000, steps: 300 }).ok);
check("tiny total rejected", !W.qualifies({ ms: 60000, steps: 29 }).ok);

s = W.createSession(0, 0);
s.hide(60000); check("paused on hide", s.isPaused() && s.elapsed(100000) === 60000);
check("show resumes", s.show(90000) === null && s.elapsed(120000) === 90000);
s.hide(120000); const h = s.show(120000 + W.MAX_HIDDEN_MS + 1);
check("long hide ends session at hide time", h && h.reason === "hidden" && h.ms === 90000);

s = W.createSession(0, 0);
check("no cap before 4h", s.tick(W.MAX_MS - 1, 10) === null);
const c = s.tick(W.MAX_MS + 5000, 20000);
check("4h cap ends", c && c.reason === "cap" && c.ms === W.MAX_MS);

const rec = W.buildRecord({ name: "  Zab ", xHandle: "zabbadat", uid: "u1", ms: 120000.4, steps: 200 });
check("record shape", rec.name === "Zab" && rec.xHandle === "@zabbadat" && rec.ms === 120000 && rec.steps === 200);
check("record valid", W.validateRecord(rec).ok);
check("no uid invalid", !W.validateRecord({ ...rec, uid: "" }).ok);
check("short invalid", !W.validateRecord({ ...rec, ms: 30000 }).ok);
check("steps cap", W.buildRecord({ uid: "u", ms: 70000, steps: 99999 }).steps === W.MAX_STEPS);

const rows = [{ name: "a", ms: 70000, steps: 1, at: 5 }, { name: "b", ms: 900000, steps: 1, at: 1 }, { name: "c", ms: 10, steps: 1, at: 9 }];
check("rank desc + filter", W.rankSessions(rows).map(x => x.name).join() === "b,a");
check("rank since", W.rankSessions(rows, 20, 4).map(x => x.name).join() === "a");

const fail = R.filter(x => !x).length;
console.log(`${R.length - fail}/${R.length} passed`);
if (fail) process.exit(1);
