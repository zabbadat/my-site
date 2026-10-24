// Battles: spoken "Ready, get set" at the shared countdown and "Go" at GO (once per room start); TUT battle reps count up.
const G = require("../get-set.js"), B = require("../battle-rooms.js"), fs = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const said = []; const v = G.makeBattleVoice({ speak: (w) => said.push(w) });
for (let t = 0; t <= 7000; t += 100) v.phase("tut:K7QX:10000", B.countdownState(10000, 5000 + t, 0).phase);
check("one 'Ready, get set' when the 5 s countdown appears, one 'Go' at GO", said.join("|") === "Ready, get set|Go" && B.LEAD_MS === 5000);
v.phase("tut:K7QX:99000", "countdown"); check("rematch / new start speaks again", said.slice(-1)[0] === "Ready, get set");
const late = []; const v2 = G.makeBattleVoice({ speak: (w) => late.push(w) }); v2.phase("x", "live"); check("rejoin after GO: silent", late.length === 0);
const v3 = G.makeBattleVoice({ speak: () => { throw new Error("no speech"); } }); let ok = true; try { v3.phase("y", "countdown"); v3.phase("y", "go"); } catch (e) { ok = false; } check("silent fallback when speech throws", ok);
const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
check("wired in Plank, TUT (shared countdown voice) and Zabba Washer Battle ticks", /pbVoice\.phase\("plank:/.test(html) && /tbVoice\.phase\("tut:/.test(html) && /battleVoice\.phase\("washers:/.test(html));
check("unlocked inside each I'm ready tap (Plank, TUT via unlockGetSet; Washer via battleVoice)", (html.match(/return; unlockGetSet\(\);/g) || []).length >= 2 && /\$\("wbReady"\)\.onclick = async \(\) => \{ if \(!requireSignIn\("washer battle"\)\) return; if \(battleVoice\) battleVoice\.unlock\(\);/.test(html));
check("TUT battle reps spoken counting up", /tbRepVoice\.say\(String\(c\.reps\)\)/.test(html));
const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
