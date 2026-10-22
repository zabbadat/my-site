/* TUT Battles: battle-only judge + result helpers. Rooms/ready/countdown come from battle-rooms.js
 * (same controller, different collection: tutBattles/{code}). Solo push counter and posture guard are
 * reused as separate instances, never modified.
 * Browser: window.ZabbaTutBattle. Node: require("./tut-battle.js").
 */
(function (root) {
  // 3:00 head-to-head: clock = room startAt (end of the shared countdown) + durationMs, same on both phones.
  // Top rests are allowed (no "stop repping" loss); each continuous top hold credits at most topCapMs of TUT.
  // settleMs: wait after 3:00 so both phones' final reps/TUT reach the room before the time-up result is decided.
  const RULES = { postureHoldMs: 750, outOfFrameMs: 2000, publishMs: 1000, minScore: 0.3, durationMs: 180000, topCapMs: 10000, settleMs: 3000 };
  // Published rules only allow loseReason in [standing, knees, frame, stopped, left] and only a self-reported loss.
  // Time-up therefore reuses the allowed value "stopped" = "lost on time (less TUT, then fewer reps)".
  const TIME_UP = "stopped";
  const REASONS = { standing: "Stood up / left plank flagged", knees: "Knees down flagged", frame: "Out of frame", stopped: "Time: less time under tension", left: "Left the battle" };
  const WIN_REASON = "Time: more time under tension";
  function hasUpperBody(kps, min) {
    let n = 0; for (const k of kps || []) if (k && /shoulder$/.test(k.name) && (k.score == null || k.score >= min)) n++;
    return n >= 1;
  }
  // guard = createPostureGuard({holdMs: 750}) instance from push-session.js (separate from solo game's).
  function createJudge(guard, opts) {
    const o = Object.assign({}, RULES, opts || {});
    let st;
    function reset(t0) { st = { t0, lastSeen: t0, lost: null }; if (guard) guard.reset(); }
    reset(0);
    // kps: pose keypoints; t: ms; topWidth: counter's calibrated top width (px) or 0. No time-without-reps rule.
    function update(kps, t, topWidth) {
      if (st.lost) return st.lost;
      if (hasUpperBody(kps, o.minScore)) st.lastSeen = t;
      if (t - st.lastSeen >= o.outOfFrameMs) return (st.lost = "frame");
      if (guard) { const g = guard.update(kps, t, topWidth); if (g.event === "standing" || g.event === "knees") return (st.lost = g.event); }
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
  // Time left on the shared 3:00 clock (server ms). endAt = startAt + durationMs.
  function endAt(room, o) { return room && room.startAt != null ? room.startAt + ((o && o.durationMs) || RULES.durationMs) : null; }
  function timeLeft(room, serverNowMs, o) { const e = endAt(room, o); return e == null ? null : Math.max(0, e - serverNowMs); }
  // Time-up decision from the room doc only (both phones see the same values): more TUT wins, then more reps; else draw.
  function timeUpLoser(room) {
    const ids = Object.keys((room && room.players) || {}); if (ids.length !== 2) return null;
    const [a, b] = ids.map((u) => ({ u, tut: Math.round(room.players[u].tutMs) || 0, reps: room.players[u].reps | 0 }));
    if (a.tut !== b.tut) return a.tut < b.tut ? a.u : b.u;
    if (a.reps !== b.reps) return a.reps < b.reps ? a.u : b.u;
    return null; // draw
  }
  // Called by each phone after endAt + settleMs. Only the loser writes (self-reported loss, allowed by the
  // published rules) with loseReason "stopped"; the winner's phone no-ops. Idempotent: no-op once done.
  // Returns "lost" | "won" | "draw" | "done" | false.
  function settleTimeUp(fs, code, uid) {
    return fs.tx(code, (t) => { const r = t.get();
      if (!r || !(uid in (r.players || {}))) return false;
      if (r.status === "done") return "done";
      if (r.status !== "live" || r.loserUid) return false;
      const loser = timeUpLoser(r);
      if (loser == null) return "draw";
      if (loser !== uid) return "won";
      t.update({ status: "done", loserUid: uid, winnerUid: other(r, uid), loseReason: TIME_UP, endedAt: fs.ts() });
      return "lost"; });
  }
  // Winner / loser line for the result: "Time: more time under tension" for a time-up win, else the loss reason.
  function resultText(room, uid) {
    if (!room || room.status !== "done") return "";
    if (room.loseReason === TIME_UP) return room.winnerUid === uid ? WIN_REASON : REASONS.stopped;
    return REASONS[room.loseReason] || "Out";
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
  const api = { RULES, REASONS, TIME_UP, WIN_REASON, endAt, timeLeft, timeUpLoser, settleTimeUp, resultText, hasUpperBody, createJudge, throttle, reportLoss, publishLive, nextStats, recordResult, rankStats, other };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaTutBattle = api;
})(typeof window !== "undefined" ? window : null);
