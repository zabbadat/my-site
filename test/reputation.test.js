// Reputation: start 50, +2 clean confirmed match, -10 dispute resolved against you, -5 forfeit/abandon, clamp 0..100, tiers, exactly-once server settle, rules.
const Rp = require("../reputation.js"), W = require("../washers-battle.js"), H = require("./lib/washers-match.js"), fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("constants: start 50, +2, -10, -5, range 0..100", Rp.START === 50 && Rp.CLEAN === 2 && Rp.DISPUTE_LOST === -10 && Rp.FORFEIT === -5 && Rp.MIN === 0 && Rp.MAX === 100);
check("missing / junk reputation = new user at 50", Rp.normalize(undefined) === 50 && Rp.normalize(null) === 50 && Rp.normalize("80") === 50 && Rp.normalize(120) === 50 && Rp.normalize(-1) === 50 && Rp.normalize(0) === 0 && Rp.normalize(100) === 100);
check("tiers: <40 Shaky, 40-69 Steady, 70+ Trusted", Rp.tier(39).label === "Shaky" && Rp.tier(40).label === "Steady" && Rp.tier(69).label === "Steady" && Rp.tier(70).label === "Trusted" && Rp.tier(100).key === "trusted" && Rp.tier(undefined).label === "Steady");
check("label text", Rp.labelText(52) === "Steady 52" && Rp.labelText(10) === "Shaky 10");
check("apply clamps at 0 and 100", Rp.apply(99, 2) === 100 && Rp.apply(100, 2) === 100 && Rp.apply(4, -10) === 0 && Rp.apply(undefined, 2) === 52);
const won = () => H.round(H.round(H.bariboshi(H.room(), 10, 30), 1, [5, 5, 5], [0, 0, 0]), 2, [5, 5, 5], [0, 0, 0]);
let d = Rp.matchDeltas(won());
check("clean confirmed match: +2 each", d.a.delta === 2 && d.b.delta === 2 && d.a.events[0] === "clean");
check("undecided / waiting / abandoned / cancelled: no change (null)", Rp.matchDeltas(H.bariboshi(H.room(), 10, 30)) === null && Rp.matchDeltas({ status: "abandoned", players: {} }) === null && Rp.matchDeltas({ status: "waiting", players: { a: H.seat("A"), b: H.seat("B") } }) === null && Rp.matchDeltas(null) === null);
let r = H.bariboshi(H.room(), 10, 30); r.players.b.result = { forfeit: true, at: 1 }; d = Rp.matchDeltas(r);
check("forfeit: forfeiter -5, winner unchanged", d.b.delta === -5 && d.b.events[0] === "forfeit" && d.a.delta === 0);
r = H.bariboshi(H.room(), 10, 30); r.players.a.leftAt = 3; check("leaving mid-match = forfeit -5", Rp.matchDeltas(r).a.delta === -5);
r = H.bariboshi(H.room(), 10, 30); r.players.a.claimGone = true; check("silent 30 s: the silent player -5, the claimer 0", Rp.matchDeltas(r).b.delta === -5 && Rp.matchDeltas(r).a.delta === 0);
r = H.room(); r.players.a.result = { forfeit: true, at: 1 }; r.players.b.leftAt = 2; d = Rp.matchDeltas(r); check("both forfeit: -5 each", d.a.delta === -5 && d.b.delta === -5);
// dispute resolved against the reporter
r = H.bariboshi(H.room(), 10, 30); H.report(r, "a", 1, [5, 5, 5]); H.confirm(r, "b", 1, false); H.add(r, "a", { k: "x", n: 1, who: "a", pack: [2, 0, 0] }); H.report(r, "b", 1, [0, 0, 0]); H.confirm(r, "a", 1);
H.round(r, 2, [5, 5, 5], [0, 0, 0]); H.round(r, 3, [5, 5, 0], [0, 0, 0]); d = Rp.matchDeltas(r);
check("dispute resolved against the reporter: -10, no clean bonus; the other +2", W.decide(r).done && d.a.delta === -10 && d.a.events.join() === "dispute-lost" && d.b.delta === 2);
// ruling upholds the report: against the disputer
r = H.bariboshi(H.room(), 10, 30); H.report(r, "a", 1, [5, 5, 5]); H.confirm(r, "b", 1, false); H.add(r, "a", { k: "x", n: 1, who: "a", pack: [5, 5, 5] }); H.report(r, "b", 1, [0, 0, 0]); H.confirm(r, "a", 1);
H.round(r, 2, [5, 5, 5], [0, 0, 0]); d = Rp.matchDeltas(r);
check("ruling upholds the report: -10 to the disputer, reporter +2", d.b.delta === -10 && d.a.delta === 2);
r = H.bariboshi(H.room(), 10, 30); H.add(r, "a", { k: "b", n: 1, d: 5 }); r = H.bariboshi(H.room(), 10, 30);
let q = H.room(); H.add(q, "a", { k: "b", n: 1, d: 10 }); H.add(q, "b", { k: "b", n: 1, d: 30 }); H.add(q, "a", { k: "c", t: "b", n: 1, ok: false }); H.bariboshi(q, 10, 30, 2); H.round(q, 1, [5, 5, 5], [0, 0, 0]); H.round(q, 2, [5, 5, 5], [0, 0, 0]);
check("a disputed Bariboshi is just pitched again: no penalty", Rp.matchDeltas(q).a.delta === 2 && Rp.matchDeltas(q).b.delta === 2);
// ---- server settle: exactly once, name + reputation only ----
const db = {}, clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o))); const P = (p) => p.join("/");
const fs = { toMs: (v) => (typeof v === "number" ? v : null), ts: () => 777, tx: (fn) => { const w = []; return Promise.resolve(fn({ get: async (p) => clone(db[P(p)]), set: (p, x) => w.push(() => (db[P(p)] = clone(x))), update: (p, x) => w.push(() => (db[P(p)] = Object.assign({}, db[P(p)], clone(x)))) })).then((o) => { w.forEach((f) => f()); return o; }); } };
(async () => {
  const room = won(); room.players.a.name = "Ann"; room.players.b.name = "zed@mail.com"; room.players.a.email = "ann@mail.com"; db["washersBattles/K7QX"] = room;
  const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
  check("only players of the match can settle; bad code rejected", (await err(Rp.settle(fs, "zzz", "K7QX"))).status === 403 && (await err(Rp.settle(fs, "a", "k"))).status === 400 && (await err(Rp.settle(fs, "a", "AAAA"))).status === 404);
  let o = await Rp.settle(fs, "a", "K7QX");
  check("first settle: both start at 50 and go to 52", o.ok && db["repBoard/a"].rep === 52 && db["repBoard/b"].rep === 52 && o.deltas.a.before === 50);
  check("public mirror holds name + reputation only; an email-like name is stored as Player and no email field", db["repBoard/b"].name === "Player" && db["repBoard/a"].name === "Ann" && !JSON.stringify(db["repBoard/a"]).includes("@") && !("email" in db["repBoard/a"]) && db["repBoard/a"].clean === 1);
  o = await Rp.settle(fs, "b", "K7QX"); check("second settle (other phone): counted once", o.already === true && db["repBoard/a"].rep === 52);
  db["repBoard/a"].rep = 99; const key = Object.keys(db).find((k) => k.startsWith("repLog/")); delete db[key];
  o = await Rp.settle(fs, "a", "K7QX"); check("clamped at 100", db["repBoard/a"].rep === 100 && db["repBoard/a"].clean === 2);
  db["washersBattles/K7QX"] = H.bariboshi(H.room(), 10, 30); check("undecided match: pending, nothing written", (await Rp.settle(fs, "a", "K7QX")).pending === true);
  // ---- rules draft + wiring ----
  const rules = fsx.readFileSync(__dirname + "/../firestore.rules", "utf8"), blk = rules.slice(rules.indexOf("// Zabba reputation"), rules.indexOf("match /{document=**}"));
  check("rules: repBoard readable when signed in, never client-writable; repLog server-only", /match \/repBoard\/\{uid\} \{\s*allow read: if request\.auth != null;\s*allow write: if false;/.test(blk) && /match \/repLog\/\{key\} \{\s*allow read, write: if false;/.test(blk) && /release 2026-10-23/i.test(blk));
  check("rules: no users/{uid} field for reputation (owner cannot edit it)", !/reputation/.test(rules.slice(rules.indexOf("match /users/{uid}"), rules.indexOf("match /zabLedger"))));
  const fn = fsx.readFileSync(__dirname + "/../netlify/functions/rep-settle.js", "utf8");
  check("function: POST, bearer auth, admin SDK path, no ZAB moved", /uidFrom/.test(fn) && /POST only/.test(fn) && /wagerFs/.test(fn) && !/zabBalance/.test(fn));
  const html = fsx.readFileSync(__dirname + "/../index.html", "utf8");
  check("index: reputation.js loaded, repBoard watched, settle called when decided, never writes repBoard", html.includes('src="/reputation.js"') && /doc\(db, "repBoard", u\)/.test(html) && /rep-settle/.test(html) && !/setDoc\(doc\(db, "repBoard"/.test(html) && !/updateDoc\(doc\(db, "repBoard"/.test(html));
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
