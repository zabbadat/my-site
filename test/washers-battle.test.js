// Zabba Washer Battle match play, Bariboshi style (rules.html v1.9): pairing flags, Bariboshi order, packs/rounds, confirm/dispute,
// winner (first to 21), overtime, forfeit / 30 s silence, write-once reports, match states, rules draft wiring.
const W = require("../washers-battle.js"), B = require("../battle-rooms.js"), H = require("./lib/washers-match.js"), fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// ---- validation (Art. 5.1 pack of 3; Art. 6 bank 5 / shoot 3 / box-bound 2 / out 0) ----
check("pack = exactly 3 washers, each 0/2/3/5", W.validPack([5, 3, 2]) && W.validPack([0, 0, 0]) && !W.validPack([5, 3]) && !W.validPack([5, 3, 2, 0]) && !W.validPack([4, 0, 0]) && !W.validPack([1, 0, 0]) && !W.validPack(["5", 0, 0]));
check("entry shapes", W.validEntry({ k: "b", n: 1, d: 0 }) && W.validEntry({ k: "r", n: 2, pack: [5, 5, 5] }) && W.validEntry({ k: "c", t: "r", n: 1, ok: false }) && W.validEntry({ k: "x", n: 1, who: "a", pack: [0, 0, 0] })
  && !W.validEntry({ k: "b", n: 1, d: -1 }) && !W.validEntry({ k: "b", n: 1, d: 3000 }) && !W.validEntry({ k: "r", n: 1, pack: [5, 5, 5], extra: 1 }) && !W.validEntry({ k: "z" }) && !W.validEntry(null));
