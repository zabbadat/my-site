/* Zabba Washer Battle: one-on-one Game of Washers, Bariboshi style (rules.html, Official Regulations v1.9).
 * Rooms / ready / shared 5 s countdown come from battle-rooms.js (collection washersBattles/{code}). No video:
 * each player pitches at their OWN box and REPORTS what happened; the opponent confirms or disputes.
 * Seat: players[uid] = { name, ready, joinedAt, seenAt?, leftAt?, steps?, claimGone?, result?, rep? }
 *   steps      optional logged extra (live step count from the phone; never decides the match)
 *   result     { forfeit: true, at }
 *   claimGone  true = "my opponent has been silent > 30 s" (write-once; only valid when their seenAt is stale)
 *   rep        append-only list of write-once reports, the FIRST entry per key wins:
 *     { k:'b', n, d }            Bariboshi attempt n: my opening pitch, cm from the cup centre (0 = in the cup)
 *     { k:'r', n, pack:[a,b,c] } Round n: my pack of 3, each washer 0 out / 2 box-bound / 3 shoot / 5 bank
 *     { k:'c', t:'b'|'r', n, ok } my confirm (ok:true) or dispute (ok:false) of my OPPONENT's report t/n
 *     { k:'x', n, who, pack }    ruling on a disputed round pack by the Bariboshi winner (Art. 11)
 * Everything (order, scores, winner) is derived from the room doc, so both phones agree. Browser: window.ZabbaWasherBattle.
 */
