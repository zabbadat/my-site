// "Send Zab" tab sits inside the ZAB balance card (home #zab .stat and /bank balance line), ring label, opens the send form.
const fs = require("fs"), R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const home = fs.readFileSync(__dirname + "/../index.html", "utf8"), bank = fs.readFileSync(__dirname + "/../bank.html", "utf8");
const card = (home.match(/<div class="stat"><span class="zt-bag-label"[\s\S]*?Your balance<\/span><\/div>/) || [""])[0];
check("home: tab directly under the ZAB+ring amount (#ztBalance), outside it so repaints keep it", /<b id="ztBalance">—<\/b><a class="zt-send-tab" id="ztSendTab"/.test(card));
check("home: tab label is Send + ZAB with ring", /id="ztSendTab"[^>]*>Send <span class="zab">ZAB<svg class="zab-ring"/.test(card));
check("home: signed in -> /bank#bankSend, signed out -> #play", /ztSendTab"\); if \(st\) st\.setAttribute\("href", on \? "\/bank#bankSend" : "#play"\)/.test(home));
check("bank: tab directly under the ZAB+ring balance (#bankMine)", /<span class="zt-bal-row"><span id="bankMine">[^<]*<\/span><a class="zt-send-tab" id="bankSendTab" href="#bankSend"[^>]*>Send <span class="zab">ZAB<svg class="zab-ring"/.test(bank));
check("bank: tab reveals + scrolls to the form, signed out prompts sign-in", /\$\("bankSend"\)\.hidden = false; \$\("bankSend"\)\.scrollIntoView/.test(bank) && /bankSendSignIn"\)\.hidden = false/.test(bank) && /location\.hash === "#bankSend"\) openSend\(\)/.test(bank));
check("tab stacked under the ring (column, right-aligned) on both pages", [home, bank].every((h) => /\.zt-bal-row \{ display: inline-flex; flex-direction: column; align-items: flex-end;/.test(h)));
const fail = R.filter((x) => !x).length; console.log(`${R.length - fail}/${R.length} passed`); process.exit(fail ? 1 : 0);
