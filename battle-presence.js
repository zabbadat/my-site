/* Presence for two-player battles (Plank Battles, TUT Battles; Zabba Washer Battle has the same rules built in).
 * Each phone writes a heartbeat (players.{uid}.seenAt = server time) every BEAT_MS while the battle is live. If the
 * opponent's heartbeat is more than GONE_MS old (baseline: the shared start), the other phone records claimGone on its
 * OWN seat (write-once). The game module then treats the silent player as a forfeit: the claimer wins (and takes the pot).
 * Adapter fs = { tx(code, fn(t)) with t.get() / t.update(patch), update(code, patch), ts(), toMs(v) } (battle-rooms.js style).
 * Browser: window.ZabbaPresence. Node: require("./battle-presence.js").
 */
(function (root) {
  const GONE_MS = 30000, BEAT_MS = 10000;
  const ids = (r) => Object.keys((r && r.players) || {});
  const other = (r, uid) => ids(r).find((u) => u !== uid) || null;
  /* seats whose opponent recorded "silent for 30 s" (and who have not finished themselves) */
  const goneUids = (r) => ids(r).filter((u) => { const o = r.players[other(r, u)]; const p = r.players[u]; return !!(o && o.claimGone === true && !(p && p.result)); });
  const defaultToMs = (v) => (typeof v === "number" ? v : v && typeof v.toMillis === "function" ? v.toMillis() : null);
  /* isDone(r) -> true once the battle is decided (then nobody can be "gone") */
  function staleOpponent(r, uid, nowMs, toMs, isDone) {
    toMs = toMs || defaultToMs;
    if (!r || r.status !== "live" || r.startAt == null || !r.players || !(uid in r.players)) return false;
    const o = other(r, uid); if (!o || (isDone && isDone(r))) return false;
    const p = r.players[o]; if (p.result || p.leftAt || p.claimGone) return false;
    return nowMs - Math.max(toMs(r.startAt) || 0, toMs(p.seenAt) || 0) > GONE_MS;
  }
  function canWrite(r, uid, isDone) {
    const o = r && other(r, uid);
    return !!r && r.status === "live" && !!r.players && uid in r.players && !r.players[uid].result && !r.players[uid].leftAt && !(o && r.players[o].claimGone) && !(isDone && isDone(r));
  }
  function claimGone(fs, code, uid, nowMs, isDone) {
    return fs.tx(code, (t) => { const r = t.get(); if (!canWrite(r, uid, isDone) || !staleOpponent(r, uid, nowMs, fs.toMs, isDone)) return false;
      t.update({ ["players." + uid + ".claimGone"]: true }); return true; });
  }
  const heartbeat = (fs, code, uid) => fs.update(code, { ["players." + uid + ".seenAt"]: fs.ts() });
  const api = { GONE_MS, BEAT_MS, other, goneUids, staleOpponent, canWrite, claimGone, heartbeat };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaPresence = api;
})(typeof window !== "undefined" ? window : null);
