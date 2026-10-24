// ZAB wagers: stake limits, escrow, payout exactly once, refunds, silent players, every battle type.
const WH = require("./lib/washers-match.js"), W = require("../zaba-wager.js"), Z = require("../zab-balance.js"), B = require("../battle-rooms.js"), fsx = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("min bet 1: 0, negatives, fractions rejected", !W.validStake(0) && !W.validStake(-2) && !W.validStake(1.5) && !W.validStake("3") && W.validStake(1) && /Minimum wager is 1/.test(W.stakeError(0)));
check("MAX_STAKE single config constant (null = open)", W.MAX_STAKE === null && W.validStake(1e6));
check("pot = 2 x stake", W.pot(1) === 2 && W.pot(5) === 10);
check("key includes room createdAt", W.roomKey("tut", "K7QX", 123) === "tut_K7QX_123");
// ---- mock admin store: path arrays, reads must precede writes in a transaction ----
let T = 1e9; const db = {}; const SV = { __ts: 1 };
const P = (p) => p.join("/"), clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
const deep = (v) => (v === SV ? T : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
function apply(d, p) { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; o[ks[ks.length - 1]] = deep(v); } return d; }
let readAfterWrite = false, lock = Promise.resolve();
const fs = { tx: (fn) => { const run = lock.then(async () => { const w = []; const out = await fn({ get: async (p) => { if (w.length) readAfterWrite = true; return clone(db[P(p)]); },
  set: (p, d) => w.push(() => (db[P(p)] = deep(d))), update: (p, x) => w.push(() => { if (!db[P(p)]) throw new Error("update missing " + P(p)); db[P(p)] = apply(db[P(p)], x); }) }); w.forEach((f) => f()); return out; }); lock = run.catch(() => {}); return run; },
  ts: () => SV, toMs: (v) => (typeof v === "number" ? v : null) };
const bal = (u) => (db["users/" + u] || {}).zabBalance;
const txs = (u) => Object.keys(db).filter((k) => k.startsWith("users/" + u + "/zabLedger/"));
const setUser = (u, n) => (db["users/" + u] = { uid: u, zabBalance: n, lastTxId: "", createdAt: 0, updatedAt: 0 });
let n = 0;
function mkRoom(game, stake, extra) { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k = n++; const code = "AB" + A[Math.floor(k / 32) % 32] + A[k % 32]; const createdAt = T - k;
  db[W.COL[game] + "/" + code] = Object.assign({ code, status: "waiting", createdAt, startAt: null, stake, players: { a: { name: "A", ready: false, joinedAt: T }, b: { name: "B", ready: false, joinedAt: T + 1 } } }, extra || {});
  return { code, key: W.roomKey(game, code, createdAt), ref: W.COL[game] + "/" + code }; }
