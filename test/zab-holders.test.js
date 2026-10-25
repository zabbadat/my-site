// "Top ZAB Holders" scoreboard: view logic (zab-balance.js), markup/placement and wiring (index.html). Run: node test/zab-holders.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), Z = require("../zab-balance.js"), ZC = require("../zab-currency.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const E = (uid, name, total) => ({ uid, name, total });
const text = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

// ---- sorting, ranks, ties, limits
{ const v = Z.holdersView([E("a", "Al", 5), E("b", "Bo", 50), E("c", "Cy", 20), E("d", "Di", 0), E("e", "Ed", -3), null, E("f", "Fay", "x")], "c");
  check("sorted by balance high to low; zero, negative and bad balances are left out", v.map((r) => r.name).join() === "Bo,Cy,Al" && v.map((r) => r.total).join() === "50,20,5");
  check("ranks 1..n and the viewer's row is flagged", v.map((r) => r.rank).join() === "1,2,3" && v[1].me === true && !v[0].me && !v[2].me); }
{ const v = Z.holdersView([E("u3", "Cy", 10), E("u1", "al", 10), E("u2", "Bo", 10), E("u9", "Di", 7)]);
  check("ties: same balance shares a rank (1,1,1,4), ordered by name then uid (stable)", v.map((r) => r.rank).join() === "1,1,1,4" && v.map((r) => r.name).join() === "al,Bo,Cy,Di");
  const w = Z.holdersView([E("u2", "Same", 4), E("u1", "Same", 4)]); check("same name and balance: ordered by uid", w[0].uid === "u1"); }
{ const many = Array.from({ length: 25 }, (_, i) => E("u" + i, "P" + i, 100 - i));
  const v = Z.holdersView(many); check("top 10 only", v.length === 10 && v[0].total === 100 && v[9].total === 91);
  check("top three highlighted (and only them)", v.filter((r) => r.top).length === 3 && v[2].top && !v[3].top); }
{ const v = Z.holdersView([E("a", "A", 9), E("b", "B", 9), E("c", "C", 9), E("d", "D", 9)]); check("a tie for 1st highlights everyone tied at ranks 1-3", v.every((r) => r.rank === 1 && r.top)); }
check("balances are whole numbers", Z.holdersView([E("a", "A", 7.9)])[0].total === 7);

