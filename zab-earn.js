/* Server-verified ZAB earning (netlify/functions/zab-earn.js, admin SDK). Clients can no longer credit themselves
 * (firestore.rules deny client zabLedger creates and balance raises). A player asks for ZAB for ONE recorded session
 * they own; the server reads that session doc, works out the amount from the stored numbers (zab-balance.js rates),
 * applies the caps below, and in ONE transaction: writes the ledger entry, raises users/{uid}.zabBalance, keeps the
 * zabBoard total equal, adds to today's per-source total and writes the claim marker zabClaims/{source}_{col}_{id}.
 * A second claim for the same session and source fails (409), so repeats cannot double-credit.
 *
 * Sources -> session docs (all must be owned by the caller):
 *   pushups  pushups/{id}      reps            10 reps = 1 ZAB
 *   tut      pushups/{id}      tutMs (One long set only, written by the page)  60 s = 1 ZAB
 *   hold     pushups/{id}      holds (30-second top holds in that set)          0.5 ZAB each
 *   plank    planks/{id}       holdSec         60 s = 1 ZAB
 *   walk     walkSessions/{id} ms              10 min = 1 ZAB
 *   washers  games/{id}        verified 21     1 ZAB per game won
 *   tutBattle tutBattles/{code}  players[uid].tutMs of a finished TUT Battle (credited as source "tut")
 * RESIDUAL RISK: those session docs are still written by the player's own browser. firestore.rules only bound them
 * (ranges, server time) and plausible() below adds sanity limits, so a determined player can still post invented
 * sessions within those limits. The caps (per claim, per source per UTC day) bound how much that is worth.
 * Node only. */
"use strict";
const ZC = require("./zab-currency.js");
const ZB = require("./zab-balance.js");

// ---- OWNER DECISION: caps (ZAB). Per claim and per source per UTC day. ----
const CLAIM_CAP = 500;
const DAY_CAP = { pushups: 50, tut: 30, hold: 10, plank: 30, walk: 24, washers: 20 };
const MAX_AGE_MS = 48 * 3600000;          // a session can be claimed for 48 h after it was recorded
const SLACK_MS = 10000;

const KINDS = {
  pushups:   { col: "pushups", source: "pushups" },
  tut:       { col: "pushups", source: "tut" },
  hold:      { col: "pushups", source: "hold" },
  plank:     { col: "planks", source: "plank" },
  walk:      { col: "walkSessions", source: "walk" },
  washers:   { col: "games", source: "washers" },
  tutBattle: { col: "tutBattles", source: "tut" }
};
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const err = (status, message) => Object.assign(new Error(message), { status });
const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : NaN);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// Session doc -> { qty, amount } or throws 422 (implausible / not earnable). Pure (tested in test/zab-earn.test.js).
function measure(kind, d, uid, nowMs) {
  const bad = (why) => { throw err(422, "Session can't earn ZAB: " + why + "."); };
  if (!d) throw err(404, "No such session.");
  if (kind === "tutBattle") {
    const p = d.players && d.players[uid];
    if (!p) throw err(403, "Not your session.");
    if (d.startAt == null || !(d.status === "done" || nowMs > d.startAt + 180000)) bad("battle not finished");
    const tutMs = num(p.tutMs), reps = num(p.reps || 0);
    if (!(tutMs >= 0) || tutMs > 180000 + SLACK_MS) bad("TUT longer than the battle");
    if (reps > tutMs / 400 + 1) bad("too many reps for the time");
    const qty = Math.floor(tutMs / 1000);
    return { qty, units: "seconds", amount: ZB.zabFor("tut", qty) };
  }
  if (d.uid !== uid) throw err(403, "Not your session.");
  if (kind === "pushups" || kind === "tut" || kind === "hold") {
    const reps = d.reps, ms = num(d.ms);
    if (!isInt(reps) || reps < 0 || reps > 5000 || !(ms >= 0)) bad("bad push-up record");
    if (ms > 3 * 3600000) bad("set longer than 3 hours");
    if (reps > ms / 400 + 1) bad("more than 2.5 reps a second");
    if (kind === "pushups") return { qty: reps, units: "reps", amount: ZB.zabFor("pushups", reps) };
    if (kind === "tut") {
      if (!isInt(d.tutMs) || d.tutMs <= 0) bad("no time under tension recorded");
      if (d.tutMs > ms + SLACK_MS) bad("time under tension longer than the set");
      const qty = Math.min(7200, Math.floor(d.tutMs / 1000));
      return { qty, units: "seconds", amount: ZB.zabFor("tut", qty) };
    }
    if (!isInt(d.holds) || d.holds <= 0) bad("no 30-second holds recorded");
    if (d.holds * 30000 > ms + SLACK_MS) bad("more holds than the set time allows");
    return { qty: d.holds, units: "holds", amount: ZC.roundZab(d.holds * 0.5) };
  }
  if (kind === "plank") {
    if (d.source !== "camera" || !isInt(d.holdSec) || d.holdSec < 0 || d.holdSec > 7200) bad("bad plank record");
    return { qty: d.holdSec, units: "seconds", amount: ZB.zabFor("plank", d.holdSec) };
  }
  if (kind === "walk") {
    if (!isInt(d.ms) || d.ms < 60000 || d.ms > 14400000 || !isInt(d.steps)) bad("bad walk record");
    const minutes = Math.floor(d.ms / 60000);
    if (d.steps < minutes * 30) bad("fewer than 30 steps a minute");
    if (d.steps > minutes * 250 + 250) bad("more than 250 steps a minute");
    return { qty: minutes, units: "minutes", amount: ZB.zabFor("walk", minutes) };
  }
  if (kind === "washers") {
    if (d.verified !== true || d.score !== 21 || !isInt(d.ms) || d.ms < 60000) bad("not a verified win");
    return { qty: 1, units: "wins", amount: ZB.zabFor("washers", 1) };
  }
  throw err(400, "Unknown source.");
}

