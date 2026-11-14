/* Zabba Washers Live Match: two remote players, real washers thrown on camera, each player scores their OWN pack of 3 while both
 * watch the video (video-only scoring: no step tracking, no sensors). Zabba Washers / Bariboshi rules (rules.html v1.9, same point
 * values as washers-battle.js): a pack is 3 washers, each Out 0 / Box-bound 2 / Shoot 3 / Bank 5; a round = one pack each; first to 21.
 * Doc matches/{code} (read: any signed-in user; a future public Live tab will need a rules change):
 *   { code, status: waiting|active|finished|abandoned, createdBy, createdAt, updatedAt, turnMs,
 *     uids: [uidA, uidB?], players: [{ uid, name, photo }, ...] (same order as uids; host first),
 *     scores: [a, b], round (0 before start, then 1..), first (0|1: who pitches first this round), turn (uid|null),
 *     turnAt (server time the current turn began; deadline = turnAt + turnMs), pack ([] .. 3 washers being tapped in live),
 *     log: [{ r: round, i: seat 0|1, p: [w,w,w], x: false = scored / true = time ran out (0 0 0) }], winner (uid|null), reason, seq }
 * Rounds (Art. 5.5 / 5.6, as in washers-battle.js): the side that scored more in a round pitches first next round, a tie keeps the
 * order; round 1: the host pitches first. A win is checked only after BOTH packs of a round (equal turns): the higher total at or
 * over 21 wins; level at/over 21 = overtime round. No bust, no exact-21. 30 rounds without a winner = tie.
 * Timer: TURN_MS per turn (45 s). The current player can submit until the deadline + GRACE_MS (5 s, network). After that the
 * opponent takes the turn (their phone does it automatically, or they tap): the late pack is logged as 0 0 0 and play moves on.
 * Hooks for later (Live tab, PFP-in-washers): api.hooks.onState(fn) gets every snapshot; api.hooks.photoFor(player) picks the photo.
 * Browser: window.ZabbaMatch. Node: require("./zabba-match.js"). Adapter fs: same shape as battle-rooms.js (tx/update/watch/ts/toMs).
 */
