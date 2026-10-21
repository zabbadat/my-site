/* Zabba Washers Battles: two-phone 1v1. Rooms/ready/countdown come from battle-rooms.js (same controller,
 * collection washersBattles/{code}). Each phone plays the normal solo washers game (lock, steps, verifier);
 * this module only adds the battle bits. No tokens, no wagers.
 * Seat (players[uid], uid = Firebase auth uid): { name, ready, joinedAt, seenAt?, leftAt?, opener?, score?, steps?,
 *   result?: { score:21, steps, ms, verified, reasons, at } | { forfeit:true, at } }  (result is write-once)
 * Winner (decide): both must post. A forfeit loses to a finish. Between two finishes: verified beats unverified,
 * then fewest steps, then faster time; identical -> draw.
 * Browser: window.ZabbaWashersBattle. Node: require("./washers-battle.js").
 */
(function (root) {
  const TARGET = 21, MAX_STEPS = 100000, MAX_MS = 4 * 3600 * 1000, MAX_REASONS = 8;
  const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
  const SITE = "https://www.zabbadat.com/";
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  function validateResult(x) {
    if (!x || typeof x !== "object") return "No result.";
    if (x.score !== TARGET) return "Score must be exactly 21.";
    if (!isInt(x.steps) || x.steps < 0 || x.steps > MAX_STEPS) return "Bad step count.";
    if (!isInt(x.ms) || x.ms <= 0 || x.ms > MAX_MS) return "Bad game time.";
    if (typeof x.verified !== "boolean") return "Missing verified flag.";
    if (!Array.isArray(x.reasons) || x.reasons.length > MAX_REASONS || !x.reasons.every((s) => typeof s === "string" && s.length <= 120)) return "Bad reasons.";
    return "";
  }
  const cleanResult = (x) => ({ score: TARGET, steps: x.steps, ms: x.ms, verified: x.verified, reasons: x.reasons.slice() });
  const seats = (r) => Object.keys((r && r.players) || {});
  // Compare two finished results: <0 if a wins.
  const cmp = (a, b) => (a.verified === b.verified ? 0 : a.verified ? -1 : 1) || a.steps - b.steps || a.ms - b.ms;
  function decide(r) {
    const ids = seats(r);
    if (ids.length < 2) return { phase: "waiting" };
    const [a, b] = ids, ra = r.players[a].result, rb = r.players[b].result;
    if (!ra || !rb) {
      const done = ra ? a : rb ? b : null;
      return { phase: done ? "waiting-opponent" : "playing", done };
    }
    const fa = !!ra.forfeit, fb = !!rb.forfeit;
    if (fa && fb) return { phase: "done", winnerUid: null, why: "both-forfeit" };
    if (fa || fb) return { phase: "done", winnerUid: fa ? b : a, loserUid: fa ? a : b, why: "forfeit" };
    const c = cmp(ra, rb);
    if (c === 0) return { phase: "done", winnerUid: null, why: "draw" };
    const w = c < 0 ? a : b, l = c < 0 ? b : a, W = r.players[w].result, L = r.players[l].result;
    const why = W.verified !== L.verified ? "verified" : W.steps !== L.steps ? "steps" : "time";
    return { phase: "done", winnerUid: w, loserUid: l, why };
  }
  const WHY = { forfeit: "Opponent stopped before 21", "both-forfeit": "Both stopped before 21", draw: "Dead even: same steps and time",
    verified: "Verified game beats unverified", steps: "Fewest steps", time: "Same steps, faster time" };
  const live = (r) => !!r && r.status === "live";
  // Write-once result post. Returns true if written, false if already posted / not allowed.
  function postResult(fs, code, uid, x) {
    const e = validateResult(x); if (e) return Promise.reject(new Error(e));
    return fs.tx(code, (t) => { const r = t.get(); const p = r && r.players && r.players[uid];
      if (!live(r) || !p || p.result) return false;
      t.update({ ["players." + uid + ".result"]: Object.assign(cleanResult(x), { at: fs.ts() }), ["players." + uid + ".score"]: TARGET, ["players." + uid + ".steps"]: x.steps });
      return true; });
  }
  function forfeit(fs, code, uid) {
    return fs.tx(code, (t) => { const r = t.get(); const p = r && r.players && r.players[uid];
      if (!live(r) || !p || p.result) return false;
      t.update({ ["players." + uid + ".result"]: { forfeit: true, at: fs.ts() } }); return true; });
  }
  // Live progress (score 0..20 while playing, steps).
  function progressPatch(uid, score, steps) {
    const s = Math.max(0, Math.min(TARGET, Math.floor(Number(score) || 0))), st = Math.max(0, Math.min(MAX_STEPS, Math.floor(Number(steps) || 0)));
    return { ["players." + uid + ".score"]: s, ["players." + uid + ".steps"]: st };
  }
  function publishProgress(fs, code, uid, score, steps) {
    return fs.tx(code, (t) => { const r = t.get(); const p = r && r.players && r.players[uid];
      if (!live(r) || !p || p.result) return false; t.update(progressPatch(uid, score, steps)); return true; });
  }
  // Bariboshi opener, honor system: each player records who pitched first (uid). Agreed when both match.
  function setOpener(fs, code, uid, openerUid) {
    return fs.tx(code, (t) => { const r = t.get(); if (!r || !r.players || !(uid in r.players) || !(openerUid in r.players) || r.status === "abandoned") return false;
      t.update({ ["players." + uid + ".opener"]: openerUid }); return true; });
  }
  function openerState(r) {
    const ids = seats(r); if (ids.length < 2) return { agreed: false };
    const o = ids.map((u) => r.players[u].opener).filter(Boolean);
    if (o.length < 2) return { agreed: false, picks: o.length };
    return o[0] === o[1] ? { agreed: true, opener: o[0] } : { agreed: false, conflict: true };
  }
  // Invite links: https://www.zabbadat.com/?wb=CODE#battle-gate
  const inviteUrl = (code) => SITE + "?wb=" + encodeURIComponent(code) + "#battle-gate";
  function parseInvite(search) {
    let v = null;
    try { v = new URLSearchParams(String(search || "").replace(/^[^?]*\?/, "").split("#")[0]).get("wb"); } catch (e) { return null; }
    const c = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return CODE_RE.test(c) ? c : null;
  }
  const NAME = "Zabba washer Battle Gate";
  const shareText = (code) => "Join my " + NAME + ": " + inviteUrl(code);
  const api = { NAME, shareText, TARGET, MAX_STEPS, MAX_MS, WHY, validateResult, decide, postResult, forfeit, progressPatch, publishProgress, setOpener, openerState, inviteUrl, parseInvite };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaWashersBattle = api;
})(typeof window !== "undefined" ? window : null);
