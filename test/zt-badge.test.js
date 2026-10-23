// Header badge #ztBadge: "<leaderboard name> · Zabba Bag: <total>" when signed in; "Sign in" when signed out.
const fs = require("fs"), path = require("path"), vm = require("vm"), ZT = require("../zaba-tokens.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const fn = (name) => { const i = html.indexOf("function " + name + "("); const e = html.indexOf("\n", i); const l = html.slice(i, e); return /\}\s*$/.test(l) && l.split("{").length === l.split("}").length ? l : html.slice(i, html.indexOf("\n}", i) + 2); };
check("format", ZT.badgeText("Zab", 12) === "Zab \u00b7 Zabba Bag: 12" && ZT.badgeText("Zab", 1) === "Zab \u00b7 Zabba Bag: 1" && ZT.badgeText("Zab", 1234) === "Zab \u00b7 Zabba Bag: 1,234" && ZT.badgeText("Zab", 0) === "Zab \u00b7 Zabba Bag: 0");
check("long names truncated with an ellipsis", ZT.badgeParts("Bartholomew Montgomery-Smith", 3).name === "Bartholomew Mon\u2026" && ZT.badgeParts("Bartholomew Montgomery-Smith", 3).name.length === 16);
check("never an email", ZT.badgeParts("zab@example.com", 3).name === "Player" && ZT.badgeParts("", 3).name === "Player");
function env(user) {
  const attrs = {}, log = []; const els = { ztBadge: { textContent: "Sign in", innerHTML: "", title: "", attrs, setAttribute(k, v) { attrs[k] = v; } },
    play: { scrollIntoView: (o) => log.push("scroll:" + o.block) }, signInBtn: { focus: () => log.push("focus") } };
  const ctx = { $: (id) => els[id] || null, ZT, auth: { currentUser: user }, setTimeout: (f) => f(), log, escapeHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"), Number, String };
  vm.createContext(ctx); vm.runInContext([fn("publicName"), fn("displayNameOf"), fn("paintTokenSection"), fn("ztBadgeClick")].join("\n"), ctx); return { ctx, g: els.ztBadge, log };
}
{ const e = env({ displayName: "Zab", email: "z@x.com" }); e.ctx.paintTokenSection(12);
  check("signed in: name + Zabba Bag", e.g.innerHTML === '<span class="zt-name">Zab</span> \u00b7 Zabba Bag: 12'); }
{ const e = env({ displayName: "", email: "zabfan@example.com" }); e.ctx.paintTokenSection(5);
  check("no display name: same as leaderboards (email local part), never the full email", /^<span class="zt-name">zabfan<\/span>/.test(e.g.innerHTML) && !/@/.test(e.g.innerHTML)); }
{ const e = env({ displayName: "<b>x</b>" }); e.ctx.paintTokenSection(1); check("name is escaped", !/<b>/.test(e.g.innerHTML)); }
{ const e = env(null); e.ctx.paintTokenSection(null); check("signed out unchanged: 'Sign in'", e.g.textContent === "Sign in"); }
{ const e = env({ displayName: "Zab" }); e.ctx.paintTokenSection(3); let pd = 0; e.ctx.ztBadgeClick({ preventDefault: () => pd++ });
  check("signed in: badge links to #tokens, click not intercepted", e.g.attrs.href === "#tokens" && pd === 0 && !e.log.length); }
{ const e = env(null); e.ctx.paintTokenSection(null); let pd = 0; e.ctx.ztBadgeClick({ preventDefault: () => pd++ });
  check("signed out: badge links to #play, scrolls to the sign-in box and focuses the Google button", e.g.attrs.href === "#play" && pd === 1 && e.log.join(",") === "scroll:start,focus"); }
check("static: badge defaults to #play / Sign in; click handler wired", html.includes('<a class="zt-badge" id="ztBadge" href="#play" aria-label="Sign in">Sign in</a>') && html.includes('$("ztBadge").onclick = ztBadgeClick;'));
check("Zabba Bag label directly above #ztBalance, styled like the stat labels", html.includes('<div class="stat"><span class="zt-bag-label" id="ztBagLabel">Zabba Bag</span><b id="ztBalance">') && /\.stat \.zt-bag-label \{ display: block;/.test(html));
check("CSS ellipsis on the name", /\.zt-badge \.zt-name\{[^}]*text-overflow:ellipsis/.test(html));
check("user-facing spelling Zabba", !/Zaba Bag|Zaba Token/.test(html + fs.readFileSync(path.join(__dirname, "..", "zaba-tokens.js"), "utf8")));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
