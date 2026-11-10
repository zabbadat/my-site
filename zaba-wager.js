/* ZAB wagers on battles (TUT Battles, Plank Battles, Zabba Washer Battle). SERVER-SIDE spending only:
 * stake / payout / refund run in netlify/functions (admin SDK); clients stay earn-only (rules).
 * Room: creator sets room.stake (ZAB in tenths, >= MIN_STAKE) once at create. Each seated player stakes via wager-stake.
 * Escrow: wagers/{key}, key = <game>_<code>_<room createdAt ms> (room codes are reused, createdAt is not):
 *   { key, game, code, roomCreatedAt, stake, players: { [uid]: { amount, at } }, status: open|paid|refunded,
 *     winner?, reason?, flag?, settledAt? }
 * Ledger (users/{uid}/zabLedger, written by the server only), ids fixed per wager so retries can't repeat:
 *   stake-<key>  { type:'stake',  amount:-stake } · payout-<key> { type:'payout', amount:+pot } · refund-<key> { type:'refund', amount:+own stake }
 * Pot = 2 x stake. Countdown can't start until both seated players have staked (rules + client canStart).
 * Outcome uses the same game logic as the phones (washers-battle.js, tut-battle.js, plank-battle.js).
 * Browser: window.ZabaWager (pure parts). Node: require("./zaba-wager.js").
 */
