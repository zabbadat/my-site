// ZAB wagering on Plank Battles and TUT Battles: settle (win, draw within 1 s, forfeit, refund on cancel, no double payout,
// no wager = unchanged), 30 s silence forfeit, reputation, arcade boards, stake UI wording, rules draft.
const W = require("../zaba-wager.js"), PB = require("../plank-battle.js"), TB = require("../tut-battle.js"), PR = require("../battle-presence.js"),
  REP = require("../reputation.js"), ARC = require("../washers-arcade.js"), fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const read = (f) => fsx.readFileSync(__dirname + "/../" + f, "utf8");
// ---- mock admin store (same shape as zaba-wager.test.js): path arrays, reads before writes ----
let T = 1e9; const db = {}; const SV = { __ts: 1 };
const P = (p) => p.join("/"), clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
const deep = (v) => (v === SV ? T : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
function apply(d, p) { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; o[ks[ks.length - 1]] = deep(v); } return d; }
let readAfterWrite = false, lock = Promise.resolve();
const fs = { tx: (fn) => { const run = lock.then(async () => { const w = []; const out = await fn({ get: async (p) => { if (w.length) readAfterWrite = true; return clone(db[P(p)]); },
  set: (p, d) => w.push(() => (db[P(p)] = deep(d))), update: (p, x) => w.push(() => { if (!db[P(p)]) throw new Error("update missing " + P(p)); db[P(p)] = apply(db[P(p)], x); }) }); w.forEach((f) => f()); return out; }); lock = run.catch(() => {}); return run; },
  ts: () => SV, toMs: (v) => (typeof v === "number" ? v : null) };
// room-store adapter for the presence module: tx(code, fn(t)) with t.get() / t.update(patch)
const roomFs = (ref) => ({ tx: (code, fn) => Promise.resolve().then(() => { let patch = null; const out = fn({ get: () => clone(db[ref]), update: (p) => { patch = p; } }); if (patch) db[ref] = apply(db[ref], patch); return out; }),
  update: (code, p) => { db[ref] = apply(db[ref], p); return Promise.resolve(); }, ts: () => SV, toMs: (v) => (typeof v === "number" ? v : null) });
const bal = (u) => (db["users/" + u] || {}).zabBalance;
const txs = (u) => Object.keys(db).filter((k) => k.startsWith("users/" + u + "/zabLedger/"));
const setUser = (u, n) => (db["users/" + u] = { uid: u, zabBalance: n, lastTxId: "", createdAt: 0, updatedAt: 0 });
let n = 0;
function mkRoom(game, stake, extra) { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k = n++; const code = "CD" + A[Math.floor(k / 32) % 32] + A[k % 32]; const createdAt = T - k;
  db[W.COL[game] + "/" + code] = Object.assign({ code, status: "waiting", createdAt, startAt: null, players: { a: { name: "A", ready: false, joinedAt: T }, b: { name: "B", ready: false, joinedAt: T + 1 } } }, stake ? { stake } : {}, extra || {});
  return { code, key: W.roomKey(game, code, createdAt), ref: W.COL[game] + "/" + code }; }
