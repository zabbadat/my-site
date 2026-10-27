// Zabba Washer Battlers board: season label, ranking + tie-breaks, table html, and the server tally (1v1 and 2v2), exactly once.
const B = require("../washers-battlers.js"), W = require("../washers-battle.js"), HR = require("./lib/washers-match.js"), HA = require("./lib/arena-match.js"), fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
// ---- season label (Eastern calendar quarter) ----
const E = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi || 0); // UTC instant
check("label: Oct-Dec = Q4, 'Season Q4 2026'", B.seasonLabel(E(2026, 10, 27, 16)) === "Season Q4 2026" && B.titleFor(E(2026, 10, 27, 16)) === "Zabba Washer Battlers, Season Q4 2026");
check("quarters: Jan Q1, Apr Q2, Jul Q3, Oct Q4", [[1, 15], [2, 15], [3, 15], [4, 15], [6, 15], [7, 15], [9, 15], [10, 15], [12, 15]].map(([m, d]) => B.seasonOf(E(2026, m, d, 16)).q).join() === "1,1,1,2,2,3,3,4,4");
check("boundaries use Eastern time: Mar 31 23:59 ET is still Q1, Apr 1 00:00 ET is Q2; New Year in Eastern", B.seasonOf(E(2026, 4, 1, 3, 59)).label === "Season Q1 2026" && B.seasonOf(E(2026, 4, 1, 4, 0)).label === "Season Q2 2026" && B.seasonOf(E(2027, 1, 1, 4, 59)).label === "Season Q4 2026" && B.seasonOf(E(2027, 1, 1, 5, 0)).label === "Season Q1 2027");
check("season id and reset text", B.seasonOf(E(2026, 11, 2, 12)).id === "2026-Q4" && B.seasonResetText(E(2026, 11, 2, 12)) === "Resets Jan 1" && B.seasonResetText(E(2026, 2, 2, 12)) === "Resets Apr 1");
check("lead line, columns text and empty state are the locked wording", B.LEAD === "This season's wins and losses, and each player's ZAB. Most wins first. Scroll to find your rank. Names only." && B.EMPTY === "Waiting for battles…" && B.PAGE === 50 && B.VISIBLE_ROWS === 10);
// ---- ranking ----
const P = (uid, wins, losses, battles, reachedAt, extra) => Object.assign({ uid, name: uid, wins, losses, battles, reachedAt }, extra);
const rows = [P("c", 3, 1, 4, 500), P("a", 5, 5, 10, 900), P("b", 5, 2, 7, 800), P("d", 5, 2, 9, 800), P("e", 5, 2, 9, 700), P("f", 0, 0, 0, 100), P("g", 5, 2, 9, 700)];
check("most wins first; then fewer losses; then more battles; then reached it first; then uid", B.ranked(rows).map((r) => r.uid).join() === "e,g,d,b,a,c,f");
check("rankOf and exact rank from a count of those ahead", B.rankOf(rows, "d") === 3 && B.rankOf(rows, "zz") === 0 && B.rankFromAhead(0) === 1 && B.rankFromAhead(36) === 37 && B.rankFromAhead(-1) === 0 && B.rankFromAhead(null) === 0);
check("sortKey: more wins > fewer losses > more battles > reached earlier", B.sortKey("2026-Q4", P("x", 2, 0, 2, 5)) > B.sortKey("2026-Q4", P("y", 1, 0, 1, 5)) && B.sortKey("2026-Q4", P("x", 2, 1, 3, 5)) < B.sortKey("2026-Q4", P("y", 2, 0, 2, 5)) && B.sortKey("2026-Q4", P("x", 2, 0, 3, 5)) > B.sortKey("2026-Q4", P("y", 2, 0, 2, 5)) && B.sortKey("2026-Q4", P("x", 2, 0, 2, 100)) > B.sortKey("2026-Q4", P("y", 2, 0, 2, 200)));
{ const ks = rows.slice().sort(B.compare).map((r) => B.sortKey("2026-Q4", r)); check("sortKey order matches the comparator for every row (so the page needs no composite index)", ks.every((k, i) => i === 0 || k <= ks[i - 1])); }
{ const r = B.seasonRange("2026-Q4"); check("season range keeps other seasons out", r.lo === "2026-Q4|" && B.sortKey("2026-Q4", P("x", 1, 0, 1, 5)) >= r.lo && B.sortKey("2026-Q4", P("x", 1, 0, 1, 5)) < r.hi && B.sortKey("2027-Q1", P("x", 1, 0, 1, 5)) >= r.hi && B.sortKey("2026-Q3", P("x", 99, 0, 99, 1)) < r.lo); }
check("pinned line wording", B.youLine(37, P("me", 4, 6, 10, 1), 120) === "You: #37, 4 wins, 6 losses, 120 ZAB" && B.youLine(1, P("me", 1, 1, 2, 1), null) === "You: #1, 1 win, 1 loss" && /no battles/.test(B.youLine(0, null, 5)));
// ---- table html ----
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])), amountHtml = (n) => "<z>" + n + " ZAB</z>", o = { esc, amountHtml };
let h = B.bodyHtml(rows.slice(0, 3), "b", { b: 40, c: 7 }, o);
check("signed in: rank, name, wins, losses, ZAB; my row highlighted + marked; others' ZAB when known, dash when not", /<td>1<\/td><td>b \(you\)<\/td>/.test(h) && /class="bb-me" data-me="1"/.test(h) && /<td>b \(you\)<\/td><td>5<\/td><td>2<\/td><td><z>40 ZAB<\/z><\/td>/.test(h) && /<td>c<\/td><td>3<\/td><td>1<\/td><td><z>7 ZAB<\/z><\/td>/.test(h) && /<td>a<\/td><td>5<\/td><td>5<\/td><td>—<\/td>/.test(h) && (h.match(/data-me/g) || []).length === 1);
h = B.bodyHtml(rows.slice(0, 3), null, { b: 40 }, o);
check("signed out: names, wins and losses visible, ZAB shows dashes, no highlight", /<td>a<\/td><td>5<\/td><td>5<\/td><td>—<\/td>/.test(h) && !/ZAB/.test(h) && !/data-me/.test(h) && !/\(you\)/.test(h));
check("names are escaped and an email-looking name is never printed", !/<script/.test(B.bodyHtml([P("x", 1, 0, 1, 1, { name: "<script>x</script>" })], null, {}, o)) && /<td>Player<\/td>/.test(B.bodyHtml([P("x", 1, 0, 1, 1, { name: "zed@mail.com" })], null, {}, o)) && !/@/.test(B.bodyHtml([P("x", 1, 0, 1, 1, { name: "zed@mail.com" })], null, {}, o)));
check("empty state", /Waiting for battles…/.test(B.bodyHtml([], "a", {}, o)) && /colspan="5"/.test(B.bodyHtml([], null, {}, o)));
// ---- server settle over a fake admin db ----
const db = {}, clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x))), K = (p) => p.join("/");
const fs = { toMs: (v) => (typeof v === "number" ? v : null), ts: () => 777, tx: (fn) => { const w = []; return Promise.resolve(fn({ get: async (p) => clone(db[K(p)]), set: (p, x) => w.push(() => (db[K(p)] = clone(x))), update: (p, x) => w.push(() => (db[K(p)] = Object.assign({}, db[K(p)], clone(x)))) })).then((out) => { w.forEach((f) => f()); return out; }); } };
const NOW = E(2026, 10, 27, 16), START = E(2026, 10, 27, 15);
const won = () => HR.round(HR.round(HR.bariboshi(HR.room({ startAt: START, createdAt: 500 }), 10, 30), 1, [5, 5, 5], [0, 0, 0]), 2, [5, 5, 5], [0, 0, 0]);
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
(async () => {
  const room = won(); room.players.a.name = "Ann"; room.players.a.email = "ann@mail.com"; room.players.b.name = "zed@mail.com"; db["washersBattles/K7QX"] = room;
  check("only a player of the match can ask; bad code / missing room rejected", (await err(B.settle(fs, "zzz", "K7QX", NOW))).status === 403 && (await err(B.settle(fs, "a", "k", NOW))).status === 400 && (await err(B.settle(fs, "a", "AAAA", NOW))).status === 404 && (await err(B.settle(fs, "a", "K7QX", NOW, "arena"))).status === 404);
  let out = await B.settle(fs, "a", "K7QX", NOW);
  const sw = db["washersBattleSeason/2026-Q4_a"], sl = db["washersBattleSeason/2026-Q4_b"];
  check("1v1 finished: winner +1 win, loser +1 loss in the current season, each 1 battle", out.ok && out.recorded && sw.wins === 1 && sw.losses === 0 && sw.battles === 1 && sl.wins === 0 && sl.losses === 1 && sl.battles === 1 && sw.season === "2026-Q4" && sw.sortKey === B.sortKey("2026-Q4", sw));
  check("public season docs carry a name + counts only: never an email, never other fields", sw.name === "Ann" && sl.name === "Player" && !JSON.stringify([sw, sl]).includes("@") && Object.keys(sw).sort().join() === "battles,losses,name,reachedAt,season,sortKey,uid,updatedAt,wins");
  const lw = db["washersBattleLifetime/a"];
  check("hidden lifetime tally written for both (wins/losses/battles/firstAt/lastAt/lastSeason), no name", lw.wins === 1 && lw.battles === 1 && lw.firstAt === START && lw.lastAt === START && lw.lastSeason === "2026-Q4" && !("name" in lw) && db["washersBattleLifetime/b"].losses === 1);
  check("guard doc washersBattleLog/{code}_{createdAtMs} written", !!db["washersBattleLog/K7QX_500"] && db["washersBattleLog/K7QX_500"].outcome === "win");
  out = await B.settle(fs, "b", "K7QX", NOW + 5000); check("second phone asking: already counted, nothing changes (idempotent)", out.already === true && db["washersBattleSeason/2026-Q4_a"].wins === 1 && db["washersBattleLifetime/a"].battles === 1);
  // a second match for the same players, new createdAt
  const r2 = HR.round(HR.round(HR.bariboshi(HR.room({ startAt: START + 60000, createdAt: 900 }), 30, 10), 1, [0, 0, 0], [5, 5, 5]), 2, [0, 0, 0], [5, 5, 5]); r2.players.a.name = "Ann"; r2.players.b.name = "Bo"; db["washersBattles/M3PA"] = r2;
  await B.settle(fs, "b", "M3PA", NOW);
  check("records accumulate; reachedAt moves only when the win count goes up", db["washersBattleSeason/2026-Q4_a"].wins === 1 && db["washersBattleSeason/2026-Q4_a"].losses === 1 && db["washersBattleSeason/2026-Q4_a"].reachedAt === START && db["washersBattleSeason/2026-Q4_b"].wins === 1 && db["washersBattleSeason/2026-Q4_b"].reachedAt === START + 60000 && db["washersBattleLifetime/a"].battles === 2 && db["washersBattleSeason/2026-Q4_b"].name === "Bo");
  // forfeit / left / tie / both leave / undecided
  const f1 = HR.bariboshi(HR.room({ startAt: START, createdAt: 1100 }), 10, 30); f1.players.b.result = { forfeit: true, at: 1 }; db["washersBattles/F4RF"] = f1;
  out = await B.settle(fs, "a", "F4RF", NOW); check("forfeit = loss for the leaver and win for the other", out.recorded && out.winners.join() === "a" && out.losers.join() === "b" && db["washersBattleSeason/2026-Q4_a"].wins === 2);
  const bl = HR.room({ startAt: START, createdAt: 1200 }); bl.players.a.result = { forfeit: true, at: 1 }; bl.players.b.leftAt = 2; 
  const before = JSON.stringify(Object.keys(db).filter((k) => k.startsWith("washersBattleSeason")).map((k) => db[k]));
  db["washersBattles/BATH"] = bl; out = await B.settle(fs, "a", "BATH", NOW);
  check("both leave: nothing recorded on the board (guard only)", out.ok && out.recorded === false && JSON.stringify(Object.keys(db).filter((k) => k.startsWith("washersBattleSeason")).map((k) => db[k])) === before && db["washersBattleLog/BATH_1200"].outcome === "none");
  const tie = HR.bariboshi(HR.room({ startAt: START, createdAt: 1300 }), 10, 30); for (let n = 1; n <= 30; n++) HR.round(tie, n, [0, 0, 0], [0, 0, 0]); db["washersBattles/TAED"] = tie; out = await B.settle(fs, "a", "TAED", NOW);
  check("a tie records nothing", out.recorded === false && out.reason === "tie");
  db["washersBattles/UNDC"] = HR.bariboshi(HR.room({ createdAt: 1400 }), 10, 30); out = await B.settle(fs, "a", "UNDC", NOW); check("undecided match: pending, nothing written", out.pending === true && !db["washersBattleLog/UNDC_1400"]);
  // ---- 2v2 ----
  const ar = HA.bariboshi(HA.arena({ startAt: START, createdAt: 2000 }), [10, 40, 30, 50]); HA.round(ar, 1, [[5, 5, 5], [5, 0, 0], [0, 0, 0], [2, 0, 0]]); HA.round(ar, 2, [[5, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  ar.seats.a1.pubName = "Annie"; ar.seats.b2.name = "q@mail.com"; db["washersArenas/A2V2"] = ar;
  check("2v2: only a seated player can ask; the arena is looked up as kind=arena", (await err(B.settle(fs, "zzz", "A2V2", NOW, "arena"))).status === 403 && (await err(B.settle(fs, "a1", "A2V2", NOW))).status === 404);
  out = await B.settle(fs, "b2", "A2V2", NOW, "arena");
  const s = (u) => db["washersBattleSeason/2026-Q4_" + u];
  check("2v2 finished: every member of the winning team +1 win, every member of the losing team +1 loss", out.recorded && s("a1").wins === 1 && s("a2").wins === 1 && s("b1").losses === 1 && s("b2").losses === 1 && s("a1").losses === 0 && ["a1", "a2", "b1", "b2"].every((u) => s(u).battles === 1));
  check("2v2: the saved pubName is used, an email-looking name is stored as Player, hidden lifetime written for all four", s("a1").name === "Annie" && s("b2").name === "Player" && ["a1", "a2", "b1", "b2"].every((u) => db["washersBattleLifetime/" + u].battles >= 1) && !JSON.stringify(Object.keys(db).filter((k) => /^washersBattle(Season|Lifetime|Log)/.test(k)).map((k) => db[k])).includes("@"));
  check("2v2: guard arena_{code}_{createdAtMs}; a second ask counts nothing", !!db["washersBattleLog/arena_A2V2_2000"] && (await B.settle(fs, "a2", "A2V2", NOW, "arena")).already === true && s("a1").wins === 1);
  const af = HA.bariboshi(HA.arena({ startAt: START, createdAt: 2100 }), [10, 40, 30, 50]); af.seats.b1.leftAt = 3; af.seats.b2.result = { forfeit: true, at: 3 }; db["washersArenas/AFF2"] = af;
  out = await B.settle(fs, "a1", "AFF2", NOW, "arena"); check("2v2: a forfeited team = a loss for its players, a win for the other team", out.recorded && s("a1").wins === 2 && s("b1").losses === 2 && s("b2").losses === 2);
  const au = HA.bariboshi(HA.arena({ createdAt: 2200 }), [10, 40, 30, 50]); db["washersArenas/AUND"] = au; check("2v2 undecided: pending", (await B.settle(fs, "a1", "AUND", NOW, "arena")).pending === true);
  const ab = HA.bariboshi(HA.arena({ startAt: START, createdAt: 2300 }), [10, 40, 30, 50]); ["a1", "a2", "b1", "b2"].forEach((u) => { ab.seats[u].leftAt = 2; }); db["washersArenas/ABTH"] = ab;
  out = await B.settle(fs, "a1", "ABTH", NOW, "arena"); check("2v2 everyone out: nothing recorded", out.recorded === false && s("a1").wins === 2);
  // ---- files / wiring ----
  const fn = fsx.readFileSync(__dirname + "/../netlify/functions/battle-stats.js", "utf8");
  check("function: POST only, bearer auth, admin SDK adapter, passes the kind, moves no ZAB", /POST only/.test(fn) && /uidFrom/.test(fn) && /wagerFs/.test(fn) && /body\.kind/.test(fn) && /FIREBASE_SERVICE_ACCOUNT/.test(fn) && !/zabBalance|zabLedger/.test(fn));
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