check("steps are an optional logged extra: validSteps + publishPatch clamp", W.validSteps(0) && !W.validSteps(-1) && !W.validSteps(1.5) && eq(W.publishPatch("a", { steps: -3 }), { "players.a.steps": 0 }) && eq(W.publishPatch("a", { steps: 250000 }), { "players.a.steps": 100000 }));
// ---- Bariboshi (Art. 4) ----
let r = H.room();
let an = W.analyze(r);
check("before any report: Bariboshi attempt 1, both must pitch", an.current.kind === "b" && an.current.n === 1 && !an.order && an.actions.a[0].type === "b" && an.actions.b[0].type === "b");
H.add(r, "a", { k: "b", n: 1, d: 40 }); an = W.analyze(r);
check("one reported: other still to pitch, reporter has nothing yet", an.actions.a.length === 0 && an.actions.b[0].type === "b");
H.add(r, "b", { k: "b", n: 1, d: 15 }); an = W.analyze(r);
check("both reported: each must confirm the other's distance", an.current.stage === "confirm" && an.pending.length === 2 && an.actions.a[0].type === "c" && an.actions.a[0].d === 15 && an.actions.b[0].d === 40);
H.add(r, "a", { k: "c", t: "b", n: 1, ok: true }); H.add(r, "b", { k: "c", t: "b", n: 1, ok: true }); an = W.analyze(r);
check("closest to the cup pitches first (4.2)", eq(an.order, ["b", "a"]) && an.bari.winner === "b" && an.current.kind === "r" && an.current.turn === "b" && an.current.n === 1);
r = H.bariboshi(H.room(), 0, 0); an = W.analyze(r);
check("both in the cup: Bariboshi again (4.3)", !an.order && an.current.kind === "b" && an.current.n === 2 && an.bari.attempts[0].result === "again");
r = H.bariboshi(H.room(), 12, 12); check("equal distance also again", W.analyze(r).current.n === 2);
r = H.room(); H.add(r, "a", { k: "b", n: 1, d: 10 }); H.add(r, "b", { k: "b", n: 1, d: 30 }); H.add(r, "a", { k: "c", t: "b", n: 1, ok: true }); H.add(r, "b", { k: "c", t: "b", n: 1, ok: false }); an = W.analyze(r);
check("disputed Bariboshi report: pitch again, dispute counted (Art. 11)", an.current.n === 2 && an.disputes === 1 && !an.order);
r = H.room(); for (let n = 1; n <= W.MAX_BARI; n++) H.bariboshi(r, 5, 5, n);
check("never settled after 8 tries: falls back to seat order, flagged", W.analyze(r).bari.fallback === true && W.analyze(r).order.length === 2);
// ---- turns, packs, rounds (Art. 5) ----
r = H.bariboshi(H.room(), 10, 30); an = W.analyze(r);  // a pitches first
check("round 1: Bariboshi winner pitches the first pack; opponent waits (5.4)", an.current.turn === "a" && an.actions.a[0].type === "r" && an.actions.b.length === 0);
check("second pitcher can't report before the first (turn order)", !W.allowed(r, "b", { k: "r", n: 1, pack: [5, 5, 5] }) && W.allowed(r, "a", { k: "r", n: 1, pack: [5, 5, 5] }));
H.report(r, "a", 1, [5, 3, 0]); an = W.analyze(r);
check("after first pack: opponent must confirm, and may pitch next", an.pending[0].who === "a" && an.pending[0].by === "b" && an.actions.b.some((x) => x.type === "c") && an.actions.b.some((x) => x.type === "r") && an.current.turn === "b");
H.report(r, "b", 1, [2, 2, 0]); H.confirm(r, "b", 1); an = W.analyze(r);
check("round open until both confirm", an.rounds.length === 0 && an.pending.length === 1 && an.pending[0].by === "a");
H.confirm(r, "a", 1); an = W.analyze(r);
check("round 1 scored: Ann 8 (5+3+0), Bo 4 (2+2+0)", an.rounds.length === 1 && an.totals.a === 8 && an.totals.b === 4 && !an.done);
check("5.5: side that scored more in the previous round pitches first (a again)", an.current.n === 2 && an.current.turn === "a");
H.round(r, 2, [0, 0, 0], [5, 0, 0]); an = W.analyze(r);
check("round 2 -> b scored more, so b pitches first in round 3", an.rounds.length === 2 && an.current.n === 3 && an.current.turn === "b" && an.current.first === "b");
r = H.bariboshi(H.room(), 10, 30); H.round(r, 1, [2, 0, 0], [2, 0, 0]);
check("5.6: tied round keeps the order", W.analyze(r).current.turn === "a" && W.analyze(r).rounds[0].scores.a === 2);
// ---- winner: first to 21 (Art. 1.1), no steps/time tie-break ----
r = H.bariboshi(H.room(), 10, 30); H.round(r, 1, [5, 5, 5], [5, 3, 2]); H.round(r, 2, [2, 2, 2], [2, 3, 0]);
let d = W.decide(r); an = W.analyze(r);
check("15+6 = 21 vs 10+5 = 15: first to 21 wins", d.done && d.winner === "a" && d.reason === "score" && an.totals.a === 21 && an.totals.b === 15);
r = H.bariboshi(H.room(), 10, 30); H.round(r, 1, [5, 5, 5], [5, 5, 5]); H.round(r, 2, [5, 0, 0], [3, 0, 0]);
check("20 vs 18: nobody at 21 yet, play on", !W.decide(r).done && W.analyze(r).totals.a === 20);
H.round(r, 3, [0, 0, 0], [5, 5, 0]); 
check("both over 21 the same round: higher total wins (rules silent, documented)", W.decide(r).winner === "b" && W.analyze(r).totals.b === 28);
r = H.bariboshi(H.room(), 10, 30); H.round(r, 1, [5, 5, 5], [5, 5, 5]); H.round(r, 2, [3, 3, 0], [3, 3, 0]);
d = W.decide(r); an = W.analyze(r);
check("tied at 21+: overtime round, not a draw yet", !d.done && an.overtime && an.totals.a === 21 && an.totals.b === 21 && an.current.n === 3);
H.round(r, 3, [5, 0, 0], [2, 0, 0]);
check("overtime round decides it", W.decide(r).winner === "a" && W.decide(r).reason === "score");
r = H.bariboshi(H.room(), 10, 30); for (let n = 1; n <= W.MAX_ROUNDS; n++) H.round(r, n, n <= 3 ? [5, 5, 5] : [0, 0, 0], n <= 3 ? [5, 5, 5] : [0, 0, 0]);
d = W.decide(r); check("level at the round cap: draw (tie)", d.done && d.winner === null && d.reason === "tie" && /Tie/.test(W.resultText(r, "a")));
check("result text names the score", /You win 21 to 15/.test(W.resultText(H.round(H.round(H.bariboshi(H.room(), 10, 30), 1, [5, 5, 5], [5, 3, 2]), 2, [2, 2, 2], [2, 3, 0]), "a")));
// steps / time never decide: lots of steps for the winner changes nothing
r = H.bariboshi(H.room(), 10, 30); r.players.a.steps = 99999; r.players.b.steps = 1; H.round(r, 1, [0, 0, 0], [5, 5, 5]); H.round(r, 2, [0, 0, 0], [5, 5, 5]);
check("steps are only logged: more steps does not matter, b wins on score", W.decide(r).winner === "b");
// ---- disputes (Art. 11): Bariboshi winner rules ----
r = H.bariboshi(H.room(), 10, 30); H.report(r, "a", 1, [5, 5, 5]); H.confirm(r, "b", 1, false); an = W.analyze(r);
check("disputed pack: Bariboshi winner (a) must rule; round not scored", an.disputed.length === 1 && an.disputed[0].ruler === "a" && an.disputed[0].who === "a" && an.actions.a.some((x) => x.type === "x") && !an.rounds.length);
check("only the Bariboshi winner may rule", W.allowed(r, "a", { k: "x", n: 1, who: "a", pack: [5, 5, 0] }) && !W.allowed(r, "b", { k: "x", n: 1, who: "a", pack: [0, 0, 0] }));
H.add(r, "a", { k: "x", n: 1, who: "a", pack: [5, 5, 0] }); H.report(r, "b", 1, [0, 0, 0]); H.confirm(r, "a", 1); an = W.analyze(r);
check("ruling replaces the disputed pack; resolved against the reporter", an.rulings.length === 1 && an.rulings[0].against === "a" && an.totals.a === 10 && an.rounds.length === 1);
r = H.bariboshi(H.room(), 10, 30); H.report(r, "a", 1, [5, 5, 5]); H.confirm(r, "b", 1, false); H.add(r, "a", { k: "x", n: 1, who: "a", pack: [5, 5, 5] });
check("ruling that upholds the report is against the disputer", W.analyze(r).rulings[0].against === "b");
// ---- forfeits (explicit, left, 30 s silence) ----
r = H.bariboshi(H.room(), 10, 30); r.players.b.result = { forfeit: true, at: 1 };
d = W.decide(r); check("forfeit: opponent wins at once", d.done && d.winner === "a" && d.reason === "forfeit" && /forfeited/.test(W.resultText(r, "a")));
r = H.bariboshi(H.room(), 10, 30); r.players.a.leftAt = 5; check("leaving after start = forfeit", W.decide(r).winner === "b");
r = H.room(); r.players.a.result = { forfeit: true, at: 1 }; r.players.b.leftAt = 3; d = W.decide(r); check("both out: no winner", d.done && d.winner === null && d.reason === "both-forfeit");
r = H.bariboshi(H.room({ startAt: 100000 }), 10, 30); r.players.b.seenAt = 105000;
check("30 s grace: seen 20 s ago is fine", !W.staleOpponent(r, "a", 125000) && W.staleOpponent(r, "a", 135001));
r.players.b.seenAt = undefined; delete r.players.b.seenAt; check("never heartbeat: grace counts from the shared start", !W.staleOpponent(r, "a", 129000) && W.staleOpponent(r, "a", 130001));
check("not stale outside live / after a decision / for a left player", !W.staleOpponent({ ...r, status: "countdown" }, "a", 999999) && !W.staleOpponent(H.room({ startAt: 1 , players: { a: H.seat("A"), b: H.seat("B", { leftAt: 1 }) } }), "a", 999999));
r.players.a.claimGone = true; d = W.decide(r);
check("claimGone ends the match: the silent player forfeits, claimer wins", d.done && d.winner === "a" && d.reason === "forfeit" && W.forfeitedBy(r, "b") && !W.forfeitedBy(r, "a"));
r = H.bariboshi(H.room(), 10, 30); H.round(r, 1, [5, 5, 5], [0, 0, 0]); H.round(r, 2, [5, 5, 5], [0, 0, 0]); r.players.b.leftAt = 9;
check("a decided score stays decided if the loser leaves afterwards", W.decide(r).reason === "score" && W.decide(r).winner === "a");
// ---- write-once and gating ----
r = H.bariboshi(H.room(), 10, 30);
check("write-once: a second report for the same round is rejected", W.allowed(r, "a", { k: "r", n: 1, pack: [5, 5, 5] }) && (H.report(r, "a", 1, [5, 5, 5]), !W.allowed(r, "a", { k: "r", n: 1, pack: [0, 0, 0] })));
check("can't report a future round or a bad pack", !W.allowed(H.bariboshi(H.room(), 10, 30), "a", { k: "r", n: 2, pack: [5, 5, 5] }) && !W.allowed(H.bariboshi(H.room(), 10, 30), "a", { k: "r", n: 1, pack: [5, 5, 4] }));
check("can't confirm your own report, or something not reported", !W.allowed(r, "a", { k: "c", t: "r", n: 1, ok: true }) && !W.allowed(H.bariboshi(H.room(), 10, 30), "b", { k: "c", t: "r", n: 1, ok: true }) && W.allowed(r, "b", { k: "c", t: "r", n: 1, ok: true }));
check("writes need a live room, a seat, and no forfeit/claim", !W.allowed(H.room({ status: "countdown" }), "a", { k: "b", n: 1, d: 5 }) && !W.allowed(H.room(), "z", { k: "b", n: 1, d: 5 }) && W.allowed(H.room(), "a", { k: "b", n: 1, d: 5 })
  && !W.allowed(H.room({ players: { a: H.seat("A", { result: { forfeit: true, at: 1 } }), b: H.seat("B") } }), "a", { k: "b", n: 1, d: 5 })
  && !W.allowed(H.room({ players: { a: H.seat("A"), b: H.seat("B", { claimGone: true }) } }), "a", { k: "b", n: 1, d: 5 }));
