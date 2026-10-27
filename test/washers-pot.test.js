// Zab wagers in the washer battle (washers-pot.js): per-player amounts, write-once lock-in, agreement, one combined pot, payouts, refunds, conservation.
const P = require("../washers-pot.js"), W = require("../zaba-wager.js"), WH = require("./lib/washers-match.js"), HA = require("./lib/arena-match.js"), mockFs = require("./lib/mockfs.js"), fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const caught = async (p) => { try { await p; return null; } catch (e) { return e; } };
// ---------- label: the word Zab, THEN the ring, then the number ----------
const h1 = P.html("Lock in Zab 50? Final once confirmed."), h2 = P.html("Pot: Zab 0 so far"), h3 = P.html("You won Zab +75."), h4 = P.html("Not enough Zab: you have 3.");
check("amount renders as the word Zab, then the ring, then the number", /<span class="zab zab-wager">Zab<svg class="zab-ring"[^>]*>.*<\/svg> 50<\/span>/.test(h1) && /Zab<svg[^>]*>.*<\/svg> \+75<\/span>/.test(h3) && />Zab<svg class="zab-ring"/.test(h4));
check("the ring never comes before the word, and no ZAB / Zob appears in rendered wager text", [h1, h2, h3, h4, P.labelHtml(), P.amountHtml(5)].every((x) => !/<svg[^>]*class="zab-ring"[^>]*>(?:(?!<\/svg>).)*<\/svg>\s*Zab/.test(x) && !/ZAB|Zob|zab\b/.test(x.replace(/class="[^"]*"/g, ""))) && P.WORD === "Zab" && P.amountText(50) === "Zab 50");
check("html() escapes everything else (names / markup cannot inject)", P.html('<img src=x onerror=1> Zab 5').indexOf("<img") < 0 && /&lt;img/.test(P.html("<img>")));
check("Zab capitalisation is exact: the label constant is Zab (never ZAB, Zob, zab)", P.WORD === "Zab" && !/ZAB|Zob/.test(P.WORD));
// ---------- summary / validation ----------
const room = (w, ag, extra) => Object.assign({ code: "K7QX", status: "waiting", startAt: null, createdAt: 500, players: { a: { name: "A", ready: false, joinedAt: 1, ...(w[0] != null ? { wager: w[0] } : null), ...(ag ? { agreed: ag[0] } : null) }, b: { name: "B", ready: false, joinedAt: 2, ...(w[1] != null ? { wager: w[1] } : null), ...(ag ? { agreed: ag[1] } : null) } } }, extra || {});
let m = P.summary(room([50, 30]));
check("1v1 summary: total, all submitted, pot needed, nobody agreed yet", m.total === 80 && m.allSubmitted && m.needed && !m.allAgreed && m.full);
m = P.summary(room([50, null])); check("one seat still deciding: not all submitted, no pot yet", !m.allSubmitted && !m.needed && m.total === 50);
m = P.summary(room([0, 0])); check("everyone chose no wager: all submitted, no pot", m.allSubmitted && !m.needed && !m.allAgreed);
m = P.summary(room([50, 30], [80, 80])); check("both agreed to the same total: all agreed", m.allAgreed); m = P.summary(room([50, 30], [80, 50])); check("an agreement to a different total does not count", !m.allAgreed);
check("wager validity: integers 0..max only", [0, 1, 50, 1e9].every(P.validWager) && [-1, 1.5, "5", null, NaN, 1e9 + 1].every((x) => !P.validWager(x)));
check("submit errors: not seated, closed, already locked, bad amount, over balance", P.submitError(room([null, null]), "z", 5) && P.submitError(room([null, null], null, { status: "countdown", startAt: 5 }), "a", 5) && P.submitError(room([5, null]), "a", 7) && P.submitError(room([null, null]), "a", -2) && P.submitError(room([null, null]), "a", 50, 10) && !P.submitError(room([null, null]), "a", 0) && !P.submitError(room([null, null]), "a", 50, 50));
// ---------- split math + conservation ----------
let okSplit = true; for (let total = 0; total <= 200; total++) for (let n = 1; n <= 4; n++) { const s = P.split(total, n); if (s.length !== n || s.reduce((x, y) => x + y, 0) !== total || Math.max(...s) - Math.min(...s) > 1 || !s.every(Number.isInteger)) okSplit = false; }
check("split: integers, sum is exactly the pot, parts differ by at most 1 (conservation for 0..200 x 1..4 winners)", okSplit && P.split(7, 2).join() === "4,3" && P.split(1, 2).join() === "1,0" && P.split(0, 2).join() === "0,0");
// ---------- client writes (mock room fs): one-time lock-in, tamper tests ----------
(async () => {
  const S = mockFs(), put = (d) => { S.docs.K7QX = JSON.parse(JSON.stringify(d)); };
  put(room([null, null]));
  const r1 = await P.submit(S.fs, "K7QX", "a", 50, 100); check("first submit writes seats' own wager once", r1.ok && S.docs.K7QX.players.a.wager === 50 && S.docs.K7QX.players.b.wager === undefined);
  for (const [lbl, v] of [["higher", 60], ["lower", 10], ["zero", 0], ["same", 50]]) { const e = await caught(P.submit(S.fs, "K7QX", "a", v, 100)); check(`second write rejected (${lbl}): the first value is final`, e && /already final/.test(e.message) && S.docs.K7QX.players.a.wager === 50); }
  let e = await caught(P.submit(S.fs, "K7QX", "zz", 5)); check("a non-seated user cannot write a wager", e && S.docs.K7QX.players.zz === undefined);
  e = await caught(P.submit(S.fs, "K7QX", "b", 500, 100)); check("over the player's own balance is refused", e && /Not enough Zab/.test(e.message) && S.docs.K7QX.players.b.wager === undefined);
  e = await caught(P.submit(S.fs, "K7QX", "b", -5, 100)); check("negative / fractional / text amounts refused", e && !!(await caught(P.submit(S.fs, "K7QX", "b", 1.5))) && !!(await caught(P.submit(S.fs, "K7QX", "b", "9"))) && S.docs.K7QX.players.b.wager === undefined);
  e = await caught(P.agree(S.fs, "K7QX", "a")); check("agreeing before everyone locked in is refused", e && /lock in/.test(e.message) && S.docs.K7QX.players.a.agreed === undefined);
  await P.submit(S.fs, "K7QX", "b", 30, 100); const ag = await P.agree(S.fs, "K7QX", "a");
  check("after all locked in, agree records the pot total and marks the player ready; amounts are untouched", ag.agreed === 80 && S.docs.K7QX.players.a.agreed === 80 && S.docs.K7QX.players.a.ready === true && S.docs.K7QX.players.a.wager === 50 && S.docs.K7QX.players.b.wager === 30);
  e = await caught(P.agree(S.fs, "K7QX", "a")); check("agreeing twice to the same pot is refused", e && /already agreed/.test(e.message));
  // leave before the pot forms: seat (and its locked amount) disappears, the other keeps theirs; a new taker locks in their OWN amount
  S.docs.K7QX.players = { a: S.docs.K7QX.players.a }; // b left
  check("a player who left takes their locked amount away; the remaining amount stays locked", S.docs.K7QX.players.a.wager === 50 && !P.summary(S.docs.K7QX).allSubmitted);
  S.docs.K7QX.players.c = { name: "C", ready: false, joinedAt: 3 }; await P.submit(S.fs, "K7QX", "c", 5, 100);
  check("the refilled seat locks in its own amount; the old agreement (80) no longer matches the new pot (55)", P.summary(S.docs.K7QX).total === 55 && !P.summary(S.docs.K7QX).allAgreed && !P.agreeError(S.docs.K7QX, "a"));
  put(room([null, null], null, { status: "countdown", startAt: 9 })); e = await caught(P.submit(S.fs, "K7QX", "a", 5)); check("no wager can be written once the countdown has started", e && /close/.test(e.message));
  // ---------- server: pot formation + settle with the admin-style fake db ----------
  let T = 1e9; const db = {}; const SV = { __ts: 1 }; const PA = (p) => p.join("/"), clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
  const deep = (v) => (v === SV ? T : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
  const apply = (d, p) => { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; o[ks[ks.length - 1]] = deep(v); } return d; };
  let raw = false, lock = Promise.resolve(), writes = 0;
  const fs = { tx: (fn) => { const run = lock.then(async () => { const w = []; const out = await fn({ get: async (p) => { if (w.length) raw = true; return clone(db[PA(p)]); }, set: (p, d) => w.push(() => (db[PA(p)] = deep(d))), update: (p, x) => w.push(() => { if (!db[PA(p)]) throw new Error("update missing " + PA(p)); db[PA(p)] = apply(db[PA(p)], x); }) }); w.forEach((f) => { f(); writes++; }); return out; }); lock = run.catch(() => {}); return run; }, ts: () => SV, toMs: (v) => (typeof v === "number" ? v : null) };
  const bal = (u) => (db["users/" + u] || {}).zabBalance, setU = (u, n) => (db["users/" + u] = { uid: u, zabBalance: n, lastTxId: "", createdAt: 0, updatedAt: 0 });
  const sumBal = (us) => us.reduce((x, u) => x + (bal(u) || 0), 0);
  const escrowTotal = () => Object.keys(db).filter((k) => k.startsWith("wagers/") && db[k].status === "open").reduce((x, k) => x + db[k].total, 0);
  const seat1 = (nm, wager, ag) => ({ name: nm, ready: !!ag, joinedAt: 1, wager, ...(ag ? { agreed: ag } : null) });
    let n = 0; const CODES = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const nextCode = () => { const k = n++; return "Q" + CODES[Math.floor(k / 32) % 32] + CODES[k % 32] + "2"; };
  const mkRoom = (wa, wb, agreeBoth = true) => { const code = nextCode(), t = wa + wb; db["washersBattles/" + code] = { code, status: "waiting", startAt: null, createdAt: T - n, players: { a: seat1("A", wa, agreeBoth && t > 0 ? t : 0), b: seat1("B", wb, agreeBoth && t > 0 ? t : 0) } };
    if (!agreeBoth || t === 0) { delete db["washersBattles/" + code].players.a.agreed; delete db["washersBattles/" + code].players.b.agreed; } return { code, ref: "washersBattles/" + code, key: P.potKey("room", code, T - n) }; };
  const goLive1 = (r, pa, pb) => { const rm = db[r.ref]; rm.status = "live"; rm.startAt = T; rm.players.a.rep = []; rm.players.b.rep = []; WH.bariboshi(rm, 10, 30); pa.forEach((p, i) => WH.round(rm, i + 1, p, pb[i])); };
  const WIN_A = [[[5, 5, 5], [5, 5, 5]], [[0, 0, 0], [0, 0, 0]]];
  setU("a", 100); setU("b", 100); setU("c", 100); setU("d", 100);
  // --- 1v1 unequal wagers: ONE combined pot of both full amounts (no matching, no refund of the excess) ---
  let r = mkRoom(50, 30), before = sumBal(["a", "b"]);
  let fp = await P.formPot(fs, "a", "room", r.code); const wg = db["wagers/" + r.key];
  check("pot forms once everyone locked in and agreed: each full amount debited, escrow holds the combined pot", fp.ok && fp.total === 80 && bal("a") === 50 && bal("b") === 70 && wg.pot === true && wg.total === 80 && wg.players.a.amount === 50 && wg.players.b.amount === 30 && wg.status === "open" && wg.kind === "room" && db["users/a/zabLedger/stake-" + r.key].amount === -50);
  fp = await P.formPot(fs, "b", "room", r.code); check("forming twice is idempotent: no second debit", fp.already && bal("a") === 50 && bal("b") === 70);
  check("countdown gate: covered by the escrow, and not covered without it", P.canStart(db[r.ref], wg) && !P.canStart(db[r.ref], null) && P.canStart(room([0, 0]), null));
  check("pot escrow conserves: balances + escrow unchanged", sumBal(["a", "b"]) + escrowTotal() === before);
  check("the washers rooms' own settle still goes through the same function: pending while live", (goLive1(r, [], []), (await W.settle(fs, r.key, T)).pending === true));
  goLive1(r, WIN_A[0], WIN_A[1]); let out = await W.settle(fs, r.key, T);
  check("winner of a 1v1 takes the WHOLE pot (80)", out.status === "paid" && out.winner === "a" && bal("a") === 130 && bal("b") === 70 && db["users/a/zabLedger/payout-" + r.key].amount === 80);
  out = await W.settle(fs, r.key, T); check("settle is idempotent: second settle pays nothing", out.already && bal("a") === 130 && bal("b") === 70);
  db["wagers/" + r.key].status = "open"; await W.settle(fs, r.key, T); check("even a reopened guard cannot double-pay (ledger id is create-once)", bal("a") === 130 && bal("b") === 70);
  check("conservation after payout: total Zab unchanged", sumBal(["a", "b"]) === before && !raw);
  // --- 1v1: loser's side first / tie / forfeit / cancel / expired ---
  r = mkRoom(10, 40); before = sumBal(["a", "b"]); await P.formPot(fs, "a", "room", r.code); goLive1(r, [[0, 0, 0], [0, 0, 0]], [[5, 5, 5], [5, 5, 5]]); // b (30 cm) loses the opening? a pitches first; b wins by score
  out = await W.settle(fs, r.key, T); check("1v1 the higher staker can lose their full amount: pot goes to the winner", out.status === "paid" && sumBal(["a", "b"]) === before && bal(out.winner) > 0);
  r = mkRoom(20, 20); before = sumBal(["a", "b"]); await P.formPot(fs, "a", "room", r.code); goLive1(r, Array.from({ length: 30 }, (_, i) => (i < 3 ? [5, 5, 5] : [0, 0, 0])), Array.from({ length: 30 }, (_, i) => (i < 3 ? [5, 5, 5] : [0, 0, 0])));
  out = await W.settle(fs, r.key, T); check("1v1 tie: everyone gets their OWN amount back", out.status === "refunded" && out.reason === "tie" && sumBal(["a", "b"]) === before && db["users/a/zabLedger/refund-" + r.key].amount === 20);
  r = mkRoom(15, 5); before = sumBal(["a", "b"]); await P.formPot(fs, "a", "room", r.code); db[r.ref].status = "abandoned"; out = await W.settle(fs, r.key, T);
  check("room abandoned after the pot formed: full refunds of each own amount", out.status === "refunded" && sumBal(["a", "b"]) === before && db["users/b/zabLedger/refund-" + r.key].amount === 5);
  r = mkRoom(7, 9); before = sumBal(["a", "b"]); await P.formPot(fs, "a", "room", r.code); out = await W.settle(fs, r.key, T + require("../battle-rooms.js").EXPIRE_MS + 1e6);
  check("a pot whose match never starts expires into full refunds", out.status === "refunded" && out.reason === "expired" && sumBal(["a", "b"]) === before);
  r = mkRoom(6, 4); before = sumBal(["a", "b"]); await P.formPot(fs, "a", "room", r.code); goLive1(r, [], []); db[r.ref].players.b.result = { forfeit: true, at: T }; out = await W.settle(fs, r.key, T);
  check("forfeit: the other player wins the whole pot", out.status === "paid" && out.winner === "a" && sumBal(["a", "b"]) === before && db["users/a/zabLedger/payout-" + r.key].amount === 10);
  // --- pot refusals ---
  r = mkRoom(5, 5, false); e = await caught(P.formPot(fs, "a", "room", r.code)); check("no pot without everyone's agreement (409), nothing debited", e && e.status === 409 && !db["wagers/" + r.key]);
  r = mkRoom(0, 0); fp = await P.formPot(fs, "a", "room", r.code); check("everyone chose no wager: nothing escrowed, no pot", fp.none && !db["wagers/" + r.key]);
  r = mkRoom(5, 5); db[r.ref].players.b.wager = undefined; delete db[r.ref].players.b.wager; e = await caught(P.formPot(fs, "a", "room", r.code)); check("a player who has not locked in blocks the pot", e && e.status === 409);
  setU("poor", 3); r = mkRoom(5, 5); db[r.ref].players = { a: db[r.ref].players.a, poor: Object.assign({}, db[r.ref].players.b) }; const b0 = [bal("a"), bal("poor")];
  e = await caught(P.formPot(fs, "a", "room", r.code)); check("a player whose balance fell below their wager: 402, nobody charged, no escrow (all or nothing)", e && e.status === 402 && bal("a") === b0[0] && bal("poor") === b0[1] && !db["wagers/" + r.key] && !/poor/.test(e.message));
  e = await caught(P.formPot(fs, "poor", "room", r.code)); check("the underfunded player is told their own shortfall", e && e.status === 402 && /Not enough Zab: you have 3/.test(e.message));
  e = await caught(P.formPot(fs, "zzz", "room", r.code)); check("only a seated player can ask for the pot", e && e.status === 403);
  e = await caught(P.formPot(fs, null, "room", r.code)); check("signed-out refused", e && e.status === 401);
  db[r.ref].status = "countdown"; db[r.ref].startAt = 5; e = await caught(P.formPot(fs, "a", "room", r.code)); check("no pot once the countdown has started", e && e.status === 409);
  // --- 2v2: one combined pot, winning team splits equally ---
  const mkArena = (ws, agreed = true) => { const code = nextCode(), a = HA.arena({ code, status: "waiting", startAt: null, createdAt: T - n }); const tot = ws.reduce((x, y) => x + y, 0);
    HA.UIDS.forEach((u, i) => { a.seats[u].wager = ws[i]; a.seats[u].ready = !!agreed; if (agreed && tot > 0) a.seats[u].agreed = tot; }); db["washersArenas/" + code] = a; return { code, ref: "washersArenas/" + code, key: P.potKey("arena", code, T - n) }; };
  const live4 = (x, packs) => { const a = db[x.ref]; a.status = "live"; a.startAt = T; HA.UIDS.forEach((u) => (a.seats[u].rep = [])); HA.bariboshi(a, [10, 40, 30, 50]); if (packs) HA.round(a, 1, packs); };
  ["a1", "a2", "b1", "b2"].forEach((u) => setU(u, 100)); let ar = mkArena([30, 0, 10, 20]); before = sumBal(["a1", "a2", "b1", "b2"]);
  fp = await P.formPot(fs, "b2", "arena", ar.code); const aw = db["wagers/" + ar.key];
  check("2v2: one combined pot of all four amounts; zero-amount seats are listed but not debited", fp.ok && fp.total === 60 && aw.kind === "arena" && aw.game === "arena" && Object.keys(aw.players).length === 4 && bal("a1") === 70 && bal("a2") === 100 && bal("b1") === 90 && bal("b2") === 80 && !db["users/a2/zabLedger/stake-" + ar.key]);
  check("2v2 countdown gate follows the escrow", P.canStart(db[ar.ref], aw) && !P.canStart(db[ar.ref], null));
  live4(ar, [[5, 5, 5], [5, 5, 5], [0, 0, 0], [0, 0, 0]]); out = await W.settle(fs, ar.key, T);
  check("2v2: winning team splits the pot equally (60 -> 30 + 30), losers get nothing back", out.status === "paid" && bal("a1") === 100 && bal("a2") === 130 && bal("b1") === 90 && bal("b2") === 80 && sumBal(["a1", "a2", "b1", "b2"]) === before);
  out = await W.settle(fs, ar.key, T); check("2v2 settle idempotent", out.already && bal("a2") === 130);
  ar = mkArena([3, 4, 0, 0]); before = sumBal(["a1", "a2", "b1", "b2"]); const b1b = bal("b1"), b2b = bal("b2"); await P.formPot(fs, "a1", "arena", ar.code); live4(ar, [[0, 0, 0], [0, 0, 0], [5, 5, 5], [5, 5, 5]]); out = await W.settle(fs, ar.key, T);
  check("2v2 the winning team staked nothing and the losing team staked: the winners still split the whole pot (7 -> 4 + 3, lowest seat gets the odd Zab)", out.status === "paid" && bal("b1") === b1b + 4 && bal("b2") === b2b + 3 && sumBal(["a1", "a2", "b1", "b2"]) === before);
  ar = mkArena([5, 5, 5, 5]); before = sumBal(["a1", "a2", "b1", "b2"]); await P.formPot(fs, "a1", "arena", ar.code); live4(ar, null);
  for (let k = 1; k <= 30; k++) HA.round(db[ar.ref], k, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]); out = await W.settle(fs, ar.key, T);
  check("2v2 tie / cap reached: each player gets their OWN amount back", out.status === "refunded" && sumBal(["a1", "a2", "b1", "b2"]) === before && db["users/a2/zabLedger/refund-" + ar.key].amount === 5);
  ar = mkArena([8, 0, 0, 2]); before = sumBal(["a1", "a2", "b1", "b2"]); await P.formPot(fs, "a1", "arena", ar.code); db[ar.ref].status = "abandoned"; out = await W.settle(fs, ar.key, T);
  check("2v2 cancelled arena after the pot: full refunds", out.status === "refunded" && sumBal(["a1", "a2", "b1", "b2"]) === before);
  ar = mkArena([8, 0, 0, 2]); before = sumBal(["a1", "a2", "b1", "b2"]); await P.formPot(fs, "a1", "arena", ar.code); live4(ar, null); ["b1", "b2"].forEach((u) => (db[ar.ref].seats[u].result = { forfeit: true, at: T })); out = await W.settle(fs, ar.key, T);
  check("2v2 whole team forfeits: the other team splits the pot (10 -> 5 + 5)", out.status === "paid" && db["users/a1/zabLedger/payout-" + ar.key].amount === 5 && db["users/a2/zabLedger/payout-" + ar.key].amount === 5 && sumBal(["a1", "a2", "b1", "b2"]) === before);
  ar = mkArena([8, 0, 0, 2]); await P.formPot(fs, "a1", "arena", ar.code); live4(ar, null); out = await W.settle(fs, ar.key, T); check("2v2 still playing: pending, escrow kept", out.pending === true && db["wagers/" + ar.key].status === "open");
  ar = mkArena([2, 0, 0, 0], false); e = await caught(P.formPot(fs, "a1", "arena", ar.code)); check("2v2 needs all four to agree", e && e.status === 409 && !db["wagers/" + ar.key]);
  db[ar.ref].seats.b2 = undefined; delete db[ar.ref].seats.b2; e = await caught(P.formPot(fs, "a1", "arena", ar.code)); check("2v2 needs all four seats filled", e && e.status === 409);
  check("every transaction reads before it writes", !raw);
  // ---------- sweep covers pot wagers ----------
  const sw = require("../netlify/functions/wager-sweep.js"); ar = mkArena([4, 4, 0, 0]); await P.formPot(fs, "a1", "arena", ar.code); db[ar.ref].status = "abandoned";
  const fake = Object.assign({}, fs, { db: { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: Object.keys(db).filter((k) => k.startsWith("wagers/") && db[k].status === "open").map((k) => ({ id: k.slice(7) })) }) }) }) }) } });
  const so = await sw.sweep(fake, T); check("the 5-minute sweep refunds abandoned pots", so.refunded >= 1 && db["wagers/" + ar.key].status === "refunded");
  // ---------- function wiring ----------
  const fn = (f) => fsx.readFileSync(__dirname + "/../netlify/functions/" + f, "utf8");
  check("wager-pot function: POST only, signed-in caller, admin SDK env, calls formPot; settle accepts arena keys", /POST only/.test(fn("wager-pot.js")) && /uidFrom/.test(fn("wager-pot.js")) && /formPot/.test(fn("wager-pot.js")) && /FIREBASE_SERVICE_ACCOUNT/.test(fn("wager-pot.js")) && /washers\|arena\|tut\|plank/.test(fn("wager-settle.js")));
  check("the legacy shared-stake MIN is unchanged and the pot module agrees with it", W.MIN_STAKE === P.MIN_WAGER && W.pot(3) === 6);
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.log("FAIL  crashed: " + e.stack); process.exit(1); });
