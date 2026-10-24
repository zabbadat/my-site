// Header badge #ztBadge: "<name> \u00b7 <n> ZAB (ring)" when signed in (name = leaderboard publicName, never an email); "Sign in" when signed out.
const fs = require("fs"), path = require("path"), vm = require("vm"), ZT = require("../zab-balance.js"), ZC = require("../zab-currency.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const fn = (name) => { const i = html.indexOf("function " + name + "("); const e = html.indexOf("\n", i); const l = html.slice(i, e); return /\}\s*$/.test(l) && l.split("{").length === l.split("}").length ? l : html.slice(i, html.indexOf("\n}", i) + 2); };
check("badge parts: grouped number, name never an email", ZT.badgeParts("Zab", 1234).amount === "1,234" && ZT.badgeParts("Zab", 0).amount === "0" && ZT.badgeParts("zab@example.com", 3).name === "Player" && ZT.badgeParts("", 3).name === "Player");
check("long names truncated with an ellipsis (board entries)", ZT.badgeParts("Bartholomew Montgomery-Smith", 3).name === "Bartholomew Mon\u2026" && ZT.badgeParts("Bartholomew Montgomery-Smith", 3).name.length === 16);
function env(user) {
  const attrs = {}, log = []; const els = { ztBadge: { textContent: "Sign in", innerHTML: "", title: "", attrs, setAttribute(k, v) { attrs[k] = v; } }, ztBalance: { innerHTML: "" }, ztSignedOut: { hidden: false },
    play: { scrollIntoView: (o) => log.push("scroll:" + o.block) }, signInBtn: { focus: () => log.push("focus") } };
  const ctx = { $: (id) => els[id] || null, ZT, window: { ZabCurrency: ZC }, escapeHtml: (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;"), auth: { currentUser: user }, setTimeout: (f) => f(), log, Number, String, document: {} };
  vm.createContext(ctx); vm.runInContext([fn("publicName"), fn("displayNameOf"), fn("paintZabSection"), fn("ztBadgeClick")].join("\n"), ctx); return { ctx, g: els.ztBadge, log };
}
{ const e = env({ displayName: "Zab", email: "z@x.com" }); e.ctx.paintZabSection(12);
  check("signed in: '<name> \u00b7 <n> ZAB' + ring, no email", /^<span class="zt-name">Zab<\/span> \u00b7 <span class="zab">12 ZAB<svg class="zab-ring"[\s\S]*<\/svg><\/span>$/.test(e.g.innerHTML) && !/@|Zabba Bag/.test(e.g.innerHTML)); }
{ const e = env({ displayName: "", email: "zabfan@example.com" }); e.ctx.paintZabSection(5);
  check("no display name: email local part like leaderboards, never the full email", /^<span class="zt-name">zabfan<\/span>/.test(e.g.innerHTML) && !/@/.test(e.g.innerHTML)); }
{ const e = env({ displayName: "<b>x</b>" }); e.ctx.paintZabSection(1); check("name is escaped", !/<b>/.test(e.g.innerHTML)); }
{ const e = env(null); e.ctx.paintZabSection(null); check("signed out unchanged: 'Sign in'", e.g.textContent === "Sign in" && e.g.attrs["aria-label"] === "Sign in"); }
{ const e = env({ displayName: "Zab" }); e.ctx.paintZabSection(3); let pd = 0; e.ctx.ztBadgeClick({ preventDefault: () => pd++ });
  check("signed in: badge links to #zab, click not intercepted", e.g.attrs.href === "#zab" && e.g.attrs["aria-label"] === "ZAB balance" && pd === 0 && !e.log.length); }
{ const e = env(null); e.ctx.paintZabSection(null); let pd = 0; e.ctx.ztBadgeClick({ preventDefault: () => pd++ });
  check("signed out: badge links to #play, scrolls to the sign-in box and focuses the Google button", e.g.attrs.href === "#play" && pd === 1 && e.log.join(",") === "scroll:start,focus"); }
check("static: badge defaults to #play / Sign in; click handler wired", html.includes('<a class="zt-badge" id="ztBadge" href="#play" aria-label="Sign in">Sign in</a>') && html.includes('$("ztBadge").onclick = ztBadgeClick;'));
check("the ZAB page label stays above #ztBalance, styled like the stat labels", html.includes('<div class="stat"><span class="zt-bag-label" id="ztBagLabel">ZAB bag</span><b id="ztBalance">') && /\.stat \.zt-bag-label \{ display:/.test(html));
check("header badge no longer says 'Zabba Bag:' and the name has a CSS ellipsis", !/Zabba Bag:/.test(html) && /\.zt-badge \.zt-name\{[^}]*text-overflow:ellipsis/.test(html));
check("user-facing spelling Zabba", !/Zaba Bag|Zaba ZAB/.test(html + fs.readFileSync(path.join(__dirname, "..", "zab-balance.js"), "utf8")));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
