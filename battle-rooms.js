/* Plank Battles step 1: rooms + shared countdown (no video, no pose).
 * Pure helpers + a controller over a tiny Firestore adapter, so it runs in tests with a mock.
 * Browser: window.ZabbaBattles. Node: require("./battle-rooms.js").
 * Adapter fs = {
 *   tx(code, fn(t)) -> runs a transaction; t.get() -> data|null, t.set(data), t.update(patch)
 *   update(code, patch), watch(code, cb(data|null)) -> unsubscribe, ts() -> serverTimestamp sentinel,
 *   toMs(v) -> number|null (Timestamp/number -> ms) }
 */
(function (root) {
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const CODE_LEN = 4, EXPIRE_MS = 30 * 60 * 1000, LEAD_MS = 5000, GO_MS = 1200;
  function genCode(rand = Math.random) { let s = ""; for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length) % ALPHABET.length]; return s; }
  function normCode(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function isValidCode(s) { return s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c)); }
  // Clock offset (server - local) from a write stamped by the server between localSend and localRecv.
  function estimateOffset(serverMs, localSendMs, localRecvMs) { return Math.round(serverMs - (localSendMs + localRecvMs) / 2); }
  function serverNow(localNowMs, offsetMs) { return localNowMs + (offsetMs || 0); }
  function joinError(room, uid, nowServerMs, createdMs) {
    if (!room) return "No room with that code. Check the code and try again.";
    if (room.hostUid === uid) return "That's your own room. Share the code with a friend.";
    if (room.status === "abandoned" || room.status === "done") return "That battle has ended.";
    if (createdMs != null && nowServerMs - createdMs > EXPIRE_MS) return "That room has expired. Ask for a new code.";
    if (room.guestUid && room.guestUid !== uid) return "That room is full.";
    return "";
  }
  // What to show for a start time: {phase:'wait'|'countdown'|'go'|'live', n}
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
    async function stampOffset(code, field, send) {
      // read our own server-stamped field back to estimate skew
      return new Promise((res) => { const off = fs.watch(code, (d) => { const v = d && fs.toMs(d[field]); if (v != null) { offset = estimateOffset(v, send, now()); off(); res(offset); } }); });
    }
    async function createRoom(user) {
      if (!user || !user.uid) throw new Error("Sign in to create a battle.");
      for (let i = 0; i < 8; i++) {
        const code = genCode(rand); const send = now();
        const ok = await fs.tx(code, (t) => { const cur = t.get(); if (cur && !["abandoned", "done"].includes(cur.status) && !(fs.toMs(cur.createdAt) < serverNow(now(), offset) - EXPIRE_MS)) return false;
          t.set({ code, hostUid: user.uid, hostName: user.name || "Host", guestUid: null, guestName: null, status: "waiting", createdAt: fs.ts(), startAt: null }); return true; });
        if (ok) { await stampOffset(code, "createdAt", send); return code; }
      }
      throw new Error("Couldn't find a free room code. Try again.");
    }
    async function joinRoom(raw, user) {
      if (!user || !user.uid) throw new Error("Sign in to join a battle.");
      const code = normCode(raw); if (!isValidCode(code)) throw new Error("Codes are 4 letters/numbers, like K7QX.");
      const send = now();
      const err = await fs.tx(code, (t) => { const r = t.get(); const e = joinError(r, user.uid, serverNow(now(), offset), r && fs.toMs(r.createdAt)); if (e) return e;
        if (r.guestUid !== user.uid) t.update({ guestUid: user.uid, guestName: user.name || "Guest", status: "ready", joinedAt: fs.ts() }); return ""; });
      if (err) throw new Error(err);
      await stampOffset(code, "joinedAt", send); return code;
    }
    async function start(code, user) { await fs.update(code, { status: "countdown", startAt: Math.round(serverNow(now(), offset) + LEAD_MS), startedBy: user.uid }); }
    async function markLive(code) { await fs.update(code, { status: "live" }); }
    async function leave(code, room, user) {
      if (!room) return;
      if (room.hostUid === user.uid) await fs.update(code, { status: "abandoned" });
      else await fs.update(code, { guestUid: null, guestName: null, joinedAt: null, status: room.status === "ready" ? "waiting" : room.status });
    }
    return { createRoom, joinRoom, start, markLive, leave, watch: fs.watch, get offset() { return offset; }, set offset(v) { offset = v; }, state: (startAt) => countdownState(startAt, now(), offset) };
  }
  const api = { ALPHABET, CODE_LEN, EXPIRE_MS, LEAD_MS, genCode, normCode, isValidCode, estimateOffset, serverNow, joinError, countdownState, controller };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaBattles = api;
})(typeof window !== "undefined" ? window : null);
