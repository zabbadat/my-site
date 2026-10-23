// "Top Zabba Bag" line: tokenBoard mirror entry, line text, hide rules, draft rules shape.
const fs = require("fs"), path = require("path"), vm = require("vm"), ZT = require("../zaba-tokens.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"), rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
check("line text", ZT.topLine({ name: "Zab", total: 12 }) === "Bank of Zabba \u2013 Top Zabba Bags: Zab \u00b7 12 Zabba Tokens" && ZT.topLine({ name: "Zab", total: 1 }) === "Bank of Zabba \u2013 Top Zabba Bags: Zab \u00b7 1 Zabba Token" && ZT.topLine({ name: "Zab", total: 1500 }) === "Bank of Zabba \u2013 Top Zabba Bags: Zab \u00b7 1,500 Zabba Tokens");
check("hidden when empty / zero / missing", ZT.topLine(null) === null && ZT.topLine({ name: "Zab", total: 0 }) === null && ZT.topLine({}) === null);
check("never an email (entry and line)", ZT.boardEntry("u1", "zab@example.com", 3).name === "Player" && !/@/.test(ZT.topLine({ name: "a@b.co", total: 3 })));
check("entry shape uid/name/total only", JSON.stringify(ZT.boardEntry("u1", "Zab", 7.9)) === '{"uid":"u1","name":"Zab","total":7}');
const fn = (name) => { const i = html.indexOf("function " + name + "("); const e = html.indexOf("\n", i); const l = html.slice(i, e); return /\}\s*$/.test(l) && l.split("{").length === l.split("}").length ? l : html.slice(i, html.indexOf("\n}", i) + 2); };
{ const el = { textContent: "x", hidden: false }; const ctx = { $: () => el, ZT }; vm.createContext(ctx); vm.runInContext(fn("paintTopBag"), ctx);
  ctx.paintTopBag({ name: "Zab", total: 4 }); const shown = !el.hidden && el.textContent === "Bank of Zabba \u2013 Top Zabba Bags: Zab \u00b7 4 Zabba Tokens";
  ctx.paintTopBag(null); check("paintTopBag shows the line, hides on null (empty / no permission / error)", shown && el.hidden && el.textContent === ""); }
{ const writes = []; let fail1 = true; const ctx = { ZT, db: {}, doc: (db, c, id) => c + "/" + id, serverTimestamp: () => "TS", setDoc: (p, d) => { writes.push([p, d]); return fail1 ? Promise.reject(new Error("denied")) : Promise.resolve(); },
    publicName: (s) => String(s).split("@")[0], displayNameOf: (u) => u.displayName || u.email, ztMirrored: null };
  vm.createContext(ctx); vm.runInContext("var ztMirrored = null;\n" + fn("mirrorBoard"), ctx);
  ctx.mirrorBoard({ uid: "u1", email: "zab@x.com" }, 5);
  setTimeout(() => { fail1 = false; ctx.mirrorBoard({ uid: "u1", email: "zab@x.com" }, 5); ctx.mirrorBoard({ uid: "u1", email: "zab@x.com" }, 5);
    check("mirror: writes tokenBoard/{uid} {uid,name,total,updatedAt}, leaderboard name, retries after a denied write, no duplicate writes", writes.length === 2 && writes[0][0] === "tokenBoard/u1" && JSON.stringify(writes[1][1]) === '{"uid":"u1","name":"zab","total":5,"updatedAt":"TS"}');
    check("wiring: mirror from the profile snapshot, top query only while signed in, unsubscribed on sign-out", /paintTokens\(n\); mirrorBoard\(u, n\);/.test(html) && /ztTopOff = onSnapshot\(query\(collection\(db, "tokenBoard"\), orderBy\("total", "desc"\), limit\(1\)\), \(snap\) => paintTopBag\(snap\.empty \? null : snap\.docs\[0\]\.data\(\)\), \(\) => paintTopBag\(null\)\)/.test(html) && /if \(ztTopOff\) \{ ztTopOff\(\); ztTopOff = null; \}\s*paintTokens\(null\); paintTopBag\(null\);/.test(html));
    check("award transaction untouched (mirror is outside it)", !/tokenBoard/.test(fs.readFileSync(path.join(__dirname, "..", "zaba-tokens.js"), "utf8").slice(0, fs.readFileSync(path.join(__dirname, "..", "zaba-tokens.js"), "utf8").indexOf("function earnAndQueue"))));
    check("#ztTop present, hidden by default, near the balance", /<b id="ztBalance">[^\n]*\n\s*<p class="note" id="ztTop" hidden><\/p>/.test(html));
    const m = rules.slice(rules.indexOf("match /tokenBoard/{uid}"));
    check("draft rules: signed-in read only; owner write; keys uid/name/total/updatedAt; total == own zabaTokens; no '@' in name; no delete",
      /allow read: if request\.auth != null;/.test(m) && /request\.auth\.uid == uid/.test(m) && /hasOnly\(\['uid','name','total','updatedAt'\]\)/.test(m) && /b\(\)\.total == get\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\)\.data\.zabaTokens/.test(m) && /!b\(\)\.name\.matches\('\.\*@\.\*'\)/.test(m) && /allow delete: if false;/.test(m));
    check("users/{uid} stays owner-only read", /match \/users\/\{uid\} \{[\s\S]*?allow read: if request\.auth != null && request\.auth\.uid == uid;/.test(rules));
    console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }, 20);
}
