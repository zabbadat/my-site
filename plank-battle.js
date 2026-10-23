/* Plank Battles result step: last one holding wins. Rooms/ready/countdown come from battle-rooms.js (battles/{code}).
 * Each phone writes only its own seat: a write-once result when its player drops (or forfeits).
 *   result = { holdMs, verified, at } | { forfeit: true, at }   holdMs = serverNow - startAt (shared GO time)
 *   verified = this page stayed visible for the whole hold (no tab switch / screen off).
 * Winner (from the room doc only): first to drop / forfeit / leave loses at once; if both dropped, longer hold wins
 * (exact same ms = tie). Browser: window.ZabbaPlankBattle. Node: require("./plank-battle.js").
 */
(function (root) {
  const MAX_MS = 7200000; // 2 h cap, same as the plank board
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
  function decide(r) {
    const u = ids(r); if (!r || u.length !== 2 || !(r.status === "live" || r.status === "done")) return { done: false };
    const [a, b] = u.map((x) => ({ uid: x, p: r.players[x] }));
    if (out(a.p) && out(b.p)) return { done: true, winner: null, reason: "both-out" };
    if (out(a.p)) return { done: true, winner: b.uid, reason: "forfeit" };
    if (out(b.p)) return { done: true, winner: a.uid, reason: "forfeit" };
    const da = dropped(a.p), db = dropped(b.p);
    if (da && db) {
      if (a.p.result.holdMs === b.p.result.holdMs) return { done: true, winner: null, reason: "tie" };
      return { done: true, winner: a.p.result.holdMs > b.p.result.holdMs ? a.uid : b.uid, reason: "longer" };
    }
    if (da) return { done: true, winner: b.uid, reason: "last-holding" };
    if (db) return { done: true, winner: a.uid, reason: "last-holding" };
    return { done: false };
  }
  function resultText(r, uid) {
    const d = decide(r); if (!d.done) return "";
    if (d.winner == null) return d.reason === "tie" ? "Tie: same hold time." : "No winner: both players left.";
    const won = d.winner === uid;
    if (d.reason === "forfeit") return won ? "You win: your opponent forfeited." : "You forfeited.";
    return won ? "You win: you held the plank longest." : "You lose: you dropped first.";
  }
  const canWrite = (r, uid) => !!r && r.status === "live" && !!r.players && uid in r.players && !r.players[uid].result;
  // "I dropped" (or winner stops after the decision): write-once own hold.
  function submitDrop(fs, code, uid, serverNowMs, verified) {
    return fs.tx(code, (t) => { const r = t.get(); if (!canWrite(r, uid)) return false;
      t.update({ ["players." + uid + ".result"]: makeResult(r, serverNowMs, verified, fs.ts()) }); return true; });
  }
  function forfeit(fs, code, uid) {
    return fs.tx(code, (t) => { const r = t.get(); if (!canWrite(r, uid)) return false;
      t.update({ ["players." + uid + ".result"]: { forfeit: true, at: fs.ts() } }); return true; });
  }
  const api = { MAX_MS, holdMs, makeResult, validResult, decide, resultText, canWrite, submitDrop, forfeit, dropped, out, ended };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaPlankBattle = api;
})(typeof window !== "undefined" ? window : null);
