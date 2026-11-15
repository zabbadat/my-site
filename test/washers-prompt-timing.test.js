// Zabba Washer Battle in-game prompt lead times: 3 s get-set + spoken/shown 3-2-1, then GO.
// Floor drop-downs (push-up / plank) are not part of this game; their cues are unchanged.
// Run: node test/washers-prompt-timing.test.js
const fs = require("fs"), path = require("path");
const G = require("../get-set.js"), BR = require("../battle-rooms.js"), AR = require("../washers-arena.js"), A = require("../washers-arcade.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const R = []; const check = (n, ok, extra) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? "  " + extra : ""}`); R.push(!!ok); };

check("1v1 and 2v2 share a 6 s lead (3 s get-set + 3-2-1); default battle-rooms lead stays 5 s for plank", AR.LEAD_MS === 6000 && BR.LEAD_MS === 5000 && /leadMs: WB_LEAD_MS/.test(html) && /WB_LEAD_MS = \(window\.ZabbaArena && window\.ZabbaArena\.LEAD_MS\) \|\| 6000/.test(html));
check("TUT battle still uses the 7.6 s next-set cue lead; plank battles stay on the 5 s default", /leadMs: \(window\.ZabbadatGetSet && window\.ZabbadatGetSet\.NEXT_TOTAL_MS\) \|\| 7600/.test(html) && !/controller\(pbFs[\s\S]{0,200}leadMs/.test(html) && !/controller\(battleFs[\s\S]{0,200}leadMs/.test(html));

// With startAt = now + 6000: n stays 5 (READY) for 2 s, 4 (SET) for 1 s, then 3, 2, 1, GO
const T0 = 10000, startAt = T0 + 6000;
const at = (ms) => BR.countdownState(startAt, T0 + ms, 0);
check("t=0..1999: READY (get-set)", at(0).phase === "countdown" && at(0).n === 5 && at(1999).n === 5 && A.countdownLabel(at(0)) === "READY");
check("t=2000..2999: SET (get-set continues)", at(2000).n === 4 && at(2999).n === 4 && A.countdownLabel(at(2000)) === "SET");
check("t=3000,4000,5000: 3, 2, 1", at(3000).n === 3 && at(4000).n === 2 && at(5000).n === 1 && A.countdownLabel(at(3000)) === "3" && A.countdownLabel(at(5000)) === "1");
check("t=6000: GO, then live after GO_MS", at(6000).phase === "go" && A.countdownLabel(at(6000)) === "GO!" && at(6000 + 1200).phase === "live");

const said = []; const v = G.makeBattleVoice({ speak: (w) => said.push(w) });
for (let ms = 0; ms <= 7500; ms += 100) { const st = at(ms); v.phase("washers:TEST:" + startAt, st.phase, st.n); }
check("spoken: Ready, get set · three · two · one · Go", said.join("|") === "Ready, get set|three|two|one|Go");

check("status wording unchanged: Get set to pitch… during countdown (1v1 and 2v2)", /if \(st\.phase === "countdown"\) \{ c\.textContent = \(ARC && ARC\.countdownLabel\(st\)\) \|\| st\.n; wbStat\("Get set to pitch…"\); \}/.test(html) && (html.match(/wbStat\("Get set to pitch…"\)/g) || []).length === 2);
check("on-screen count uses READY / SET / 3 / 2 / 1, not a raw 5 during the extra get-set", /battleVoice\.phase\("washers:/.test(html) && /battleVoice\.phase\("arena:/.test(html) && (html.match(/ARC\.countdownLabel\(st\)/g) || []).length === 2);
check("solo Start game still has no drop-for-push-up / plank prompt (practice washers stays a pitch-and-walk game)", !/drop into|get down|push-up position|plank position/.test(html.match(/function wbStartGame\(\)[\s\S]*?\n\}/)[0] + html.match(/\$\("startBtn"\)\.onclick = \(\) => \{[\s\S]*?\n\};/)[0]));

const f = R.filter((x) => !x).length; console.log(`\n${R.length - f}/${R.length} passed`); process.exit(f ? 1 : 0);
