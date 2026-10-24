#!/usr/bin/env node
/* One-time (re-runnable) Firestore data migration for the ZAB rename. SAFE for the old live code and the new code:
 * it only ADDS data; nothing old is changed or deleted.
 *   users/{uid}.zabaTokens          -> users/{uid}.zabBalance           (old field is kept)
 *   users/{uid}/tokenTx/{id}        -> users/{uid}/zabLedger/{id}       (same ids and data; old docs are kept)
 *   tokenBoard/{uid}                -> zabBoard/{uid}                   (old docs are kept)
 *
 * Usage (service account JSON path comes ONLY from the environment; nothing secret is ever printed):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node tools/migrate-zab.js            # dry run (default): prints the plan, writes nothing
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node tools/migrate-zab.js --apply    # performs the copy
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node tools/migrate-zab.js --verify   # read-only per-user check
 *   options: --uid=<uid> (one user only), --verbose (print every user, not only problems)
 *
 * Idempotent and catch-up safe. Each user doc records zabMigratedFrom (the old balance that was copied). On a re-run,
 * if the old balance moved (the old site kept earning during the switch-over) the DIFFERENCE is added to zabBalance,
 * so earnings made by either version are never lost and never counted twice. Users who already have a zabBalance but no
 * marker (created by the new site) are left alone. Ledger / board docs are only created when missing; a doc that
 * exists with different data is reported as a conflict and not overwritten.
 */
"use strict";
const isInt = (v) => typeof v === "number" && Number.isInteger(v);

/* ---- pure mapping (unit tested with a mocked Firestore) ---- */
// user doc data -> { action, patch?, reason? }.   action: create | catch-up | in-sync | skip-new | skip-no-old | blocked
function planUser(u) {
  u = u || {};
  if (!isInt(u.zabaTokens) || u.zabaTokens < 0) return { action: "skip-no-old" };
  const old = u.zabaTokens;
  if (!isInt(u.zabBalance)) return { action: "create", patch: { zabBalance: old, zabMigratedFrom: old }, before: null, after: old };
  if (!isInt(u.zabMigratedFrom)) return { action: "skip-new", before: u.zabBalance, after: u.zabBalance, differs: u.zabBalance !== old };
  if (u.zabMigratedFrom === old) return { action: "in-sync", before: u.zabBalance, after: u.zabBalance };
  const after = u.zabBalance + (old - u.zabMigratedFrom);
  if (after < 0) return { action: "blocked", reason: "negative result", before: u.zabBalance, after };
  return { action: "catch-up", patch: { zabBalance: after, zabMigratedFrom: old }, before: u.zabBalance, after };
}
const sameData = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(o) { if (o && typeof o === "object" && !Array.isArray(o) && typeof o.toMillis !== "function") return Object.keys(o).sort().reduce((r, k) => { r[k] = sortKeys(o[k]); return r; }, {}); if (o && typeof o.toMillis === "function") return { __ms: o.toMillis() }; return o; }
// ledger / board doc -> action
const planCopy = (oldData, newData) => (newData == null ? { action: "create" } : sameData(oldData, newData) ? { action: "same" } : { action: "conflict" });
// per-user verification from the three facts
function verifyUser(u, ledgerOld, ledgerNew) {
  const problems = []; u = u || {};
  if (!isInt(u.zabaTokens)) return { ok: true, note: "no old balance" };
  if (!isInt(u.zabBalance)) problems.push("zabBalance missing");
  else if (u.zabBalance < 0) problems.push("zabBalance negative");
  if (isInt(u.zabBalance) && !isInt(u.zabMigratedFrom)) problems.push("no migration marker (new-site user or not migrated)");
  if (isInt(u.zabMigratedFrom) && u.zabMigratedFrom < u.zabaTokens) problems.push("old balance grew after the last copy: run --apply again");
  if (isInt(u.zabMigratedFrom) && u.zabMigratedFrom > u.zabaTokens) problems.push("old balance is lower than the copied value");
  const missing = Object.keys(ledgerOld || {}).filter((id) => !(ledgerNew || {})[id]);
  if (missing.length) problems.push(missing.length + " ledger entr" + (missing.length === 1 ? "y" : "ies") + " missing");
  const diff = Object.keys(ledgerOld || {}).filter((id) => (ledgerNew || {})[id] && !sameData(ledgerOld[id], ledgerNew[id]));
  if (diff.length) problems.push(diff.length + " ledger entr" + (diff.length === 1 ? "y differs" : "ies differ"));
  return { ok: problems.length === 0, problems };
}