async function staked(game, stake) { setUser("a", 20); setUser("b", 20); const x = mkRoom(game, stake); await W.stake(fs, "a", game, x.code); await W.stake(fs, "b", game, x.code); return x; }
const goLive = (r) => Object.assign(db[r.ref], { status: "live", startAt: T });
const hold = (r, u, ms, ok) => (db[r.ref].players[u].result = { holdMs: ms, verified: ok !== false, at: T });
const START = T;
(async () => {
  // ================= PLANK =================
  // win: longest hold takes the pot
  let r = await staked("plank", 3); goLive(r); hold(r, "a", 60000); hold(r, "b", 30000);
  let out = await W.settle(fs, r.key, T + 90000);
  check("Plank win: longest hold (60 s vs 30 s) takes the pot of 6", out.status === "paid" && out.winner === "a" && bal("a") === 23 && bal("b") === 17);
  const before = [bal("a"), bal("b"), txs("a").length, txs("b").length];
  out = await W.settle(fs, r.key, T + 99999); await W.settle(fs, r.key, T + 99999);
  check("Plank: settling again pays nothing more (no double payout, ledger unchanged)", out.already === true && bal("a") === before[0] && bal("b") === before[1] && txs("a").length === before[2] && txs("b").length === before[3]);
  // draw within 1 s: both stakes back
  r = await staked("plank", 2); goLive(r); hold(r, "a", 60000); hold(r, "b", 60800);
  out = await W.settle(fs, r.key, T + 90000);
  check("Plank draw: holds 0.8 s apart refund both stakes", out.status === "refunded" && out.reason === "tie" && bal("a") === 20 && bal("b") === 20);
  r = await staked("plank", 2); goLive(r); hold(r, "a", 60000); hold(r, "b", 61000);
  out = await W.settle(fs, r.key, T + 90000);
  check("Plank draw window is inclusive: exactly 1.000 s apart is still a draw", out.status === "refunded" && out.reason === "tie");
  r = await staked("plank", 2); goLive(r); hold(r, "a", 60000); hold(r, "b", 61001);
  out = await W.settle(fs, r.key, T + 90000);
  check("Plank: 1.001 s apart is a win for the longer hold", out.status === "paid" && out.winner === "b" && bal("b") === 22);
  // one dropped, the other still holding: wait out the 1 s window, then the one still holding wins
  r = await staked("plank", 2); goLive(r); hold(r, "a", 40000);
  out = await W.settle(fs, r.key, T + 40500);
  check("Plank: 0.5 s after a drop the other player may still draw -> settle waits (pending)", out.pending === true && db["wagers/" + r.key].status === "open" && bal("a") === 18);
  out = await W.settle(fs, r.key, T + 41001);
  check("Plank: past 1 s the player still holding wins the pot", out.status === "paid" && out.winner === "b" && bal("b") === 22 && bal("a") === 18);
  r = await staked("plank", 2); goLive(r); hold(r, "a", 40000); hold(r, "b", 40400);
  out = await W.settle(fs, r.key, T + 41500);
  check("Plank: second player drops 0.4 s later -> draw, refunded", out.status === "refunded" && out.reason === "tie" && bal("a") === 20 && bal("b") === 20);
  // forfeit: tapped, left, 30 s silence
  r = await staked("plank", 5); goLive(r); db[r.ref].players.b.result = { forfeit: true, at: T };
  out = await W.settle(fs, r.key, T + 1000);
  check("Plank forfeit tap: opponent wins the pot at once", out.status === "paid" && out.winner === "a" && bal("a") === 25 && bal("b") === 15);
  r = await staked("plank", 5); goLive(r); db[r.ref].players.a.leftAt = T;
  out = await W.settle(fs, r.key, T + 1000);
  check("Plank leaving after the start = forfeit, opponent wins", out.status === "paid" && out.winner === "b");
  r = await staked("plank", 5); goLive(r); db[r.ref].players.a.seenAt = START + 1000; db[r.ref].players.b.seenAt = START + 40000;
  check("silence: 30 s without a heartbeat is stale, not before", PR.staleOpponent(db[r.ref], "b", START + 31001, null, null) === true && PR.staleOpponent(db[r.ref], "b", START + 30900, null, null) === false);
  let ok = await PR.claimGone(roomFs(r.ref), r.code, "b", START + 41000, (x) => PB.decide(x, START + 41000).done);
  check("claimGone is written on the claimer's own seat once, and only when stale", ok === true && db[r.ref].players.b.claimGone === true && !db[r.ref].players.a.claimGone);
  ok = await PR.claimGone(roomFs(r.ref), r.code, "b", START + 99000, (x) => PB.decide(x, START + 99000).done);
  check("claimGone is not written twice", ok === false);
  out = await W.settle(fs, r.key, T + 41000);
  check("Plank 30 s silence: the silent player forfeits, the other wins the pot", out.status === "paid" && out.winner === "b" && out.reason === "forfeit" && bal("b") === 25);
  r = await staked("plank", 5); goLive(r); db[r.ref].players.a.seenAt = START + 5000; db[r.ref].players.b.seenAt = START + 5000;
  ok = await PR.claimGone(roomFs(r.ref), r.code, "b", START + 20000, () => false);
  check("heartbeat inside 30 s: no claim", ok === false && !db[r.ref].players.b.claimGone);
  r = await staked("plank", 5); goLive(r); hold(r, "a", 20000); db[r.ref].players.b.seenAt = START;
  ok = await PR.claimGone(roomFs(r.ref), r.code, "a", START + 99000, () => false);
  check("a player who already dropped cannot claim the other as gone", ok === false);
  r = await staked("plank", 5); goLive(r); db[r.ref].players.a.leftAt = T; db[r.ref].players.b.result = { forfeit: true, at: T };
  out = await W.settle(fs, r.key, T + 5000);
  check("Plank both out: stakes refunded", out.status === "refunded" && out.reason === "both-out" && bal("a") === 20 && bal("b") === 20);
  // cancel / never started
  r = await staked("plank", 4); db[r.ref].status = "abandoned";
  out = await W.settle(fs, r.key, T + 5000);
  check("Plank cancelled before the start: both stakes refunded", out.status === "refunded" && out.reason === "never-started" && bal("a") === 20 && bal("b") === 20);
  r = await staked("plank", 4);
  out = await W.settle(fs, r.key, T + 31 * 60 * 1000);
  check("Plank expired in the lobby: both stakes refunded", out.status === "refunded" && out.reason === "expired" && bal("a") === 20);
  // no wager = unchanged
  const nw = { status: "live", startAt: START, players: { a: { result: { holdMs: 60000, verified: true } }, b: {} } };
  check("no stake: the first to drop still loses at once (no 1 s wait, no clock needed)", PB.decide(nw).done === true && PB.decide(nw).winner === "b" && PB.decide(nw, START + 100).reason === "last-holding");
  const nw2 = { status: "live", startAt: START, players: { a: { result: { holdMs: 60000, verified: true } }, b: { result: { holdMs: 60500, verified: true } } } };
  check("no stake: only an exact tie is a tie (0.5 s apart still has a winner)", PB.decide(nw2).winner === "b" && PB.decide({ status: "live", players: { a: { result: { holdMs: 5, verified: true } }, b: { result: { holdMs: 5, verified: true } } } }).reason === "tie");
  check("no stake: allStaked is always true, so the countdown is never gated", W.allStaked({ players: { a: {}, b: {} } }, null) === true && W.allStaked({ stake: 2, players: { a: {}, b: {} } }, null) === false);
  check("no stake: plan() has no wager to settle", W.plan(null, nw, T, null).action === "none");
  check("wager countdown gate: both seated stakes must be escrowed", W.allStaked({ stake: 2, players: { a: {}, b: {} } }, { status: "open", players: { a: {}, b: {} } }) === true && W.allStaked({ stake: 2, players: { a: {}, b: {} } }, { status: "open", players: { a: {} } }) === false);
  // ================= TUT =================
  r = await staked("tut", 3); goLive(r); Object.assign(db[r.ref], { status: "done", winnerUid: "a", loserUid: "b", loseReason: "knees" });
  out = await W.settle(fs, r.key, T + 5000);
  check("TUT win: the existing result (first to break loses) pays the pot", out.status === "paid" && out.winner === "a" && bal("a") === 23 && bal("b") === 17);
  const ln = txs("a").length; out = await W.settle(fs, r.key, T + 5000);
  check("TUT: no double payout", out.already === true && bal("a") === 23 && bal("b") === 17 && txs("a").length === ln);
  r = await staked("tut", 3); goLive(r); Object.assign(db[r.ref].players.a, { tutMs: 90000, reps: 12 }); Object.assign(db[r.ref].players.b, { tutMs: 70000, reps: 20 });
  out = await W.settle(fs, r.key, T + 180000 + TB.RULES.settleMs + W.GRACE_MS + 1);
  check("TUT time-up: more TUT wins (reps only break an equal TUT)", out.status === "paid" && out.winner === "a" && out.reason === "time");
  r = await staked("tut", 3); goLive(r); Object.assign(db[r.ref].players.a, { tutMs: 70000, reps: 12 }); Object.assign(db[r.ref].players.b, { tutMs: 70000, reps: 20 });
  out = await W.settle(fs, r.key, T + 180000 + TB.RULES.settleMs + W.GRACE_MS + 1);
  check("TUT equal TUT: more reps wins, same decision as the battle", out.status === "paid" && out.winner === "b");
  r = await staked("tut", 3); goLive(r); Object.assign(db[r.ref].players.a, { tutMs: 70000, reps: 12 }); Object.assign(db[r.ref].players.b, { tutMs: 70000, reps: 12 });
  out = await W.settle(fs, r.key, T + 180000 + TB.RULES.settleMs + W.GRACE_MS + 1);
  check("TUT tie: both stakes refunded", out.status === "refunded" && out.reason === "draw" && bal("a") === 20 && bal("b") === 20);
  r = await staked("tut", 3); goLive(r); Object.assign(db[r.ref].players.a, { tutMs: 10000, reps: 1 });
  out = await W.settle(fs, r.key, T + 60000);
  check("TUT: still inside the 3:00 battle -> nothing settles yet", out.pending === true && bal("a") === 17);
  r = await staked("tut", 3); goLive(r); db[r.ref].players.a.leftAt = T;
  out = await W.settle(fs, r.key, T + 5000);
  check("TUT: leaving the battle is a forfeit, the other player wins the pot", out.status === "paid" && out.winner === "b" && out.reason === "forfeit" && bal("b") === 23);
  r = await staked("tut", 3); goLive(r); db[r.ref].players.a.seenAt = START + 40000; db[r.ref].players.b.seenAt = START + 2000;
  check("TUT presence: stale after 30 s of silence", TB.stale(db[r.ref], "a", START + 33000, null) === true && TB.stale(db[r.ref], "a", START + 31000, null) === false);
  ok = await TB.claimGone(roomFs(r.ref), r.code, "a", START + 43000);
  out = await W.settle(fs, r.key, T + 43000);
  check("TUT 30 s silence: claimGone recorded, the silent player forfeits the pot", ok === true && db[r.ref].players.a.claimGone === true && out.status === "paid" && out.winner === "a" && out.reason === "forfeit");
  check("TUT: no result / no judge once forfeited (reportLoss and time-up stand down)", TB.forfeitLoser(db[r.ref]).loser === "b" && TB.isDone(db[r.ref]) === true);
  const fsT = roomFs(r.ref); const lost = await TB.reportLoss(fsT, r.code, "a", "knees", { reps: 1, tutMs: 1 });
  check("TUT: a forfeited battle can't also be reported as a loss", lost === false && db[r.ref].status === "live");
  r = await staked("tut", 3); goLive(r); db[r.ref].players.a.leftAt = T; db[r.ref].players.b.leftAt = T;
  out = await W.settle(fs, r.key, T + 5000);
  check("TUT both left: stakes refunded", out.status === "refunded" && out.reason === "both-out" && bal("a") === 20);
  r = await staked("tut", 3); db[r.ref].status = "abandoned";
  out = await W.settle(fs, r.key, T + 5000);
  check("TUT cancelled before the start: both stakes refunded", out.status === "refunded" && out.reason === "never-started" && bal("b") === 20);
  const ntut = { status: "live", players: { a: { tutMs: 5, reps: 1 }, b: { tutMs: 9, reps: 1 } } };
  check("no stake TUT: the judge and result helpers behave as before", TB.timeUpLoser(ntut) === "a" && TB.forfeitLoser(ntut) === null && TB.isDone(ntut) === false);
  check("no read-after-write in any settle transaction", readAfterWrite === false);
  // ================= REPUTATION =================
  const D = (game, room, now) => REP.matchDeltas(room, game, now, null);
  const ev = (d) => Object.keys(d).map((u) => u + ":" + d[u].delta).join(",");
  const pr = (a, b, stake) => ({ status: "live", startAt: START, stake, players: { a: { name: "A", result: a }, b: { name: "B", result: b } } });
  check("rep Plank clean finish: +2 each", ev(D("plank", pr({ holdMs: 60000, verified: true }, { holdMs: 30000, verified: true }), START + 99000)) === "a:2,b:2");
  check("rep Plank draw (wagered): +2 each", ev(D("plank", pr({ holdMs: 60000, verified: true }, { holdMs: 60400, verified: true }, 2), START + 99000)) === "a:2,b:2");
  check("rep Plank forfeit: -5 for the forfeiter, 0 for the winner", ev(D("plank", pr({ forfeit: true, at: 1 }, undefined), START + 5000)) === "a:-5,b:0");
  check("rep Plank both out: -5 each", ev(D("plank", pr({ forfeit: true, at: 1 }, { forfeit: true, at: 1 }), START + 5000)) === "a:-5,b:-5");
  check("rep Plank undecided or cancelled: no change", D("plank", pr(undefined, undefined), START + 5000) === null && D("plank", { status: "abandoned", players: { a: {}, b: {} } }, START) === null);
  check("rep Plank wagered, drop inside the 1 s window: undecided yet", D("plank", pr({ holdMs: 60000, verified: true }, undefined, 2), START + 60500) === null);
  check("rep Plank unverified hold: no change (flagged)", D("plank", pr({ holdMs: 60000, verified: false }, { holdMs: 30000, verified: true }), START + 99000) === null);
  const tr = (extra) => Object.assign({ status: "live", startAt: START, players: { a: { tutMs: 1000, reps: 2 }, b: { tutMs: 500, reps: 1 } } }, extra);
  check("rep TUT lost by posture break: clean, +2 each", ev(D("tut", tr({ status: "done", winnerUid: "a", loserUid: "b", loseReason: "knees" }), START + 5000)) === "a:2,b:2");
  check("rep TUT left the battle (reported): -5 forfeit, winner 0", ev(D("tut", tr({ status: "done", winnerUid: "a", loserUid: "b", loseReason: "left" }), START + 5000)) === "a:0,b:-5");
  const tg = tr(); tg.players.b.claimGone = true;
  check("rep TUT silent 30 s (claimGone on the opponent): silent player -5", ev(D("tut", tg, START + 50000)) === "a:-5,b:0");
  check("rep TUT time-up draw: +2 each once the result settles", ev(D("tut", tr({ players: { a: { tutMs: 1, reps: 1 }, b: { tutMs: 1, reps: 1 } } }), START + 180000 + 3000 + 60001)) === "a:2,b:2");
  check("rep TUT running: no change yet", D("tut", tr(), START + 60000) === null);
  // settle once via the ledger
  const rr = mkRoom("plank", 0); goLive(rr); hold(rr, "a", 60000); hold(rr, "b", 30000);
  let s1 = await REP.settle(fs, "a", rr.code, "plank", START + 99000), s2 = await REP.settle(fs, "b", rr.code, "plank", START + 99000);
  check("rep settle Plank: +2 each once, repLog keyed per game, second settle is a no-op", s1.ok === true && s2.already === true && db["repBoard/a"].rep === 52 && db["repBoard/b"].rep === 52 && !!db["repLog/" + REP.KEY(rr.code, db[rr.ref].createdAt, "plank")] && db["repLog/" + REP.KEY(rr.code, db[rr.ref].createdAt, "plank")].game === "plank");
  const rt = mkRoom("tut", 0); goLive(rt); Object.assign(db[rt.ref], { status: "done", winnerUid: "a", loserUid: "b", loseReason: "left" });
  await REP.settle(fs, "b", rt.code, "tut", START + 5000);
  check("rep settle TUT: forfeit -5 on the board", db["repBoard/b"].rep === 47 && db["repBoard/b"].forfeits === 1 && db["repBoard/a"].rep === 52);
  let e = null; try { await REP.settle(fs, "zz", rt.code, "tut", START); } catch (x) { e = x; }
  check("rep settle: only a seated player can ask", e && e.status === 403);
  e = null; try { await REP.settle(fs, "a", rt.code, "nope", START); } catch (x) { e = x; }
  check("rep settle: unknown battle type rejected", e && e.status === 400);
  const sw = mkRoom("washers", 0); check("rep settle washers key is unchanged (washers_CODE_ms)", REP.KEY(sw.code, 5) === "washers_" + sw.code + "_5");
  // ================= ARCADE BOARDS =================
  const ps = (r) => ["a", "b"].map((u) => Object.assign({ uid: u }, r.players[u]));
  const mp = (r, ctx, me) => ARC.battleModel("plank", r, ps(r), me || "a", ctx);
  const base = { status: "waiting", players: { a: { name: "Ann", ready: true }, b: { name: "bob@example.com", ready: false } } };
  check("board Plank: waiting/ready/countdown/live/finished/cancelled labels",
    ARC.battleModel("plank", { status: "waiting", players: { a: { name: "Ann" } } }, [{ uid: "a", name: "Ann" }], "a", {}).mode.title === "INSERT COIN" && mp(base, {}).mode.title === "READY?"
    && mp(Object.assign({}, base, { status: "countdown" }), { cd: { phase: "countdown", n: 5 } }).mode.title === "READY" && mp(pr(undefined, undefined), { nowMs: START + 5000 }).mode.title === "HOLD ON"
    && mp(pr({ holdMs: 60000, verified: true }, { holdMs: 30000, verified: true }), {}).mode.title === "K.O." && mp(pr({ holdMs: 60000, verified: true }, { holdMs: 60300, verified: true }, 2), {}).mode.title === "DRAW"
    && mp({ status: "abandoned", players: base.players }, {}).mode.title === "GAME OVER");
  const live = mp(pr(undefined, { holdMs: 20000, verified: true }, 2), { nowMs: START + 20500 }), lh = ARC.html(live, null, null);
  check("board Plank: live hold clock, dropped hold, status words", live.mode.key === "live" && /Checking/.test(live.mode.sub) && live.rows[0].big === "0:20" && live.rows[1].big === "0:20" && live.rows[0].status === "HOLDING" && live.rows[1].status === "DROPPED" && /HOLDING/.test(lh) && /DROPPED/.test(lh) && /arc-static/.test(lh));
  const both = mp(pr(undefined, undefined), { nowMs: START + 65000 });
  check("board Plank: both still holding show the shared 1:05 clock", both.rows[0].big === "1:05" && both.rows[1].big === "1:05" && both.rows.every((x) => x.turn));
  const fo = mp(pr({ forfeit: true, at: 1 }, undefined), {});
  check("board Plank: forfeit shows K.O. with the winner and (forfeit)", fo.mode.title === "K.O." && /forfeit/.test(fo.mode.sub) && fo.rows[0].status === "FORFEIT" && fo.rows[1].win === true);
  const rp = mp(pr(undefined, undefined), { nowMs: START + 5000, reps: { a: 80, b: 30 } });
  check("board: reputation badge (tier + score) next to the names", /TRUSTED 80/.test(ARC.html(rp, null, null)) && /SHAKY 30/.test(ARC.html(rp, null, null)));
  const html1 = ARC.html(mp(base, {}), null, null);
  check("board Plank: an email-like name never appears (shows Player)", !/@|example\.com/.test(html1) && /Player/.test(html1));
  const tm = ARC.battleModel("tut", { status: "live", startAt: START, stake: 2, players: { a: { name: "Ann", reps: 5, tutMs: 61000 }, b: { name: "Bob", reps: 4, tutMs: 20000 } } }, ps({ players: { a: { name: "Ann" }, b: { name: "Bob" } } }), "a", { nowMs: START + 90000, timeLeft: 90000, mine: { uid: "a", reps: 7, tutMs: 65000 } });
  check("board TUT: live TUT clock, reps, time left", tm.mode.title === "TUT BATTLE" && /1:30 left/.test(tm.mode.sub) && tm.rows[0].big === "1:05" && tm.rows[0].extraText === "7" && tm.rows[1].big === "0:20" && tm.rows[1].extraLabel === "REPS");
  const td = ARC.battleModel("tut", { status: "done", winnerUid: "b", loserUid: "a", loseReason: "knees", players: { a: { name: "Ann" }, b: { name: "Bob" } } }, ps({ players: { a: { name: "Ann" }, b: { name: "Bob" } } }), "a", {});
  check("board TUT: finished K.O. with the winner; draw and forfeit variants", td.mode.title === "K.O." && /Bob/.test(td.mode.sub) && ARC.battleModel("tut", { status: "live", startAt: START, players: { a: { name: "A" }, b: { name: "B" } } }, ps({ players: { a: { name: "A" }, b: { name: "B" } } }), "a", { draw: true }).mode.title === "DRAW"
    && /forfeit/.test(ARC.battleModel("tut", { status: "live", startAt: START, players: { a: { name: "A", leftAt: 1 }, b: { name: "B" } } }, ps({ players: { a: { name: "A" }, b: { name: "B" } } }), "b", {}).mode.sub));
  check("board: wager shown in the ready label (no stake -> not shown)", /bet 2 ZAB/.test(ARC.battleMode("plank", { status: "waiting", stake: 2, players: { a: { ready: false }, b: { ready: false } } }, {}, null, {}).sub) && !/bet/.test(ARC.battleMode("plank", { status: "waiting", players: { a: { ready: false }, b: { ready: false } } }, {}, null, {}).sub));
  // ================= UI / RULES / COPY =================
  const html = read("index.html"), rules = read("firestore.rules");
  check("stake button reads 'Lock in n ZAB' with the ring; old 'Stake n' text gone", /"Lock in " \+ r\.stake \+ " ZAB"/.test(html) && !/"Stake " \+ r\.stake/.test(html) && /window\.ZabCurrency\.set\(\$\(P \+ "StakeBtn"\)/.test(html));
  check("joiner sees the bet (confirm dialog + pot line) and locks in with the button (no auto-stake)", /This battle has a bet of/.test(html) && !/setTimeout\(\(\) => wg\.autoStake/.test(html) && /locked in/.test(html));
  check("countdown is gated on escrow only when a stake exists (wagerGate -> allStaked)", /canStart: \(r\) => !wagerOk\[g\] \|\| wagerOk\[g\]\(r\)/.test(html) && /wagerOk\[game\] = \(r\) => WG\.allStaked/.test(html));
  check("Plank and TUT: arcade board, presence and reputation are wired", /id="battleBoard"/.test(html) && /id="tbBoard"/.test(html) && /mkArcBoard\(\{ prefix: "battle"/.test(html) && /mkArcBoard\(\{ prefix: "tb"/.test(html) && /plankPres = mkPresence/.test(html) && /tbPres = mkPresence/.test(html) && /repSettle\("plank"/.test(html) && /repSettle\("tut"/.test(html));
  check("scripts load in dependency order (presence before the games, wager before reputation and arcade)", (() => { const o = (f) => html.indexOf('<script src="/' + f + '"></script>'); return o("battle-presence.js") > 0 && o("battle-presence.js") < o("tut-battle.js") && o("plank-battle.js") < o("zaba-wager.js") && o("zaba-wager.js") < o("reputation.js") && o("reputation.js") < o("washers-arcade.js"); })());
  check("home Washer Battle card uses the Bariboshi wording", /<h3>Zabba Washer Battle<\/h3><p>First to 21, Bariboshi style\. Challenge a friend with a room code, with an optional ZAB bet\.<\/p>/.test(html) && !/Washer Battle<\/h3><p>Reach 21/.test(html));
  check("no stale old-rule copy on any battle card or battle lead", !/data-battle="washers"><h3>[^<]*<\/h3><p>[^<]*fewest steps/.test(html) && /id="washerbattle">\s*<h2>[^<]*<\/h2>\s*<p class="lead">[^<]*Bariboshi/.test(html));
  check("Plank and TUT leads explain the optional ZAB bet, the 1 s draw and 30 s silence", /Optional ZAB bet[^<]*within 1 second are a draw[^<]*30 seconds of silence/.test(html) && /Optional ZAB bet[^<]*A tie refunds both stakes[^<]*30 seconds of silence/.test(html));
  check("rules draft: heartbeat + claimGone on battles and tutBattles, own seat only, 30 s stale, server time", (rules.match(/presOk\(d\(\)\.players\[me\(\)\], n\(\)\.players\[me\(\)\]\)/g) || []).length === 2 && (rules.match(/function otherStale\(\)/g) || []).length === 3 && (rules.match(/'claimGone'\]\)/g) || []).length === 3 && (rules.match(/p\.seenAt == request\.time/g) || []).length >= 3 && (rules.match(/> 30000/g) || []).length >= 3);
  check("rules draft: plank hold result stays write-once, wagers + repBoard/repLog stay server-only", /plankResOk/.test(rules) && /!\('result' in o\)/.test(rules) && /match \/wagers\/\{key\}[\s\S]{0,200}allow write: if false/.test(rules) && /match \/repLog\/\{key\}[\s\S]{0,120}allow (read, write|write): if false/.test(rules));
  check("rules draft still balanced", ["{", "(", "["].every((c, i) => { const cl = "})]"[i]; return rules.split(c).length === rules.split(cl).length; }));
  check("rep-settle function accepts game and passes the server clock", /body\.game/.test(read("netlify/functions/rep-settle.js")) && /Date\.now\(\)/.test(read("netlify/functions/rep-settle.js")));
  check("ZAB naming only: no old currency word in the new files", ["battle-presence.js", "test/plank-tut-wager.test.js"].every((f) => !/tok[e]n/i.test(read(f))));
  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
