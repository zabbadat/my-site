/* Zabba Washer Battlers: the seasonal wins / losses board + the server-side tally behind it.
 * Season = calendar quarter in Eastern time (Jan-Mar Q1, Apr-Jun Q2, Jul-Sep Q3, Oct-Dec Q4), label "Season Q4 2026".
 * Records (written ONLY by netlify/functions/battle-stats.js, admin SDK; clients can never write them):
 *   washersBattleSeason/{season}_{uid}  PUBLIC read: { uid, name, season, wins, losses, battles, reachedAt, sortKey, updatedAt }
 *       names (never emails) and counts only. reachedAt = when the current win count was reached (ms).
 *       sortKey = season + "|" + padded(wins) + padded(99999-losses) + padded(battles) + padded(reachedAt inverted): ONE string
 *       whose descending order IS the ranking (most wins, fewer losses, more battles, reached first), so the page needs no
 *       composite index: orderBy sortKey desc within the season's key range.
 *   washersBattleLifetime/{uid}         NOT public (no rule reads or writes it; the page never loads it): { uid, wins, losses, battles, firstAt, lastAt, lastSeason }
 *   washersBattleLog/{code}_{createdAtMs}  NOT public: one-time guard so a match counts once.
 * A finished match is derived from the room doc with washers-battle.js decide() (same as the phones): a winner gets a win, the
 * other seat a loss (forfeit / left / silent 30 s = loss for the leaver). A tie or both leaving records nothing. A 2v2 team arena
 * (washersArenas/{code}, washers-arena.js decide()) gives every member of the winning team a win and every member of the other
 * team a loss (a forfeited team = a loss for its players); guard key arena_{code}_{createdAtMs}.
 * Browser: window.ZabbaBattlers. Node: require("./washers-battlers.js").
 */
