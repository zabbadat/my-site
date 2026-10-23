/* Zabba Washer Battle: one-on-one washers. Rooms/ready/5 s countdown come from battle-rooms.js
 * (same controller, collection washersBattles/{code}). Each phone plays the solo washers game as-is
 * (start lock, 1 s hold to score, 15 s relock, step counting, gyro throw filter) and only publishes
 * its own seat: live score/steps, then a write-once result.
 * Seat: players[uid] = { name, ready, joinedAt, seenAt?, leftAt?, score?, steps?, result? }
 * result = { score: 21, steps, ms, verified, reasons, at } | { forfeit: true, at }
 * Winner (client-side, from the room doc only, same on both phones):
 *   both reached 21 -> fewest steps, then quickest time; one forfeits (or leaves) -> the other wins at once.
 * Browser: window.ZabbaWasherBattle. Node: require("./washers-battle.js").
 */
(function (root) {
  const TARGET = 21, MAX_STEPS = 100000, MAX_MS = 14400000, MAX_REASONS = 8, PUBLISH_MS = 1000;
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const validScore = (s) => isInt(s) && s >= 0 && s <= TARGET;
  const validSteps = (s) => isInt(s) && s >= 0 && s <= MAX_STEPS;
  const validMs = (m) => isInt(m) && m > 0 && m <= MAX_MS;
  // Build the result object the rules accept (at = serverTimestamp sentinel). Returns null if invalid.
  function makeResult(g, ts) {
    if (!g || !validSteps(g.steps) || !validMs(Math.round(g.ms))) return null;
    const reasons = (Array.isArray(g.reasons) ? g.reasons : []).map((r) => String(r).slice(0, 120)).slice(0, MAX_REASONS);
    return { score: TARGET, steps: g.steps, ms: Math.round(g.ms), verified: !!g.verified, reasons, at: ts };
  }
  function validResult(x) {
    if (!x || typeof x !== "object") return false;
    const k = Object.keys(x).sort().join(",");
    if (k === "at,forfeit") return x.forfeit === true;
    return k === "at,ms,reasons,score,steps,verified" && x.score === TARGET && validSteps(x.steps) && validMs(x.ms)
      && typeof x.verified === "boolean" && Array.isArray(x.reasons) && x.reasons.length <= MAX_REASONS;
  }
  const ids = (r) => Object.keys((r && r.players) || {});
  const other = (r, uid) => ids(r).find((u) => u !== uid) || null;
  const finished = (p) => !!(p && p.result && !p.result.forfeit);
  const forfeited = (p) => !!(p && ((p.result && p.result.forfeit) || (p.leftAt && !p.result)));
  // -> { done, winner, reason } ; done=false while someone is still playing.
  function decide(r) {
    const u = ids(r); if (!r || u.length !== 2 || !(r.status === "live" || r.status === "done")) return { done: false };
    const [a, b] = u.map((x) => ({ uid: x, p: r.players[x] }));
    const fa = finished(a.p), fb = finished(b.p), xa = forfeited(a.p), xb = forfeited(b.p);
    if (fa && fb) {
      if (a.p.result.steps !== b.p.result.steps) { const w = a.p.result.steps < b.p.result.steps ? a : b; return { done: true, winner: w.uid, reason: "steps" }; }
      if (a.p.result.ms !== b.p.result.ms) { const w = a.p.result.ms < b.p.result.ms ? a : b; return { done: true, winner: w.uid, reason: "time" }; }
      return { done: true, winner: null, reason: "tie" };
    }
    if (xa && xb) return { done: true, winner: null, reason: "both-forfeit" };
    if (xb) return { done: true, winner: a.uid, reason: "forfeit" };
    if (xa) return { done: true, winner: b.uid, reason: "forfeit" };
    return { done: false };
  }
  function resultText(r, uid) {
    const d = decide(r); if (!d.done) return "";
    if (d.winner == null) return d.reason === "tie" ? "Tie: same steps and time." : "No winner: both players left.";
    const won = d.winner === uid;
    if (d.reason === "forfeit") return won ? "You win: your opponent forfeited." : "You forfeited.";
    if (d.reason === "steps") return won ? "You win: fewer steps to 21." : "You lose: more steps to 21.";
    return won ? "You win: same steps, quicker time." : "You lose: same steps, slower time.";
  }
  // Live publish (own seat only, while live, before a result).
  function publishPatch(uid, g) {
    const s = Math.max(0, Math.min(TARGET, g.score | 0)), st = Math.max(0, Math.min(MAX_STEPS, g.steps | 0));
    return { ["players." + uid + ".score"]: s, ["players." + uid + ".steps"]: st };
  }
  function canWrite(r, uid) { return !!r && r.status === "live" && !!r.players && uid in r.players && !r.players[uid].result; }
  function publishLive(fs, code, uid, g) { return fs.update(code, publishPatch(uid, g)); }
  // Write-once: own result + final score/steps in one update. Returns true if written.
  function submitResult(fs, code, uid, g) {
    return fs.tx(code, (t) => { const r = t.get(); if (!canWrite(r, uid)) return false;
      const res = makeResult(g, fs.ts()); if (!res) return false;
      t.update({ ["players." + uid + ".score"]: TARGET, ["players." + uid + ".steps"]: res.steps, ["players." + uid + ".result"]: res }); return true; });
  }
  function forfeit(fs, code, uid) {
    return fs.tx(code, (t) => { const r = t.get(); if (!canWrite(r, uid)) return false;
      t.update({ ["players." + uid + ".result"]: { forfeit: true, at: fs.ts() } }); return true; });
  }
  function throttle(ms, now) { let last = -Infinity; return () => { const t = now(); if (t - last >= ms) { last = t; return true; } return false; }; }
  // Live board (no extra Firestore fields): elapsed = serverNow - startAt (shared GO time), frozen at result.ms once finished.
  const fmtClock = (ms) => { const t = Math.max(0, Math.floor((ms || 0) / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = String(t % 60).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + x : String(m).padStart(2, "0") + ":" + x; };
  function elapsedMs(r, p, serverNowMs) {
    if (finished(p)) return p.result.ms;
    if (!r || r.startAt == null || serverNowMs == null) return 0;
    return Math.max(0, Math.min(MAX_MS, serverNowMs - r.startAt));
  }
  // players: ordered [{uid, ...seat}]; mine: optional {score, steps} local values for my own unfinished seat.
  function boardRows(r, players, uid, serverNowMs, mine) {
    return (players || []).map((p) => {
      const fin = finished(p), out = forfeited(p), self = p.uid === uid;
      const score = fin ? TARGET : self && mine && !out ? Math.min(TARGET, mine.score | 0) : Math.min(TARGET, p.score | 0);
      const steps = fin ? p.result.steps : self && mine && !out ? mine.steps | 0 : p.steps | 0;
      const state = fin ? "finished" : p.result && p.result.forfeit ? "forfeit" : p.leftAt ? "left" : "playing";
      const ms = out ? null : elapsedMs(r, p, serverNowMs);
      return { uid: p.uid, name: (p.name || "Player") + (self ? " (you)" : ""), score, scoreText: score + "/21", steps, stepsText: steps.toLocaleString("en-US"),
        ms, timeText: state === "forfeit" ? "Forfeit" : state === "left" ? "Left" : fmtClock(ms) + (fin ? " ✓" : ""), state, ticking: state === "playing" };
    });
  }
  const api = { fmtClock, elapsedMs, boardRows, TARGET, PUBLISH_MS, validScore, validSteps, validMs, makeResult, validResult, decide, resultText, publishPatch, canWrite, publishLive, submitResult, forfeit, throttle, other, finished, forfeited };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaWasherBattle = api;
})(typeof window !== "undefined" ? window : null);