(function (root) {
  const TARGET = 21, PTS = [0, 2, 3, 5], MAX_ROUNDS = 30, MAX_BARI = 8, MAX_CM = 2000, MAX_STEPS = 100000, MAX_REPS = 120;
  const GONE_MS = 30000, BEAT_MS = 10000, PUBLISH_MS = 2000, PACK = 3;
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const validSteps = (s) => isInt(s) && s >= 0 && s <= MAX_STEPS;
  const validPack = (p) => Array.isArray(p) && p.length === PACK && p.every((x) => PTS.includes(x));
  const sum = (p) => p.reduce((a, b) => a + b, 0);
  const ids = (r) => Object.keys((r && r.players) || {});
  const other = (r, uid) => ids(r).find((u) => u !== uid) || null;
  /* names only: anything that looks like an email is shown as Player */
  const pubName = (n) => { const t = String(n == null ? "" : n).trim().slice(0, 40); return !t || /\S+@\S+/.test(t) ? "Player" : t; };
  const reps = (p) => (p && Array.isArray(p.rep) ? p.rep : []);
  const keysOf = (o) => Object.keys(o).sort().join(",");
  function validEntry(e) {
    if (!e || typeof e !== "object") return false;
    if (e.k === "b") return keysOf(e) === "d,k,n" && isInt(e.n) && e.n >= 1 && e.n <= MAX_BARI && isInt(e.d) && e.d >= 0 && e.d <= MAX_CM;
    if (e.k === "r") return keysOf(e) === "k,n,pack" && isInt(e.n) && e.n >= 1 && e.n <= MAX_ROUNDS && validPack(e.pack);
    if (e.k === "c") return keysOf(e) === "k,n,ok,t" && (e.t === "b" || e.t === "r") && isInt(e.n) && e.n >= 1 && e.n <= MAX_ROUNDS && typeof e.ok === "boolean";
    if (e.k === "x") return keysOf(e) === "k,n,pack,who" && isInt(e.n) && e.n >= 1 && e.n <= MAX_ROUNDS && typeof e.who === "string" && validPack(e.pack);
    return false;
  }
  // first matching entry wins (write-once)
  const ent = (p, k, n, extra) => reps(p).find((e) => e && e.k === k && e.n === n && (!extra || Object.keys(extra).every((x) => e[x] === extra[x]))) || null;
  const conf = (p, t, n) => ent(p, "c", n, { t });
  const forfeitedSeat = (p) => !!(p && ((p.result && p.result.forfeit) || p.leftAt));

  // ---- the whole match, derived from the room doc ----
  function analyze(r) {
    const u = ids(r);
    const out = { valid: false, players: u, totals: {}, rounds: [], bari: { attempts: [], winner: null, fallback: false }, order: null, disputes: 0, overtime: false,
      current: null, pending: [], disputed: [], rulings: [], actions: {}, done: false, winner: null, reason: "" };
    if (!r || u.length !== 2) return out;
    out.valid = true;
    const [a, b] = u, P = { [a]: r.players[a], [b]: r.players[b] };
    out.totals = { [a]: 0, [b]: 0 }; out.actions = { [a]: [], [b]: [] };
    // Art. 4 Bariboshi: closest to the cup (or in it) pitches first; equal (e.g. both in the cup, 4.3) = again; a disputed report = again (Art. 11).
    let order = null;
    for (let n = 1; n <= MAX_BARI && !order; n++) {
      const ea = ent(P[a], "b", n), eb = ent(P[b], "b", n);
      if (!ea || !eb) {
        out.current = { kind: "b", n, stage: "report", turn: null };
        [[a, ea], [b, eb]].forEach(([x, e]) => { if (!e) out.actions[x].push({ type: "b", n }); });
        break;
      }
      const ca = conf(P[a], "b", n), cb = conf(P[b], "b", n); // ca: a's verdict on b's distance
      if ((ca && !ca.ok) || (cb && !cb.ok)) { out.disputes++; out.bari.attempts.push({ n, d: { [a]: ea.d, [b]: eb.d }, result: "disputed" }); continue; }
      if (!ca || !cb) {
        out.current = { kind: "b", n, stage: "confirm", turn: null };
        if (!ca) { out.pending.push({ t: "b", n, who: b, by: a }); out.actions[a].push({ type: "c", t: "b", n, who: b, d: eb.d }); }
        if (!cb) { out.pending.push({ t: "b", n, who: a, by: b }); out.actions[b].push({ type: "c", t: "b", n, who: a, d: ea.d }); }
        break;
      }
      if (ea.d === eb.d) { out.bari.attempts.push({ n, d: { [a]: ea.d, [b]: eb.d }, result: "again" }); continue; }
      order = ea.d < eb.d ? [a, b] : [b, a];
      out.bari.attempts.push({ n, d: { [a]: ea.d, [b]: eb.d }, result: "order" });
    }
    if (!order && !out.current) { order = [a, b]; out.bari.fallback = true; } // never settled in MAX_BARI tries: seat order
    if (!order) return out;
    out.order = order; out.bari.winner = order[0];
    let first = order[0];
    for (let n = 1; n <= MAX_ROUNDS; n++) {
      const s = other(r, first), who = [first, s], packs = {}, ruled = [], disp = [];
      let incomplete = false, turnSet = false;
      who.forEach((x) => {
        const y = other(r, x), e = ent(P[x], "r", n);
        if (!e) {
          incomplete = true;
          if (!turnSet) { turnSet = true; out.current = { kind: "r", n, stage: "pitch", turn: x, first }; out.actions[x].push({ type: "r", n }); }
          return;
        }
        const c = conf(P[y], "r", n);
        if (!c) { incomplete = true; out.pending.push({ t: "r", n, who: x, by: y }); out.actions[y].push({ type: "c", t: "r", n, who: x, pack: e.pack }); return; }
        if (c.ok) { packs[x] = e.pack; return; }
        const rl = ent(P[order[0]], "x", n, { who: x });
        if (rl) { packs[x] = rl.pack; ruled.push(x); out.rulings.push({ n, who: x, by: y, ruler: order[0], reported: e.pack, ruled: rl.pack, against: rl.pack.join() === e.pack.join() ? y : x }); return; }
        incomplete = true; disp.push({ n, who: x, ruler: order[0], pack: e.pack }); out.actions[order[0]].push({ type: "x", n, who: x, pack: e.pack });
      });
      if (disp.length) { out.disputed.push(...disp); out.disputes += disp.length; }
      if (incomplete) {
        if (!out.current) out.current = { kind: "r", n, stage: disp.length ? "rule" : "confirm", turn: null, first };
        else if (out.pending.length || disp.length) out.current.waiting = true;
        // a half-finished round still shows what has been confirmed so far
        out.partial = { n, first, packs };
        break;
      }
      const sc = { [first]: sum(packs[first]), [s]: sum(packs[s]) };
      out.totals[first] += sc[first]; out.totals[s] += sc[s];
      out.rounds.push({ n, first, packs, scores: sc, ruled, order: [first, s] });
      const hi = Math.max(out.totals[a], out.totals[b]);
      if (hi >= TARGET) { // Art. 1.1 first to 21; both over 21 in one round (rules silent): higher total; equal = overtime round
        if (out.totals[a] !== out.totals[b]) { out.done = true; out.winner = out.totals[a] > out.totals[b] ? a : b; out.reason = "score"; return out; }
        out.overtime = true;
      }
      if (sc[s] > sc[first]) first = s; // 5.5 the side that scored more pitches first; 5.6 a tie keeps the order
    }
    if (!out.done && out.rounds.length >= MAX_ROUNDS) { out.done = true; out.winner = null; out.reason = "tie"; out.current = null; }
    return out;
  }
  // -> { done, winner, reason } ; done=false while undecided.  reasons: score | tie | forfeit | both-forfeit
  function decide(r) {
    const u = ids(r); if (!r || u.length !== 2 || !(r.status === "live" || r.status === "done")) return { done: false };
    const an = analyze(r);
    if (an.done) return { done: true, winner: an.winner, reason: an.reason };
    const [a, b] = u, xa = forfeitedBy(r, a), xb = forfeitedBy(r, b);
    if (xa && xb) return { done: true, winner: null, reason: "both-forfeit" };
    if (xb) return { done: true, winner: a, reason: "forfeit" };
    if (xa) return { done: true, winner: b, reason: "forfeit" };
    return { done: false };
  }
  // Seat gave up: tapped forfeit, left after start, or the opponent recorded they were silent for 30 s.
  function forfeitedBy(r, uid) { const p = r && r.players && r.players[uid], o = r && r.players && r.players[other(r, uid)]; return forfeitedSeat(p) || !!(o && o.claimGone === true && !(p && p.result)); }
  // Opponent silent: heartbeat (seenAt, written every BEAT_MS while live) older than GONE_MS; baseline = shared start.
  function staleOpponent(r, uid, nowMs, toMs) {
    toMs = toMs || ((v) => (typeof v === "number" ? v : null));
    if (!r || r.status !== "live" || r.startAt == null || !r.players || !(uid in r.players)) return false;
    const o = other(r, uid); if (!o || decide(r).done) return false;
    const p = r.players[o]; if (p.result || p.leftAt || p.claimGone) return false;
    return nowMs - Math.max(toMs(r.startAt) || 0, toMs(p.seenAt) || 0) > GONE_MS;
  }
  // ---- match state (waiting, ready, countdown, live, finished, cancelled) ----
  function matchState(r, nowMs, toMs) {
    if (!r) return "cancelled";
    if (r.status === "abandoned") return "cancelled";
    if (decide(r).done) return "finished";
    if (r.status === "live" || r.status === "done") return "live";
    if (r.status === "countdown") return "countdown";
    const t = toMs && r.createdAt != null ? toMs(r.createdAt) : null;
    if (nowMs != null && t != null && nowMs - t > 30 * 60 * 1000) return "cancelled"; // nobody joined / never started within 30 min
    return ids(r).length === 2 ? "ready" : "waiting";
  }
  // ---- writes ----
  function canWrite(r, uid) { return !!r && r.status === "live" && !!r.players && uid in r.players && !r.players[uid].result && !decide(r).done && !(other(r, uid) && r.players[other(r, uid)].claimGone); }
  function allowed(r, uid, e) {
    if (!canWrite(r, uid) || !validEntry(e)) return false;
    const p = r.players[uid];
    if (ent(p, e.k, e.n, e.k === "c" ? { t: e.t } : e.k === "x" ? { who: e.who } : null)) return false; // write-once
    return analyze(r).actions[uid].some((a) => a.type === e.k && a.n === e.n && (e.k !== "c" || (a.t === e.t)) && (e.k !== "x" || a.who === e.who));
  }
  // Append one report to my own seat. Returns true if written.
  function report(fs, code, uid, e) {
    return fs.tx(code, (t) => { const r = t.get(); if (!allowed(r, uid, e)) return false;
      t.update({ ["players." + uid + ".rep"]: reps(r.players[uid]).concat([e]).slice(0, MAX_REPS) }); return true; });
  }
  function forfeit(fs, code, uid) {
    return fs.tx(code, (t) => { const r = t.get(); if (!canWrite(r, uid)) return false;
      t.update({ ["players." + uid + ".result"]: { forfeit: true, at: fs.ts() } }); return true; });
  }
  // 30 s grace: the opponent's heartbeat is stale -> record it (own seat, write-once); decide() then ends the match.
  function claimGone(fs, code, uid, nowMs) {
    return fs.tx(code, (t) => { const r = t.get(); if (!canWrite(r, uid) || !staleOpponent(r, uid, nowMs, fs.toMs)) return false;
      t.update({ ["players." + uid + ".claimGone"]: true }); return true; });
  }
  const heartbeat = (fs, code, uid) => fs.update(code, { ["players." + uid + ".seenAt"]: fs.ts() });
  // Optional logged extra: live steps (never decides the match).
  const publishPatch = (uid, g) => ({ ["players." + uid + ".steps"]: Math.max(0, Math.min(MAX_STEPS, (g && g.steps) | 0)) });
  const publishLive = (fs, code, uid, g) => fs.update(code, publishPatch(uid, g));
  function throttle(ms, now) { let last = -Infinity; return () => { const t = now(); if (t - last >= ms) { last = t; return true; } return false; }; }

  // ---- text ----
  const POINTS = { 0: "Out 0", 2: "Box-bound 2", 3: "Shoot 3", 5: "Bank 5" };
  const packText = (p) => p.join(" + ") + " = " + sum(p);
  function resultText(r, uid) {
    const d = decide(r); if (!d.done) return "";
    if (d.winner == null) return d.reason === "tie" ? "Tie: still level after the last round." : "No winner: both players left.";
    const won = d.winner === uid;
    if (d.reason === "forfeit") return won ? "You win: your opponent forfeited or went silent." : "You lost by forfeit.";
    const an = analyze(r), o = other(r, uid);
    return (won ? "You win " : "You lose ") + an.totals[uid] + " to " + an.totals[o] + ".";
  }
  // ---- live board (scorekeeper) ----
  const fmtSteps = (n) => (n | 0).toLocaleString("en-US");
  function boardRows(r, players, uid, labels) { // labels: optional { [uid]: 'Steady 52' } reputation text
    const an = analyze(r), dec = decide(r), live = !!r && (r.status === "live" || r.status === "done");
    return (players || []).map((p) => {
      const self = p.uid === uid, total = an.valid ? an.totals[p.uid] || 0 : 0, out = forfeitedBy(r, p.uid);
      const tally = an.rounds.map((x) => ({ n: x.n, score: x.scores[p.uid], first: x.first === p.uid }));
      let round = "", turn = "";
      if (!an.valid) round = "Waiting for opponent";
      else if (dec.done) round = dec.winner === p.uid ? "Winner" : dec.winner ? "" : "Tie";
      else if (!live) round = "Not started";
      else if (!an.order) { const c = an.current; round = "Bariboshi " + (c ? c.n : 1); turn = !c ? "" : c.stage === "report" ? (ent(p, "b", c.n) ? "Reported" : "To pitch") : "Confirming"; }
      else { const c = an.current || (an.partial ? { n: an.partial.n } : null), n = c ? c.n : an.rounds.length + 1;
        round = "Round " + n + (an.overtime ? " (overtime)" : ""); if (c && c.stage === "pitch") turn = c.turn === p.uid ? "Pitching pack" : "Waiting"; else if (c) turn = ent(p, "r", n) ? "Pack reported" : "Waiting"; }
      const pend = an.pending.filter((x) => x.who === p.uid).length, dis = an.disputed.filter((x) => x.who === p.uid).length;
      const status = out ? "Forfeit" : dis ? "Disputed" : pend ? "Awaiting confirm" : turn;
      return { uid: p.uid, name: pubName(p.name) + (self ? " (you)" : ""), repText: (labels && labels[p.uid]) || "", total, scoreText: total + "/" + TARGET, tally, tallyText: tally.length ? tally.map((x) => "R" + x.n + " " + x.score).join(" · ") : "—",
        roundText: round, turnText: turn, steps: p.steps | 0, stepsText: fmtSteps(p.steps), status, state: out ? "forfeit" : p.leftAt ? "left" : "playing" };
    });
  }
  // One line for the top of the board: match state + what is pending.
  function boardStatus(r, nowMs, toMs) {
    const st = matchState(r, nowMs, toMs), an = analyze(r), names = {};
    ids(r).forEach((u) => (names[u] = pubName(r.players[u].name)));
    let extra = "";
    if (st === "live" && an.valid) {
      if (an.disputed.length) extra = "Dispute on " + an.disputed.map((x) => names[x.who] + " round " + x.n).join(", ") + ": " + names[an.order[0]] + " (Bariboshi winner) rules.";
      else if (an.pending.length) extra = "Waiting for " + an.pending.map((x) => names[x.by]).join(" and ") + " to confirm.";
      else if (an.current && an.current.stage === "pitch") extra = names[an.current.turn] + " is pitching a pack of 3.";
      else if (an.current && an.current.kind === "b") extra = "Bariboshi: both pitch one washer, closest to the cup goes first.";
    }
    return { state: st, extra, text: { waiting: "Waiting for a second player", ready: "Both seated · tap ready", countdown: "Countdown", live: "Live", finished: "Finished", cancelled: "Cancelled" }[st] + (extra ? " · " + extra : "") };
  }
  const api = { TARGET, PTS, PACK, GONE_MS, BEAT_MS, PUBLISH_MS, MAX_ROUNDS, MAX_BARI, validSteps, validPack, validEntry, analyze, decide, matchState, forfeitedSeat, forfeitedBy,
    staleOpponent, pubName, canWrite, allowed, report, forfeit, claimGone, heartbeat, publishPatch, publishLive, throttle, other, resultText, boardRows, boardStatus, packText, POINTS, sum, fmtSteps };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaWasherBattle = api;
})(typeof window !== "undefined" ? window : null);
