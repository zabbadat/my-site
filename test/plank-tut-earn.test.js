// 80 s regular plank TUT: shows and speaks "plank TUT executed", 1 ZAB once per set via source plankTut,
// stacks on the 60 s plank pay, counts as a TUT set of kind plank. Run: node test/plank-tut-earn.test.js
const fsx = require("fs"), path = require("path");
const E = require("../zab-earn.js"), Z = require("../zab-balance.js");
const S = require("../push-session.js");
const D = require("../lifetime-dash.js");
const G = require("../get-set.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const read = (f) => fsx.readFileSync(path.join(__dirname, "..", f), "utf8");
function fakeFs(T) {
  const db = {};
  return { db, ts: () => T, toMs: (v) => (typeof v === "number" ? v : null),
    tx: async (fn) => { const w = []; const t = { get: async (p) => (db[p.join("/")] ? JSON.parse(JSON.stringify(db[p.join("/")])) : null),
      set: (p, d) => w.push([p.join("/"), d, false]), update: (p, d) => w.push([p.join("/"), d, true]) };
      const out = await fn(t); w.forEach(([k, d, u]) => { db[k] = u ? Object.assign({}, db[k], d) : d; }); return out; } };
}
const NOW = Date.parse("2026-11-14T15:00:00Z"), SINCE = NOW - 3600000;
const st = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, status: e.status, msg: e.message }));
const plankDoc = (id, holdSec) => ({ uid: "u1", holdSec, source: "camera", createdAt: NOW - 1000 });

