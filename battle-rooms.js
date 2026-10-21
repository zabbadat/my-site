/* Plank Battles step 1: rooms + shared countdown (no video, no pose). Two equal players, no host.
 * Doc battles/{code} = { code, createdBy (audit only), status, createdAt, startAt,
 *   players: { [uid]: { name, ready, joinedAt, seenAt?, leftAt? } } }
 * status: waiting (fewer than 2 seated or not both ready) | countdown | live | done | abandoned
 * Browser: window.ZabbaBattles. Node: require("./battle-rooms.js").
 * Adapter fs = { tx(code, fn(t)) where t.get() -> data|null, t.set(data), t.update(patch with dotted paths);
 *   update(code, patch), watch(code, cb(data|null)) -> unsubscribe, ts() serverTimestamp sentinel,
 *   del() deleteField sentinel, toMs(v) -> ms|null }
 */
(function (root) {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const CODE_LEN = 4, EXPIRE_MS = 30 * 60 * 1000, LEAD_MS = 5000, GO_MS = 1200, MAX = 2;
  const genCode = (rand = Math.random) => { let s = ""; for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length) % ALPHABET.length]; return s; };
  const normCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isValidCode = (s) => s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c));
  const estimateOffset = (serverMs, sendMs, recvMs) => Math.round(serverMs - (sendMs + recvMs) / 2);
  const serverNow = (localMs, off) => localMs + (off || 0);
  const started = (r) => !!r && (r.status === "countdown" || r.status === "live" || r.status === "done");
  const seatIds = (r) => Object.keys((r && r.players) || {});
  // Players in seat order (by joinedAt), for "Player 1 / Player 2".
  function orderedPlayers(r, toMs = (v) => v) {
    return seatIds(r).map((uid) => ({ uid, ...r.players[uid] })).sort((a, b) => (toMs(a.joinedAt) || 0) - (toMs(b.joinedAt) || 0));
  }
  const bothReady = (r) => seatIds(r).length === MAX && seatIds(r).every((u) => r.players[u].ready);
  function isExpired(r, nowServerMs, createdMs) { return !!r && !started(r) && createdMs != null && nowServerMs - createdMs > EXPIRE_MS; }
  function joinError(r, uid, nowServerMs, createdMs) {
    if (!r) return "No room with that code. Check the code and try again.";
    if (uid in (r.players || {})) return "";            // already seated: rejoin
    if (r.status === "abandoned" || started(r)) return "That battle has already started or ended.";
    if (isExpired(r, nowServerMs, createdMs)) return "That room has expired. Make a new one.";
    if (seatIds(r).length >= MAX) return "That room is full.";
    return "";
  }
  function countdownState(startAtMs, localNowMs, offsetMs) {
    if (startAtMs == null) return { phase: "wait" };
    const left = startAtMs - serverNow(localNowMs, offsetMs);
    if (left > 0) return { phase: "countdown", n: Math.min(5, Math.ceil(left / 1000)) };
    if (left > -GO_MS) return { phase: "go" };
    return { phase: "live" };
  }
  function controller(fs, opts = {}) {
    const rand = opts.rand || Math.random, now = opts.now || (() => Date.now());
    let offset = 0;
    const toMs = fs.toMs;
    // Our own server-stamped field read back -> clock skew.
    function stamp(code, uid, field, send) {
      return new Promise((res) => { let done = false; const off = fs.watch(code, (d) => {
        if (done) return; const p = d && d.players && d.players[uid]; const v = p && toMs(p[field]);
        if (v != null && v >= send + offset - 60000) { done = true; offset = estimateOffset(v, send, now()); off(); res(offset); } }); });
    }
    const seat = (u, extra) => ({ name: String(u.name || "Player").slice(0, 40), ready: false, joinedAt: fs.ts(), ...extra });
    async function createRoom(u) {
      if (!u || !u.uid) throw new Error("Sign in to create a battle.");
      for (let i = 0; i < 8; i++) {
        const code = genCode(rand), send = now();
        const ok = await fs.tx(code, (t) => { const cur = t.get();
          if (cur && cur.status !== "abandoned" && cur.status !== "done" && !isExpired(cur, serverNow(now(), offset), toMs(cur.createdAt))) return false;
          t.set({ code, createdBy: u.uid, status: "waiting", createdAt: fs.ts(), startAt: null, players: { [u.uid]: seat(u) } }); return true; });
        if (ok) { await stamp(code, u.uid, "joinedAt", send); return code; }
      }
      throw new Error("Couldn't find a free room code. Try again.");
    }
    async function joinRoom(raw, u) {
      if (!u || !u.uid) throw new Error("Sign in to join a battle.");
      const code = normCode(raw); if (!isValidCode(code)) throw new Error("Codes are 4 letters/numbers, like K7QX.");
      const send = now();
      const res = await fs.tx(code, (t) => { const r = t.get();
        const e = joinError(r, u.uid, serverNow(now(), offset), r && toMs(r.createdAt)); if (e) return { e };
        if (u.uid in r.players) { t.update({ ["players." + u.uid + ".seenAt"]: fs.ts() }); return { field: "seenAt" }; }
        t.update({ ["players." + u.uid]: seat(u) }); return { field: "joinedAt" }; });
      if (res.e) throw new Error(res.e);
      await stamp(code, u.uid, res.field, send); return code;
    }
    // Idempotent: whoever sees both ready first writes startAt; later callers no-op.
    async function maybeStart(code) {
      return fs.tx(code, (t) => { const r = t.get(); if (!r || started(r) || r.startAt != null || !bothReady(r)) return false;
        t.update({ status: "countdown", startAt: Math.round(serverNow(now(), offset) + LEAD_MS) }); return true; });
    }
    async function setReady(code, u, ready) {
      const ok = await fs.tx(code, (t) => { const r = t.get(); if (!r || started(r) || !(u.uid in r.players)) return false;
        t.update({ ["players." + u.uid + ".ready"]: !!ready }); return true; });
      if (ok && ready) await maybeStart(code);
      return ok;
    }
    // Idempotent: either player flips countdown -> live after startAt.
    async function markLive(code) {
      return fs.tx(code, (t) => { const r = t.get(); if (!r || r.status !== "countdown" || r.startAt == null) return false;
        if (serverNow(now(), offset) < r.startAt) return false; t.update({ status: "live" }); return true; });
    }
    async function leave(code, u) {
      return fs.tx(code, (t) => { const r = t.get(); if (!r || !u || !(u.uid in r.players)) return false;
        if (started(r)) { t.update({ ["players." + u.uid + ".leftAt"]: fs.ts() }); return "left-after-start"; } // battle continues
        const rest = seatIds(r).filter((x) => x !== u.uid);
        const patch = { ["players." + u.uid]: fs.del(), status: rest.length ? "waiting" : "abandoned" };
        t.update(patch); return rest.length ? "seat-freed" : "abandoned"; });
    }
    // Reload/reconnect: stamp seenAt for skew; countdown resumes from stored startAt.
    async function resume(code, u) {
      const r = await fs.tx(code, (t) => t.get());
      if (!r || !u || !(u.uid in (r.players || {})) || r.status === "abandoned") return null;
      const send = now(); await fs.update(code, { ["players." + u.uid + ".seenAt"]: fs.ts() }); await stamp(code, u.uid, "seenAt", send); return r;
    }
    return { createRoom, joinRoom, setReady, maybeStart, markLive, leave, resume, watch: fs.watch,
      get offset() { return offset; }, set offset(v) { offset = v; }, state: (s) => countdownState(s, now(), offset) };
  }
  const api = { ALPHABET, CODE_LEN, EXPIRE_MS, LEAD_MS, MAX, genCode, normCode, isValidCode, estimateOffset, serverNow, started, bothReady, orderedPlayers, isExpired, joinError, countdownState, controller };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaBattles = api;
})(typeof window !== "undefined" ? window : null);