(function (root) {
  /* static require()s (not a variable) so the Netlify function bundler follows and ships these files */
  const NODE = typeof module !== "undefined" && !!module.exports;
  const WB = (NODE ? require("./washers-battle.js") : root && root.ZabbaWasherBattle), TB = (NODE ? require("./tut-battle.js") : root && root.ZabbaTutBattle),
    PB = (NODE ? require("./plank-battle.js") : root && root.ZabbaPlankBattle), BR = (NODE ? require("./battle-rooms.js") : root && root.ZabbaBattles),
    POT = (NODE ? require("./washers-pot.js") : root && root.ZabbaWasherPot); // per-player washers pot (washers-pot.js): wagers with pot:true settle through POT.plan
  // ---- config (user decision pending: MAX_STAKE null = no upper limit) ----
  const MIN_STAKE = 0.1;               // stakes are ZAB in tenths, like balances and sends
  const MAX_STAKE = null;
  const COL = { washers: "washersBattles", tut: "tutBattles", plank: "battles" };
  const LABEL = { washers: "Zabba Washer Battle", tut: "TUT Battle", plank: "Plank Battle" };
  const GRACE_MS = 60000;              // after a timed battle should have ended
  const SILENT_MS = 15 * 60000;        // legacy constant (unused by washers since the Bariboshi match)
  const MAX_GAME_MS = 4 * 3600000;     // nobody finished after this -> both disconnected -> refund
  const MIN_WASHERS_MS = 60000;        // legacy constant (unused)
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const ZC = NODE ? require("./zab-currency.js") : root && root.ZabCurrency;
  const ETD = NODE ? require("./et-day.js") : root && root.ZabbadatEtDay; // same-pair day = Eastern day
  const balOf = (u) => (u && ZC.isZab(u.zabBalance) ? ZC.roundZab(u.zabBalance) : 0); // balances and stakes are tenths (zab-currency.js)
  function validStake(n) { return ZC.isZab(n) && n >= MIN_STAKE && (MAX_STAKE == null || n <= MAX_STAKE); }
  function stakeError(n) {
    if (!ZC.isZab(n) || n < MIN_STAKE) return "Wagers are at least " + ZC.fmtZab(MIN_STAKE) + " ZAB, in steps of 0.1.";
    if (MAX_STAKE != null && n > MAX_STAKE) return "Maximum wager is " + ZC.fmtZab(MAX_STAKE) + " ZAB.";
    return "";
  }
  const pot = (stake) => ZC.roundZab(2 * stake);
  const roomKey = (game, code, createdMs) => game + "_" + code + "_" + createdMs;
  const isGame = (g) => Object.prototype.hasOwnProperty.call(COL, g);
  const seated = (r) => Object.keys((r && r.players) || {});
  const stakers = (w) => Object.keys((w && w.players) || {});
  // Both seated players have stakes in escrow (client-side gate for the countdown; rules enforce the same).
  function allStaked(room, w) { const s = seated(room); return !room || !room.stake || (s.length === 2 && !!w && w.status === "open" && s.every((u) => w.players && w.players[u])); }

  // Game decision -> { state: pending | win | refund, winner?, reason, flag? }
  function gameOutcome(game, room, nowMs, toMs) {
    const start = room.startAt;
    if (game === "washers") {
      // Bariboshi match (washers-battle.js): both phones derive the same decision from the reports; wager uses it as-is.
      const d = WB.decide(room);
      if (d.done) return d.winner == null ? { state: "refund", reason: d.reason } : { state: "win", winner: d.winner, reason: d.reason };
      if (start != null && nowMs - start > MAX_GAME_MS) return { state: "refund", reason: "both-silent" };
      return { state: "pending" };
    }
    if (game === "tut") {
      if (room.status === "done" && room.loserUid && room.winnerUid) return { state: "win", winner: room.winnerUid, reason: room.loseReason || "loss" };
      // Left the battle or 30 s of heartbeat silence before any result: forfeit, the other player wins the pot (both out: refund).
      const ff = TB.forfeitLoser(room);
      if (ff) return ff.both ? { state: "refund", reason: "both-out" } : { state: "win", winner: TB.other(room, ff.loser), reason: "forfeit" };
      const end = TB.endAt(room);
      if (end != null && nowMs > end + TB.RULES.settleMs + GRACE_MS) {
        const loser = TB.timeUpLoser(room);
        if (loser == null) return { state: "refund", reason: "draw" }; // includes both silent with equal (zero) TUT
        return { state: "win", winner: TB.other(room, loser), reason: "time" };
      }
      return { state: "pending" };
    }
    if (game === "plank") {
      const d = PB.decide(room, nowMs);
      const bad = seated(room).find((u) => { const x = room.players[u].result; return x && !x.forfeit && x.verified === false; });
      if (d.done) {
        if (d.winner == null) return { state: "refund", reason: d.reason };
        if (bad) return { state: "refund", reason: "unverified", flag: "unverified" };
        return { state: "win", winner: d.winner, reason: d.reason };
      }
      if (start != null && nowMs - start > PB.MAX_MS + GRACE_MS) return { state: "refund", reason: "both-silent" };
      return { state: "pending" };
    }
    return { state: "pending" };
  }
  // ---- Server result checks: a reported result must be plausible before a pot is paid. A failed check refunds every
  // stake with flag "implausible" (outcomeText explains it). Only wins are checked; refunds need no check.
  const SLACK_MS = 10000, MIN_WIN_MS = 60000, MAX_REP_MS = 400;
  const PAIR_FLAG = 5;                 // same players settled this many times in one UTC day -> wager flagged "repeat-pair" (paid as normal)
  const NOT_PLAYED = ["never-started", "expired", "not-staked", "seats-changed"];
  // -> null (plausible) or a short reason. game: washers | arena | tut | plank. reason = the outcome reason (forfeit etc.).
  function resultCheck(game, room, nowMs, toMs, reason) {
    toMs = toMs || ((v) => (v && v.toMillis ? v.toMillis() : isInt(v) ? v : null));
    if (!room || !(room.players || room.seats)) return "no room";
    const start = toMs(room.startAt); if (start == null) return "no start time";
    const elapsed = nowMs - start; if (elapsed < 0) return "start time in the future";
    const ids = seated(room);
    if (game === "washers" || game === "arena") {
      if (reason !== "forfeit" && elapsed < MIN_WIN_MS) return "finished faster than a real game";
      return null;
    }
    if (game === "tut") {
      const cap = Math.min(elapsed, TB.RULES.durationMs) + SLACK_MS;
      for (const u of ids) {
        const p = room.players[u] || {}, tut = Number(p.tutMs) || 0, reps = Number(p.reps) || 0;
        if (tut < 0 || tut > cap) return "TUT longer than the battle";
        if (reps > tut / MAX_REP_MS + 1) return "more reps than the time allows";
      }
      if (room.status === "done" && (room.winnerUid || room.loserUid)) {
        if (ids.indexOf(room.winnerUid) < 0 || ids.indexOf(room.loserUid) < 0 || room.winnerUid === room.loserUid) return "result names someone who isn't seated";
      }
      return null;
    }
    if (game === "plank") {
      for (const u of ids) {
        const x = (room.players[u] || {}).result; if (!x || x.forfeit) continue;
        const hold = Number(x.holdMs) || 0, at = toMs(x.at);
        if (hold < 0 || hold > PB.MAX_MS || hold > elapsed + SLACK_MS) return "hold longer than the battle";
        if (at != null && (at < start - SLACK_MS || at > nowMs + SLACK_MS || hold > at - start + SLACK_MS)) return "hold reported outside the battle time";
      }
      return null;
    }
    return null;
  }
  const pairKeyOf = (w) => Object.keys((w && w.players) || {}).sort().join("_");
  // Full plan for an open wager. room may be null or a newer room reusing the code.
  // -> { action: pending } | { action: payout, winner, amount, refunds:[{uid,amount}], reason } | { action: refund, refunds, reason, flag? }
  function plan(w, room, nowMs, toMs) {
    toMs = toMs || ((v) => (v && v.toMillis ? v.toMillis() : isInt(v) ? v : null));
    if (!w || w.status !== "open") return { action: "none" };
    const all = stakers(w).map((u) => ({ uid: u, amount: w.players[u].amount }));
    const refundAll = (reason, flag) => ({ action: "refund", refunds: all, reason, flag: flag || null });
    const sameRoom = room && toMs(room.createdAt) === w.roomCreatedAt;
    if (!sameRoom || room.status === "abandoned") return refundAll("never-started");
    if (!BR.started(room)) {
      if (nowMs - w.roomCreatedAt > BR.EXPIRE_MS) return refundAll("expired");
      return { action: "pending" };
    }
    const s = seated(room);
    if (s.length !== 2 || !s.every((u) => w.players[u])) return refundAll("not-staked"); // safety: should not start
    const o = gameOutcome(w.game, room, nowMs, toMs);
    if (o.state === "pending") return { action: "pending" };
    if (o.state === "refund") return refundAll(o.reason, o.flag);
    const amount = ZC.roundZab(s.reduce((n, u) => n + w.players[u].amount, 0));
    return { action: "payout", winner: o.winner, amount, reason: o.reason, refunds: all.filter((x) => s.indexOf(x.uid) < 0) };
  }

  /* fs adapter (server): { tx(fn) -> Promise; fn(t): t.get(path) -> Promise<data|null>, t.set(path,data), t.update(path,patch);
   *   ts() server timestamp; toMs(v) } paths are arrays. All reads happen before writes (Firestore transactions). */
  const ledger = (uid, type, amount, w, extra) => Object.assign({ uid, type, source: "wager", game: w.game, amount, wager: w.key, code: w.code }, extra || {});
  function stake(fs, uid, game, rawCode) {
    if (!uid) return Promise.reject(err(401, "Sign in to wager."));
    if (!isGame(game)) return Promise.reject(err(400, "Unknown battle."));
    const code = BR.normCode(rawCode); if (!BR.isValidCode(code)) return Promise.reject(err(400, "Bad room code."));
    return fs.tx((t) => t.get([COL[game], code]).then((room) => {
      if (!room) throw err(404, "No room with that code.");
      if (!room.players || !(uid in room.players)) throw err(403, "Join the room first.");
      if (room.status !== "waiting" || room.startAt != null) throw err(409, "Stakes close when the countdown starts.");
      if (!validStake(room.stake)) throw err(400, stakeError(room.stake));
      const createdMs = fs.toMs(room.createdAt), key = roomKey(game, code, createdMs), txId = "stake-" + key;
      const wRef = ["wagers", key], uRef = ["users", uid], tRef = ["users", uid, "zabLedger", txId];
      return Promise.all([t.get(wRef), t.get(uRef), t.get(tRef)]).then(([w, u, prior]) => {
        if (prior || (w && w.players && w.players[uid])) return { ok: true, already: true, key, stake: room.stake };
        if (w && w.status !== "open") throw err(409, "This wager is already settled.");
        if (w && stakers(w).length >= 2) throw err(409, "Both stakes are already in.");
        const bal = balOf(u);
        if (bal < room.stake) throw err(402, "Not enough ZAB: you have " + ZC.fmtZab(bal) + ", the wager is " + ZC.fmtZab(room.stake) + ".");
        const seat = { amount: room.stake, at: fs.ts() };
        if (w) t.update(wRef, { ["players." + uid]: seat });
        else t.set(wRef, { key, game, code, roomCreatedAt: createdMs, stake: room.stake, players: { [uid]: seat }, status: "open", createdAt: fs.ts() });
        t.update(uRef, { zabBalance: ZC.roundZab(bal - room.stake), lastTxId: txId, updatedAt: fs.ts() });
        t.set(tRef, Object.assign(ledger(uid, "stake", -room.stake, { game, key, code }), { createdAt: fs.ts() }));
        return { ok: true, key, stake: room.stake, balance: ZC.roundZab(bal - room.stake) };
      });
    }));
  }
  // Idempotent: a settled wager is never paid again; each ledger id is create-once.
  function settle(fs, key, nowMs) {
    return fs.tx((t) => t.get(["wagers", key]).then((w) => {
      if (!w) throw err(404, "No wager.");
      if (w.status !== "open") return { ok: true, already: true, status: w.status, winner: w.winner || null };
      return t.get([w.pot ? POT.COL[w.kind] : COL[w.game], w.code]).then((room) => {
        let p = w.pot ? POT.plan(w, room, nowMs, fs.toMs) : plan(w, room, nowMs, fs.toMs);
        if (p.action === "pending") return { ok: true, pending: true };
        if (p.action === "payout") { // server result check before any pot is paid
          const why = resultCheck(w.pot ? (w.kind === "arena" ? "arena" : "washers") : w.game, room, nowMs, fs.toMs, p.reason);
          if (why) p = { action: "refund", reason: "implausible", flag: "implausible", detail: why,
            refunds: stakers(w).map((u) => ({ uid: u, amount: w.players[u].amount })).filter((x) => x.amount > 0) };
        }
        const played = NOT_PLAYED.indexOf(p.reason) < 0, pairKey = pairKeyOf(w), today = ETD ? ETD.key(nowMs) : new Date(nowMs).toISOString().slice(0, 10);
        const credits = [];
        if (p.action === "payout") (p.payouts || [{ uid: p.winner, amount: p.amount }]).forEach((x) => credits.push({ uid: x.uid, type: "payout", amount: x.amount }));
        (p.refunds || []).forEach((r) => credits.push({ uid: r.uid, type: "refund", amount: r.amount }));
        const reads = credits.map((c) => Promise.all([t.get(["users", c.uid]), t.get(["users", c.uid, "zabLedger", c.type + "-" + key])]));
        return Promise.all([Promise.all(reads), played && pairKey ? t.get(["wagerPairs", pairKey]) : null]).then(([got, pair]) => {
          // Same-pair flag: count settled, played wagers per set of players per Eastern day; flag (not block) from PAIR_FLAG on.
          if (played && pairKey) {
            const n = (pair && pair.day === today ? pair.count : 0) + 1;
            t.set(["wagerPairs", pairKey], { players: pairKey.split("_"), day: today, count: n, lastWager: key, updatedAt: fs.ts() });
            if (n >= PAIR_FLAG && !p.flag) p = Object.assign({}, p, { flag: "repeat-pair" });
          }
          credits.forEach((c, i) => { const [u, prior] = got[i]; if (prior) return;
            const id = c.type + "-" + key, bal = ZC.roundZab(balOf(u) + c.amount);
            if (u) t.update(["users", c.uid], { zabBalance: bal, lastTxId: id, updatedAt: fs.ts() });
            else t.set(["users", c.uid], { uid: c.uid, zabBalance: bal, lastTxId: id, createdAt: fs.ts(), updatedAt: fs.ts() });
            t.set(["users", c.uid, "zabLedger", id], Object.assign(ledger(c.uid, c.type, c.amount, w, { reason: p.reason }), { createdAt: fs.ts() })); });
          t.update(["wagers", key], { status: p.action === "payout" ? "paid" : "refunded", winner: p.winner || null, reason: p.reason, flag: p.flag || null, ...(p.detail ? { detail: p.detail } : null), settledAt: fs.ts(),
            ...(w.pot ? { winners: p.winners || null, paid: p.action === "payout" ? Object.fromEntries(p.payouts.map((x) => [x.uid, x.amount])) : null } : null) });
          return { ok: true, status: p.action === "payout" ? "paid" : "refunded", winner: p.winner || null, reason: p.reason, flag: p.flag || null, credits };
        });
      });
    }));
  }
  function err(status, message) { const e = new Error(message); e.status = status; return e; }
  // Client-side text for the result line.
  function outcomeText(w, uid) {
    if (!w || w.status === "open") return w ? "Pot: " + ZC.fmtZab(pot(w.stake)) + " ZAB" : "";
    if (w.status === "paid") return w.winner === uid ? "You won the pot: +" + ZC.fmtZab(pot(w.stake)) + " ZAB." : "Your opponent won the pot.";
    const why = { unverified: " (unverified game, flagged)", implausible: " (result flagged)" }[w.flag] || "";
    return "Wager refunded: +" + ZC.fmtZab((w.players && w.players[uid] && w.players[uid].amount) || w.stake) + " ZAB" + why + ".";
  }
  const api = { MIN_STAKE, MAX_STAKE, COL, LABEL, GRACE_MS, SILENT_MS, MAX_GAME_MS, MIN_WASHERS_MS, validStake, stakeError, pot, roomKey, isGame, allStaked, gameOutcome, plan, stake, settle, outcomeText, resultCheck, PAIR_FLAG };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabaWager = api;
})(typeof window !== "undefined" ? window : null);