// ---- names: never an email, safe fallback, long names
{ const bad = ["zab@example.com", "a@b.co", "  ", "", null, undefined, "Zab Smith <z@x.org>", "john.smith.gmail.com"];
  const names = bad.map((n) => Z.holderName({ uid: "uid-" + n, name: n }));
  check("email-looking, blank or missing names become 'Zabba #1234'", names.every((n) => /^Zabba #\d{4}$/.test(n)), names.join(" | "));
  check("fallback is stable for the same uid and differs between uids", Z.holderName({ uid: "x1" }) === Z.holderName({ uid: "x1", name: "" }) && Z.holderName({ uid: "x1" }) !== Z.holderName({ uid: "x2" })); }
check("normal names pass through (spaces tidied)", Z.holderName({ name: "  Zab   Ace " }) === "Zab Ace" && Z.holderName({ name: "Zabba_77" }) === "Zabba_77");
{ const long = Z.holderName({ name: "A".repeat(80) }); check("long names are cut with an ellipsis (24 chars)", Array.from(long).length === 24 && long.endsWith("\u2026"));
  const emoji = Z.holderName({ name: "\u{1F600}".repeat(40) }); check("long names with emoji are cut on whole characters", Array.from(emoji).length === 24 && !/[\uD800-\uDBFF]$/.test(emoji)); }

// ---- rendering
{ const v = Z.holdersView([E("a", "Al", 1234567), E("b", "Bo", 50), E("c", "Cy", 20), E("d", "Di", 5)], "d"), h = Z.holdersHtml("ok", v);
  check("renders an ordered list: rank, name, balance with the ZAB ring", /^<ol class="zt-holders">/.test(h) && (h.match(/<li /g) || []).length === 4 && /zab-ring/.test(h) && /<span class="zt-h-rank" aria-label="Rank 1">1<\/span><span class="zt-h-name">Al<\/span><span class="zt-h-bal">1,234,567 <span class="zab">ZAB/.test(h));
  check("top three rows carry gold / silver / bronze classes, the fourth does not", /zt-top zt-r1/.test(h) && /zt-top zt-r2/.test(h) && /zt-top zt-r3/.test(h) && (h.match(/zt-top/g) || []).length === 3);
  check("the viewer's own row is marked 'you'", /zt-me/.test(h) && /<em class="zt-h-you">you<\/em>/.test(h) && (h.match(/zt-h-you/g) || []).length === 1);
  const x = Z.holdersHtml("ok", Z.holdersView([E("a", '<img src=x onerror=alert(1)>', 3)])); check("names are HTML-escaped", !/<img/.test(x) && /&lt;img/.test(x)); }
{ const raw = [E("a", "zab@example.com", 9), E("b", "real.person@gmail.com", 8), { uid: "c", name: "Cy", total: 7, email: "cy@secret.org" }, { uid: "d", name: "Di", total: 6, userEmail: "d@x.io" }];
  const h = Z.holdersHtml("ok", Z.holdersView(raw)); check("an email never appears in the scoreboard (name fields or stray email fields)", !/@|example\.com|gmail|secret\.org|x\.io/.test(h) && /Zabba #\d{4}/.test(h)); }
for (const [st, re, key] of [["loading", /Loading the ZAB holders/, "loading"], ["empty", /No ZAB holders on the board yet/, "empty"], ["error", /Couldn\u2019t load the ZAB holders/, "error"], ["signedout", /Sign in to see the ZAB holders/, "signedout"]]) {
  const h = Z.holdersHtml(st, null); check(`${st} state shows a message, no list`, re.test(h) && h.indexOf("<ol") < 0 && h.includes('data-state="' + key + '"')); }
check("'ok' with no usable rows falls back to the empty state", /No ZAB holders on the board yet/.test(Z.holdersHtml("ok", [])) && /No ZAB holders/.test(Z.holdersHtml("ok", Z.holdersView([E("a", "A", 0)]))));
check("no location text in the scoreboard copy", !/jersey|yardley|south nj/i.test(Z.holdersHtml("empty") + Z.holdersHtml("error") + Z.holdersHtml("signedout")));

// ---- placement in the page (index.html #zab), above Recent earnings
const s = html.indexOf('<section id="zab">'), sec = html.slice(s, html.indexOf("</section>", s));
const at = (needle) => sec.indexOf(needle);
check("scoreboard is inside the ZAB section, after the ZAB heading and balance", at('id="ztHolders"') > at("<h2>") && at('id="ztHolders"') > at('id="ztBalance"') && at('id="ztHolders"') > 0);
check("scoreboard comes ABOVE the 'Recent earnings' heading and its table", at('id="ztHolders"') < at("<h3>Recent earnings</h3>") && at('id="ztHolders"') < at('id="ztTxBody"'));
check("scoreboard comes above the earn rates too, and the top-line note stays above it", at('id="ztHolders"') < at('id="ztRates"') && at('id="ztTop"') < at('id="ztHolders"'));
check("heading: 'The Bank of Zabba \u2014 top ' + the site's ZAB markup (span.zab with the ring svg, as in the table header) + ' holders'", (() => { const m = sec.match(/<h3 class="zt-board-title">([\s\S]*?)<\/h3>/); if (!m) return false; const h = m[1];
  const zabSpan = /<span class="zab">ZAB<svg class="zab-ring" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle[^>]*\/><circle[^>]*\/><\/svg><\/span>/;
  const same = sec.match(/<th><span class="zab">ZAB<svg[\s\S]*?<\/svg><\/span><\/th>/); // the existing table-header markup
  const plain = h.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "");
  return h.startsWith("The Bank of Zabba \u2014 top ") && zabSpan.test(h) && h.endsWith("</span> holders") && plain === "The Bank of Zabba \u2014 top ZAB holders" && !/symbol/i.test(h) && !!same && h.match(zabSpan)[0] === same[0].replace(/^<th>|<\/th>$/g, ""); })());
check("brand spelling: the heading says Zabba (two Bs), never one-b Zaba, and the whole page text has no one-b Zaba", (() => { const h = sec.match(/<h3 class="zt-board-title">([\s\S]*?)<\/h3>/)[1]; const page = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " "); return /The Bank of Zabba \u2014 top /.test(h) && !/\bZaba\b/.test(h) && !/\bZaba\b/.test(page); })());
check("heading is the scoreboard's heading: it sits right before the aria-live body, and there is one 'Recent earnings' section only", /<h3 class="zt-board-title">[\s\S]*?<\/h3>\s*<div id="ztHoldersBody" aria-live="polite"/.test(sec) && (html.match(/Recent earnings/g) || []).length === 1);
check("mobile styles present (row grid, ellipsis for long names, small-screen media query)", /#zab \.zt-h-name\{[^}]*text-overflow:ellipsis/.test(html) && /@media \(max-width:480px\)\{#zab \.zt-board/.test(html));
check("the static /zab page has no 'Recent earnings' section (balances are loaded only on the main page)", !/Recent earnings/.test(fs.readFileSync(path.join(__dirname, "..", "zab.html"), "utf8")));

// ---- wiring: existing zabBoard read only, states, no new data exposure
const fn = (name) => { const i = html.indexOf("function " + name + "("); const e = html.indexOf("\n", i); const l = html.slice(i, e); return /\}\s*$/.test(l) && l.split("{").length === l.split("}").length ? l : html.slice(i, html.indexOf("\n}", i) + 2); };
{ const el = { innerHTML: "" }, ctx = { $: () => el, ZT: Z, escapeHtml: (x) => String(x) }; vm.createContext(ctx); vm.runInContext(fn("paintHolders"), ctx);
  ctx.paintHolders("loading"); const a = /Loading/.test(el.innerHTML);
  ctx.paintHolders("ok", [E("u1", "Zab", 3), E("u2", "x@y.com", 9)], "u1"); const b = el.innerHTML.indexOf("Zabba #") < el.innerHTML.indexOf(">Zab <em") && !/@/.test(el.innerHTML) && /zt-me/.test(el.innerHTML);
  ctx.paintHolders("empty"); const c = /No ZAB holders/.test(el.innerHTML); ctx.paintHolders("error"); const d = /Couldn/.test(el.innerHTML); ctx.paintHolders("signedout"); const e = /Sign in/.test(el.innerHTML);
  check("paintHolders drives loading / ranked list (own row marked, emails never) / empty / error / signed-out", a && b && c && d && e); }
check("wiring: zabBoard top-10 query (balance high to low) while signed in, error -> error state, empty -> empty state, unsubscribed on sign-out",
  /ztHoldersOff = onSnapshot\(query\(collection\(db, "zabBoard"\), orderBy\("total", "desc"\), limit\(10\)\)[^\n]*paintHolders\(snap\.empty \? "empty" : "ok"[^\n]*u\.uid\), \(\) => paintHolders\("error"\)\)/.test(html) && /if \(ztHoldersOff\) \{ ztHoldersOff\(\); ztHoldersOff = null; \}/.test(html) && /paintHolders\("signedout"\)/.test(html) && /paintHolders\("loading"\)/.test(html));
const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"), zb = rules.slice(rules.indexOf("match /zabBoard/{uid}"), rules.indexOf("match /repBoard/{uid}"));
check("rules untouched in spirit: zabBoard stays signed-in read, name + total only, no '@' allowed", /allow read: if request\.auth != null;/.test(zb) && /hasOnly\(\['uid','name','total','updatedAt'\]\)/.test(zb) && /!b\(\)\.name\.matches\('\.\*@\.\*'\)/.test(zb) && !/allow read: if true/.test(zb));
check("no email field is ever read for the scoreboard (holders code never touches 'email')", !/email/i.test(fn("paintHolders")) && !/email/i.test(Z.holdersHtml.toString() + Z.holdersView.toString() + Z.holderName.toString().replace(/@|email-looking/gi, "")));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
