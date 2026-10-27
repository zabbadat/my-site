/* Zabba Washer Arena: the 2v2 TEAM version of the Zabba Washer Battle (two teams of two, one shared room).
 * 2-player stays the plain one-on-one room (washers-battle.js + battle-rooms.js, collection washersBattles, unchanged).
 * Doc washersArenas/{code} = { code, createdBy (audit; if the creator leaves before the start the arena is cancelled),
 *   size: 2|4, status: waiting | countdown | live | abandoned, createdAt, startAt,
 *   slots:  { "0": uid, "1": uid, ... }          // claimed seat numbers (a slot can be claimed once)
 *   teamNames: { a?, b? }                         // optional team names, set before the start by a member of that team
 *   seats:  { [uid]: { name, pubName?, ready, joinedAt, slot, team: 'a'|'b', seenAt?, leftAt?, steps?, result?, rep?, gone? } } }
 * Fixed seat map: slot*2 < size -> Team A (slots 0,1 of 4), else Team B (slots 2,3). Size 2 = one player per team.
 * Rules of play = the 1v1 rules over teams (washers-battle.js): each player pitches at their OWN box and REPORTS.
 *   rep (append-only, write-once per key, own seat only):
 *     { k:'b', n, d }                  opening (Bariboshi) attempt n: my washer, cm from the cup centre
 *     { k:'r', n, pack:[a,b,c] }       round n: my pack of 3 (0 out / 2 box-bound / 3 shoot / 5 bank)
 *     { k:'c', t:'b'|'r', n, who, ok } my confirm / dispute of the report of OPPONENT player `who`
 *     { k:'x', n, who, pack }          ruling on a disputed pack by the Bariboshi winner
 *   Any ONE player of the other team verifies a pitch (a dispute from any of them wins over a confirm).
 *   Team score = sum of its players' confirmed packs; first team to 21 (Art. 1.1; both over 21 in one round: higher total, level
 *   = overtime round; 30 rounds = tie). Opening: the team whose closest washer is nearest goes first; level = pitch again.
 *   There is no turn order inside a round: all players pitch at their own box and report when done.
 *   Forfeit: a player who forfeits, leaves, or is recorded silent for 30 s (`gone`, by an opposing player) just stops
 *   contributing and nobody waits for them. A TEAM forfeits only when ALL its players are out; then the other team wins.
 *   Both teams out = no winner.
 * decide() is the one team win check, shared by the phones (this file) and the server (netlify/functions/battle-stats.js).
 * Browser: window.ZabbaArena. Node: require("./washers-arena.js"). fs adapter as battle-rooms.js:
 *   { tx(code, fn(t)) with t.get() / t.set(data) / t.update(patch with dotted paths), update, watch, ts(), del(), toMs(v) }.
 */
