// tools/migrate-zab.js: mapping logic against a mocked Firestore (no network, no credentials).
const path = require("path"), fsx = require("fs"), M = require("../tools/migrate-zab.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const FV = { serverTimestamp: () => "SERVER_TS" };
function mockDb(init) {
  const store = JSON.parse(JSON.stringify(init)); let writes = 0, readAfterWrite = false;
  const mkRef = (p) => { const parts = p.split("/"); return { path: p, id: parts[parts.length - 1],
    parent: { id: parts[parts.length - 2], parent: parts.length > 2 ? { id: parts[parts.length - 3] } : null },
    get: async () => ({ id: parts[parts.length - 1], exists: p in store, data: () => (p in store ? JSON.parse(JSON.stringify(store[p])) : undefined), ref: mkRef(p) }),
    set: async (d) => { writes++; store[p] = JSON.parse(JSON.stringify(d)); }, update: async (d) => { writes++; Object.assign(store[p], d); } }; };
  const docsUnder = (re) => Object.keys(store).filter((k) => re.test(k)).map((k) => ({ id: k.split("/").pop(), data: () => JSON.parse(JSON.stringify(store[k])), ref: mkRef(k) }));
  return { store, writes: () => writes, readAfterWrite: () => readAfterWrite,
    collection: (c) => ({ get: async () => ({ docs: docsUnder(new RegExp("^" + c + "/[^/]+$")) }) }),
    collectionGroup: (c) => ({ get: async () => ({ docs: docsUnder(new RegExp("^[^/]+/[^/]+/" + c + "/[^/]+$")) }) }),
    doc: (p) => mkRef(p),
    runTransaction: async (fn) => { let wrote = false; const out = await fn({ get: (ref) => { if (wrote) readAfterWrite = true; return ref.get(); }, update: (ref, d) => { wrote = true; writes++; Object.assign(store[ref.path], d); } }); return out; } };
}
const quiet = () => {};
(async () => {
  // ---- pure mapping ----
  check("planUser: new copy sets zabBalance and the marker, keeps the old field (patch never touches it)", (() => { const p = M.planUser({ zabaTokens: 7 }); return p.action === "create" && p.patch.zabBalance === 7 && p.patch.zabMigratedFrom === 7 && !("zabaTokens" in p.patch); })());
  check("planUser: zero balance still migrates", M.planUser({ zabaTokens: 0 }).action === "create" && M.planUser({ zabaTokens: 0 }).patch.zabBalance === 0);
  check("planUser: no old field / junk = skipped", M.planUser({}).action === "skip-no-old" && M.planUser({ zabaTokens: -3 }).action === "skip-no-old" && M.planUser({ zabaTokens: "5" }).action === "skip-no-old" && M.planUser(null).action === "skip-no-old");
  check("planUser: already copied and unchanged = in-sync, no patch", M.planUser({ zabaTokens: 7, zabBalance: 7, zabMigratedFrom: 7 }).action === "in-sync" && !M.planUser({ zabaTokens: 7, zabBalance: 7, zabMigratedFrom: 7 }).patch);
  check("planUser: old site kept earning -> only the difference is added (new-site spending is kept)", (() => { const p = M.planUser({ zabaTokens: 12, zabBalance: 5, zabMigratedFrom: 10 }); return p.action === "catch-up" && p.patch.zabBalance === 7 && p.patch.zabMigratedFrom === 12; })());
  check("planUser: balance created by the new site (no marker) is left alone", (() => { const p = M.planUser({ zabaTokens: 3, zabBalance: 9 }); return p.action === "skip-new" && !p.patch && p.differs === true; })());
  check("planUser: never produces a negative balance", M.planUser({ zabaTokens: 2, zabBalance: 1, zabMigratedFrom: 10 }).action === "blocked");
  check("planCopy: missing = create, identical = same, different = conflict (never overwrite)", M.planCopy({ a: 1 }, null).action === "create" && M.planCopy({ a: 1, b: 2 }, { b: 2, a: 1 }).action === "same" && M.planCopy({ a: 1 }, { a: 2 }).action === "conflict");
  check("parseArgs: dry run is the default; --apply and --verify never combine", M.parseArgs([]).apply === false && M.parseArgs(["--apply"]).apply === true && M.parseArgs(["--apply", "--verify"]).bad && M.parseArgs(["--wat"]).bad);
  // ---- dataset ----
  const init = {
    "users/a": { uid: "a", zabaTokens: 5, lastTxId: "pushups-s1", updatedAt: 1 },
    "users/b": { uid: "b", zabaTokens: 0, lastTxId: "", updatedAt: 1 },
    "users/c": { uid: "c", zabaTokens: 4, zabBalance: 9, lastTxId: "x", updatedAt: 1 },   // new-site user
    "users/d": { uid: "d", lastTxId: "", updatedAt: 1 },                                  // no old field
    "users/a/tokenTx/pushups-s1": { uid: "a", type: "earn", source: "pushups", amount: 3, qty: 30, units: "reps", setId: "s1" },
    "users/a/tokenTx/walk-w1": { uid: "a", type: "earn", source: "walk", amount: 2, qty: 20, units: "minutes", setId: "w1" },
    "tokenBoard/a": { uid: "a", name: "Ann", total: 5 },
    "tokenBoard/b": { uid: "b", name: "Bob", total: 0 },
  };
  let db = mockDb(init);
  let S = await M.run(db, FV, {}, quiet);
  check("dry run: counts reported, NOTHING written", S.mode === "dry-run" && db.writes() === 0 && S.usersCreate === 2 && S.usersSkipNew === 1 && S.usersNoOld === 1 && S.ledgerCreate === 2 && S.boardCreate === 2 && !("zabBalance" in db.store["users/a"]));
  db = mockDb(init); S = await M.run(db, FV, { apply: true }, quiet);
  check("apply: balances copied, marker + timestamp added, old fields kept", db.store["users/a"].zabBalance === 5 && db.store["users/a"].zabMigratedFrom === 5 && db.store["users/a"].zabaTokens === 5 && db.store["users/a"].zabMigratedAt === "SERVER_TS" && db.store["users/b"].zabBalance === 0);
  check("apply: new-site user and no-old user untouched", db.store["users/c"].zabBalance === 9 && !("zabMigratedFrom" in db.store["users/c"]) && !("zabBalance" in db.store["users/d"]));
  check("apply: ledger copied with the same ids and data, old entries kept", sameKeys(db.store, "users/a/zabLedger/pushups-s1", init["users/a/tokenTx/pushups-s1"]) && sameKeys(db.store, "users/a/zabLedger/walk-w1", init["users/a/tokenTx/walk-w1"]) && "users/a/tokenTx/walk-w1" in db.store);
  check("apply: board mirror copied, old kept", db.store["zabBoard/a"].name === "Ann" && db.store["zabBoard/b"].total === 0 && "tokenBoard/a" in db.store);
  check("apply: transactions read before they write", db.readAfterWrite() === false);
  const w1 = db.writes(); S = await M.run(db, FV, { apply: true }, quiet);
  check("idempotent: second apply writes nothing", db.writes() === w1 && S.usersInSync === 2 && S.usersCreate === 0 && S.ledgerCreate === 0 && S.boardCreate === 0 && S.ledgerSame === 2);
  // old site keeps earning during the switch-over, new site spends; the catch-up adds only the difference
  db.store["users/a"].zabaTokens = 8; db.store["users/a"].zabBalance = 4; db.store["users/a/tokenTx/plank-p1"] = { uid: "a", type: "earn", source: "plank", amount: 3, qty: 180, units: "seconds", setId: "p1" };
  S = await M.run(db, FV, { apply: true }, quiet);
  check("catch-up: +3 earned by the old site is added to the new balance (4 -> 7), new ledger entry copied", db.store["users/a"].zabBalance === 7 && db.store["users/a"].zabMigratedFrom === 8 && S.usersCatchUp === 1 && "users/a/zabLedger/plank-p1" in db.store);
  S = await M.run(db, FV, { apply: true }, quiet);
  check("catch-up twice does not double count", db.store["users/a"].zabBalance === 7);
  // conflicts are never overwritten
  db.store["users/a/zabLedger/walk-w1"].amount = 99; S = await M.run(db, FV, { apply: true }, quiet);
  check("conflict: an existing different ledger doc is reported, not overwritten", S.ledgerConflict === 1 && db.store["users/a/zabLedger/walk-w1"].amount === 99 && S.problems.some((x) => /walk-w1/.test(x)));
  // verify
  db = mockDb(init); S = await M.run(db, FV, { verify: true }, quiet);
  check("verify before apply: flags every user that has an old balance", S.mode === "verify" && S.verifyProblems >= 2 && db.writes() === 0);
  await M.run(db, FV, { apply: true }, quiet); S = await M.run(db, FV, { verify: true }, quiet);
  check("verify after apply: users a and b clean (c is a new-site user, reported for review)", S.verifyOk === 3 && S.verifyProblems === 1 && S.problems.join() === "c");
  db.store["users/a"].zabaTokens = 6; const wv = db.writes(); S = await M.run(db, FV, { verify: true }, quiet);
  check("verify: old balance grew after the copy -> asks to run --apply again", S.problems.includes("a") && db.writes() === wv);
  S = await M.run(db, FV, { apply: true, uid: "b" }, quiet);
  check("--uid limits the run to one user", S.users === 1);
  // report never prints data fields
  const lines = []; M.report(await M.run(mockDb(init), FV, {}, quiet), (m) => lines.push(m));
  check("report prints counts only", lines.join("\n").includes("users scanned: 4") && !/Ann|Bob/.test(lines.join("")));
  // script hygiene
  const src = fsx.readFileSync(path.join(__dirname, "..", "tools", "migrate-zab.js"), "utf8");
  check("credentials come from GOOGLE_APPLICATION_CREDENTIALS only; no key material, no deletes, dry-run is the default", /process\.env\.GOOGLE_APPLICATION_CREDENTIALS/.test(src) && !/private_key|BEGIN PRIVATE|\.delete\(|deleteField|FIREBASE_SERVICE_ACCOUNT/.test(src) && /apply: false/.test(src));
  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
function sameKeys(store, p, expected) { return JSON.stringify(Object.keys(store[p] || {}).sort()) === JSON.stringify(Object.keys(expected).sort()) && Object.keys(expected).every((k) => store[p][k] === expected[k]); }
