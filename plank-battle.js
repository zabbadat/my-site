/* Plank Battles result step: last one holding wins. Rooms/ready/countdown come from battle-rooms.js (battles/{code}).
 * Each phone writes only its own seat: a write-once result when its player drops (or forfeits).
 *   result = { holdMs, verified, at } | { forfeit: true, at }   holdMs = serverNow - startAt (shared GO time)
 *   verified = this page stayed visible for the whole hold (no tab switch / screen off).
 * Winner (from the room doc only): first to drop / forfeit / leave loses at once; if both dropped, longer hold wins
 * (exact same ms = tie). ZAB bets (room has stake): the win is the longest hold, holds within 1 s are a draw (stakes refunded),
 * and 30 s of heartbeat silence (battle-presence.js claimGone) is a forfeit. Browser: window.ZabbaPlankBattle. Node: require("./plank-battle.js").
 */
(function (root) {
  const PR = typeof module !== "undefined" && module.exports ? require("./battle-presence.js") : root && root.ZabbaPresence;
  const MAX_MS = 7200000; // 2 h cap, same as the plank board
  const DRAW_MS = 1000; // wagered rooms only: holds within 1 s of each other are a draw (both stakes refunded)
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const ids = (r) => Object.keys((r && r.players) || {});
  const dropped = (p) => !!(p && p.result && !p.result.forfeit && isInt(p.result.holdMs));
  const out = (p) => !!(p && ((p.result && p.result.forfeit) || (p.leftAt && !p.result)));
  const ended = (p) => dropped(p) || out(p);
  function holdMs(room, serverNowMs) { return room && room.startAt != null ? Math.max(0, Math.min(MAX_MS, Math.round(serverNowMs - room.startAt))) : 0; }
  function makeResult(room, serverNowMs, verified, ts) { const h = holdMs(room, serverNowMs); return { holdMs: h, verified: !!verified, at: ts }; }
  function validResult(x) {
    if (!x || typeof x !== "object") return false;
    const k = Object.keys(x).sort().join(",");
    if (k === "at,forfeit") return x.forfeit === true;
    return k === "at,holdMs,verified" && isInt(x.holdMs) && x.holdMs >= 0 && x.holdMs <= MAX_MS && typeof x.verified === "boolean";
  }
  const staked = (r) => !!r && isInt(r.stake) && r.stake >= 1;
  /* out = tapped forfeit, left after start, or the opponent recorded 30 s of silence (claimGone) */
  const outBy = (r, uid) => out(r.players[uid]) || (PR ? PR.goneUids(r).indexOf(uid) >= 0 : false);
  /* decide(r [, serverNowMs]). Unwagered rooms: first to drop loses at once (unchanged). Wagered rooms (r.stake): the win is the
   * longest hold; holds within DRAW_MS are a draw; when one player has dropped the other is declared the winner only once
   * more than DRAW_MS has passed since that drop (needs serverNowMs), so a drop 0.4 s later can still draw. */
  function decide(r, nowMs) {
    const u = ids(r); if (!r || u.length !== 2 || !(r.status === "live" || r.status === "done")) return { done: false };
    const [a, b] = u.map((x) => ({ uid: x, p: r.players[x] }));
    const oa = outBy(r, a.uid), ob = outBy(r, b.uid);
    if (oa && ob) return { done: true, winner: null, reason: "both-out" };
    if (oa) return { done: true, winner: b.uid, reason: "forfeit" };
    if (ob) return { done: true, winner: a.uid, reason: "forfeit" };
    const da = dropped(a.p), db = dropped(b.p), st = staked(r);
    if (da && db) {
      const ha = a.p.result.holdMs, hb = b.p.result.holdMs;
      if (ha === hb || (st && Math.abs(ha - hb) <= DRAW_MS)) return { done: true, winner: null, reason: "tie" };
      return { done: true, winner: ha > hb ? a.uid : b.uid, reason: "longer" };
    }
    if (da || db) {
      const first = da ? a : b, rest = da ? b : a;
      if (st && !(isInt(nowMs) && r.startAt != null && nowMs - r.startAt > first.p.result.holdMs + DRAW_MS)) return { done: false, waiting: true };
      return { done: true, winner: rest.uid, reason: "last-holding" };
    }
    return { done: false };
  }
  function resultText(r, uid, nowMs) {
    const d = decide(r, nowMs); if (!d.done) return "";
    if (d.winner == null) return d.reason === "tie" ? "Tie: same hold time." : "No winner: both players left.";
    const won = d.winner === uid;
    if (d.reason === "forfeit") return won ? "You win: your opponent forfeited." : "You forfeited.";
    return won ? "You win: you held the plank longest." : "You lose: you dropped first.";
  }
  const canWrite = (r, uid) => !!r && r.status === "live" && !!r.players && uid in r.players && !r.players[uid].result && !(PR && PR.goneUids(r).indexOf(uid) >= 0);
  const claimGone = (fs, code, uid, nowMs) => PR.claimGone(fs, code, uid, nowMs, (r) => decide(r, nowMs).done);
  const stale = (r, uid, nowMs, toMs) => PR.staleOpponent(r, uid, nowMs, toMs, (x) => decide(x, nowMs).done);
  // "I dropped" (or winner stops after the decision): write-once own hold.
  function submitDrop(fs, code, uid, serverNowMs, verified) {
    return fs.tx(code, (t) => { const r = t.get(); if (!canWrite(r, uid)) return false;
      t.update({ ["players." + uid + ".result"]: makeResult(r, serverNowMs, verified, fs.ts()) }); return true; });
  }
  function forfeit(fs, code, uid) {
    return fs.tx(code, (t) => { const r = t.get(); if (!canWrite(r, uid)) return false;
      t.update({ ["players." + uid + ".result"]: { forfeit: true, at: fs.ts() } }); return true; });
  }
  const api = { MAX_MS, DRAW_MS, staked, outBy, claimGone, stale, heartbeat: PR && PR.heartbeat, holdMs, makeResult, validResult, decide, resultText, canWrite, submitDrop, forfeit, dropped, out, ended };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaPlankBattle = api;
})(typeof window !== "undefined" ? window : null);
