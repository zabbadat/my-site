// Tests for plank-daily.js. Run: node test/plank-daily.test.js
const D = require("../plank-daily.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };

check("9.9s hold is not a set", !D.countsAsSet(9999) && D.addHold(D.empty("2026-10-21"), 9999).sets === 0);
check("10s hold is a set", D.countsAsSet(10000));
let d = D.addHold(D.empty("2026-10-21"), 25400); d = D.addHold(d, 12000); d = D.addHold(d, 3000);
check("sets/total/best accumulate", d.sets === 2 && d.totalSec === 37 && d.bestSec === 25);
let cap = { date: "x", sets: 100, totalSec: 14390, bestSec: 100 }; cap = D.addHold(cap, 60000);
check("caps hold", cap.sets === 100 && cap.totalSec === 14400 && cap.bestSec <= cap.totalSec);
const s = mem();
D.recordHold(s, 20000, "2026-10-20"); D.recordHold(s, 15000, "2026-10-21"); D.recordHold(s, 30000, "2026-10-21");
const t = D.getDay(s, "2026-10-21");
check("per-day storage", t.sets === 2 && t.totalSec === 45 && t.bestSec === 30 && D.getDay(s, "2026-10-20").sets === 1);
check("lastDays newest first", D.lastDays(s, 7).map((x) => x.date).join() === "2026-10-21,2026-10-20");
check("bad storage is empty", D.readDays({ getItem: () => "{oops" }).length === 0);
const rows = [
  { date: "2026-10-21", name: "a", sets: 3, totalSec: 60 }, { date: "2026-10-21", name: "b", sets: 3, totalSec: 90 },
  { date: "2026-10-21", name: "c", sets: 5, totalSec: 50 }, { date: "2026-10-20", name: "old", sets: 9, totalSec: 999 },
  { date: "2026-10-21", name: "zero", sets: 0, totalSec: 0 }];
check("rank: today only, sets then time", D.rankDaily(rows, "2026-10-21").map((r) => r.name).join() === "c,b,a");
check("localDateKey format", /^\d{4}-\d{2}-\d{2}$/.test(D.localDateKey(new Date(2026, 0, 5))) && D.localDateKey(new Date(2026, 0, 5)) === "2026-01-05");
const rec = D.buildRecord({ name: "Z", xHandle: "zab", uid: "u1", date: "2026-10-21", sets: 2, totalSec: 45, bestSec: 30, sessionStartedAt: 1e12 });
check("record valid + camera source", rec.source === "camera" && rec.xHandle === "@zab" && D.validateRecord(rec, "u1_2026-10-21").ok);
check("wrong doc id rejected", !D.validateRecord(rec, "u2_2026-10-21").ok);
check("best > total rejected", !D.validateRecord({ ...rec, bestSec: 50 }, "u1_2026-10-21").ok);
check("too many sets rejected", !D.validateRecord({ ...rec, sets: 101 }, "u1_2026-10-21").ok);
check("non-camera source rejected", !D.validateRecord({ ...rec, source: "manual" }, "u1_2026-10-21").ok);

const failed = R.filter((x) => !x).length;
console.log(`\n${R.length - failed}/${R.length} passed`);
if (failed) process.exit(1);