const goLive = (r) => Object.assign(db[r.ref], { status: "live", startAt: T });
const caught = async (p) => { try { await p; return null; } catch (e) { return e; } };
(async () => {
  // ---- staking ----
  setUser("a", 10); setUser("b", 2);
  let r = mkRoom("washers", 3);
  let e = await caught(W.stake(fs, "b", "washers", r.code)); check("insufficient balance rejected (402), nothing debited", e && e.status === 402 && bal("b") === 2 && !db["wagers/" + r.key]);
  e = await caught(W.stake(fs, "z", "washers", r.code)); check("non-player can't stake", e && e.status === 403);
  e = await caught(W.stake(fs, null, "washers", r.code)); check("signed-out can't stake", e && e.status === 401);
  e = await caught(W.stake(fs, "a", "chess", r.code)); check("unknown game rejected", e && e.status === 400);
  let s = await W.stake(fs, "a", "washers", r.code); check("stake debits balance into escrow + ledger -3", s.ok && bal("a") === 7 && db["wagers/" + r.key].players.a.amount === 3 && db["users/a/zabLedger/stake-" + r.key].amount === -3 && db["users/a/zabLedger/stake-" + r.key].type === "stake");
  s = await W.stake(fs, "a", "washers", r.code); check("stake twice: idempotent, no second debit", s.already && bal("a") === 7);
  check("countdown gate: one stake is not enough", !W.allStaked(db[r.ref], db["wagers/" + r.key]));
  setUser("b", 5); await W.stake(fs, "b", "washers", r.code);
  check("both staked -> countdown allowed", W.allStaked(db[r.ref], db["wagers/" + r.key]) && bal("b") === 2);
  check("no-bet room never gated", W.allStaked({ players: { a: {}, b: {} } }, null));
  goLive(r);
  e = await caught(W.stake(fs, "a", "washers", r.code)); check("stakes close once started", e && e.status === 409);
  const bad = mkRoom("washers", 0); e = await caught(W.stake(fs, "a", "washers", bad.code)); check("room stake < 1 rejected", e && e.status === 400);
  // ---- washers payout ----
  /* Bariboshi match: a (10 cm) pitches first. played(r, A, B) = agreed rounds; a wins 21-0 in two rounds, b wins, or level at the cap. */
  const played = (x, pa, pb) => { const rm = db[x.ref]; rm.players.a.rep = []; rm.players.b.rep = []; WH.bariboshi(rm, 10, 30); pa.forEach((p, i) => WH.round(rm, i + 1, p, pb[i])); };
  const WIN_A = [[[5, 5, 5], [5, 5, 5]], [[0, 0, 0], [0, 0, 0]]], WIN_B = [[[0, 0, 0], [0, 0, 0]], [[5, 5, 5], [5, 5, 5]]];
  check("pending while playing", (await W.settle(fs, r.key, T)).pending);
  played(r, [[5, 5, 5], [5, 5, 5]], [[0, 0, 0], [0, 0, 0]]);
  let out = await W.settle(fs, r.key, T); check("washers: first to 21 wins pot 6 (2x3)", out.status === "paid" && out.winner === "a" && bal("a") === 13 && bal("b") === 2 && db["users/a/zabLedger/payout-" + r.key].amount === 6);
  out = await W.settle(fs, r.key, T); check("double settle: no double payout", out.already && bal("a") === 13 && txs("a").filter((k) => k.includes("payout")).length === 1);
  db["wagers/" + r.key].status = "open"; out = await W.settle(fs, r.key, T); check("even if status were reopened, payout ledger id blocks a second credit", bal("a") === 13);
  check("reads before writes in every transaction", !readAfterWrite);
  // ---- refunds ----
  async function staked(game, stake) { setUser("a", 20); setUser("b", 20); const x = mkRoom(game, stake); await W.stake(fs, "a", game, x.code); await W.stake(fs, "b", game, x.code); return x; }
  r = await staked("washers", 2); goLive(r); played(r, [[5, 5, 5], [3, 3, 0]], [[5, 5, 5], [3, 3, 0]]);
  out = await W.settle(fs, r.key, T); check("washers level at 21+: overtime, still pending", out.pending === true);
  r = await staked("washers", 2); goLive(r); played(r, Array.from({ length: 30 }, (_, i) => (i < 3 ? [5, 5, 5] : [0, 0, 0])), Array.from({ length: 30 }, (_, i) => (i < 3 ? [5, 5, 5] : [0, 0, 0])));
  out = await W.settle(fs, r.key, T); check("washers level at the round cap (draw): refund both", out.status === "refunded" && out.reason === "tie" && bal("a") === 20 && bal("b") === 20 && db["users/a/zabLedger/refund-" + r.key].amount === 2);
  r = await staked("washers", 2); goLive(r); db[r.ref].players.b.result = { forfeit: true, at: T };
  out = await W.settle(fs, r.key, T); check("forfeit loses the pot", out.status === "paid" && out.winner === "a" && bal("a") === 22 && bal("b") === 18);
  r = await staked("washers", 2); goLive(r); db[r.ref].players.a.leftAt = T;
  out = await W.settle(fs, r.key, T); check("left mid-battle loses", out.winner === "b" && bal("b") === 22);
  r = await staked("washers", 2); goLive(r); db[r.ref].players.a.claimGone = true;
  out = await W.settle(fs, r.key, T); check("opponent silent 30 s (claimGone): the silent player loses", out.winner === "a" && bal("a") === 22);
  r = await staked("washers", 2); goLive(r); played(r, [[5, 5, 5]], [[0, 0, 0]]);
  check("one round agreed, match not over: pending", (await W.settle(fs, r.key, T + 60000)).pending);
  r = await staked("washers", 2); goLive(r);
  out = await W.settle(fs, r.key, T + W.MAX_GAME_MS + 1000); check("both disconnected (nobody finished in 4 h): refund", out.status === "refunded" && out.reason === "both-silent" && bal("a") === 20);
  r = await staked("washers", 2);
  check("waiting room inside 30 min: pending", (await W.settle(fs, r.key, T + 60000)).pending);
  out = await W.settle(fs, r.key, T + B.EXPIRE_MS + 1000); check("room never started (expired): refund", out.reason === "expired" && bal("a") === 20 && bal("b") === 20);
  r = await staked("washers", 2); db[r.ref].status = "abandoned";
  out = await W.settle(fs, r.key, T); check("abandoned room: refund", out.reason === "never-started" && bal("a") === 20);
  r = await staked("washers", 2); db[r.ref] = Object.assign(clone(db[r.ref]), { createdAt: T + 5 });
  out = await W.settle(fs, r.key, T); check("code reused by a new room: old wager refunded", out.reason === "never-started" && bal("a") === 20);
  r = await staked("washers", 2); delete db[r.ref].players.b; db[r.ref].players.c = { name: "C" }; goLive(r);
  out = await W.settle(fs, r.key, T); check("seat swapped without stake: refund (safety)", out.reason === "not-staked" && bal("b") === 20);
  // ---- TUT ----
  r = await staked("tut", 4); goLive(r); Object.assign(db[r.ref], { status: "done", loserUid: "b", winnerUid: "a", loseReason: "knees" });
  out = await W.settle(fs, r.key, T); check("TUT: self-reported loss pays winner 8", out.winner === "a" && bal("a") === 24 && bal("b") === 16);
  r = await staked("tut", 4); goLive(r); Object.assign(db[r.ref].players.a, { tutMs: 90000, reps: 30 }); Object.assign(db[r.ref].players.b, { tutMs: 80000, reps: 40 });
  check("TUT before 3:00 + settle + grace: pending", (await W.settle(fs, r.key, T + 180000)).pending);
  out = await W.settle(fs, r.key, T + 180000 + 3000 + W.GRACE_MS + 1); check("TUT time-up nobody wrote: server decides more TUT wins (silent loser)", out.winner === "a");
  r = await staked("tut", 4); goLive(r); Object.assign(db[r.ref].players.a, { tutMs: 50000, reps: 10 }); Object.assign(db[r.ref].players.b, { tutMs: 50000, reps: 10 });
  out = await W.settle(fs, r.key, T + 300000); check("TUT draw: refund", out.status === "refunded" && out.reason === "draw" && bal("a") === 20);
  r = await staked("tut", 4); goLive(r);
  out = await W.settle(fs, r.key, T + 300000); check("TUT both disconnected (no stats): refund", out.status === "refunded");
  // ---- Plank ----
  r = await staked("plank", 1); goLive(r); db[r.ref].players.a.result = { holdMs: 30000, verified: true, at: T };
  out = await W.settle(fs, r.key, T + 40000); check("Plank: first to drop loses, 1-ZAB battle pays pot 2", out.winner === "b" && bal("b") === 21 && bal("a") === 19);
  r = await staked("plank", 1); goLive(r); db[r.ref].players.a.result = { holdMs: 30000, verified: false, at: T };
  out = await W.settle(fs, r.key, T + 40000); check("Plank unverified hold: refund + flag", out.flag === "unverified" && bal("a") === 20);
  r = await staked("plank", 1); goLive(r); db[r.ref].players.a.result = { holdMs: 30000, verified: true, at: T }; db[r.ref].players.b.result = { holdMs: 30000, verified: true, at: T };
  out = await W.settle(fs, r.key, T); check("Plank tie: refund", out.reason === "tie" && bal("b") === 20);
  r = await staked("plank", 1); goLive(r);
  out = await W.settle(fs, r.key, T + 7200000 + W.GRACE_MS + 1); check("Plank both silent past 2 h: refund", out.reason === "both-silent");
  check("still no read-after-write", !readAfterWrite);
  // ---- conservation: every settled wager pays out exactly what was staked ----
  let sumStake = 0, sumBack = 0; Object.keys(db).filter((k) => k.includes("/zabLedger/")).forEach((k) => { const t = db[k]; if (t.type === "stake") sumStake -= t.amount; if (t.type === "payout" || t.type === "refund") sumBack += t.amount; });
  const openStake = Object.keys(db).filter((k) => k.startsWith("wagers/") && db[k].status === "open").reduce((s2, k) => s2 + Object.values(db[k].players).reduce((x, p) => x + p.amount, 0), 0);
  check("ZAB conserved: staked = paid + refunded + still in escrow", sumStake === sumBack + openStake);
  // ---- outcome text, history lines ----
  check("result text", /won the pot: \+6/.test(W.outcomeText({ status: "paid", winner: "a", stake: 3 }, "a")) && /refunded: \+2 .*flagged/.test(W.outcomeText({ status: "refunded", flag: "unverified", stake: 2, players: { a: { amount: 2 } } }, "a")) && /Pot: 4/.test(W.outcomeText({ status: "open", stake: 2 }, "a")));
  const L = (t) => Z.txLine(t);
  check("history: stake negative, win / refund positive", L({ source: "wager", type: "stake", amount: -3, game: "tut", code: "K7QX" }).amount === "−3" && L({ source: "wager", type: "payout", amount: 6, game: "washers" }).source === "Battle win" && L({ source: "wager", type: "refund", amount: 3, game: "plank" }).qty === "Plank Battle" && L({ source: "pushups", amount: 2, qty: 20 }).amount === "+2");
  // ---- rules ----
  const rules = fsx.readFileSync(__dirname + "/../firestore.rules", "utf8");
  check("rules: wagers server-only (client write false)", /match \/wagers\/\{key\} \{\s*allow read: if request.auth != null;\s*allow write: if false;/.test(rules));
  check("rules: clients still earn-only zabLedger", rules.includes("t().uid == uid && t().type == 'earn'"));
  check("rules: all 3 rooms gate countdown on wagerReady + stake >= 1", (rules.match(/n\(\)\.startAt is int && wagerReady\(\)/g) || []).length === 3 && (rules.match(/&& stakeOk\(\); \}/g) || []).length === 3 && ["plank_", "tut_", "washers_"].every((g) => rules.includes("$('" + g + "' + code")));
  check("rules: washers zabLedger clause untouched", /t\(\)\.source == 'washers' && t\(\)\.units == 'wins'\s+&& t\(\)\.qty == 1\s+&& t\(\)\.amount == 1\)\)/.test(rules));
  // ---- functions + UI wiring ----
  const fn = (f) => fsx.readFileSync(__dirname + "/../netlify/functions/" + f, "utf8");
  check("functions exist and use common.js admin + auth", ["wager-stake.js", "wager-settle.js", "wager-sweep.js"].every((f) => /lib\/common/.test(fn(f))) && /uidFrom/.test(fn("wager-stake.js")) && /uidFrom/.test(fn("wager-settle.js")) && /schedule/.test(fn("wager-sweep.js")));
  check("settle checks caller is in the wager", /Not your wager/.test(fn("wager-settle.js")));
  const html = fsx.readFileSync(__dirname + "/../index.html", "utf8");
  check("UI: script, stake picker, join confirm, pot line, all 3 controllers gated", html.includes('src="/zaba-wager.js"') && /mkWager\("plank"/.test(html) && /mkWager\("tut"/.test(html) && /mkWager\("washers"/.test(html) && /Winner takes the pot/.test(html) && (html.match(/wagerGate\("(plank|tut|washers)"\)/g) || []).length === 3);
  check("user-facing bet text says ZAB + ring (no old currency wording)", /Wager ZAB<svg class="zab-ring"/.test(html) && !/Zab+a Tok[e]n/.test(html));
  // sweep helper
  const sw = require("../netlify/functions/wager-sweep.js");
  r = await staked("washers", 1); const fake = Object.assign({}, fs, { db: { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: Object.keys(db).filter((k) => k.startsWith("wagers/") && db[k].status === "open").map((k) => ({ id: k.slice(7) })) }) }) }) }) } });
  const so = await sw.sweep(fake, T + B.EXPIRE_MS + 1000); check("sweep refunds expired open wagers", so.refunded >= 1 && db["wagers/" + r.key].status === "refunded");
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.log("FAIL  crashed: " + e.stack); process.exit(1); });
