/* Zabba Tokens: earn-only balance + transaction log (no wagering, no spend yet).
 * Data model (Firestore):
 *   users/{uid}                 { uid, zabaTokens:int, lastTxId, createdAt, updatedAt }
 *   users/{uid}/tokenTx/{txId}  { uid, type:'earn', source, amount, units, qty, setId, createdAt }
 * Each award runs in ONE Firestore transaction: tx doc create + balance += amount, lastTxId = txId.
 * txId = "<source>-<setId>" is deterministic per set/session, so a retry finds the existing tx and
 * credits nothing (idempotent). Rules also forbid re-creating or editing a tx.
 * Rates (floor per completed set/session, remainders are NOT carried — each set stands alone,
 * which keeps every log entry independently checkable against its own units):
 *   pushups: 10 reps = 1 · plank: 60 s = 1 · walk: 10 min = 1 · tut: 60 s = 1
 *   washers: 1 Zabba Washers game won (reached 21, signed in, verified) = 1 (setId = game id)
 * Browser: window.ZabaTokens. Node: require("./zaba-tokens.js").
 */
(function (root) {
  "use strict";
  var RATES = {
    pushups: { units: "reps", per: 10, max: 5000 },
    plank: { units: "seconds", per: 60, max: 7200 },
    walk: { units: "minutes", per: 10, max: 240 },
    tut: { units: "seconds", per: 60, max: 7200 },
    washers: { units: "wins", per: 1, max: 1 }
  };
  var PENDING_KEY = "zdTokenPending";
  // qty from raw measurements: reps as-is; ms -> whole seconds / minutes.
  function qtyFrom(source, raw) {
    var n = Number(raw) || 0;
    if (source === "pushups") return Math.max(0, Math.floor(n));
    if (source === "walk") return Math.max(0, Math.floor(n / 60000));
    if (source === "plank" || source === "tut") return Math.max(0, Math.floor(n / 1000));
    if (source === "washers") return n > 0 ? 1 : 0;
    return 0;
  }
  function tokensFor(source, qty) {
    var r = RATES[source]; if (!r) return 0;
    var q = Math.min(Math.max(0, Math.floor(Number(qty) || 0)), r.max);
    return Math.floor(q / r.per);
  }
  function cleanId(s) { return String(s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60); }
  function txId(source, setId) { return source + "-" + cleanId(setId); }
  function newSetId(now) { return (now || Date.now()).toString(36) + Math.random().toString(36).slice(2, 8); }
  // Build the log entry; null when nothing is earned or input is invalid.
  function buildEarn(uid, source, qty, setId) {
    var r = RATES[source]; if (!r || !uid || !cleanId(setId)) return null;
    var q = Math.min(Math.max(0, Math.floor(Number(qty) || 0)), r.max), amount = tokensFor(source, q);
    if (amount < 1) return null;
    return { id: txId(source, setId), tx: { uid: uid, type: "earn", source: source, amount: amount, units: r.units, qty: q, setId: cleanId(setId) } };
  }
  // Zabba Washers: 1 token for a won game, once per gameId; null on loss / no user / no id.
  function washersWinEarn(uid, won, gameId) { return won ? buildEarn(uid, "washers", 1, gameId) : null; }
  function validEarn(t) {
    var r = t && RATES[t.source];
    return !!(r && t.type === "earn" && t.units === r.units && Number.isInteger(t.qty) && t.qty >= 0 && t.qty <= r.max
      && Number.isInteger(t.amount) && t.amount >= 1 && t.amount * r.per <= t.qty);
  }
  function profileFrom(d, uid) { return { uid: uid, zabaTokens: d && Number.isInteger(d.zabaTokens) && d.zabaTokens >= 0 ? d.zabaTokens : 0, exists: !!d }; }
  /* fs adapter: { tx(fn) -> Promise; fn(t) with t.get(path) -> data|null, t.set(path, data), t.update(path, patch); ts() }
   * paths are arrays like ["users", uid] / ["users", uid, "tokenTx", id]. */
  function ensureProfile(fs, uid) {
    return fs.tx(function (t) {
      return t.get(["users", uid]).then(function (d) {
        if (d) return profileFrom(d, uid);
        t.set(["users", uid], { uid: uid, zabaTokens: 0, lastTxId: "", createdAt: fs.ts(), updatedAt: fs.ts() });
        return { uid: uid, zabaTokens: 0, exists: true, created: true };
      });
    });
  }
  function award(fs, earn) {
    if (!earn || !validEarn(earn.tx)) return Promise.resolve({ credited: 0, skipped: "invalid" });
    var uid = earn.tx.uid, uRef = ["users", uid], tRef = ["users", uid, "tokenTx", earn.id];
    return fs.tx(function (t) {
      return Promise.all([t.get(uRef), t.get(tRef)]).then(function (got) {
        if (got[1]) return { credited: 0, skipped: "duplicate", balance: profileFrom(got[0], uid).zabaTokens };
        var bal = profileFrom(got[0], uid).zabaTokens + earn.tx.amount;
        var rec = Object.assign({}, earn.tx, { createdAt: fs.ts() });
        if (got[0]) t.update(uRef, { zabaTokens: bal, lastTxId: earn.id, updatedAt: fs.ts() });
        else t.set(uRef, { uid: uid, zabaTokens: bal, lastTxId: earn.id, createdAt: fs.ts(), updatedAt: fs.ts() });
        t.set(tRef, rec);
        return { credited: earn.tx.amount, balance: bal };
      });
    });
  }
  // Offline/failed awards wait in localStorage under their fixed id and are retried (idempotent).
  function queue(store, earn) { var q = readQ(store); if (!q.some(function (e) { return e.id === earn.id; })) q.push(earn); store.setItem(PENDING_KEY, JSON.stringify(q.slice(-50))); }
  function readQ(store) { try { var q = JSON.parse(store.getItem(PENDING_KEY) || "[]"); return Array.isArray(q) ? q : []; } catch (e) { return []; } }
  function drop(store, id) { store.setItem(PENDING_KEY, JSON.stringify(readQ(store).filter(function (e) { return e.id !== id; }))); }
  function earnAndQueue(fs, store, earn) {
    if (!earn) return Promise.resolve({ credited: 0 });
    queue(store, earn);
    return award(fs, earn).then(function (r) { drop(store, earn.id); return r; });
  }
  function flush(fs, store, uid) {
    var q = readQ(store).filter(function (e) { return e.tx && e.tx.uid === uid; });
    return q.reduce(function (p, e) { return p.then(function () { return award(fs, e).then(function () { drop(store, e.id); }, function () {}); }); }, Promise.resolve());
  }
  var LABEL = { pushups: "Push-ups", plank: "Plank", walk: "Walking", tut: "TUT", washers: "Won Zabba Washers" };
  function mins(m) { m = Math.floor(m); return m + " minute" + (m === 1 ? "" : "s"); }
  var UNIT = { pushups: function (n) { return n + " push-up" + (n === 1 ? "" : "s"); }, plank: function (n) { return mins(n / 60); },
    tut: function (n) { return mins(n / 60); }, walk: function (n) { return mins(n); },
    washers: function (n) { return n + " game" + (n === 1 ? "" : "s") + " won"; } };
  var OF = { pushups: "", plank: " of plank", tut: " of TUT", walk: " of walking" };
  // Display lines built from RATES so the page always matches the earn math.
  function rateLines() { return ["pushups", "plank", "tut", "walk"].map(function (k) { return UNIT[k](RATES[k].per) + OF[k] + " = 1 token"; }).concat(["Won Zabba Washers game = 1 token"]); }
  function txLine(t) {
    t = t || {};
    var src = LABEL[t.source] || String(t.source || "?"), q = Number(t.qty) || 0;
    var c = t.createdAt, d = c && typeof c.toDate === "function" ? c.toDate() : (c instanceof Date ? c : null);
    return { source: src, amount: "+" + (Number(t.amount) || 0), qty: UNIT[t.source] ? UNIT[t.source](q) : q + " " + (t.units || ""), when: d ? d.toLocaleString() : "just now" };
  }
  function txRowsHtml(list, esc) {
    if (!list || !list.length) return '<tr><td colspan="4">No tokens earned yet. Finish a set, plank or walk to earn your first.</td></tr>';
    return list.map(function (t) { var l = txLine(t); return "<tr><td>" + esc(l.source) + "</td><td>" + esc(l.amount) + "</td><td>" + esc(l.qty) + "</td><td>" + esc(l.when) + "</td></tr>"; }).join("");
  }
  // Header badge when signed in: "<name> · Zabba Bag: 12". Name = the leaderboard name (publicName; never an email:
  // email-looking input shows as "Player"), cut to maxName chars with an ellipsis; CSS also ellipsizes on mobile.
  function badgeParts(name, balance, maxName) {
    maxName = maxName || 16;
    var n = String(name || "").trim();
    if (!n || /\S+@\S+\.\S+/.test(n)) n = "Player";
    if (n.length > maxName) n = n.slice(0, maxName - 1).trim() + "\u2026";
    var b = Math.max(0, Math.floor(Number(balance) || 0));
    return { name: n, tokens: "Zabba Bag: " + b.toLocaleString("en-US") };
  }
  function badgeText(name, balance, maxName) { var p = badgeParts(name, balance, maxName); return p.name + " \u00b7 " + p.tokens; }
  // Public "Top Zabba Bag" mirror: tokenBoard/{uid} = { uid, name, total, updatedAt } (name = leaderboard publicName,
  // never an email; total = the owner's users/{uid}.zabaTokens, enforced by rules). Written best-effort, outside the
  // award transaction, so earning never depends on it.
  function boardEntry(uid, name, total) {
    var n = badgeParts(name, total, 40).name;
    return { uid: String(uid), name: n, total: Math.max(0, Math.floor(Number(total) || 0)) };
  }
  // "Top Zabba Bag: Zab · 12 Zabba Tokens" or null (hide) when there is no usable entry.
  function topLine(entry) {
    if (!entry || !(Number(entry.total) > 0)) return null;
    var p = badgeParts(entry.name, entry.total, 24), t = Math.floor(Number(entry.total));
    return "Top Zabba Bag: " + p.name + " \u00b7 " + t.toLocaleString("en-US") + (t === 1 ? " Zabba Token" : " Zabba Tokens");
  }
  var api = { boardEntry: boardEntry, topLine: topLine, badgeParts: badgeParts, badgeText: badgeText, rateLines: rateLines, txLine: txLine, txRowsHtml: txRowsHtml, RATES: RATES, qtyFrom: qtyFrom, tokensFor: tokensFor, txId: txId, newSetId: newSetId, buildEarn: buildEarn, washersWinEarn: washersWinEarn, validEarn: validEarn,
    profileFrom: profileFrom, ensureProfile: ensureProfile, award: award, earnAndQueue: earnAndQueue, flush: flush, readQ: readQ, PENDING_KEY: PENDING_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ZabaTokens = api;
})(typeof window !== "undefined" ? window : this);