/* ---- runner. db = firebase-admin Firestore (or the test mock); FV = { serverTimestamp() } ---- */
async function run(db, FV, opts, log) {
  opts = opts || {}; log = log || (() => {});
  const mode = opts.verify ? "verify" : opts.apply ? "apply" : "dry-run";
  const only = opts.uid || null, S = { mode, users: 0, usersCreate: 0, usersCatchUp: 0, usersInSync: 0, usersSkipNew: 0, usersNoOld: 0, usersBlocked: 0,
    ledgerCreate: 0, ledgerSame: 0, ledgerConflict: 0, boardCreate: 0, boardSame: 0, boardConflict: 0, verifyOk: 0, verifyProblems: 0, problems: [] };
  const say = (uid, msg, always) => { if (always || opts.verbose) log("  " + uid + ": " + msg); };
  const userSnap = await db.collection("users").get();
  const users = userSnap.docs.filter((d) => !only || d.id === only);
  const ledgerOld = {}, ledgerNew = {};
  const txSnap = await db.collectionGroup("tokenTx").get();
  txSnap.docs.forEach((d) => { const uid = d.ref.parent.parent.id; if (only && uid !== only) return; (ledgerOld[uid] = ledgerOld[uid] || {})[d.id] = d.data(); });
  const zlSnap = await db.collectionGroup("zabLedger").get();
  zlSnap.docs.forEach((d) => { const uid = d.ref.parent.parent.id; if (only && uid !== only) return; (ledgerNew[uid] = ledgerNew[uid] || {})[d.id] = d.data(); });
  if (mode === "verify") {
    for (const d of users) {
      S.users++; const v = verifyUser(d.data(), ledgerOld[d.id], ledgerNew[d.id]);
      if (v.ok) { S.verifyOk++; say(d.id, "ok" + (v.note ? " (" + v.note + ")" : "")); } else { S.verifyProblems++; S.problems.push(d.id); say(d.id, v.problems.join("; "), true); }
    }
  } else {
    for (const d of users) {
      S.users++;
      const run1 = async () => {
        const tr = (fn) => (mode === "apply" ? db.runTransaction(fn) : fn({ get: (r) => r.get(), update() {}, set() {} }));
        return tr(async (t) => {
          const snap = await t.get(d.ref), p = planUser(snap.data());
          if (mode === "apply" && p.patch) t.update(d.ref, Object.assign({}, p.patch, { zabMigratedAt: FV.serverTimestamp() }));
          return p;
        });
      };
      const p = await run1();
      const key = { create: "usersCreate", "catch-up": "usersCatchUp", "in-sync": "usersInSync", "skip-new": "usersSkipNew", "skip-no-old": "usersNoOld", blocked: "usersBlocked" }[p.action]; S[key]++;
      say(d.id, p.action + (p.after != null ? " (" + (p.before == null ? "-" : p.before) + " -> " + p.after + ")" : "") + (p.reason ? " " + p.reason : "") + (p.differs ? " (differs from old, left alone)" : ""), p.action === "blocked" || p.action === "skip-new" && p.differs);
      if (p.action === "blocked") S.problems.push(d.id);
    }
    for (const uid of Object.keys(ledgerOld)) {
      if (!users.some((u) => u.id === uid)) continue;
      for (const id of Object.keys(ledgerOld[uid])) {
        const pc = planCopy(ledgerOld[uid][id], (ledgerNew[uid] || {})[id]);
        if (pc.action === "create") { S.ledgerCreate++; if (mode === "apply") await db.doc("users/" + uid + "/zabLedger/" + id).set(ledgerOld[uid][id]); }
        else if (pc.action === "same") S.ledgerSame++; else { S.ledgerConflict++; S.problems.push(uid + "/" + id); say(uid, "ledger " + id + " exists with different data (not overwritten)", true); }
      }
    }
    const boardSnap = await db.collection("tokenBoard").get(), newBoard = {};
    (await db.collection("zabBoard").get()).docs.forEach((d) => { newBoard[d.id] = d.data(); });
    for (const d of boardSnap.docs) {
      if (only && d.id !== only) continue;
      const pc = planCopy(d.data(), newBoard[d.id]);
      if (pc.action === "create") { S.boardCreate++; if (mode === "apply") await db.doc("zabBoard/" + d.id).set(d.data()); }
      else if (pc.action === "same") S.boardSame++; else { S.boardConflict++; say(d.id, "board entry exists with different data (not overwritten; the site rewrites it)", true); }
    }
  }
  return S;
}

function report(S, log) {
  log("mode: " + S.mode + (S.mode === "dry-run" ? "  (nothing was written; add --apply to copy)" : ""));
  log("users scanned: " + S.users);
  if (S.mode === "verify") { log("verify ok: " + S.verifyOk + "   with problems: " + S.verifyProblems); return; }
  log("users  create: " + S.usersCreate + "  catch-up: " + S.usersCatchUp + "  in-sync: " + S.usersInSync + "  new-site (left alone): " + S.usersSkipNew + "  no old balance: " + S.usersNoOld + "  blocked: " + S.usersBlocked);
  log("ledger entries  to copy: " + S.ledgerCreate + "  already there: " + S.ledgerSame + "  conflicts: " + S.ledgerConflict);
  log("board entries   to copy: " + S.boardCreate + "  already there: " + S.boardSame + "  conflicts: " + S.boardConflict);
}

function parseArgs(argv) {
  const o = { apply: false, verify: false, verbose: false, uid: null };
  argv.forEach((a) => { if (a === "--apply") o.apply = true; else if (a === "--verify") o.verify = true; else if (a === "--verbose") o.verbose = true; else if (a === "--dry-run") o.apply = false; else if (a.startsWith("--uid=")) o.uid = a.slice(6); else if (a === "--help" || a === "-h") o.help = true; else o.bad = a; });
  if (o.apply && o.verify) o.bad = "--apply and --verify together";
  return o;
}

async function main(argv) {
  const o = parseArgs(argv.slice(2));
  if (o.help || o.bad) { console.log((o.bad ? "Unknown or conflicting option: " + o.bad + "\n" : "") + "Usage: GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node tools/migrate-zab.js [--apply | --verify] [--uid=UID] [--verbose]"); return o.bad ? 2 : 0; }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.error("Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON file path."); return 2; }
  const admin = require("firebase-admin");
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();
  const S = await run(db, admin.firestore.FieldValue, o, (m) => console.log(m));
  report(S, (m) => console.log(m));
  if (S.problems.length) console.log("needs attention: " + S.problems.slice(0, 50).join(", ") + (S.problems.length > 50 ? " …(" + S.problems.length + " total)" : ""));
  return S.problems.length ? 1 : 0;
}
module.exports = { planUser, planCopy, verifyUser, run, report, parseArgs, main, sameData };
if (require.main === module) main(process.argv).then((c) => process.exit(c), (e) => { console.error("Migration failed: " + (e && e.message ? e.message : e)); process.exit(1); });