(function (root) {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const CODE_LEN = 5, TARGET = 21, PACK = 3, PTS = [0, 2, 3, 5], TURN_MS = 45000, GRACE_MS = 5000, MAX_ROUNDS = 30;
  const EXPIRE_MS = 30 * 60 * 1000, NAME_MAX = 40, PHOTO_MAX = 1024, MAX_LOG = MAX_ROUNDS * 2;
  const POINTS = { 5: "Bank", 3: "Shoot", 2: "Box-bound", 0: "Out" };
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const sum = (p) => p.reduce((a, b) => a + b, 0);
  const genCode = (rand = Math.random) => { let s = ""; for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length) % ALPHABET.length]; return s; };
  const normCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isValidCode = (s) => typeof s === "string" && s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c));
  /* ?match=CODE or #match=CODE (also #match/CODE) in a shared link */
  function codeFromUrl(search, hash) {
    const m = /[?&]match=([A-Za-z0-9-]+)/.exec(search || "") || /^#match[=/]([A-Za-z0-9-]+)/.exec(hash || "");
    const c = m ? normCode(m[1]) : ""; return isValidCode(c) ? c : "";
  }
  const linkFor = (code, origin) => (origin || "https://zabbadat.com") + "/?match=" + code + "#zabbaMatch";
  const validWasher = (w) => PTS.includes(w);
  const validPack = (p) => Array.isArray(p) && p.length === PACK && p.every(validWasher);
  const validPartial = (p) => Array.isArray(p) && p.length <= PACK && p.every(validWasher);
  const cleanText = (s) => String(s == null ? "" : s).replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  /* Names only, never an email (cut to the local part, like the site's publicName). */
  function nameOf(u) {
    let n = cleanText(u && (u.name || u.displayName));
    if (!n && u && u.email) n = cleanText(String(u.email).split("@")[0]);
    if (n.indexOf("@") >= 0) n = cleanText(n.split("@")[0]);
    return n.slice(0, NAME_MAX).trim() || "Player";
  }
  const photoOf = (u) => { const p = String((u && (u.photo || u.photoURL)) || ""); return /^https:\/\/[^\s"'<>]+$/.test(p) && p.length <= PHOTO_MAX ? p : ""; };
  const seatOf = (u) => ({ uid: u.uid, name: nameOf(u), photo: photoOf(u) });
  const idx = (m, uid) => (m && Array.isArray(m.uids) ? m.uids.indexOf(uid) : -1);
  const otherUid = (m, uid) => (m && m.uids && m.uids.length === 2 ? m.uids[1 - idx(m, uid)] : null);
  const playerOf = (m, uid) => (m && m.players ? m.players.find((p) => p.uid === uid) || null : null);
  const ms = (v, toMs) => (toMs ? toMs(v) : typeof v === "number" ? v : null);
  const deadlineMs = (m, toMs) => { const t = m && ms(m.turnAt, toMs); return t == null ? null : t + (m.turnMs || TURN_MS); };
  const timeLeftMs = (m, nowMs, toMs) => { const d = deadlineMs(m, toMs); return d == null ? null : Math.max(0, d - nowMs); };
  const isExpired = (m, nowMs, toMs) => !!m && m.status === "waiting" && ms(m.createdAt, toMs) != null && nowMs - ms(m.createdAt, toMs) > EXPIRE_MS;

  function newMatch(code, u, ts) {
    return { code, status: "waiting", createdBy: u.uid, createdAt: ts, updatedAt: ts, turnMs: TURN_MS, uids: [u.uid], players: [seatOf(u)],
      scores: [0, 0], round: 0, first: 0, turn: null, turnAt: null, pack: [], log: [], winner: null, reason: "", seq: 0 };
  }
  function joinError(m, uid, nowMs, toMs) {
    if (!m) return "No match with that code. Check the code and try again.";
    if (idx(m, uid) >= 0) return "";                         // already in: rejoin
    if (m.status !== "waiting") return m.status === "abandoned" ? "That match was cancelled." : "That match already has two players.";
    if (isExpired(m, nowMs, toMs)) return "That match has expired. Make a new one.";
    if (m.uids.length >= 2) return "That match already has two players.";
    return "";
  }
  // Second player joins: match starts at once, host pitches first, host's turn clock starts.
  const joinPatch = (m, u, ts) => ({ uids: [m.uids[0], u.uid], players: [m.players[0], seatOf(u)], status: "active", round: 1, first: 0, turn: m.uids[0], turnAt: ts, updatedAt: ts });

  // ---- turns + scoring ----
  function canSubmit(m, uid, nowMs, toMs) { const d = deadlineMs(m, toMs); return !!m && m.status === "active" && m.turn === uid && (d == null || nowMs <= d + GRACE_MS); }
  function canClaim(m, uid, nowMs, toMs) { const d = deadlineMs(m, toMs); return !!m && m.status === "active" && idx(m, uid) >= 0 && m.turn !== uid && d != null && nowMs > d + GRACE_MS; }
  /* The state after the current player's pack (pack = 3 washers; claimed = time ran out, pack must be 0 0 0). Pure. */
  function afterPack(m, pack, claimed) {
    const i = idx(m, m.turn), e = { r: m.round, i, p: pack.slice(), x: !!claimed };
    const scores = m.scores.slice(); scores[i] += sum(pack);
    const log = (m.log || []).concat([e]), out = { scores, log, pack: [], round: m.round, first: m.first, turn: m.turn, status: "active", winner: null, reason: "", seq: (m.seq | 0) + 1 };
    const inRound = log.filter((x) => x.r === m.round);
    if (inRound.length < 2) { out.turn = m.uids[1 - i]; return out; } // first pack of the round: other player's turn
    const f = m.first, s = 1 - f, sc = [0, 0]; inRound.forEach((x) => (sc[x.i] += sum(x.p)));
    if (Math.max(scores[0], scores[1]) >= TARGET && scores[0] !== scores[1]) { // win checked after both packs
      out.status = "finished"; out.winner = m.uids[scores[0] > scores[1] ? 0 : 1]; out.reason = "score"; out.turn = null; return out;
    }
    if (m.round >= MAX_ROUNDS) { out.status = "finished"; out.winner = null; out.reason = "tie"; out.turn = null; return out; }
    out.first = sc[s] > sc[f] ? s : f; out.round = m.round + 1; out.turn = m.uids[out.first]; return out;
  }
  const isOvertime = (m) => !!m && m.status === "active" && Math.max(m.scores[0], m.scores[1]) >= TARGET && m.scores[0] === m.scores[1];
  /* Replays the log from scratch: scores/turn the doc should hold (a check that the stored doc is consistent). */
  function replay(m) {
    let s = { uids: m.uids, scores: [0, 0], round: 1, first: 0, turn: m.uids[0], status: "active", log: [], seq: 0 };
    for (const e of m.log || []) { if (s.status !== "active" || e.i !== idx(s, s.turn) || e.r !== s.round) return null; s = Object.assign({}, s, afterPack(s, e.p, e.x)); }
    return s;
  }

  /* Mirror of the matches/{code} security rules (firestore.rules), for client pre-checks and tests.
   * before/after = docs with timestamps as ms; nowMs = server time of the write. Returns "" when allowed, else the reason. */
  const KEYS = ["code","status","createdBy","createdAt","updatedAt","turnMs","uids","players","scores","round","first","turn","turnAt","pack","log","winner","reason","seq"];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const changedKeys = (a, b) => KEYS.filter((k) => !eq(a[k], b[k])).concat(Object.keys(b).filter((k) => !KEYS.includes(k)));
  const only = (ch, list) => ch.every((k) => list.includes(k));
  const seatOk = (p, uid) => !!p && eq(Object.keys(p).sort(), ["name", "photo", "uid"]) && p.uid === uid && typeof p.name === "string" && p.name.length >= 1 && p.name.length <= NAME_MAX && typeof p.photo === "string" && p.photo.length <= PHOTO_MAX;
  function checkWrite(before, after, uid, nowMs, code) {
    if (!uid) return "not signed in";
    if (!after) return "delete not allowed";
    const n = after, d = before;
    if (!eq(Object.keys(n).sort(), KEYS.slice().sort())) return "fields";
    if (!d) { // create
      if (!isValidCode(code) || n.code !== code) return "code";
      if (!(n.status === "waiting" && n.createdBy === uid && n.createdAt === nowMs && n.updatedAt === nowMs && n.turnMs === TURN_MS && eq(n.uids, [uid])
        && n.players.length === 1 && seatOk(n.players[0], uid) && eq(n.scores, [0, 0]) && n.round === 0 && n.first === 0 && n.turn === null && n.turnAt === null
        && eq(n.pack, []) && eq(n.log, []) && n.winner === null && n.reason === "" && n.seq === 0)) return "bad new match";
      return "";
    }
    if (n.updatedAt !== nowMs) return "updatedAt";
    const ch = changedKeys(d, n), me = idx(d, uid);
    // join
    if (me < 0) {
      if (!(d.status === "waiting" && d.uids.length === 1 && nowMs - d.createdAt <= EXPIRE_MS)) return "not joinable";
      if (!only(ch, ["uids", "players", "status", "round", "turn", "turnAt", "updatedAt"])) return "join fields";
      if (!(eq(n.uids, [d.uids[0], uid]) && n.players.length === 2 && eq(n.players[0], d.players[0]) && seatOk(n.players[1], uid)
        && n.status === "active" && n.round === 1 && n.turn === d.uids[0] && n.turnAt === nowMs)) return "bad join";
      return "";
    }
    // host cancels a waiting match
    if (d.status === "waiting") return uid === d.createdBy && only(ch, ["status", "updatedAt"]) && n.status === "abandoned" ? "" : "waiting: cancel only";
    if (d.status !== "active") return "match over";
    // forfeit: the other player wins
    if (n.status === "finished" && n.reason === "forfeit") return only(ch, ["status", "winner", "reason", "turn", "updatedAt"]) && n.winner === d.uids[1 - me] && n.turn === null ? "" : "bad forfeit";
    // live pack taps by the current player
    if (only(ch, ["pack", "updatedAt"])) return d.turn === uid && validPartial(n.pack) ? "" : "pack: not your turn";
    // a pack: scored by the current player before the deadline, or a time-out taken by the opponent after it
    if (!only(ch, ["scores", "round", "first", "turn", "turnAt", "pack", "log", "winner", "reason", "status", "seq", "updatedAt"])) return "turn fields";
    if (n.seq !== d.seq + 1 || n.turnAt !== nowMs || !eq(n.pack, []) || n.log.length !== d.log.length + 1 || n.log.length > MAX_LOG || !eq(n.log.slice(0, d.log.length), d.log)) return "turn bookkeeping";
    const e = n.log[d.log.length], ti = idx(d, d.turn), late = nowMs > d.turnAt + d.turnMs + GRACE_MS;
    if (!(e && eq(Object.keys(e).sort(), ["i", "p", "r", "x"]) && e.r === d.round && e.i === ti && validPack(e.p))) return "log entry";
    if (uid === d.turn) { if (e.x !== false || late) return late ? "turn time is up" : "log entry"; }
    else if (!(e.x === true && eq(e.p, [0, 0, 0]) && late)) return late ? "time-out must be 0 0 0" : "not your turn";
    if (!(n.scores[ti] === d.scores[ti] + sum(e.p) && n.scores[1 - ti] === d.scores[1 - ti])) return "scores";
    if (!(d.uids.includes(n.turn) || n.turn === null) || !(n.round === d.round || n.round === d.round + 1) || !(n.first === 0 || n.first === 1)) return "turn";
    if (n.status === "active") return n.winner === null && n.reason === "" && n.turn !== null ? "" : "active state";
    if (n.status === "finished") {
      if (n.reason === "score") return d.uids.includes(n.winner) && n.scores[d.uids.indexOf(n.winner)] >= TARGET && n.scores[d.uids.indexOf(n.winner)] > n.scores[1 - d.uids.indexOf(n.winner)] ? "" : "bad win";
      if (n.reason === "tie") return n.winner === null && d.round >= MAX_ROUNDS ? "" : "bad tie";
    }
    return "status";
  }

  // ---- what each phone shows ----
  function view(m, uid, nowMs, toMs) {
    const out = { state: m ? m.status : "missing", mine: false, banner: "", who: null, secsLeft: null, canClaim: false, canSubmit: false, overtime: false, seats: [] };
    if (!m) { out.banner = "Match not found."; return out; }
    out.seats = m.players.map((p, i) => ({ uid: p.uid, name: p.name, photo: hooks.photoFor(p) || "", score: m.scores[i] | 0, me: p.uid === uid, turn: m.turn === p.uid }));
    if (m.status === "waiting") { out.banner = "Waiting for a friend to join. Share the code."; return out; }
    if (m.status === "abandoned") { out.banner = "Match cancelled."; return out; }
    if (m.status === "finished") {
      const w = playerOf(m, m.winner);
      out.banner = m.reason === "tie" ? "Tie after " + MAX_ROUNDS + " rounds." : m.winner === uid ? "You win" + (m.reason === "forfeit" ? " by forfeit." : "!") : (w ? w.name : "Opponent") + " wins" + (m.reason === "forfeit" ? " by forfeit." : ".");
      out.who = w; return out;
    }
    const left = timeLeftMs(m, nowMs, toMs), t = playerOf(m, m.turn);
    out.mine = m.turn === uid; out.who = t; out.secsLeft = left == null ? null : Math.ceil(left / 1000); out.overtime = isOvertime(m);
    out.canSubmit = canSubmit(m, uid, nowMs, toMs); out.canClaim = canClaim(m, uid, nowMs, toMs);
    out.banner = out.mine ? "Your turn: pitch your pack of 3" : "Waiting for " + (t ? t.name : "your opponent");
    return out;
  }
  const packText = (p) => (p || []).map((w) => POINTS[w] + " " + w).join(" · ");
  const hooks = { listeners: [], onState(fn) { this.listeners.push(fn); return () => (this.listeners = this.listeners.filter((f) => f !== fn)); }, emit(m) { this.listeners.slice().forEach((f) => { try { f(m); } catch (e) {} }); }, photoFor: (p) => (p && p.photo) || "" };

  // ---- writes (all transactions read the doc and re-check turn + status) ----
  function controller(fs, opts = {}) {
    const rand = opts.rand || Math.random, now = opts.now || (() => Date.now()), toMs = fs.toMs;
    let offset = 0;
    const serverNow = () => now() + offset;
    // our own updatedAt read back -> clock offset (the turn timer runs on server time)
    function stamp(code, send, seq) {
      return new Promise((res) => { let done = false; const off = fs.watch(code, (d) => { if (done) return; const v = d && toMs(d.updatedAt);
        if (v != null && (seq == null || d.seq >= seq) && v >= send + offset - 60000) { done = true; offset = Math.round(v - (send + now()) / 2); off(); res(offset); } }); });
    }
    async function create(u) {
      if (!u || !u.uid) throw new Error("Sign in to start a match.");
      for (let i = 0; i < 8; i++) {
        const code = genCode(rand), send = now();
        const ok = await fs.tx(code, (t) => { if (t.get()) return false; t.set(newMatch(code, u, fs.ts())); return true; });
        if (ok) { await stamp(code, send); return code; }
      }
      throw new Error("Couldn't find a free match code. Try again.");
    }
    async function join(raw, u) {
      if (!u || !u.uid) throw new Error("Sign in to join a match.");
      const code = normCode(raw); if (!isValidCode(code)) throw new Error("Match codes are 5 letters/numbers, like K7QX2.");
      const send = now();
      const res = await fs.tx(code, (t) => { const m = t.get(); const e = joinError(m, u.uid, serverNow(), toMs); if (e) return { e };
        if (idx(m, u.uid) >= 0) return { rejoin: true };
        t.update(joinPatch(m, u, fs.ts())); return { joined: true }; });
      if (res.e) throw new Error(res.e);
      if (res.joined) await stamp(code, send);
      return code;
    }
    async function setPack(code, u, pack) {
      if (!validPartial(pack)) throw new Error("A pack is up to 3 washers: 0, 2, 3 or 5.");
      return fs.tx(code, (t) => { const m = t.get(); if (!m || m.status !== "active" || m.turn !== u.uid) return false; t.update({ pack: pack.slice(), updatedAt: fs.ts() }); return true; });
    }
    async function submit(code, u, pack) {
      if (!validPack(pack)) throw new Error("Score all 3 washers first.");
      const send = now();
      const r = await fs.tx(code, (t) => { const m = t.get();
        if (!m || m.status !== "active") return { e: "This match isn't running." };
        if (m.turn !== u.uid) return { e: "It isn't your turn." };
        if (!canSubmit(m, u.uid, serverNow(), toMs)) return { e: "Your turn time ran out." };
        const nx = afterPack(m, pack, false); t.update(Object.assign(nx, { turnAt: fs.ts(), updatedAt: fs.ts() })); return { ok: true, seq: nx.seq, status: nx.status }; });
      if (r.e) throw new Error(r.e);
      stamp(code, send, r.seq); return r;
    }
    // Opponent's clock ran out: log their pack as 0 0 0 and take the turn. Idempotent (a second caller sees it already moved).
    async function claim(code, u) {
      return fs.tx(code, (t) => { const m = t.get(); if (!canClaim(m, u.uid, serverNow(), toMs)) return false;
        t.update(Object.assign(afterPack(m, [0, 0, 0], true), { turnAt: fs.ts(), updatedAt: fs.ts() })); return true; });
    }
    async function forfeit(code, u) {
      return fs.tx(code, (t) => { const m = t.get(); if (!m || m.status !== "active" || idx(m, u.uid) < 0) return false;
        t.update({ status: "finished", winner: otherUid(m, u.uid), reason: "forfeit", turn: null, updatedAt: fs.ts() }); return true; });
    }
    async function cancel(code, u) {
      return fs.tx(code, (t) => { const m = t.get(); if (!m || m.status !== "waiting" || m.createdBy !== u.uid) return false;
        t.update({ status: "abandoned", updatedAt: fs.ts() }); return true; });
    }
    function watch(code, cb) { return fs.watch(code, (m) => { hooks.emit(m); cb(m); }); }
    return { create, join, setPack, submit, claim, forfeit, cancel, watch, serverNow, get offset() { return offset; }, set offset(v) { offset = v; },
      view: (m, uid) => view(m, uid, serverNow(), toMs) };
  }
  const api = { ALPHABET, CODE_LEN, TARGET, PACK, PTS, POINTS, TURN_MS, GRACE_MS, MAX_ROUNDS, EXPIRE_MS, KEYS, genCode, normCode, isValidCode, codeFromUrl, linkFor,
    validPack, validPartial, nameOf, photoOf, seatOf, idx, otherUid, playerOf, deadlineMs, timeLeftMs, isExpired, newMatch, joinError, joinPatch,
    canSubmit, canClaim, afterPack, isOvertime, replay, checkWrite, view, packText, sum, hooks, controller };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaMatch = api;
})(typeof window !== "undefined" ? window : null);