// ---- match states (waiting, ready, countdown, live, finished, cancelled) ----
const T0 = 1e6, tm = (v) => (typeof v === "number" ? v : null);
check("state waiting: one seat", W.matchState({ status: "waiting", createdAt: T0, players: { a: H.seat("A") } }, T0 + 1000, tm) === "waiting");
check("state ready: two seated, not started", W.matchState({ status: "waiting", createdAt: T0, players: { a: H.seat("A"), b: H.seat("B") } }, T0 + 1000, tm) === "ready");
check("state countdown", W.matchState(H.room({ status: "countdown" }), T0, tm) === "countdown");
check("state live", W.matchState(H.room(), T0, tm) === "live");
check("state finished", W.matchState(H.round(H.round(H.bariboshi(H.room(), 10, 30), 1, [5, 5, 5], [0, 0, 0]), 2, [5, 5, 5], [0, 0, 0]), T0, tm) === "finished");
check("state cancelled: abandoned, or nobody joined within 30 min", W.matchState({ status: "abandoned", players: {} }, T0, tm) === "cancelled" && W.matchState({ status: "waiting", createdAt: T0, players: { a: H.seat("A") } }, T0 + B.EXPIRE_MS + 1, tm) === "cancelled" && W.matchState(null) === "cancelled");
check("cancelled / unstarted rooms are never 'decided'", !W.decide({ status: "waiting", players: { a: H.seat("A"), b: H.seat("B") } }).done && !W.decide({ status: "abandoned", players: {} }).done);
// ---- pairing flags the match relies on (battle-rooms.js): code, exactly two seats, expiry ----
check("pairing: 4-char code, two seats max, expiry 30 min", B.CODE_LEN === 4 && B.MAX === 2 && B.EXPIRE_MS === 30 * 60 * 1000 && /full/.test(B.joinError({ status: "waiting", players: { a: {}, b: {} } }, "c", 0, 0)) && /expired/.test(B.joinError({ status: "waiting", players: { a: {} } }, "c", 31 * 60000, 0)));
// ---- write path over a mock room doc ----
let doc = H.bariboshi(H.room(), 10, 30), wrote = 0; const SV = { __sv: 1 };
const mfs = { ts: () => SV, toMs: tm, tx: async (c, fn) => fn({ get: () => JSON.parse(JSON.stringify(doc)), update: (p) => { wrote++; for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = doc; ks.slice(0, -1).forEach((s) => (o = o[s])); o[ks[ks.length - 1]] = v; } } }) };
(async () => {
  check("report() appends the entry once", (await W.report(mfs, "K7QX", "a", { k: "r", n: 1, pack: [5, 3, 2] })) === true && doc.players.a.rep.length === 3);
  check("report() refuses a duplicate", (await W.report(mfs, "K7QX", "a", { k: "r", n: 1, pack: [0, 0, 0] })) === false && doc.players.a.rep.filter((e) => e.k === "r").length === 1);
  check("report() refuses out of turn", (await W.report(mfs, "K7QX", "a", { k: "c", t: "r", n: 1, ok: true })) === false);
  check("forfeit() writes a forfeit result once", (await W.forfeit(mfs, "K7QX", "b")) === true && doc.players.b.result.forfeit === true && (await W.forfeit(mfs, "K7QX", "b")) === false);
  doc = H.bariboshi(H.room({ startAt: 100000 }), 10, 30);
  check("claimGone() refused while the opponent is fresh, allowed once stale", (await W.claimGone(mfs, "K7QX", "a", 120000)) === false && (await W.claimGone(mfs, "K7QX", "a", 140000)) === true && doc.players.a.claimGone === true && (await W.claimGone(mfs, "K7QX", "a", 140000)) === false);
  const pass = R.filter(Boolean).length;
  // ---- rules draft + index wiring ----
  const rules = fsx.readFileSync(__dirname + "/../firestore.rules", "utf8");
  const blk = rules.slice(rules.indexOf("match /washersBattles/{code}"), rules.indexOf("match /tutBattleStats"));
  check("rules: washersBattles block marked DRAFT, not yet published", /DRAFT, not yet published/.test(rules.slice(rules.indexOf("match /washersBattles") - 900, rules.indexOf("match /washersBattles"))));
  check("rules: no stray ';' before '&&' (syntax) in any battle room block", !/\);\s*&&/.test(rules));
  check("rules: seat fields cover the reports, claim and steps", blk.includes("'ready','seenAt','leftAt','opener','steps','result','rep','claimGone'"));
  check("rules: report entries are append-only and validated", blk.includes("function repOk(e)") && blk.includes("function packOk(a)") && /a\[0\] in \[0,2,3,5\]/.test(blk) && blk.includes("p.rep[0:o.rep.size()] == o.rep"));
  check("rules: claimGone only when the other seat's heartbeat is stale 30 s", /function otherStale\(\)/.test(blk) && blk.includes("30000") && blk.includes("claimGone"));
  check("rules: result still write-once forfeit; seenAt must be server time", blk.includes("resOk(") && blk.includes("p.seenAt == request.time"));
  check("rules: wager hooks inert without a stake (stakeOk / wagerReady pass when no stake)", blk.includes("!('stake' in n()) ||") && blk.includes("!('stake' in d()) ||"));
  check("rules: washers tokenTx clause untouched", /t\(\)\.source == 'washers' && t\(\)\.units == 'wins'\s+&& t\(\)\.qty == 1\s+&& t\(\)\.amount == 1\)\)/.test(rules));
  const html = fsx.readFileSync(__dirname + "/../index.html", "utf8");
  check("hub card points at the battle UI", /href="#washerbattle" data-battle="washers"/.test(html) && html.includes('id="washerbattle"'));
  check("module loaded, collection washersBattles", html.includes('src="/washers-battle.js"') && html.includes('mkBattleFs("washersBattles")'));
  check("user-facing spelling Zabba in the battle section", html.includes("Zabba Washer Battle") && !/>[^<]*\bZaba\b[^<]*</.test(html.slice(html.indexOf('id="washerbattle"'), html.indexOf('id="washerbattle"') + 4000)));
  check("match panel + scorekeeper wired in index", html.includes('id="wbMatch"') && /function wbMatchPaint\(/.test(html) && /WB\.report\(/.test(html) && /WB\.claimGone\(/.test(html) && /WB\.heartbeat\(/.test(html));
  const p2 = R.filter(Boolean).length; console.log(`${p2}/${R.length} passed`); process.exit(p2 === R.length ? 0 : 1);
})();
