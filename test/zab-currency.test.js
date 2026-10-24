// ZAB display name + washer ring: markup, amounts, speech ("Zab"), every user-facing place, internal ids untouched.
const C = require("../zab-currency.js"), fs = require("fs"), P = (f) => fs.readFileSync(__dirname + "/../" + f, "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
check("ring: outer r=10 + hole r=3.6, stroke 2.6, currentColor, aria-hidden, viewBox 24", /viewBox="0 0 24 24"/.test(C.RING) && /r="10"/.test(C.RING) && /r="3\.6"/.test(C.RING) && (C.RING.match(/stroke-width="2\.6"/g) || []).length === 2 && /stroke="currentColor"/.test(C.RING) && /aria-hidden="true"/.test(C.RING) && /focusable="false"/.test(C.RING));
check("amount reads label then ring: 5 ZAB (ring)", C.amountHtml(5) === '<span class="zab">5 ZAB' + C.RING + "</span>" && C.amountText(5) === "5 ZAB" && /1,204 ZAB/.test(C.amountHtml(1204)));
check("html(): every ZAB word gets a ring, text is escaped", (C.html("Pot 4 ZAB and 2 ZAB <b>").match(/zab-ring/g) || []).length === 2 && /&lt;b&gt;/.test(C.html("<b>")) && C.html("ZABBA") === "ZABBA" && C.html("Zabba") === "Zabba");
check("ring() adds the icon once to plain text", (() => { const el = { textContent: "Bet 3 ZAB", innerHTML: "", querySelector: () => (/zab-ring/.test(el.innerHTML) ? {} : null) }; C.ring(el); const a = el.innerHTML; C.ring(el); return /zab-ring/.test(a) && el.innerHTML === a; })());
check("speech says Zab, never spelled out", C.spoken("You won 5 ZAB.") === "You won 5 Zab." && C.spoken("ZABBA") === "ZABBA");
{ let said = []; global.window = { speechSynthesis: { speak: (u) => said.push(u.text), cancel() {} }, SpeechSynthesisUtterance: function (t) { this.text = t; } };
  const GS = require("../get-set.js"); const v = GS.makeHoldVoice ? null : null; delete global.window;
  const src = P("get-set.js"); check("get-set speech: both utterance paths normalise ZAB -> Zab", /function say\(t\)[^\n]*"Zab"/.test(src) && (src.match(/SpeechSynthesisUtterance\(say\(text\)\)/g) || []).length === 2); }
const html = P("index.html"), rules = P("rules.html"), vis = (h) => h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ");
check("page text: no old currency wording (Zabba/Zaba + the old currency noun)", !/Zab+a Tok[e]ns?/i.test(vis(html)) && !/Zab+a Tok[e]ns?/i.test(vis(rules)) && !/Zab+a Tok[e]ns?/.test(html));
check("nav, ZAB heading, table header, row label use ZAB + ring", (html.match(/<span class="zab">ZAB<svg class="zab-ring"/g) || []).length >= 5 && /on \? "ZAB balance" : "Sign in"/.test(html));
check("header badge shows '<name> · <n> ZAB (ring)' when signed in, Sign in otherwise", /window\.ZabCurrency\.amountHtml\(Number\(n\)\)\);? ?g\.title|zt-name[\s\S]*amountHtml\(Number\(n\)\)/.test(html) && /g\.textContent = "Sign in"/.test(html) && !/ ZT"/.test(html));
check("balance on the ZAB page uses the ring amount", /b\.innerHTML = on \? window\.ZabCurrency\.amountHtml/.test(html));
check("wager text: stake label, confirm, pot line, stake button, errors say ZAB", /Bet ZAB<svg/.test(html) && /" ZAB each\. Winner/.test(html) && /Lock in " \+ r\.stake \+ " ZAB"/.test(html) && /Not enough ZAB: you have/.test(P("zaba-wager.js")) && /Pot: " \+ pot\(w\.stake\) \+ " ZAB"/.test(P("zaba-wager.js")));
check("status lines (set / push-up / plank / walk) and battle status get rings", (html.match(/zabRing\(\$\("(status|pushStatus|plankStatus|walkStatus)"\)\)/g) || []).length === 4 && /window\.ZabCurrency\.set\(\$\("wbStatus"\)/.test(html));
check("earn rates, empty state, sign-in gate say ZAB", /= 1 ZAB/.test(P("zab-balance.js")) && /No ZAB earned yet/.test(P("zab-balance.js")) && /steps and ZAB\./.test(P("signin-gate.js")));
check("CSS matches the approved preview (inline-flex, .28em gap, .95em ring)", /\.zab\{display:inline-flex;align-items:center;gap:\.28em;font-weight:700;letter-spacing:\.06em/.test(html) && /\.zab-ring\{width:\.95em;height:\.95em/.test(html));
check("internal ids use the new neutral names (zabBalance, zabLedger, ZabBalance, zab-balance.js)", html.includes('id="zabBalanceRow"') && html.includes('id="zabaBal"') && /window\.ZabBalance/.test(html) && /zabBalance/.test(P("zab-balance.js")) && /zabLedger/.test(html) && fs.existsSync(__dirname + "/../zab-balance.js"));
check("Zabba Bag name not touched by the rename (not present on this branch's header)", !/ZAB Bag/.test(html));
const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