(function (root) {
  const NODE = typeof module !== "undefined" && !!module.exports;
  const BR = NODE ? require("./battle-rooms.js") : root && root.ZabbaBattles;
  const WB = NODE ? require("./washers-battle.js") : root && root.ZabbaWasherBattle;
  const TARGET = 21, PTS = [0, 2, 3, 5], PACK = 3, MAX_ROUNDS = 30, MAX_BARI = 8, MAX_CM = 2000, MAX_STEPS = 100000, MAX_REPS = 200;
  const GONE_MS = 30000, BEAT_MS = 10000, PUBLISH_MS = 2000, EXPIRE_MS = 30 * 60 * 1000, LIVE_REUSE_MS = 6 * 60 * 60 * 1000, LEAD_MS = 5000;
  const SIZES = [2, 4], TEAM_NAME_MAX = 20, DEFAULT_TEAM = { a: "Team A", b: "Team B" };
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const isValidSize = (n) => isInt(n) && SIZES.indexOf(n) >= 0;
  const teamOfSlot = (slot, size) => (isInt(slot) && isValidSize(size) && slot >= 0 && slot < size ? (slot * 2 < size ? "a" : "b") : null);
  const otherTeam = (t) => (t === "a" ? "b" : "a");
  const seatOf = (a, uid) => (a && a.seats && a.seats[uid]) || null;
  const seatIds = (a) => Object.keys((a && a.seats) || {});
  const sum = (p) => p.reduce((x, y) => x + y, 0);
  const started = (a) => !!a && (a.status === "countdown" || a.status === "live");
  const live = (a) => !!a && a.status === "live";
  const isExpired = (a, nowMs, createdMs) => !!a && !started(a) && a.status !== "abandoned" && createdMs != null && nowMs - createdMs > EXPIRE_MS;
  // Seats in seat-number order (then uid), so every phone lists the same.
  function orderedSeats(a) {
    return seatIds(a).map((uid) => ({ uid, ...a.seats[uid] })).sort((x, y) => ((isInt(x.slot) ? x.slot : 9) - (isInt(y.slot) ? y.slot : 9)) || (x.uid < y.uid ? -1 : x.uid > y.uid ? 1 : 0));
  }
  const teamSeats = (a, team) => orderedSeats(a).filter((s) => s.team === team).map((s) => s.uid);
  const teamOf = (a, uid) => { const s = seatOf(a, uid); return s && (s.team === "a" || s.team === "b") ? s.team : null; };
  const full = (a) => !!a && isValidSize(a.size) && seatIds(a).length === a.size;
  const allReady = (a) => full(a) && seatIds(a).every((u) => a.seats[u].ready === true);
  // ---- team names: any member sets their own team's name before the start. No profanity helper exists on the site, so this is a plain
  // sanitise: HTML tags and control characters stripped, letters / numbers / spaces / basic punctuation only, trimmed, 20 characters.
  function sanitizeTeamName(s) {
    let t = String(s == null ? "" : s).replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f<>]/g, "");
    t = t.replace(/[^A-Za-z0-9 .,!'&_-]/g, "").replace(/\s+/g, " ").trim();
    return t.slice(0, TEAM_NAME_MAX).trim();
  }
  const teamName = (a, team) => sanitizeTeamName(a && a.teamNames && a.teamNames[team]) || DEFAULT_TEAM[team];
  // Display name of a seat: saved pubName first (washers-battle.js seatName), never an email.
  const nameOf = (a, uid) => WB.seatName(seatOf(a, uid));

  // ---- joining: slot choice + errors ----
  // Balanced auto-assign: the wanted team if it has room, else the team with fewer players (ties: Team A); lowest free seat there.
  function freeSlot(a, wantTeam) {
    if (!a || !isValidSize(a.size)) return -1;
    const taken = a.slots || {}, per = a.size / 2, mem = { a: 0, b: 0 };
    seatIds(a).forEach((u) => { const t = teamOf(a, u); if (t) mem[t]++; });
    const open = (t) => { for (let i = 0; i < a.size; i++) if (teamOfSlot(i, a.size) === t && !(String(i) in taken)) return i; return -1; };
    const order = wantTeam && mem[wantTeam] < per ? [wantTeam, otherTeam(wantTeam)] : mem.a <= mem.b ? ["a", "b"] : ["b", "a"];
    for (const t of order) { if (mem[t] < per) { const s = open(t); if (s >= 0) return s; } }
    return -1;
  }
  function joinError(a, uid, nowMs, createdMs) {
    if (!a) return "No arena with that code. Check the code and try again.";
    if (uid in (a.seats || {})) return "";
    if (a.status === "abandoned" || started(a)) return "That arena has already started or ended.";
    if (isExpired(a, nowMs, createdMs)) return "That arena has expired. Make a new one.";
    if (seatIds(a).length >= a.size || freeSlot(a) < 0) return "That arena is full.";
    return "";
  }

  // ---- reports ----
  const validPack = (p) => Array.isArray(p) && p.length === PACK && p.every((x) => PTS.indexOf(x) >= 0);
  const keysOf = (o) => Object.keys(o).sort().join(",");
  function validEntry(e) {
    if (!e || typeof e !== "object") return false;
    if (e.k === "b") return keysOf(e) === "d,k,n" && isInt(e.n) && e.n >= 1 && e.n <= MAX_BARI && isInt(e.d) && e.d >= 0 && e.d <= MAX_CM;
    if (e.k === "r") return keysOf(e) === "k,n,pack" && isInt(e.n) && e.n >= 1 && e.n <= MAX_ROUNDS && validPack(e.pack);
    if (e.k === "c") return keysOf(e) === "k,n,ok,t,who" && (e.t === "b" || e.t === "r") && isInt(e.n) && e.n >= 1 && e.n <= MAX_ROUNDS && typeof e.ok === "boolean" && typeof e.who === "string";
    if (e.k === "x") return keysOf(e) === "k,n,pack,who" && isInt(e.n) && e.n >= 1 && e.n <= MAX_ROUNDS && typeof e.who === "string" && validPack(e.pack);
    return false;
  }
  const reps = (p) => (p && Array.isArray(p.rep) ? p.rep : []);
  const ent = (p, k, n, extra) => reps(p).find((e) => e && e.k === k && e.n === n && (!extra || Object.keys(extra).every((x) => e[x] === extra[x]))) || null;
  const forfeitedSeat = (p) => !!(p && ((p.result && p.result.forfeit) || p.leftAt));
  const goneList = (p) => (p && Array.isArray(p.gone) ? p.gone : []);
  // A seat is OUT when it forfeited / left, or an opposing player recorded it silent for 30 s.
  function seatOut(a, uid) {
    const p = seatOf(a, uid); if (!p) return false;
    if (forfeitedSeat(p)) return true;
    if (p.result) return false;
    const t = teamOf(a, uid);
    return seatIds(a).some((u) => teamOf(a, u) !== t && goneList(a.seats[u]).indexOf(uid) >= 0);
  }
  const activeOf = (a, ids) => ids.filter((u) => !seatOut(a, u));
  const teamOut = (a, team) => { const m = teamSeats(a, team); return m.length > 0 && m.every((u) => seatOut(a, u)); };

  // ---- the whole match, derived from the arena doc ----
  function analyze(a) {
    const out = { valid: false, size: a && a.size, teams: { a: [], b: [] }, totals: { a: 0, b: 0 }, contrib: {}, rounds: [], bari: { attempts: [], winner: null, fallback: false }, order: null, ruler: null,
      disputes: 0, overtime: false, current: null, pending: [], disputed: [], rulings: [], actions: {}, done: false, winner: null, reason: "" };
    if (!a || !full(a)) return out;
    out.valid = true;
    out.teams = { a: teamSeats(a, "a"), b: teamSeats(a, "b") };
    const all = out.teams.a.concat(out.teams.b), P = a.seats;
    all.forEach((u) => { out.actions[u] = []; out.contrib[u] = 0; });
    const opposing = (u) => out.teams[otherTeam(teamOf(a, u))];
    // verdict on player `who`'s report t/n from the other team: a dispute from any of them wins, else one confirm is enough
    const verdict = (who, t, n) => {
      let ok = null;
      for (const y of opposing(who)) { const c = ent(P[y], "c", n, { t, who }); if (c) { if (!c.ok) return { ok: false, by: y }; if (!ok) ok = { ok: true, by: y }; } }
      return ok;
    };
    const askVerify = (who, t, n, payload) => {
      const ver = activeOf(a, opposing(who));
      out.pending.push({ t, n, who, by: ver.slice() });
      ver.forEach((y) => out.actions[y].push(Object.assign({ type: "c", t, n, who }, payload)));
    };
    // Art. 4 opening: the team with the washer closest to the cup pitches first; level = again; a dispute = again.
    let order = null, ruler = null;
    for (let n = 1; n <= MAX_BARI && !order; n++) {
      const have = all.filter((u) => ent(P[u], "b", n)), missing = activeOf(a, all).filter((u) => !ent(P[u], "b", n));
      if (missing.length) { out.current = { kind: "b", n, stage: "report", turn: null }; missing.forEach((u) => out.actions[u].push({ type: "b", n })); break; }
      if (!have.length) { out.current = { kind: "b", n, stage: "report", turn: null }; break; } // nobody left to pitch
      const verd = have.map((u) => ({ u, v: verdict(u, "b", n) }));
      if (verd.some((x) => x.v && !x.v.ok)) { out.disputes++; out.bari.attempts.push({ n, result: "disputed" }); continue; }
      const waitFor = verd.filter((x) => !x.v && activeOf(a, opposing(x.u)).length);
      if (waitFor.length) { out.current = { kind: "b", n, stage: "confirm", turn: null }; waitFor.forEach((x) => askVerify(x.u, "b", n, { d: ent(P[x.u], "b", n).d })); break; }
      const best = { a: Infinity, b: Infinity }; let top = null;
      have.forEach((u) => { const d = ent(P[u], "b", n).d, t = teamOf(a, u); if (d < best[t]) best[t] = d; if (!top || d < top.d) top = { u, d }; });
      if (best.a === best.b) { out.bari.attempts.push({ n, result: "again" }); continue; }
      order = best.a < best.b ? ["a", "b"] : ["b", "a"]; ruler = top.u;
      out.bari.attempts.push({ n, result: "order" });
    }
    if (!order && !out.current) { order = ["a", "b"]; ruler = out.teams.a[0]; out.bari.fallback = true; } // never settled: seat order
    if (!order) return out;
    out.order = order; out.bari.winner = order[0]; out.ruler = ruler;
    const rulerNow = !seatOut(a, ruler) ? ruler : (activeOf(a, out.teams[order[0]])[0] || activeOf(a, all)[0] || ruler);
    let first = order[0];
    for (let n = 1; n <= MAX_ROUNDS; n++) {
      const packs = {}, ruled = [], disp = [];
      let incomplete = false;
      if (!all.some((u) => ent(P[u], "r", n))) { // nobody reported this round (everyone is out): it never completes
        all.forEach((u) => { if (!seatOut(a, u)) out.actions[u].push({ type: "r", n }); });
        out.current = { kind: "r", n, stage: "pitch", turn: null, first }; break;
      }
      all.forEach((u) => {
        const e = ent(P[u], "r", n);
        if (!e) { if (!seatOut(a, u)) { incomplete = true; out.actions[u].push({ type: "r", n }); if (!out.current) out.current = { kind: "r", n, stage: "pitch", turn: null, first }; } return; }
        const v = verdict(u, "r", n);
        if (!v) { if (activeOf(a, opposing(u)).length) { incomplete = true; askVerify(u, "r", n, { pack: e.pack }); } else packs[u] = e.pack; return; }
        if (v.ok) { packs[u] = e.pack; return; }
        const rl = ent(P[ruler], "x", n, { who: u }) || ent(P[rulerNow], "x", n, { who: u });
        if (rl) { packs[u] = rl.pack; ruled.push(u); out.rulings.push({ n, who: u, by: v.by, ruler: rulerNow, reported: e.pack, ruled: rl.pack, against: rl.pack.join() === e.pack.join() ? v.by : u }); return; }
        incomplete = true; disp.push({ n, who: u, ruler: rulerNow, pack: e.pack }); out.actions[rulerNow].push({ type: "x", n, who: u, pack: e.pack });
      });
      if (disp.length) { out.disputed.push(...disp); out.disputes += disp.length; }
      if (incomplete) {
        if (!out.current) out.current = { kind: "r", n, stage: disp.length ? "rule" : "confirm", turn: null, first };
        out.partial = { n, first, packs };
        break;
      }
      const sc = { a: 0, b: 0 };
      all.forEach((u) => { if (packs[u]) { const s = sum(packs[u]); sc[teamOf(a, u)] += s; out.contrib[u] += s; } });
      out.totals.a += sc.a; out.totals.b += sc.b;
      out.rounds.push({ n, first, packs, scores: sc, ruled, order: [first, otherTeam(first)] });
      if (Math.max(out.totals.a, out.totals.b) >= TARGET) {
        if (out.totals.a !== out.totals.b) { out.done = true; out.winner = out.totals.a > out.totals.b ? "a" : "b"; out.reason = "score"; return out; }
        out.overtime = true;
      }
      if (sc[otherTeam(first)] > sc[first]) first = otherTeam(first); // the team that scored more pitches first next (display only); a tie keeps it
    }
    if (!out.done && out.rounds.length >= MAX_ROUNDS) { out.done = true; out.winner = null; out.reason = "tie"; out.current = null; }
    return out;
  }
  // -> { done, winner: 'a'|'b'|null, reason, winners: [uid], losers: [uid] }; reasons: score | tie | forfeit | both-forfeit
  function decide(a) {
    if (!a || !full(a) || !(a.status === "live" || a.status === "done")) return { done: false };
    const fin = (winner, reason) => ({ done: true, winner, reason, winners: winner ? teamSeats(a, winner) : [], losers: winner ? teamSeats(a, otherTeam(winner)) : [] });
    const an = analyze(a);
    if (an.done) return fin(an.winner, an.reason);
    const oa = teamOut(a, "a"), ob = teamOut(a, "b");
    if (oa && ob) return fin(null, "both-forfeit");
    if (ob) return fin("a", "forfeit");
    if (oa) return fin("b", "forfeit");
    return { done: false };
  }
  function matchState(a, nowMs, toMs) {
    if (!a || a.status === "abandoned") return "cancelled";
    if (decide(a).done) return "finished";
    if (a.status === "live" || a.status === "done") return "live";
    if (a.status === "countdown") return "countdown";
    const t = toMs && a.createdAt != null ? toMs(a.createdAt) : null;
    if (nowMs != null && t != null && nowMs - t > EXPIRE_MS) return "cancelled";
    return full(a) ? "ready" : "waiting";
  }
  // ---- writes ----
  const canWrite = (a, uid) => !!a && a.status === "live" && !!seatOf(a, uid) && !seatOf(a, uid).result && !decide(a).done && !seatOut(a, uid);
  function allowed(a, uid, e) {
    if (!canWrite(a, uid) || !validEntry(e)) return false;
    const p = a.seats[uid];
    if (ent(p, e.k, e.n, e.k === "c" ? { t: e.t, who: e.who } : e.k === "x" ? { who: e.who } : null)) return false; // write-once
    return analyze(a).actions[uid].some((x) => x.type === e.k && x.n === e.n && (e.k !== "c" || (x.t === e.t && x.who === e.who)) && (e.k !== "x" || x.who === e.who));
  }
  function report(fs, code, uid, e) {
    return fs.tx(code, (t) => { const a = t.get(); if (!allowed(a, uid, e)) return false;
      t.update({ ["seats." + uid + ".rep"]: reps(a.seats[uid]).concat([e]).slice(0, MAX_REPS) }); return true; });
  }
  function forfeit(fs, code, uid) {
    return fs.tx(code, (t) => { const a = t.get(); if (!canWrite(a, uid)) return false;
      t.update({ ["seats." + uid + ".result"]: { forfeit: true, at: fs.ts() } }); return true; });
  }
  // An opposing player's heartbeat (seenAt, every BEAT_MS while live) older than GONE_MS; baseline = the shared start.
  function staleSeat(a, byUid, targetUid, nowMs, toMs) {
    toMs = toMs || ((v) => (typeof v === "number" ? v : null));
    if (!a || a.status !== "live" || a.startAt == null || !seatOf(a, byUid) || !seatOf(a, targetUid)) return false;
    if (teamOf(a, byUid) === teamOf(a, targetUid) || decide(a).done || seatOut(a, targetUid)) return false;
    const p = a.seats[targetUid]; if (p.result || p.leftAt) return false;
    return nowMs - Math.max(toMs(a.startAt) || 0, toMs(p.seenAt) || 0) > GONE_MS;
  }
  // Opposing players currently silent for 30 s (the caller records each once).
  const staleTargets = (a, byUid, nowMs, toMs) => seatIds(a).filter((u) => staleSeat(a, byUid, u, nowMs, toMs) && goneList(seatOf(a, byUid)).indexOf(u) < 0);
  function claimGone(fs, code, uid, targetUid, nowMs) {
    return fs.tx(code, (t) => { const a = t.get(); if (!canWrite(a, uid) || !staleSeat(a, uid, targetUid, nowMs, fs.toMs)) return false;
      const cur = goneList(a.seats[uid]); if (cur.indexOf(targetUid) >= 0) return false;
      t.update({ ["seats." + uid + ".gone"]: cur.concat([targetUid]) }); return true; });
  }
  const heartbeat = (fs, code, uid) => fs.update(code, { ["seats." + uid + ".seenAt"]: fs.ts() });
  const publishPatch = (uid, g) => ({ ["seats." + uid + ".steps"]: Math.max(0, Math.min(MAX_STEPS, (g && g.steps) | 0)) });
  const publishLive = (fs, code, uid, g) => fs.update(code, publishPatch(uid, g));

  // ---- text ----
  function resultText(a, uid) {
    const d = decide(a); if (!d.done) return "";
    if (d.winner == null) return d.reason === "tie" ? "Tie: still level after the last round." : "No winner: every player left.";
    const mine = teamOf(a, uid), an = analyze(a), won = mine === d.winner;
    if (!mine) return teamName(a, d.winner) + " wins.";
    if (d.reason === "forfeit") return won ? "Your team wins: the other team forfeited or went silent." : "Your team lost by forfeit.";
    return (won ? "Your team wins " : "Your team loses ") + an.totals[mine] + " to " + an.totals[otherTeam(mine)] + ".";
  }
  // One status line: what is pending right now.
  function boardStatus(a, nowMs, toMs) {
    const st = matchState(a, nowMs, toMs), an = analyze(a); let extra = "";
    if (st === "live" && an.valid) {
      if (an.disputed.length) extra = "Dispute on " + an.disputed.map((x) => nameOf(a, x.who) + " round " + x.n).join(", ") + ": " + nameOf(a, an.disputed[0].ruler) + " (Bariboshi winner) rules.";
      else if (an.pending.length) extra = "Waiting for the other team to confirm " + an.pending.map((x) => nameOf(a, x.who)).join(", ") + ".";
      else if (an.current && an.current.stage === "pitch") extra = "Everyone pitches a pack of 3 at their own box and reports it.";
      else if (an.current && an.current.kind === "b") extra = "Opening pitch: each player pitches one washer, the closest team goes first.";
    }
    return { state: st, extra, text: { waiting: "Waiting for players", ready: "All seated · tap ready", countdown: "Countdown", live: "Live", finished: "Finished", cancelled: "Cancelled" }[st] + (extra ? " · " + extra : "") };
  }

  // ---- lobby controller ----
  function controller(fs, opts = {}) {
    const rand = opts.rand || Math.random, now = opts.now || (() => Date.now());
    let offset = 0; const toMs = fs.toMs;
    const stamp = (code, uid, field, send) => new Promise((res) => { let done = false; const off = fs.watch(code, (d) => {
      if (done) return; const p = d && d.seats && d.seats[uid]; const v = p && toMs(p[field]);
      if (v != null && v >= send + offset - 60000) { done = true; offset = BR.estimateOffset(v, send, now()); off(); res(offset); } }); });
    const seatDoc = (u, slot, size) => Object.assign({ name: String(u.name || "Player").slice(0, 40) }, u.pubName ? { pubName: String(u.pubName).slice(0, 24) } : null,
      { ready: false, joinedAt: fs.ts(), slot, team: teamOfSlot(slot, size) });
    async function createArena(u, size, o) {
      if (!u || !u.uid) throw new Error("Sign in to create an arena.");
      if (!isValidSize(size)) throw new Error("An arena has 2 or 4 players.");
      const slot = (o && o.team === "b") ? size / 2 : 0;
      for (let i = 0; i < 8; i++) {
        const code = BR.genCode(rand), send = now();
        if (opts.codeTaken && (await opts.codeTaken(code))) continue; // keep codes unique across plain rooms and arenas
        const ok = await fs.tx(code, (t) => { const cur = t.get();
          if (cur && cur.status !== "abandoned" && !isExpired(cur, BR.serverNow(now(), offset), toMs(cur.createdAt)) && !(started(cur) && cur.createdAt != null && now() - toMs(cur.createdAt) > LIVE_REUSE_MS)) return false;
          t.set({ code, createdBy: u.uid, size, status: "waiting", createdAt: fs.ts(), startAt: null, slots: { [String(slot)]: u.uid }, teamNames: {}, seats: { [u.uid]: seatDoc(u, slot, size) } }); return true; });
        if (ok) { await stamp(code, u.uid, "joinedAt", send); return code; }
      }
      throw new Error("Couldn't find a free arena code. Try again.");
    }
    async function joinArena(raw, u, o) {
      if (!u || !u.uid) throw new Error("Sign in to join an arena.");
      const code = BR.normCode(raw); if (!BR.isValidCode(code)) throw new Error("Codes are 4 letters/numbers, like K7QX.");
      const send = now();
      const res = await fs.tx(code, (t) => { const a = t.get();
        const e = joinError(a, u.uid, BR.serverNow(now(), offset), a && toMs(a.createdAt)); if (e) return { e };
        if (u.uid in a.seats) { t.update({ ["seats." + u.uid + ".seenAt"]: fs.ts() }); return { field: "seenAt" }; }
        const slot = freeSlot(a, o && o.team);
        t.update({ ["seats." + u.uid]: seatDoc(u, slot, a.size), ["slots." + slot]: u.uid }); return { field: "joinedAt" }; });
      if (res.e) throw new Error(res.e);
      await stamp(code, u.uid, res.field, send); return code;
    }
    // Idempotent: whoever sees every seat filled and ready first writes startAt; later callers no-op.
    async function maybeStart(code) {
      return fs.tx(code, (t) => { const a = t.get(); if (!a || started(a) || a.startAt != null || a.status !== "waiting" || !allReady(a)) return false;
        t.update({ status: "countdown", startAt: Math.round(BR.serverNow(now(), offset) + LEAD_MS) }); return true; });
    }
    async function setReady(code, u, ready) {
      const ok = await fs.tx(code, (t) => { const a = t.get(); if (!a || a.status !== "waiting" || !u || !(u.uid in a.seats)) return false;
        const patch = { ["seats." + u.uid + ".ready"]: !!ready }; if (u.pubName) patch["seats." + u.uid + ".pubName"] = String(u.pubName).slice(0, 24); // refresh the saved name
        t.update(patch); return true; });
      if (ok && ready) await maybeStart(code);
      return ok;
    }
    async function markLive(code) {
      return fs.tx(code, (t) => { const a = t.get(); if (!a || a.status !== "countdown" || a.startAt == null) return false;
        if (BR.serverNow(now(), offset) < a.startAt) return false; t.update({ status: "live" }); return true; });
    }
    // A member of the team sets / clears the team's name, before the start only.
    async function setTeamName(code, u, name) {
      const clean = sanitizeTeamName(name);
      return fs.tx(code, (t) => { const a = t.get(); if (!a || a.status !== "waiting" || !u || !(u.uid in a.seats)) return false;
        const team = teamOf(a, u.uid); if (!team) return false;
        t.update({ ["teamNames." + team]: clean ? clean : fs.del() }); return clean || "";
      });
    }
    async function leave(code, u) {
      return fs.tx(code, (t) => { const a = t.get(); if (!a || !u || !(u.uid in a.seats)) return false;
        if (started(a)) { if (a.seats[u.uid].leftAt) return false; t.update({ ["seats." + u.uid + ".leftAt"]: fs.ts() }); return "left-after-start"; }
        const rest = seatIds(a).filter((x) => x !== u.uid), mine = a.seats[u.uid];
        const cancel = !rest.length || a.createdBy === u.uid; // the creator leaving before the start cancels the arena
        t.update({ ["seats." + u.uid]: fs.del(), ["slots." + mine.slot]: fs.del(), status: cancel ? "abandoned" : "waiting" });
        return cancel ? "abandoned" : "seat-freed"; });
    }
    async function resume(code, u) {
      const a = await fs.tx(code, (t) => t.get());
      if (!a || !u || !(u.uid in (a.seats || {})) || a.status === "abandoned") return null;
      const send = now(); await fs.update(code, { ["seats." + u.uid + ".seenAt"]: fs.ts() }); await stamp(code, u.uid, "seenAt", send); return a;
    }
    return { createArena, joinArena, setReady, maybeStart, markLive, setTeamName, leave, resume, watch: fs.watch,
      get offset() { return offset; }, set offset(v) { offset = v; }, state: (s) => BR.countdownState(s, now(), offset) };
  }
  const api = { TARGET, PTS, PACK, GONE_MS, BEAT_MS, PUBLISH_MS, MAX_ROUNDS, MAX_BARI, SIZES, TEAM_NAME_MAX, DEFAULT_TEAM, isValidSize, teamOfSlot, otherTeam, seatOf, seatIds, started, isExpired,
    orderedSeats, teamSeats, teamOf, full, allReady, sanitizeTeamName, teamName, nameOf, freeSlot, joinError, validEntry, validPack, ent, forfeitedSeat, seatOut, teamOut, analyze, decide,
    matchState, canWrite, allowed, report, forfeit, staleSeat, staleTargets, claimGone, heartbeat, publishPatch, publishLive, resultText, boardStatus, controller, sum };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaArena = api;
})(typeof window !== "undefined" ? window : null);
