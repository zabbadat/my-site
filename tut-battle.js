/* TUT Battles: battle-only judge + result helpers. Rooms/ready/countdown come from battle-rooms.js
 * (same controller, different collection: tutBattles/{code}). Solo push counter and posture guard are
 * reused as separate instances, never modified.
 * Browser: window.ZabbaTutBattle. Node: require("./tut-battle.js").
 */
(function (root) {
  const RULES = { postureHoldMs: 750, outOfFrameMs: 2000, noRepMs: 8000, publishMs: 1000, minScore: 0.3 };
  const REASONS = { standing: "Stood up", knees: "Knee down", frame: "Out of frame", stopped: "Stopped (no rep for 8s)", left: "Left the battle" };
  function hasUpperBody(kps, min) {
    let n = 0; for (const k of kps || []) if (k && /shoulder$/.test(k.name) && (k.score == null || k.score >= min)) n++;
    return n >= 1;
  }
  // guard = createPostureGuard({holdMs: 750}) instance from push-session.js (separate from solo game's).
  function createJudge(guard, opts) {
    const o = Object.assign({}, RULES, opts || {});
    let st;
    function reset(t0) { st = { t0, lastSeen: t0, lastRep: t0, lost: null }; if (guard) guard.reset(); }
    reset(0);
    // kps: pose keypoints; t: ms; topWidth: counter's calibrated top width (px) or 0; counted: a rep was just counted.
    function update(kps, t, topWidth, counted) {
      if (st.lost) return st.lost;
      if (counted) st.lastRep = t;
      if (hasUpperBody(kps, o.minScore)) st.lastSeen = t;
      if (t - st.lastSeen >= o.outOfFrameMs) return (st.lost = "frame");
      if (guard) { const g = guard.update(kps, t, topWidth); if (g.event === "standing" || g.event === "knees") return (st.lost = g.event); }
      if (t - st.lastRep >= o.noRepMs) return (st.lost = "stopped");
      return null;
    }
    return { update, reset, state: () => st };
  }
  function throttle(ms, now) { let last = -Infinity; return () => { const t = now(); if (t - last >= ms) { last = t; return true; } return false; }; }
  const other = (r, uid) => Object.keys((r && r.players) || {}).find((u) => u !== uid) || null;
  // First to break writes itself as loser; idempotent (only while live and no result yet).
  function reportLoss(fs, code, uid, reason, mine) {
    return fs.tx(code, (t) => { const r = t.get();
      if (!r || r.status !== "live" || r.loserUid || !(uid in r.players)) return false;
      const p = "players." + uid;
      t.update({ status: "done", loserUid: uid, winnerUid: other(r, uid), loseReason: reason, endedAt: fs.ts(),
        [p + ".reps"]: mine.reps | 0, [p + ".tutMs"]: Math.round(mine.tutMs) || 0 });
      return true; });
  }
  function publishLive(fs, code, uid, mine) { return fs.update(code, { ["players." + uid + ".reps"]: mine.reps | 0, ["players." + uid + ".tutMs"]: Math.round(mine.tutMs) || 0 }); }
  // Stats doc per player; each client updates only its own, once per battle (lastBattle guard).
  function nextStats(prev, room, uid) {
    const s = Object.assign({ wins: 0, losses: 0, bestTutMs: 0, bestReps: 0, battles: 0, lastBattle: null }, prev || {});
    if (!room || room.status !== "done" || s.lastBattle === room.code || !(uid in room.players)) return null;
    const me = room.players[uid] || {}, won = room.winnerUid === uid;
    return { name: me.name || s.name || "Player", wins: s.wins + (won ? 1 : 0), losses: s.losses + (won ? 0 : 1), battles: s.battles + 1,
      bestTutMs: Math.max(s.bestTutMs, me.tutMs | 0), bestReps: Math.max(s.bestReps, me.reps | 0), lastBattle: room.code };
  }
  function recordResult(statsFs, room, uid) {
    return statsFs.tx(uid, (t) => { const n = nextStats(t.get(), room, uid); if (!n) return false; t.set(Object.assign({ uid }, n, { updatedAt: statsFs.ts() })); return true; });
  }
  function rankStats(list) { return list.slice().sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.bestTutMs - a.bestTutMs); }
  const api = { RULES, REASONS, hasUpperBody, createJudge, throttle, reportLoss, publishLive, nextStats, recordResult, rankStats, other };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaTutBattle = api;
})(typeof window !== "undefined" ? window : null);
