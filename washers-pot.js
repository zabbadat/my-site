/* Zabba Washer Battle: per-player Zab wagers forming ONE combined pot (1v1 rooms and 2v2 arenas).
 * Flow: every seated player enters their OWN amount, taps Submit, then Confirm: the amount is written once to their seat (seat.wager,
 * integer >= 0, 0 = no wager) and is FINAL (rules deny any second write; submit() refuses it too). Once every seat of a FULL room has
 * locked in and the total is above 0, each player taps "Agree to the pot": seat.agreed = the pot total they agreed to (a yes/no on fixed
 * amounts; if a seat is vacated and refilled the old agreement no longer matches the new total and must be given again).
 * The pot forms server-side only (formPot, netlify/functions/wager-pot.js): when every seat has locked in and agreed to the same total,
 * every positive amount is debited into wagers/{key} (all or nothing) with a stake ledger entry. Nothing is escrowed before that, so a
 * player who leaves before the pot forms simply takes their seat (and its locked amount) away.
 * Payout (decided from the room/arena doc with the shared decide(), idempotent, exactly the existing guard pattern): the winner of a 1v1 takes
 * the whole pot; the winning team of a 2v2 splits it equally (an odd Zab goes to the winning team's lowest seat). Ties, everyone out, a match
 * that never starts, a room abandoned before the start = every player gets their own amount back. No Zab is created or destroyed.
 * Label: the wager currency in this flow is always written "Zab" (capital Z, lowercase a, b) followed by the ring icon, then the number.
 * Every wager string goes through html()/set() so the ring is placed after the word and never before it.
 * Browser: window.ZabbaWasherPot. Node: require("./washers-pot.js").
 */