// fs adapter as zaba-wager.js: tx(fn(t)), t.get(path) -> data|null, t.set, t.update, ts(), toMs(v).
// sinceMs: sessions recorded before this (ms) cannot be claimed (they were credited by the old client-side path).
function claim(fs, uid, body, nowMs, sinceMs) {
  body = body || {};
  if (!uid) return Promise.reject(err(401, "Sign in to earn ZAB."));
  const kind = String(body.source || ""), id = String(body.id || "");
  const K = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
  if (!K) return Promise.reject(err(400, "Unknown source."));
  if (!ID.test(id)) return Promise.reject(err(400, "Bad session id."));
  const now = nowMs || Date.now(), today = day(now), src = K.source;
  return fs.tx((t) => t.get([K.col, id]).then((d) => {
    if (!d) throw err(404, "No such session.");
    const created = fs.toMs(d.createdAt);
    if (created == null) throw err(422, "Session has no time.");
    if (created < (sinceMs || 0)) throw err(410, "Sessions from before server-checked earning can't be claimed.");
    if (now - created > MAX_AGE_MS) throw err(410, "That session is too old to claim.");
    const m = measure(kind, d, uid, now);
    const key = kind === "tutBattle" ? id + "_" + created : id;
    const claimId = src + "_" + K.col + "_" + key, txId = (src + "-" + K.col.slice(0, 2) + key).slice(0, 120);
    const refs = { claim: ["zabClaims", claimId], user: ["users", uid], dayDoc: ["zabEarnDay", uid + "_" + today], board: ["zabBoard", uid] };
    return Promise.all([t.get(refs.claim), t.get(refs.user), t.get(refs.dayDoc), t.get(refs.board)]).then(([prior, u, dd, b]) => {
      if (prior) throw err(409, "ZAB for that session was already claimed.");
      const used = dd && ZC.isZab(dd[src]) ? dd[src] : 0, left = ZC.roundZab(Math.max(0, DAY_CAP[src] - used));
      const amount = ZC.roundZab(Math.min(m.amount, CLAIM_CAP, left));
      const ts = fs.ts();
      t.set(refs.claim, { uid, source: src, col: K.col, id, amount, wanted: m.amount, at: ts });
      if (!(amount >= 0.1)) return { ok: true, credited: 0, capped: m.amount >= 0.1, balance: u && ZC.isZab(u.zabBalance) ? ZC.roundZab(u.zabBalance) : 0 };
      const bal = ZC.roundZab((u && ZC.isZab(u.zabBalance) ? u.zabBalance : 0) + amount);
      t.set(["users", uid, "zabLedger", txId], { uid, type: "earn", source: src, amount, units: m.units, qty: m.qty, setId: key.slice(0, 60), session: K.col + "/" + id, createdAt: ts });
      if (u) t.update(refs.user, { zabBalance: bal, lastTxId: txId, updatedAt: ts });
      else t.set(refs.user, { uid, zabBalance: bal, lastTxId: txId, createdAt: ts, updatedAt: ts });
      t.set(refs.dayDoc, Object.assign({}, dd || { uid, day: today }, { [src]: ZC.roundZab(used + amount), updatedAt: ts }));
      if (b) t.update(refs.board, { total: bal, updatedAt: ts });
      return { ok: true, credited: amount, capped: amount < m.amount, balance: bal };
    });
  }));
}
module.exports = { CLAIM_CAP, DAY_CAP, MAX_AGE_MS, KINDS, measure, claim };