(function (root) {
  const NODE = typeof module !== "undefined" && !!module.exports;
  const WB = NODE ? require("./washers-battle.js") : root && root.ZabbaWasherBattle;
  const AR = NODE ? require("./washers-arena.js") : root && root.ZabbaArena;
  const TZ = "America/New_York", PAGE = 50, VISIBLE_ROWS = 10, RCOL = "washersBattles";
  const MAXW = 99999, MAXMS = 9999999999999;
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const pad = (n, w) => String(Math.max(0, Math.min(Math.pow(10, w) - 1, Math.floor(Number(n) || 0)))).padStart(w, "0");
  // ---- seasons ----
  function easternParts(ms) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(ms)), g = {};
    f.forEach((p) => { g[p.type] = Number(p.value); });
    return g;
  }
  function seasonOf(ms) {
    const p = easternParts(ms == null ? Date.now() : ms), q = Math.floor((p.month - 1) / 3) + 1;
    return { year: p.year, q, id: p.year + "-Q" + q, label: "Season Q" + q + " " + p.year };
  }
  const seasonLabel = (ms) => seasonOf(ms).label;
  const RESET = { 1: "Resets Apr 1", 2: "Resets Jul 1", 3: "Resets Oct 1", 4: "Resets Jan 1" };
  const seasonResetText = (ms) => RESET[seasonOf(ms).q];
  const titleFor = (ms) => "Zabba Washer Battlers, " + seasonLabel(ms);
  const LEAD = "This season's wins and losses, and each player's ZAB. Most wins first. Scroll to find your rank. Names only.";
  const EMPTY = "Waiting for battles…";
  // ---- ranking ----
  const rec = (r) => ({ wins: r && isInt(r.wins) ? r.wins : 0, losses: r && isInt(r.losses) ? r.losses : 0, battles: r && isInt(r.battles) ? r.battles : 0, reachedAt: r && isInt(r.reachedAt) ? r.reachedAt : MAXMS });
  function sortKey(season, r) {
    const x = rec(r);
    return season + "|" + pad(x.wins, 5) + pad(MAXW - x.losses, 5) + pad(x.battles, 5) + pad(MAXMS - x.reachedAt, 13);
  }
  // Query range for one season's keys: sortKey >= lo and < hi, ordered descending.
  const seasonRange = (season) => ({ lo: season + "|", hi: season + "}" });
  // most wins, fewer losses, more battles, reached that win count first, then uid (stable)
  function compare(a, b) {
    const x = rec(a), y = rec(b);
    return (y.wins - x.wins) || (x.losses - y.losses) || (y.battles - x.battles) || (x.reachedAt - y.reachedAt) || (String(a.uid) < String(b.uid) ? -1 : String(a.uid) > String(b.uid) ? 1 : 0);
  }
  const ranked = (rows) => (rows || []).filter((r) => r && r.uid).slice().sort(compare);
  const rankOf = (rows, uid) => { const i = ranked(rows).findIndex((r) => r.uid === uid); return i < 0 ? 0 : i + 1; };
  // Exact rank of a record among ALL players from a count of records ranked ahead of it (count query): 1 + ahead.
  const rankFromAhead = (ahead) => (isInt(ahead) && ahead >= 0 ? ahead + 1 : 0);
  const name = (n) => (WB ? WB.pubName(n) : String(n || "Player"));
  const youLine = (rank, r, zab) => !r ? "You: no battles this season yet." : "You: #" + rank + ", " + r.wins + (r.wins === 1 ? " win" : " wins") + ", " + r.losses + (r.losses === 1 ? " loss" : " losses") + (zab == null ? "" : ", " + Number(zab).toLocaleString("en-US") + " ZAB");
  // ---- table html (names escaped by esc; ZAB via ZabCurrency amountHtml passed in) ----
  const DASH = "—";
  function rowHtml(r, i, me, zabMap, o) {
    const esc = o.esc, self = !!me && r.uid === me, z = zabMap && zabMap[r.uid];
    const zab = !me ? DASH : isInt(z) ? o.amountHtml(z) : DASH;
    return '<tr' + (self ? ' class="bb-me" data-me="1" aria-current="true"' : "") + ' data-uid="' + esc(r.uid) + '"><td>' + (i + 1) + "</td><td>" + esc(name(r.name)) + (self ? " (you)" : "") + "</td><td>" + (r.wins | 0) + "</td><td>" + (r.losses | 0) + "</td><td>" + zab + "</td></tr>";
  }
  function bodyHtml(rows, me, zabMap, o) {
    const list = ranked(rows);
    return list.length ? list.map((r, i) => rowHtml(r, i, me, zabMap, o)).join("") : '<tr><td colspan="5">' + o.esc(EMPTY) + "</td></tr>";
  }
  // ---- match -> who won / lost (null until the match is decided) ----
  // winners / losers are lists: 1v1 has one of each, a 2v2 team match has both members of each team.
  function matchResult(room) {
    if (!room || !room.players || !WB) return null;
    const d = WB.decide(room); if (!d.done) return null;
    const ids = Object.keys(room.players);
    if (ids.length === 2 && d.winner && ids.indexOf(d.winner) >= 0) { const l = ids.find((u) => u !== d.winner); return { winner: d.winner, loser: l, winners: [d.winner], losers: [l], reason: d.reason }; }
    return { winner: null, loser: null, winners: [], losers: [], reason: d.reason || "none" }; // tie or both left: nothing recorded
  }
  // Team arena (washers-arena.js decide(): the same check the phones use): every member of the winning team wins, every member of the other loses.
  function arenaResult(arena) {
    if (!arena || !arena.seats || !AR) return null;
    const d = AR.decide(arena); if (!d.done) return null;
    if (d.winner && d.winners.length && d.losers.length) return { winner: null, loser: null, winners: d.winners, losers: d.losers, reason: d.reason };
    return { winner: null, loser: null, winners: [], losers: [], reason: d.reason || "none" };
  }
  // ---- server settle (adapter as reputation.js: fs.tx(fn(t)), t.get(pathArray)->Promise, t.set(path,doc), ts(), toMs) ----
  const err = (status, message) => Object.assign(new Error(message), { status });
  const logKey = (code, createdMs, kind) => (kind === "arena" ? "arena_" : "") + code + "_" + createdMs;
  const seatDoc = (season, uid) => season + "_" + uid;
  function nextSeason(prev, season, uid, nm, won, atMs) {
    const p = rec(prev), has = !!prev;
    const wins = p.wins + (won ? 1 : 0), losses = p.losses + (won ? 0 : 1), battles = p.battles + 1;
    const reachedAt = won || !has ? atMs : p.reachedAt; // reachedAt moves only when the win count goes up (or a record starts)
    const d = { uid, name: nm, season, wins, losses, battles, reachedAt };
    d.sortKey = sortKey(season, d);
    return d;
  }
  function nextLifetime(prev, uid, season, won, atMs) {
    const p = prev || {};
    return { uid, wins: (p.wins | 0) + (won ? 1 : 0), losses: (p.losses | 0) + (won ? 0 : 1), battles: (p.battles | 0) + 1, firstAt: isInt(p.firstAt) ? p.firstAt : atMs, lastAt: atMs, lastSeason: season };
  }
  // kind: "room" (default, washersBattles 1v1) or "arena" (washersArenas 2v2). Counted once per match (washersBattleLog guard).
  function settle(fs, uid, code, nowMs, kind) {
    kind = kind === "arena" ? "arena" : "room";
    code = String(code || "").toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) return Promise.reject(err(400, "Bad room code."));
    nowMs = nowMs == null ? Date.now() : nowMs;
    return fs.tx((t) => t.get([kind === "arena" ? "washersArenas" : RCOL, code]).then((doc) => {
      if (!doc) throw err(404, kind === "arena" ? "No arena with that code." : "No room with that code.");
      const seats = kind === "arena" ? doc.seats : doc.players;
      if (!seats || !(uid in seats)) throw err(403, "Not your match.");
      const res = kind === "arena" ? arenaResult(doc) : matchResult(doc); if (!res) return { pending: true };
      const createdMs = fs.toMs(doc.createdAt), key = logKey(code, createdMs, kind);
      const atMs = isInt(doc.startAt) ? doc.startAt : nowMs, season = seasonOf(atMs).id, members = res.winners.concat(res.losers);
      return Promise.all([t.get(["washersBattleLog", key])].concat(members.map((u) => t.get(["washersBattleSeason", seatDoc(season, u)])), members.map((u) => t.get(["washersBattleLifetime", u])))).then((got) => {
        if (got[0]) return { already: true, key };
        if (!members.length) { t.set(["washersBattleLog", key], { key, code, kind, outcome: "none", reason: res.reason, at: fs.ts() }); return { ok: true, key, recorded: false, reason: res.reason }; }
        const nm = (u) => name(WB.seatName(seats[u]));
        members.forEach((u, i) => {
          const won = res.winners.indexOf(u) >= 0;
          t.set(["washersBattleSeason", seatDoc(season, u)], Object.assign(nextSeason(got[1 + i], season, u, nm(u), won, atMs), { updatedAt: fs.ts() }));
          t.set(["washersBattleLifetime", u], nextLifetime(got[1 + members.length + i], u, season, won, atMs));
        });
        t.set(["washersBattleLog", key], { key, code, kind, outcome: "win", winners: res.winners, losers: res.losers, season, reason: res.reason, at: fs.ts() });
        return { ok: true, key, recorded: true, season, winners: res.winners, losers: res.losers, winner: res.winner, loser: res.loser };
      });
    }));
  }
  const api = { TZ, PAGE, VISIBLE_ROWS, LEAD, EMPTY, DASH, seasonOf, seasonLabel, seasonResetText, titleFor, sortKey, seasonRange, compare, ranked, rankOf, rankFromAhead, youLine,
    rowHtml, bodyHtml, matchResult, arenaResult, settle, nextSeason, nextLifetime, logKey, seasonDoc: seatDoc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaBattlers = api;
})(typeof window !== "undefined" ? window : null);