(async () => {
  check("rate: 80 s plank TUT pays 1 ZAB", Z.zabFor("plankTut", 80) === 1 && Z.RATES.plankTut.per === 80 && Z.RATES.plankTut.max === 80);
  check("79 s plank TUT pays 0", Z.zabFor("plankTut", 79) === 0);
  check("200 s plank TUT still 1", Z.zabFor("plankTut", 200) === 1);
  check("60 s plank rate is unchanged", Z.zabFor("plank", 60) === 1 && Z.zabFor("plank", 200) === 1);
  let threw = false; try { E.measure("plankTut", plankDoc("a", 79), "u1", NOW); } catch (e) { threw = e.status === 422; }
  check("measure: 79 s cannot earn plankTut", threw);
  check("measure: 80 s and 200 s pay 1 ZAB once",
    E.measure("plankTut", plankDoc("b", 80), "u1", NOW).amount === 1
    && E.measure("plankTut", plankDoc("c", 200), "u1", NOW).amount === 1
    && E.measure("plankTut", plankDoc("c", 200), "u1", NOW).qty === 80);
  check("60 s plank measure is unchanged at 1 ZAB", E.measure("plank", plankDoc("b", 80), "u1", NOW).amount === 1);

  const f = fakeFs(NOW);
  f.db["users/u1"] = { uid: "u1", zabBalance: 0, lastTxId: "" };
  f.db["planks/short"] = plankDoc("short", 79);
  f.db["planks/tut"] = plankDoc("tut", 80);
  f.db["planks/long"] = plankDoc("long", 200);
  let r = await st(E.claim(f, "u1", { source: "plankTut", id: "short" }, NOW, SINCE));
  check("claim 79 s plankTut is rejected", !r.ok && r.status === 422 && f.db["users/u1"].zabBalance === 0);
  r = await st(E.claim(f, "u1", { source: "plank", id: "tut" }, NOW, SINCE));
  check("80 s set still pays the 60 s plank 1 ZAB", r.ok && r.r.credited === 1 && f.db["users/u1"].zabBalance === 1);
  r = await st(E.claim(f, "u1", { source: "plankTut", id: "tut" }, NOW, SINCE));
  check("80 s set also pays 1 ZAB as plankTut (stacks)", r.ok && r.r.credited === 1 && f.db["users/u1"].zabBalance === 2
    && f.db["users/u1/zabLedger/plankTut-pltut"] && f.db["users/u1/zabLedger/plankTut-pltut"].source === "plankTut"
    && f.db["users/u1/zabLedger/plankTut-pltut"].amount === 1);
  r = await st(E.claim(f, "u1", { source: "plankTut", id: "tut" }, NOW, SINCE));
  check("plankTut is once per set (409)", !r.ok && r.status === 409 && f.db["users/u1"].zabBalance === 2);
  r = await st(E.claim(f, "u1", { source: "plank", id: "long" }, NOW, SINCE));
  const before = f.db["users/u1"].zabBalance;
  r = await st(E.claim(f, "u1", { source: "plankTut", id: "long" }, NOW, SINCE));
  check("a longer hold still pays only 1 plankTut ZAB on top of the 60 s plank", r.ok && r.r.credited === 1 && f.db["users/u1"].zabBalance === before + 1);

  const cap = fakeFs(NOW);
  cap.db["users/u1"] = { uid: "u1", zabBalance: 0, lastTxId: "" };
  for (let i = 0; i < 31; i++) cap.db["planks/c" + i] = plankDoc("c" + i, 80);
  let credited = 0;
  for (let i = 0; i < 31; i++) {
    const x = await st(E.claim(cap, "u1", { source: "plankTut", id: "c" + i }, NOW, SINCE));
    if (x.ok) credited += x.r.credited;
  }
  check("daily cap for plankTut is 30 ZAB", credited === 30 && E.DAY_CAP.plankTut === 30 && E.DAY_CAP.plank === 30);

  check("claimEarn accepts plankTut", Z.CLAIM_SOURCES && Z.CLAIM_SOURCES.indexOf("plankTut") >= 0
    || /"plankTut"/.test(read("zab-balance.js")));
  check("other earn rules are untouched",
    Z.zabFor("hold", 1) === 0.5 && Z.zabFor("tut", 80) === 1 && Z.zabFor("steps10k", 10000) === 4
    && E.DAY_CAP.pushups === 50 && E.DAY_CAP.tut === 30 && E.DAY_CAP.hold === 10);

  check("isPlankTutDoc: 80 s counts, 79 s does not",
    S.isPlankTutDoc({ kind: "plank", holdSec: 80, ms: 80000 })
    && S.isPlankTutDoc({ kind: "plank", holdSec: 200, ms: 200000 })
    && !S.isPlankTutDoc({ kind: "plank", holdSec: 79, ms: 79000 })
    && !S.isPlankTutDoc({ tutMs: 80000, reps: 10, ms: 80000 }));
  const mixed = [
    { uid: "a", name: "Ann", ms: 90000, reps: 12, tutMs: 90000, at: 2 },
    { uid: "a", name: "Ann", kind: "plank", holdSec: 90, ms: 90000, at: 3 },
    { uid: "a", name: "Ann", kind: "plank", holdSec: 70, ms: 70000, at: 1 }
  ];
  const all = S.tutAllTime(mixed);
  check("all-time board counts a plank TUT as a set and marks it", all.length === 1 && all[0].sets === 2 && all[0].plank === 1);
  const stats = S.tutBoardStats(mixed, (r) => "d1", "d1");
  check("drop-your-tuts stats add · N plank", stats[0].today === 12 && stats[0].allTime === 12 && stats[0].plankToday === 1 && stats[0].plankAll === 1
    && S.plankMark(1).indexOf("1 plank") >= 0);

  check("dashboard helpers count plank TUT at 80 s", D.isPlankTut({ ms: 80000 }) && !D.isPlankTut({ ms: 79999 }) && D.plankTutSets([{ uid: "a", ms: 80000 }, { uid: "a", ms: 70000 }], "a") === 1);

  const html = read("index.html"), rules = read("firestore.rules");
  const rules0 = fsx.readFileSync("/workspace/zabbadat-work/bundle-hide-hold/firestore.rules", "utf8");
  check("no firestore.rules change in this feature (file still has signed-in planks read, no new write)",
    /match \/planks\/\{id\} \{\s*allow read: if signedIn\(\);/.test(rules) && rules === rules0);
  check("page shows and speaks 'plank TUT executed' on the plank voice queue at 80 s",
    /PLANK_TUT_LINE/.test(html) && /speakPlankTutOnce/.test(html) && /r\.ms >= 80000\) speakPlankTutOnce\(\)/.test(html)
    && G.PLANK_TUT_EXECUTED_LINE === "plank TUT executed" && typeof G.speakPlankTutExecuted === "function");
  check("page claims plankTut through existing claimEarn after the plank is saved",
    /awardZab\("plankTut", id\)/.test(html) && /awardZab\("plank", id\)/.test(html));
  check("boards query planks where holdSec >= 80", /where\("holdSec", ">=", 80\)/.test(html));
  check("board copy names the 80-second regular plank TUT and marks planks",
    /or an 80-second regular plank/.test(html) && /Plank TUTs are marked as plank/.test(html));
  check("ninth earn-rate line", Z.rateLines()[2] === "1 ZAB for an 80-second plank TUT" && Z.rateLines().length === 9);
  check("no new client Firestore writes for this earn (still only saveRemotePlank to planks)",
    (html.match(/addDoc\(collection\(db, "planks"/g) || []).length === 1);

  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
