// /bank: custom name suggestions + ranking names open a small "Send ZAB" modal (name + amount, Send / Cancel). Never for yourself.
const fs = require("fs"), R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const h = fs.readFileSync(__dirname + "/../bank.html", "utf8");
check("native datalist removed, custom listbox added", !/<datalist/.test(h) && /role="combobox"[^>]*aria-controls="sendSugg"/.test(h) && /<ul id="sendSugg" class="sugg" role="listbox"/.test(h));
check("suggestions keyboard accessible (arrows, Enter, Escape, activedescendant)", /ArrowDown/.test(h) && /ArrowUp/.test(h) && /ev\.key === "Enter" && active >= 0/.test(h) && /Escape/.test(h) && /aria-activedescendant/.test(h));
check("suggestions exclude yourself", /const others = \(\) => rows\.filter\(\(r\) => !r\.me\)/.test(h) && /sugg = q \? others\(\)/.test(h));
check("modal titled Send ZAB with ring, recipient name, amount, Send + Cancel", /<dialog id="sendModal"[\s\S]*?<h2 id="sendModalTitle">Send <span class="zab">ZAB<svg class="zab-ring"[\s\S]*?id="sendModalName"[\s\S]*?id="sendAmt"[\s\S]*?id="sendCancel"[\s\S]*?id="sendBtn">Send</.test(h));
check("one confirm: modal Send posts to zab-send with board id + idempotency key", /JSON\.stringify\(\{ to: t\.uid, amount: amt, key: newKey\(\) \}\)/.test(h) && !/sendConfirm/.test(h) && !/confirm\(/.test(h));
check("ranking names open the modal, not your own row, keyboard too", /if \(!r \|\| r\.me \|\| !signedIn\) return;/.test(h) && /li\.dataset\.pick = r\.uid; li\.tabIndex = 0/.test(h) && /ev\.key !== "Enter" && ev\.key !== " "/.test(h) && /if \(!r \|\| r\.me\) return;/.test(h));
check("modal shows names only (textContent), no email fields", /\$\("sendModalName"\)\.textContent = r\.name/.test(h) && !/email/i.test(h.replace(/never (an )?emails?/gi, "")));
const openers = h.match(/openModal\([a-zA-Z]+\)/g) || [], body = (h.match(/function openModal\(r\) \{[\s\S]*?\n    \}/) || [""])[0];
check("ranking tap and suggestion pick both open the same modal via openModal(row)", /const r = rowFor\(ev\.target\); if \(r\) openModal\(r\)/.test(h) && /const r = sugg\[Number\(li\.dataset\.i\)\]; closeSugg\(\); openModal\(r\)/.test(h) && /const r = sugg\[active\]; closeSugg\(\); openModal\(r\)/.test(h) && openers.length >= 5);
check("modal name is fixed text (not an input), set only in openModal; cursor goes to amount", /<strong id="sendModalName"><\/strong>/.test(h) && (h.match(/sendModalName"\)\.textContent/g) || []).length === 1 && /textContent = r\.name/.test(body) && /\$\("sendAmt"\)\.focus\(\)/.test(body));
const fail = R.filter((x) => !x).length; console.log(`${R.length - fail}/${R.length} passed`); process.exit(fail ? 1 : 0);
