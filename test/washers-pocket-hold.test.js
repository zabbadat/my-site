// Washers pocket game: no Pause, 0.6s hold with fill, Hold to score. Run: node test/washers-pocket-hold.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };

const playStart = html.indexOf('<section id="play">');
const play = html.slice(playStart, html.indexOf("</section>", playStart));
check("Pause button is gone from #play", !/id="pauseBtn"/.test(play) && !/\$\("pauseBtn"\)/.test(html));
check("Start and Reset stay in #play", /id="startBtn"/.test(play) && /id="resetBtn"/.test(play));
check("WASHERS_HOLD_MS is 600", /const WASHERS_HOLD_MS = 600/.test(html));
check("startBtn bindHold uses 0.6s, fill, and Hold to score", (() => {
  const i = html.indexOf('bindHold($("startBtn")');
  const s = html.slice(i, html.indexOf("async function pauseGame"));
  return /holdMs:\s*WASHERS_HOLD_MS/.test(s) && /fill:\s*true/.test(s) && /Hold to score/.test(s) && /pauseGame\(\)/.test(s);
})());
check("fill on web routes the washers hold through bindHoldNative (no pointerleave cancel)",
  /\|\| \(o && o\.fill\)\) \{ bindHoldNative\(btn, o\); return; \}/.test(html) &&
  /Do not cancel on pointerleave/.test(html));
check("pocket lock copy uses 0.6 seconds",
  /Hold to score for 0\.6 seconds to unlock and score a pack/.test(html) &&
  /While unlocked, hold 0\.6 seconds to end the game/.test(html) &&
  (html.match(/Hold to score for 0\.6 seconds to unlock/g) || []).length >= 2);
check("locked and unlocked status lines",
  /setStatus\(pocketOn \? "Locked\. Hold to score for 0\.6 seconds to unlock\." : "Hold to stop for 0\.6 seconds to end the game\."\)/.test(html) &&
  /setStatus\("Unlocked\. Score the pack\."\)/.test(html));
check("unlocked hold ends the game via pauseGame",
  /else \{ setPocket\(false\); pauseGame\(\); \}/.test(html) &&
  /async function pauseGame\(\)/.test(html));
check("battle stops use pauseGame, not a Pause button",
  /setPocket\(false\); pauseGame\(\); setStatus\("Battle over\./.test(html) &&
  (html.match(/pauseGame\(\)/g) || []).length >= 3);
check("native app pocket note also uses 0.6 seconds",
  /the phone's step counter keeps counting[\s\S]{0,240}Hold to score for 0\.6 seconds/.test(html));

const ok = R.every(Boolean);
console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(ok ? 0 : 1);
