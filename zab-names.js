/* Zab Bank display names on the public ZAB board (zabBoard), written ONLY by the server (netlify/functions/zab-board.js).
 * Names are unique ignoring case, spaces and punctuation: a claim doc names/{key} (key = lowercase letters and digits)
 * is taken in the same transaction that writes zabBoard/{uid}; the player's previous claim is released.
 * Reserved names (OWNER DECISION, list below) can't be claimed: official-looking names such as Zabbadat or Zab Bank.
 * The board total is always copied from users/{uid}.zabBalance on the server (never sent by the browser).
 * Node only (the browser just calls the function). */
"use strict";
const ZC = require("./zab-currency.js");
// ---- OWNER DECISION: reserved names. EXACT = the whole name; CONTAINS = anywhere in the name (after normalising). ----
const RESERVED_EXACT = ["zab", "zabba", "zabbank", "zabbankbot", "bankofzabba", "grok", "grokbot", "player", "you", "anonymous", "null", "undefined"];
const RESERVED_CONTAINS = ["zabbadat", "zabadat", "zabbabank", "zabbank", "bankofzabba", "admin", "moderator", "official", "support", "staff", "system"];
const MAX_LEN = 24;
const err = (status, message) => Object.assign(new Error(message), { status });
function clean(raw) { return String(raw == null ? "" : raw).normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim(); }
function nameKey(raw) { return clean(raw).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""); }
function reserved(key) { return RESERVED_EXACT.indexOf(key) >= 0 || RESERVED_CONTAINS.some((w) => key.indexOf(w) >= 0); }
// -> { name, key } or throws 400 with a plain reason.
function checkName(raw, allowReserved) {
  const name = clean(raw);
  if (!name) throw err(400, "Pick a name.");
  if (Array.from(name).length > MAX_LEN) throw err(400, "Names are at most " + MAX_LEN + " characters.");
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(name)) throw err(400, "Use letters, numbers, spaces and . _ ' - only.");
  if (/@/.test(name) || /\.(com|net|org|io|co|me)\b/i.test(name)) throw err(400, "Names can't look like an email or a web address.");
  const key = nameKey(name);
  if (key.length < 2) throw err(400, "Names need at least 2 letters or numbers.");
  if (!allowReserved && reserved(key)) throw err(409, "That name is reserved.");
  return { name, key };
}
// Fallback when a name is taken: "<name> <4 digits>" (stable per uid).
function withSuffix(name, uid) {
  let h = 0; const id = String(uid || ""); for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 10000;
  return Array.from(clean(name)).slice(0, MAX_LEN - 5).join("").trim() + " " + String(1000 + (h % 9000));
}
// fs adapter as zaba-wager.js. body: { name } to set / change the board name; {} to refresh the total only.
// ownerUids: accounts allowed to use reserved names (the site owner; Netlify env ZAB_NAME_OWNER_UIDS).
function setBoard(fs, uid, body, ownerUids) {
  body = body || {};
  if (!uid) return Promise.reject(err(401, "Sign in first."));
  let want = null;
  try { want = body.name == null ? null : checkName(body.name, (ownerUids || []).indexOf(uid) >= 0); } catch (e) { return Promise.reject(e); }
  return fs.tx((t) => Promise.all([t.get(["users", uid]), t.get(["zabBoard", uid]), want ? t.get(["names", want.key]) : null]).then(([u, b, claim]) => {
    const total = u && ZC.isZab(u.zabBalance) ? ZC.roundZab(u.zabBalance) : 0, ts = fs.ts();
    if (!want) {
      if (!b) throw err(404, "Pick a board name first.");
      if (b.total === total) return { ok: true, name: b.name, total, unchanged: true };
      t.update(["zabBoard", uid], { total, updatedAt: ts });
      return { ok: true, name: b.name, total };
    }
    if (claim && claim.uid !== uid) throw err(409, "That name is taken.");
    const oldKey = b && b.name ? nameKey(b.name) : null;
    const next = oldKey && oldKey !== want.key ? t.get(["names", oldKey]) : Promise.resolve(null);
    return next.then((old) => {
      if (old && old.uid === uid) t.delete(["names", oldKey]);
      if (!claim) t.set(["names", want.key], { uid, name: want.name, at: ts });
      t.set(["zabBoard", uid], { uid, name: want.name, total, updatedAt: ts });
      return { ok: true, name: want.name, total };
    });
  }));
}
module.exports = { RESERVED_EXACT, RESERVED_CONTAINS, MAX_LEN, clean, nameKey, reserved, checkName, withSuffix, setBoard };