(function (root) {
  const NODE = typeof module !== "undefined" && !!module.exports;
  const WB = NODE ? require("./washers-battle.js") : root && root.ZabbaWasherBattle, AR = NODE ? require("./washers-arena.js") : root && root.ZabbaArena,
    BR = NODE ? require("./battle-rooms.js") : root && root.ZabbaBattles;
  const WORD = "Zab", MIN_WAGER = 1, MAX_WAGER = 1000000000, MAX_GAME_MS = 4 * 3600000;
  const COL = { room: "washersBattles", arena: "washersArenas" }, GAME = { room: "washers", arena: "arena" };
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const err = (status, message) => Object.assign(new Error(message), { status });
  // ---- label: word, then ring, then the number ----
  const RING = '<svg class="zab-ring" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>';
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => (typeof n === "number" && isFinite(n) ? n.toLocaleString("en-US") : esc(n));
  const labelHtml = () => '<span class="zab zab-wager">' + WORD + RING + "</span>";
  const amountHtml = (n) => '<span class="zab zab-wager">' + WORD + RING + " " + num(n) + "</span>";
  const amountText = (n) => WORD + " " + (typeof n === "number" ? n.toLocaleString("en-US") : n);
  // any wager text -> safe HTML: "Zab 50" / "Zab +50" become word + ring + number, a lone "Zab" becomes word + ring
  const html = (s) => esc(s).replace(/\bZab\b(?: (\+?\d[\d,]*))?/g, (m, n) => (n ? amountHtml(n) : labelHtml()));
  function set(el, text) { if (el) el.innerHTML = html(text); return el; }
  // ---- seats / summary (works on a 1v1 room: players, and a 2v2 arena: seats) ----
  const seatsOf = (r) => (r && (r.seats || r.players)) || {};
  const seatField = (r) => (r && r.seats ? "seats" : "players");
  const kindOf = (r) => (r && r.seats ? "arena" : "room");
  const sizeOf = (r) => (r && r.seats ? r.size : 2);
  const ids = (r) => Object.keys(seatsOf(r));
  const hasWager = (s) => !!s && isInt(s.wager) && s.wager >= 0;
  function summary(r) {
    const S = seatsOf(r), u = ids(r), size = sizeOf(r), full = !!r && u.length === size && (size === 2 || size === 4);
    const rows = u.map((id) => ({ uid: id, wager: hasWager(S[id]) ? S[id].wager : null, agreed: S[id].agreed, team: S[id].team || null, slot: isInt(S[id].slot) ? S[id].slot : null }))
      .sort((x, y) => ((x.slot == null ? 9 : x.slot) - (y.slot == null ? 9 : y.slot)) || (x.uid < y.uid ? -1 : 1));
    const total = rows.reduce((n, x) => n + (x.wager || 0), 0), allSubmitted = full && rows.every((x) => x.wager != null);
    const sides = { a: 0, b: 0 }; rows.forEach((x) => { if (x.team === "a" || x.team === "b") sides[x.team] += x.wager || 0; });
    const needed = allSubmitted && total > 0, allAgreed = needed && rows.every((x) => x.agreed === total);
    return { full, size, rows, total, sides, allSubmitted, needed, allAgreed, submittedCount: rows.filter((x) => x.wager != null).length };
  }
  // ---- validation (client checks mirror the rules; the rules are what bind) ----
  const validWager = (n) => isInt(n) && n >= 0 && n <= MAX_WAGER && (n === 0 || n >= MIN_WAGER);
  const wagerError = (n) => (!isInt(n) || n < 0 ? "Enter a whole number of Zab, or 0 for no wager." : n > MAX_WAGER ? "Maximum wager is " + amountText(MAX_WAGER) + "." : "");
  function submitError(r, uid, n, balance) {
    const s = seatsOf(r)[uid];
    if (!r) return "No room with that code.";
    if (!s) return "Join the room first.";
    if (r.status !== "waiting" || r.startAt != null) return "Wagers close when the countdown starts.";
    if (hasWager(s)) return "Your wager is already final.";
    if (!validWager(n)) return wagerError(n) || "Enter a whole number of Zab, or 0 for no wager.";
    if (isInt(balance) && n > balance) return "Not enough Zab: you have " + balance + ", the wager is " + n + ".";
    return "";
  }
  function agreeError(r, uid) {
    const s = seatsOf(r)[uid], m = summary(r);
    if (!r) return "No room with that code."; if (!s) return "Join the room first.";
    if (r.status !== "waiting" || r.startAt != null) return "The pot is closed once the countdown starts.";
    if (!m.allSubmitted) return "Everyone must lock in a wager first.";
    if (!m.needed) return "Nobody wagered, so there is no pot to agree to.";
    if (s.agreed === m.total) return "You already agreed to this pot.";
    return "";
  }
  // BR-style fs (tx(code, fn(t)), t.get(), t.update(patch)). The first value is the final value.
  async function submit(fs, code, uid, n, balance) {
    return fs.tx(code, (t) => { const r = t.get(), e = submitError(r, uid, n, balance); if (e) throw err(409, e);
      t.update({ [seatField(r) + "." + uid + ".wager"]: n }); return { ok: true, wager: n }; });
  }
  async function agree(fs, code, uid) {
    return fs.tx(code, (t) => { const r = t.get(), e = agreeError(r, uid); if (e) throw err(409, e);
      const m = summary(r), f = seatField(r) + "." + uid; t.update({ [f + ".agreed"]: m.total, [f + ".ready"]: true }); return { ok: true, agreed: m.total }; });
  }
  // countdown gate on the client (rules enforce the same): no pot needed, or the escrow covers every seat's locked amount
  function covers(r, w) {
    if (!w || w.pot !== true || w.status !== "open") return false; const S = seatsOf(r);
    return ids(r).every((u) => w.players && w.players[u] && w.players[u].amount === (hasWager(S[u]) ? S[u].wager : 0));
  }
  const canStart = (r, w) => (ids(r).some((u) => hasWager(seatsOf(r)[u]) && seatsOf(r)[u].wager > 0) ? covers(r, w) : true);
  // ---- payout math: integers only; remainder to the first winners in seat order ----
  function split(total, n) { if (!isInt(total) || total < 0 || !isInt(n) || n < 1) return []; const base = Math.floor(total / n), rem = total - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0)); }
  const potKey = (kind, code, createdMs) => GAME[kind] + "_" + code + "_" + createdMs;
  // ---- server: form the pot (all or nothing). fs as zaba-wager.js: tx(fn(t)), t.get(pathArray), t.set(path, d), t.update(path, patch), ts(), toMs ----
  function formPot(fs, uid, kind, rawCode) {
    if (!uid) return Promise.reject(err(401, "Sign in to wager."));
    if (!COL[kind]) return Promise.reject(err(400, "Unknown battle."));
    const code = BR.normCode(rawCode); if (!BR.isValidCode(code)) return Promise.reject(err(400, "Bad room code."));
    return fs.tx((t) => t.get([COL[kind], code]).then((room) => {
      if (!room) throw err(404, "No room with that code.");
      const S = seatsOf(room); if (!(uid in S)) throw err(403, "Join the room first.");
      const createdMs = fs.toMs(room.createdAt), key = potKey(kind, code, createdMs), txId = "stake-" + key, seatIds = Object.keys(S);
      return Promise.all([t.get(["wagers", key])].concat(seatIds.map((u) => t.get(["users", u])), seatIds.map((u) => t.get(["users", u, "zabLedger", txId])))).then((got) => {
        const w = got[0], users = got.slice(1, 1 + seatIds.length), prior = got.slice(1 + seatIds.length);
        if (w) { if (w.pot) return { ok: true, already: true, key, total: w.total }; throw err(409, "This room already has a different wager."); }
        if (room.status !== "waiting" || room.startAt != null) throw err(409, "Wagers close when the countdown starts.");
        const m = summary(room);
        if (!m.full) throw err(409, "Wait until every seat is filled.");
        if (!m.allSubmitted) throw err(409, "Every player must lock in a wager first.");
        if (!m.needed) return { ok: true, none: true, total: 0 };
        if (!m.allAgreed) throw err(409, "Every player must agree to the pot first.");
        const short = seatIds.findIndex((u, i) => { const a = S[u].wager, b = users[i] && isInt(users[i].zabBalance) ? users[i].zabBalance : 0; return a > b; });
        if (short >= 0) { const mine = seatIds[short] === uid, b = users[short] && isInt(users[short].zabBalance) ? users[short].zabBalance : 0;
          throw err(402, mine ? "Not enough Zab: you have " + b + ", your wager is " + S[uid].wager + ". Nobody was charged." : "Another player doesn't have enough Zab for this pot. Nobody was charged."); }
        if (prior.some(Boolean)) throw err(409, "Wager ledger already has an entry for this room.");
        const players = {}; seatIds.forEach((u) => { players[u] = { amount: S[u].wager, at: fs.ts() }; });
        seatIds.forEach((u, i) => { const a = S[u].wager; if (a <= 0) return; const bal = users[i].zabBalance;
          t.update(["users", u], { zabBalance: bal - a, lastTxId: txId, updatedAt: fs.ts() });
          t.set(["users", u, "zabLedger", txId], { uid: u, type: "stake", source: "wager", game: GAME[kind], amount: -a, wager: key, code, createdAt: fs.ts() }); });
        t.set(["wagers", key], { key, game: GAME[kind], kind, code, roomCreatedAt: createdMs, pot: true, total: m.total, players, status: "open", createdAt: fs.ts() });
        return { ok: true, key, total: m.total };
      });
    }));
  }
  // ---- server: decide an open pot. -> { action: none|pending|payout|refund, payouts:[{uid,amount}], refunds:[{uid,amount}], winners, reason } ----
  function outcome(kind, room, nowMs) {
    if (kind === "arena") { const d = AR.decide(room); if (d.done) return d.winner && d.winners.length ? { state: "win", winners: d.winners, reason: d.reason } : { state: "refund", reason: d.reason || "tie" }; }
    else { const d = WB.decide(room); if (d.done) return d.winner ? { state: "win", winners: [d.winner], reason: d.reason } : { state: "refund", reason: d.reason || "tie" }; }
    if (room.startAt != null && nowMs - room.startAt > MAX_GAME_MS) return { state: "refund", reason: "both-silent" };
    return { state: "pending" };
  }
  function plan(w, room, nowMs, toMs) {
    if (!w || w.status !== "open" || !w.pot) return { action: "none" };
    const mine = Object.keys(w.players || {}).map((u) => ({ uid: u, amount: w.players[u].amount })).filter((x) => x.amount > 0);
    const refundAll = (reason) => ({ action: "refund", refunds: mine, reason, flag: null });
    if (!room || toMs(room.createdAt) !== w.roomCreatedAt || room.status === "abandoned") return refundAll("never-started");
    if (!BR.started(room)) return nowMs - w.roomCreatedAt > BR.EXPIRE_MS ? refundAll("expired") : { action: "pending" };
    const S = Object.keys(seatsOf(room)), K = Object.keys(w.players || {});
    if (S.length !== K.length || !S.every((u) => w.players[u])) return refundAll("seats-changed"); // safety: cannot happen once the pot has formed
    const o = outcome(w.kind, room, nowMs);
    if (o.state === "pending") return { action: "pending" };
    if (o.state === "refund") return refundAll(o.reason);
    const total = mine.reduce((n, x) => n + x.amount, 0), order = o.winners.slice().sort((x, y) => { const sx = seatsOf(room)[x].slot, sy = seatsOf(room)[y].slot; return ((isInt(sx) ? sx : 9) - (isInt(sy) ? sy : 9)) || (x < y ? -1 : 1); });
    const parts = split(total, order.length), payouts = order.map((u, i) => ({ uid: u, amount: parts[i] })).filter((x) => x.amount > 0);
    return { action: "payout", winner: order.length === 1 ? order[0] : null, winners: order, payouts, refunds: [], reason: o.reason };
  }
  // text for the result line (plain; shown through set())
  function resultText(w, uid) {
    if (!w || !w.pot) return "";
    if (w.status === "open") return "Pot formed: " + amountText(w.total) + ", held until the match ends.";
    if (w.status === "paid") { const got = w.paid && w.paid[uid]; const won = Array.isArray(w.winners) && w.winners.indexOf(uid) >= 0;
      return won ? "You won Zab +" + (got || 0) + " from the pot of " + amountText(w.total) + "." : "Your side lost its Zab wager (" + amountText((w.players[uid] && w.players[uid].amount) || 0) + ")."; }
    return "Wager refunded: Zab +" + ((w.players && w.players[uid] && w.players[uid].amount) || 0) + ".";
  }
  const api = { WORD, MIN_WAGER, MAX_WAGER, MAX_GAME_MS, COL, GAME, RING, esc, labelHtml, amountHtml, amountText, html, set, seatsOf, seatField, kindOf, sizeOf, hasWager, summary, validWager,
    wagerError, submitError, agreeError, submit, agree, covers, canStart, split, potKey, formPot, outcome, plan, resultText };
  if (NODE) module.exports = api;
  if (root) root.ZabbaWasherPot = api;
})(typeof window !== "undefined" ? window : null);
