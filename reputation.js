/* Zabba reputation: an honesty score for the honor system (match scores can't be verified).
 * 0..100, new users start at 50. Public mirror repBoard/{uid} = { uid, name, rep, clean, disputesLost, forfeits, updatedAt }
 * (name + reputation only, never an email). Written ONLY by the server (netlify/functions/rep-settle.js, admin SDK);
 * clients can read, never write (rules draft). Ledger repLog/{key} makes each match count exactly once.
 * Per finished Zabba Washer Battle (washers-battle.js decides, same on every phone):
 *   +2  clean confirmed match (finished by score or tie, no penalty for you)       -> CLEAN
 *   -10 a dispute resolved against you (Bariboshi winner's ruling, Art. 11)        -> DISPUTE_LOST
 *   -5  forfeit / left mid-match / silent 30 s                                      -> FORFEIT
 *   0   cancelled, never started, still undecided, or you won because they forfeited.
 * Tiers: under 40 Shaky, 40-69 Steady, 70+ Trusted. Browser: window.ZabbaReputation. Node: require("./reputation.js").
 */
(function (root) {
  const req = (n, g) => (typeof module !== "undefined" && module.exports ? require(n) : root && root[g]);
  const WB = req("./washers-battle.js", "ZabbaWasherBattle");
  const START = 50, MIN = 0, MAX = 100, CLEAN = 2, DISPUTE_LOST = -10, FORFEIT = -5, SHAKY_BELOW = 40, TRUSTED_FROM = 70;
  const isInt = (v) => typeof v === "number" && Number.isInteger(v);
  const clamp = (n) => Math.max(MIN, Math.min(MAX, Math.round(n)));
  const normalize = (v) => (isInt(v) && v >= MIN && v <= MAX ? v : START); // missing / junk = a new user
  function tier(rep) { const r = normalize(rep); return r < SHAKY_BELOW ? { key: "shaky", label: "Shaky" } : r >= TRUSTED_FROM ? { key: "trusted", label: "Trusted" } : { key: "steady", label: "Steady" }; }
  const labelText = (rep) => tier(rep).label + " " + normalize(rep);
  const apply = (rep, delta) => clamp(normalize(rep) + delta);
  // Room doc -> null (nothing to score yet / cancelled) or { [uid]: { delta, events: [..] } }.
  function matchDeltas(room) {
    if (!room || !room.players || !WB) return null;
    const dec = WB.decide(room); if (!dec.done) return null;
    const an = WB.analyze(room), out = {};
    Object.keys(room.players).forEach((u) => { out[u] = { delta: 0, events: [] }; });
    const add = (u, ev, d) => { if (out[u]) { out[u].events.push(ev); out[u].delta += d; } };
    an.rulings.forEach((x) => add(x.against, "dispute-lost", DISPUTE_LOST));
    if (dec.reason === "forfeit" || dec.reason === "both-forfeit") Object.keys(room.players).forEach((u) => { if (WB.forfeitedBy(room, u)) add(u, "forfeit", FORFEIT); });
    else Object.keys(room.players).forEach((u) => { if (!out[u].events.length) add(u, "clean", CLEAN); }); // finished by score or tie
    return out;
  }
  // ---- server settle: adapter like zaba-wager.js (fs.tx(fn(t)) with t.get(pathArray) -> Promise, t.set, t.update; ts(); toMs) ----
  const err = (status, message) => Object.assign(new Error(message), { status });
  const KEY = (code, createdMs) => "washers_" + code + "_" + createdMs;
  function settle(fs, uid, code) {
    code = String(code || "").toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) return Promise.reject(err(400, "Bad room code."));
    return fs.tx((t) => t.get(["washersBattles", code]).then((room) => {
      if (!room) throw err(404, "No room with that code.");
      if (!room.players || !(uid in room.players)) throw err(403, "Not your match.");
      const key = KEY(code, fs.toMs(room.createdAt)), deltas = matchDeltas(room);
      if (!deltas) return { pending: true };
      const us = Object.keys(room.players);
      return Promise.all([t.get(["repLog", key])].concat(us.map((u) => t.get(["repBoard", u])))).then(([log, ...boards]) => {
        if (log) return { already: true, key, deltas: log.deltas };
        const applied = {};
        us.forEach((u, i) => {
          const b = boards[i], before = normalize(b && b.rep), after = apply(before, deltas[u].delta), ev = deltas[u].events;
          applied[u] = { before, after, delta: after - before, events: ev };
          const doc = { uid: u, name: WB.pubName(room.players[u].name), rep: after, updatedAt: fs.ts(),
            clean: ((b && b.clean) | 0) + (ev.includes("clean") ? 1 : 0), disputesLost: ((b && b.disputesLost) | 0) + (ev.includes("dispute-lost") ? 1 : 0), forfeits: ((b && b.forfeits) | 0) + (ev.includes("forfeit") ? 1 : 0) };
          if (b) t.update(["repBoard", u], doc); else t.set(["repBoard", u], doc);
        });
        t.set(["repLog", key], { key, code, game: "washers", deltas: applied, at: fs.ts() });
        return { ok: true, key, deltas: applied };
      });
    }));
  }
  const api = { START, MIN, MAX, CLEAN, DISPUTE_LOST, FORFEIT, SHAKY_BELOW, TRUSTED_FROM, clamp, normalize, tier, labelText, apply, matchDeltas, settle, KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaReputation = api;
})(typeof window !== "undefined" ? window : null);
