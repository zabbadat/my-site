// Unique, server-written board names (zab-names.js + netlify/functions/zab-board.js + rules + page). Run: node test/zab-names.test.js
const fsx = require("fs"), path = require("path");
const N = require("../zab-names.js"), Z = require("../zab-balance.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const read = (f) => fsx.readFileSync(path.join(__dirname, "..", f), "utf8");
function fakeFs() {
  const db = {};
  return { db, ts: () => 1, toMs: (v) => v,
    tx: async (fn) => { const w = []; let wrote = false; const t = { get: async (p) => { if (wrote) throw new Error("read after write"); return db[p.join("/")] ? { ...db[p.join("/")] } : null; },
      set: (p, d) => { wrote = true; w.push(["set", p.join("/"), d]); }, update: (p, d) => { wrote = true; w.push(["upd", p.join("/"), d]); }, delete: (p) => { wrote = true; w.push(["del", p.join("/")]); } };
      const out = await fn(t); w.forEach(([k, p, d]) => { if (k === "del") delete db[p]; else db[p] = k === "upd" ? Object.assign({}, db[p], d) : d; }); return out; } };
}
const st = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, status: e.status, msg: e.message }));
(async () => {
  check("key ignores case, spaces, punctuation", N.nameKey("Ann  Lee") === "annlee" && N.nameKey("ann-lee") === "annlee" && N.nameKey("ANN.LEE") === "annlee");
  check("reserved: Zabbadat, Zab Bank, Z.A.B.B.A.D.A.T, 'Official Ann', 'admin'", ["Zabbadat", "Zab Bank", "Z.a.b.b.a.d.a.t", "Official Ann", "admin", "Zabadat"].every((n) => N.reserved(N.nameKey(n))));
  check("ordinary names allowed", !N.reserved(N.nameKey("Ann Lee")) && N.checkName("  Ann   Lee ").name === "Ann Lee");
  check("emails / web addresses / symbols / too long refused (400)", ["a@b.com", "ann.com", "<b>x</b>", "x".repeat(25), " ", "a"].every((n) => { try { N.checkName(n); return false; } catch (e) { return e.status === 400; } }));
  const f = fakeFs(); f.db["users/u1"] = { zabBalance: 12.5 }; f.db["users/u2"] = { zabBalance: 3 };
  let r = await st(N.setBoard(f, "u1", { name: "Ann Lee" }));
  check("first claim writes zabBoard with the server balance and names/{key}", r.ok && f.db["zabBoard/u1"].name === "Ann Lee" && f.db["zabBoard/u1"].total === 12.5 && f.db["names/annlee"].uid === "u1");
  r = await st(N.setBoard(f, "u2", { name: "ann-LEE" }));
  check("same name for another player (any case/punctuation): 409, nothing written", !r.ok && r.status === 409 && !f.db["zabBoard/u2"]);
  r = await st(N.setBoard(f, "u2", { name: Z.nameWithSuffix("Ann Lee", "u2") }));
  check("page fallback '<name> 1234' is accepted", r.ok && /^Ann Lee \d{4}$/.test(f.db["zabBoard/u2"].name));
  r = await st(N.setBoard(f, "u1", { name: "Ann Lee" }));
  check("re-claiming your own name is fine", r.ok);
  r = await st(N.setBoard(f, "u1", { name: "Annie" }));
  check("renaming releases the old claim", r.ok && !f.db["names/annlee"] && f.db["names/annie"].uid === "u1");
  r = await st(N.setBoard(f, "u2", { name: "Zabbadat" }));
  check("reserved name refused (409)", !r.ok && r.status === 409);
  r = await st(N.setBoard(f, "own", { name: "Zabbadat" }, ["own"]));
  check("owner uid (ZAB_NAME_OWNER_UIDS) may use a reserved name", r.ok && f.db["names/zabbadat"].uid === "own");
  f.db["users/u1"].zabBalance = 20;
  r = await st(N.setBoard(f, "u1", {}));
  check("refresh without a name copies the server balance (browser never sends a total)", r.ok && f.db["zabBoard/u1"].total === 20);
  r = await st(N.setBoard(f, "u1", { name: "Annie", total: 99999 }));
  check("a total in the request is ignored", r.ok && f.db["zabBoard/u1"].total === 20);
  check("not signed in: 401", (await st(N.setBoard(f, null, { name: "X Y" }))).status === 401);
  const rules = read("firestore.rules"), html = read("index.html"), fn = read("netlify/functions/zab-board.js");
  check("rules: zabBoard is read-only for browsers", /match \/zabBoard\/\{uid\} \{\s*allow read: if request\.auth != null;\s*allow write: if false;\s*\}/.test(rules) && !/match \/names\//.test(rules));
  check("function: POST, verifies sign-in, owner allowlist from env", /POST only/.test(fn) && /uidFrom\(event\)/.test(fn) && /ZAB_NAME_OWNER_UIDS/.test(fn));
  check("page: board written through zab-board (no setDoc on zabBoard)", /fetch\("\/\.netlify\/functions\/zab-board"/.test(html) && !/setDoc\(doc\(db, "zabBoard"/.test(html));
  const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();
