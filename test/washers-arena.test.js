// Zabba Washer Arena (2v2 teams): seat map, balanced seating, team naming, team scoring / confirm / dispute / forfeit rules, lobby controller.
const AR = require("../washers-arena.js"), W = require("../washers-battle.js"), H = require("./lib/arena-match.js"), mockFs = require("./lib/mockfs.js"), WH = require("./lib/washers-match.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
// ---- seat map, sizes, free slots ----
check("sizes: only 2 or 4", AR.isValidSize(2) && AR.isValidSize(4) && !AR.isValidSize(3) && !AR.isValidSize(1) && !AR.isValidSize(8) && !AR.isValidSize("4") && !AR.isValidSize(null));
check("fixed seat map: size 4 = slots 0,1 Team A and 2,3 Team B; size 2 = one each; out of range = none", [0, 1, 2, 3].map((s) => AR.teamOfSlot(s, 4)).join() === "a,a,b,b" && AR.teamOfSlot(0, 2) === "a" && AR.teamOfSlot(1, 2) === "b" && AR.teamOfSlot(4, 4) === null && AR.teamOfSlot(-1, 4) === null && AR.teamOfSlot(0, 3) === null);
let a = { size: 4, status: "waiting", slots: {}, seats: {} };
const sit = (x, uid, slot) => { x.seats[uid] = H.seat(uid, slot, x.size, { ready: false }); x.slots[String(slot)] = uid; };
check("first joiner with no pick: Team A slot 0", AR.freeSlot(a) === 0);
sit(a, "u0", 0); check("balance: the next joiner goes to the team with fewer players (Team B)", AR.freeSlot(a) === 2);
sit(a, "u2", 2); check("then Team A again", AR.freeSlot(a) === 1);
check("a wanted team is honoured while it has room", AR.freeSlot(a, "b") === 3 && AR.freeSlot(a, "a") === 1);
sit(a, "u1", 1); check("wanted team full: falls to the other team", AR.freeSlot(a, "a") === 3);
sit(a, "u3", 3); check("full arena: no slot", AR.freeSlot(a) === -1);
check("join errors: missing, full, started, expired; own seat rejoins", /No arena/.test(AR.joinError(null, "z", 0, 0)) && /full/.test(AR.joinError(a, "z", 0, 0)) && AR.joinError(a, "u1", 0, 0) === "" && /started/.test(AR.joinError({ ...a, seats: {}, slots: {}, status: "live" }, "z", 0, 0)) && /expired/.test(AR.joinError({ size: 4, status: "waiting", slots: {}, seats: {} }, "z", 31 * 60000, 0)));
check("ordered seats follow the slot number; team lists", AR.orderedSeats(a).map((s) => s.uid).join() === "u0,u1,u2,u3" && AR.teamSeats(a, "a").join() === "u0,u1" && AR.teamSeats(a, "b").join() === "u2,u3");
check("full / all ready", AR.full(a) && !AR.allReady(a) && AR.allReady(H.arena({ status: "waiting" })));
// ---- team names ----
check("team name defaults Team A / Team B", AR.teamName({}, "a") === "Team A" && AR.teamName({ teamNames: {} }, "b") === "Team B" && AR.teamName(null, "a") === "Team A");
check("team name sanitise: trim, 20 chars, tags and control chars stripped, odd symbols dropped, spaces collapsed", AR.sanitizeTeamName("  Team   Rocket ") === "Team Rocket" && AR.sanitizeTeamName("<b>Hi</b><script>x</script>") === "Hix" && AR.sanitizeTeamName("A\u0000B\u0007C") === "ABC" && AR.sanitizeTeamName("x".repeat(40)).length === 20 && AR.sanitizeTeamName("Wolves! & co., it's-ok_1") === "Wolves! & co., it's-" && AR.sanitizeTeamName("a@b.com") === "ab.com" && AR.sanitizeTeamName(null) === "" && AR.sanitizeTeamName("{}[]$%^") === "");
check("teamName shows the sanitised stored name, never raw HTML", AR.teamName({ teamNames: { a: "<i>Rocket</i>" } }, "a") === "Rocket" && AR.teamName({ teamNames: { a: "<>" } }, "a") === "Team A");
// ---- match rules ----
let m = H.bariboshi(H.arena(), [10, 40, 30, 50]), an = AR.analyze(m);
check("opening: the team with the closest washer goes first; that player is the ruler", an.valid && an.order.join() === "a,b" && an.ruler === "a1" && an.bari.winner === "a" && an.current.kind === "r" && an.current.n === 1);
m = H.bariboshi(H.arena(), [40, 50, 30, 20]); an = AR.analyze(m);
check("opening: the other team can win it (teammate's washer counts)", an.order.join() === "b,a" && an.ruler === "b2");
m = H.arena(); H.add(m, "a1", { k: "b", n: 1, d: 5 }); an = AR.analyze(m);
check("opening: waits for every active player to report; actions list who still must pitch", an.current.stage === "report" && an.actions.a1.length === 0 && ["a2", "b1", "b2"].every((u) => an.actions[u].some((x) => x.type === "b")) && an.order === null);
m = H.arena(); [["a1", 5], ["a2", 9], ["b1", 7], ["b2", 8]].forEach(([u, d]) => H.add(m, u, { k: "b", n: 1, d })); an = AR.analyze(m);
check("opening: each report waits for ONE player of the other team to confirm", an.current.stage === "confirm" && an.pending.length === 4 && an.actions.b1.some((x) => x.type === "c" && x.who === "a1" && x.t === "b") && an.actions.a1.some((x) => x.type === "c" && x.who === "b2") && !an.actions.a1.some((x) => x.who === "a2"));
m = H.bariboshi(H.arena(), [10, 10, 10, 10]); an = AR.analyze(m);
check("opening: level = pitch again (attempt 2 open)", an.order === null && an.current.n === 2 && an.bari.attempts[0].result === "again");
m = H.arena(); H.bariboshi(m, [10, 40, 30, 50], 1, false); an = AR.analyze(m);
check("opening: a dispute = pitch again", an.disputes >= 1 && an.current.kind === "b" && an.current.n === 2);
m = H.arena(); [1, 2, 3, 4, 5, 6, 7, 8].forEach((n) => H.bariboshi(m, [10, 10, 10, 10], n)); an = AR.analyze(m);
check("opening: never settled after 8 tries -> seat order (Team A first, first seat rules)", an.bari.fallback && an.order.join() === "a,b" && an.ruler === "a1");
// rounds
m = H.bariboshi(H.arena(), [10, 40, 30, 50]); H.round(m, 1, [[5, 5, 5], [5, 0, 0], [0, 0, 0], [2, 0, 0]]); an = AR.analyze(m);
check("team score = both teammates' packs; per-player contribution kept", an.totals.a === 20 && an.totals.b === 2 && an.contrib.a1 === 15 && an.contrib.a2 === 5 && an.contrib.b1 === 0 && an.contrib.b2 === 2 && an.rounds.length === 1 && an.current.n === 2 && !an.done);
H.round(m, 2, [[5, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
let d = AR.decide(m);
check("first team to 21 wins; winners/losers are the two members of each team", d.done && d.winner === "a" && d.reason === "score" && d.winners.join() === "a1,a2" && d.losers.join() === "b1,b2");
check("result text for each side + a non-member", /Your team wins 25 to 2/.test(AR.resultText(m, "a2")) && /Your team loses 2 to 25/.test(AR.resultText(m, "b1")) && /Team A wins/.test(AR.resultText(m, "zz")));
m = H.bariboshi(H.arena(), [10, 40, 30, 50]); H.round(m, 1, [[5, 5, 5], [5, 5, 0], [5, 5, 5], [5, 5, 5]]); d = AR.decide(m);
check("both teams over 21 in one round: the higher total wins", AR.analyze(m).totals.a === 25 && AR.analyze(m).totals.b === 30 && d.winner === "b");
m = H.bariboshi(H.arena(), [10, 40, 30, 50]); H.round(m, 1, [[5, 5, 5], [5, 5, 0], [5, 5, 5], [5, 5, 0]]); an = AR.analyze(m);
check("level at 25+ = overtime round, no winner yet", an.overtime && !an.done && an.current.n === 2 && AR.matchState(m, 2000, (v) => v) === "live");
m = H.bariboshi(H.arena(), [10, 40, 30, 50]); for (let n = 1; n <= 30; n++) H.round(m, n, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]); d = AR.decide(m);
check("30 rounds level = tie, no winner", d.done && d.winner === null && d.reason === "tie" && d.winners.length === 0);
// verification: any ONE opposing player; dispute wins; ruling by the Bariboshi winner
m = H.bariboshi(H.arena(), [10, 40, 30, 50]); [["a1", [5, 5, 5]], ["a2", [0, 0, 0]], ["b1", [2, 0, 0]], ["b2", [0, 0, 0]]].forEach(([u, p]) => H.report(m, u, 1, p));
H.confirm(m, "b2", 1, "a1"); H.confirm(m, "b1", 1, "a2"); H.confirm(m, "a2", 1, "b1"); an = AR.analyze(m);
check("the second opposing player is not needed once one confirmed; the last pack still waits", an.pending.length === 1 && an.pending[0].who === "b2" && !an.actions.b1.length && an.actions.a1.some((x) => x.who === "b2") && an.actions.a2.some((x) => x.who === "b2"));
check("a player cannot confirm a teammate: not offered, and the write is refused", !an.actions.a2.some((x) => x.who === "a1") && !AR.allowed(m, "a2", { k: "c", t: "r", n: 1, who: "a1", ok: true }) && !AR.allowed(m, "b1", { k: "c", t: "r", n: 1, who: "b2", ok: true }));
H.confirm(m, "a1", 1, "b2"); H.confirm(m, "b1", 1, "a1", false); an = AR.analyze(m);
check("a dispute from either opposing player wins over a confirm; the Bariboshi winner is asked to rule", an.disputed.length === 1 && an.disputed[0].who === "a1" && an.disputed[0].ruler === "a1" && an.actions.a1.some((x) => x.type === "x" && x.who === "a1") && !an.done && an.rounds.length === 0);
H.add(m, "a1", { k: "x", n: 1, who: "a1", pack: [2, 0, 0] }); an = AR.analyze(m);
check("ruling replaces the disputed pack; ruling against the reporter is recorded", an.rounds.length === 1 && an.contrib.a1 === 2 && an.rulings.length === 1 && an.rulings[0].against === "a1" && an.rulings[0].ruler === "a1");
m = H.bariboshi(H.arena(), [10, 40, 30, 50]); H.report(m, "b1", 1, [5, 5, 5]); H.confirm(m, "a2", 1, "b1", false); an = AR.analyze(m);
check("a disputed pack by the other team is also ruled by the Bariboshi winner (a1)", an.disputed[0].ruler === "a1" && an.actions.a1.some((x) => x.type === "x" && x.who === "b1"));
// writes: allowed(), write-once
m = H.bariboshi(H.arena(), [10, 40, 30, 50]);
check("allowed: own pack once; invalid pack / wrong round / not live / not seated refused", AR.allowed(m, "a2", { k: "r", n: 1, pack: [5, 5, 5] }) && !AR.allowed(m, "a2", { k: "r", n: 2, pack: [5, 5, 5] }) && !AR.allowed(m, "a2", { k: "r", n: 1, pack: [4, 5, 5] }) && !AR.allowed({ ...m, status: "countdown" }, "a2", { k: "r", n: 1, pack: [5, 5, 5] }) && !AR.allowed(m, "zz", { k: "r", n: 1, pack: [5, 5, 5] }));
H.report(m, "a2", 1, [5, 5, 5]); check("write-once: a second report of the same round is refused", !AR.allowed(m, "a2", { k: "r", n: 1, pack: [0, 0, 0] }));
check("entry validation: confirm needs who, bad kinds refused", AR.validEntry({ k: "c", t: "r", n: 1, who: "b1", ok: true }) && !AR.validEntry({ k: "c", t: "r", n: 1, ok: true }) && !AR.validEntry({ k: "z" }) && !AR.validEntry({ k: "b", n: 1, d: -1 }) && !AR.validEntry({ k: "b", n: 1, d: 5, extra: 1 }));
// forfeits and drop-outs
m = H.bariboshi(H.arena(), [10, 40, 30, 50]); m.seats.b1.leftAt = 3;
check("one player leaving: their team plays on (match not decided), they are out", AR.seatOut(m, "b1") && !AR.seatOut(m, "b2") && !AR.teamOut(m, "b") && !AR.decide(m).done);
H.round(m, 1, [[5, 5, 5], [5, 0, 0], [0, 0, 0]].concat([[0, 0, 0]]).slice(0, 4).map((p) => p)); // b1 is out: its pack is not waited for
check("rounds do not wait for a player who is out (their missing pack counts 0)", AR.analyze(m).rounds.length === 1);
m.seats.b2.result = { forfeit: true, at: 4 }; d = AR.decide(m);
check("a team forfeits only when ALL its players are out: the other team wins by forfeit", d.done && d.winner === "a" && d.reason === "forfeit" && d.winners.join() === "a1,a2" && /forfeited/.test(AR.resultText(m, "a1")));
m.seats.a1.leftAt = 5; m.seats.a2.leftAt = 5; d = AR.decide(m);
check("every player out on both teams: no winner (both-forfeit)", d.done && d.winner === null && d.reason === "both-forfeit" && d.winners.length === 0);
m = H.bariboshi(H.arena(), [10, 40, 30, 50]); m.seats.a1.gone = ["b1"];
check("silent 30 s recorded by an opposing player: that player is out, only theirs", AR.seatOut(m, "b1") && !AR.seatOut(m, "b2") && !AR.decide(m).done);
m.seats.a1.gone = ["b1", "b2"]; check("both silent players recorded: Team B forfeits", AR.decide(m).winner === "a" && AR.decide(m).reason === "forfeit");
m = H.arena(); m.seats.a2.gone = ["a1"]; check("a teammate's gone entry about their own team is ignored", !AR.seatOut(m, "a1"));
check("a player who reported their own forfeit cannot write more; one claimed silent cannot write", !AR.canWrite((() => { const x = H.arena(); x.seats.a1.result = { forfeit: true }; return x; })(), "a1") && !AR.canWrite((() => { const x = H.arena(); x.seats.b1.gone = ["a1"]; return x; })(), "a1"));
// silence detection
m = H.arena({ startAt: 100000 }); m.seats.b1.seenAt = 100000; m.seats.b2.seenAt = 125000;
check("silence: only an opposing, live player whose heartbeat is older than 30 s", AR.staleSeat(m, "a1", "b1", 131000) && !AR.staleSeat(m, "a1", "b2", 131000) && !AR.staleSeat(m, "a1", "a2", 999999) && AR.staleTargets(m, "a1", 131000).join() === "b1" && !AR.staleSeat(m, "a1", "b1", 129000) && !AR.staleSeat({ ...m, status: "countdown" }, "a1", "b1", 131000));
// size 2 = the same rules with one player per team: matches the plain 1v1 decision
{ const duo = H.duo(); H.add(duo, "a1", { k: "b", n: 1, d: 10 }); H.add(duo, "b1", { k: "b", n: 1, d: 30 }); H.add(duo, "b1", { k: "c", t: "b", n: 1, who: "a1", ok: true }); H.add(duo, "a1", { k: "c", t: "b", n: 1, who: "b1", ok: true });
  const one = WH.bariboshi(WH.room(), 10, 30); [[[5, 5, 5], [0, 0, 0]], [[5, 5, 5], [0, 0, 0]]].forEach(([pa, pb], i) => { H.round(duo, i + 1, [pa, pb]); WH.round(one, i + 1, pa, pb); });
  const dd = AR.decide(duo), d1 = W.decide(one);
  check("size 2 arena decides exactly like the plain 1v1 (same winner side, same totals)", dd.done && d1.done && dd.winner === "a" && d1.winner === "a" && AR.analyze(duo).totals.a === W.analyze(one).totals.a && AR.analyze(duo).totals.b === W.analyze(one).totals.b); }
// states
check("matchState: waiting, ready, countdown, live, finished, cancelled", AR.matchState({ size: 4, status: "waiting", seats: {}, createdAt: 0 }, 5, (v) => v) === "waiting" && AR.matchState(H.arena({ status: "waiting" }), 5, (v) => v) === "ready" && AR.matchState(H.arena({ status: "countdown" }), 5, (v) => v) === "countdown" && AR.matchState(H.arena(), 5, (v) => v) === "live" && AR.matchState(H.arena({ status: "abandoned" }), 5, (v) => v) === "cancelled" && AR.matchState(H.arena({ status: "waiting" }), 31 * 60000 + 600, (v) => v) === "cancelled" && AR.matchState(m, 5, (v) => v) !== undefined);
check("boardStatus names who must act; no email can appear", /Everyone pitches|Opening pitch/.test(AR.boardStatus(H.bariboshi(H.arena(), [10, 40, 30, 50]), 2000, (v) => v).extra) && AR.nameOf({ seats: { u: { name: "zed@mail.com" } } }, "u") === "Player" && AR.nameOf({ seats: { u: { name: "old", pubName: "Saved" } } }, "u") === "Saved");
// ---- lobby controller over the mock Firestore ----
(async () => {
  const S = mockFs(), fs = S.fs, now = () => S.T;
  const U = (id, nm) => ({ uid: id, name: nm, pubName: nm });
  const c = AR.controller(fs, { now, codeTaken: async (cd) => cd === "TAKEN" });
  const bad = async (p) => { try { await p; return null; } catch (e) { return e; } };
  check("create validates: signed in, size 2 or 4", !!(await bad(c.createArena(null, 4))) && !!(await bad(c.createArena(U("u1", "Ann"), 3))));
  const code = await c.createArena(U("u1", "Ann"), 4, { team: "b" }), doc = () => S.docs[code];
  check("created: waiting, size 4, creator on Team B's first seat (slot 2) with pubName, empty teamNames", doc().status === "waiting" && doc().size === 4 && doc().createdBy === "u1" && doc().seats.u1.slot === 2 && doc().seats.u1.team === "b" && doc().seats.u1.pubName === "Ann" && doc().slots["2"] === "u1" && JSON.stringify(doc().teamNames) === "{}" && doc().startAt === null);
  check("seat docs hold only the allowed fields (name, pubName, ready, joinedAt, slot, team)", Object.keys(doc().seats.u1).sort().join() === "joinedAt,name,pubName,ready,slot,team");
  await c.joinArena(code.toLowerCase(), U("u2", "Bo"));
  check("joiner fills the team with fewer players: Team A slot 0", doc().seats.u2.team === "a" && doc().seats.u2.slot === 0 && doc().slots["0"] === "u2");
  await c.joinArena(code, U("u3", "Cy")); await c.joinArena(code, U("u4", "Di"));
  check("teams balance 2 and 2 across slots 0..3", AR.teamSeats(doc(), "a").length === 2 && AR.teamSeats(doc(), "b").length === 2 && Object.keys(doc().slots).sort().join() === "0,1,2,3");
  check("a fifth player gets 'full'; rejoining your own seat is fine", /full/.test((await bad(c.joinArena(code, U("u5", "Ed")))).message) && (await c.joinArena(code, U("u1", "Ann"))) === code);
  check("bad codes rejected", !!(await bad(c.joinArena("zzz", U("u9", "X")))) && /No arena/.test((await bad(c.joinArena("AAAA", U("u9", "X")))).message));
  // team names
  check("a member sets their own team's name (sanitised); the other team's name is untouched", (await c.setTeamName(code, U("u1", "Ann"), "  <b>Team  Rocket</b> ")) === "Team Rocket" && doc().teamNames.b === "Team Rocket" && doc().teamNames.a === undefined && AR.teamName(doc(), "a") === "Team A");
  check("any teammate may rename it; empty clears it back to the default", (await c.setTeamName(code, U("u4", "Di"), "Wolves")) === "Wolves" && doc().teamNames.b === "Wolves" && (await c.setTeamName(code, U("u4", "Di"), "<>")) === "" && doc().teamNames.b === undefined && AR.teamName(doc(), "b") === "Team B");
  check("a non-member cannot set a team name", (await c.setTeamName(code, U("u9", "Zed"), "Hax")) === false && doc().teamNames.a === undefined);
  // ready -> countdown only when all four are ready
  await c.setReady(code, U("u1", "Ann"), true); await c.setReady(code, U("u2", "Bo2"), true); await c.setReady(code, U("u3", "Cy"), true);
  check("three ready is not enough; ready refreshes the saved name (pubName) on the seat", doc().status === "waiting" && doc().startAt === null && doc().seats.u2.pubName === "Bo2" && doc().seats.u2.name === "Bo");
  await c.setReady(code, U("u4", "Di"), true);
  check("all four ready: countdown with startAt ~5 s ahead, written once", doc().status === "countdown" && doc().startAt > S.T && doc().startAt <= S.T + 6000);
  const start = doc().startAt; await c.maybeStart(code); check("start is idempotent", doc().startAt === start);
  check("ready cannot change after the start; team names locked after the start", (await c.setReady(code, U("u1", "Ann"), false)) === false && (await c.setTeamName(code, U("u1", "Ann"), "Late")) === false && doc().teamNames.b === undefined);
  check("markLive: not before startAt, live after", (await c.markLive(code)) === false && (S.T = start + 10, await c.markLive(code)) === true && doc().status === "live");
  // play through the controller's fs-level writes
  for (const [u, dd] of [["u1", 10], ["u2", 40], ["u3", 30], ["u4", 50]]) check("report opening for " + u, (await AR.report(fs, code, u, { k: "b", n: 1, d: dd })) === true);
  check("a teammate cannot confirm a teammate (refused); an opponent can", (await AR.report(fs, code, "u4", { k: "c", t: "b", n: 1, who: "u1", ok: true })) === false && (await AR.report(fs, code, "u3", { k: "c", t: "b", n: 1, who: "u1", ok: true })) === true);
  check("report write is write-once (second identical refused)", (await AR.report(fs, code, "u3", { k: "c", t: "b", n: 1, who: "u1", ok: true })) === false);
  check("heartbeat writes the own seat's seenAt only; steps clamp", (await AR.heartbeat(fs, code, "u1"), doc().seats.u1.seenAt === S.T) && (await AR.publishLive(fs, code, "u1", { steps: 999999999 }), doc().seats.u1.steps === 100000));
  check("forfeit: own seat result, once", (await AR.forfeit(fs, code, "u4")) === true && doc().seats.u4.result.forfeit === true && (await AR.forfeit(fs, code, "u4")) === false);
  S.T += 60000; doc().seats.u1.seenAt = S.T - 40000; doc().startAt = S.T - 80000;
  check("claimGone: a teammate cannot record them; an opposing player records the silent player once", (await AR.claimGone(fs, code, "u4", "u1", S.T)) === false && (await AR.claimGone(fs, code, "u3", "u1", S.T)) === true && doc().seats.u3.gone.join() === "u1" && (await AR.claimGone(fs, code, "u3", "u1", S.T)) === false && AR.seatOut(doc(), "u1"));
  // leave
  const c2 = AR.controller(S.fs, { now }); const code2 = await c2.createArena(U("x1", "Ann"), 4); await c2.joinArena(code2, U("x2", "Bo"));
  check("leave before start frees the seat and its slot; the arena stays open", (await c2.leave(code2, U("x2", "Bo"))) === "seat-freed" && S.docs[code2].status === "waiting" && !("x2" in S.docs[code2].seats) && Object.keys(S.docs[code2].slots).join() === "0");
  await c2.joinArena(code2, U("x3", "Cy"));
  check("the creator leaving before the start cancels the arena", (await c2.leave(code2, U("x1", "Ann"))) === "abandoned" && S.docs[code2].status === "abandoned");
  check("an abandoned arena cannot be joined, and the code can be reused", /started or ended/.test((await bad(c2.joinArena(code2, U("x9", "Zed")))).message));
  const code3 = await c2.createArena(U("y1", "Ann"), 2); await c2.joinArena(code3, U("y2", "Bo"));
  check("size 2 arena: one per team (slots 0 and 1)", S.docs[code3].seats.y1.team === "a" && S.docs[code3].seats.y2.team === "b" && AR.full(S.docs[code3]));
  check("resume: seated player gets the doc back, strangers and abandoned arenas do not", !!(await c.resume(code, U("u1", "Ann"))) && (await c.resume(code, U("zz", "Z"))) === null && (await c2.resume(code2, U("x3", "Cy"))) === null);
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
