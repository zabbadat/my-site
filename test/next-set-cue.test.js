// Universal between-set cue: "Set up, go on three. One, two, three, go." (7.6 s, clock at Go), every mode, plus arcade top strips.
// Run: node test/next-set-cue.test.js
const fs = require("fs"), path = require("path");
const G = require("../get-set.js"), BR = require("../battle-rooms.js");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (extra ? "  " + extra : "")); };

check("setup line, lead, counts, and total", G.NEXT_SET_LINE === "Set up, go on three." && G.NEXT_LEAD_MS === 4000 && G.NEXT_COUNT_MS === 3600 && G.NEXT_TOTAL_MS === 7600);
check("counts are One, two, three, Go at 1.2 s; clock at Go", JSON.stringify(G.NEXT_STEPS) === JSON.stringify([[0, "One", "1"], [1200, "two", "2"], [2400, "three", "3"], [3600, "Go", "GO"]]));
check("STEPS / QUICK / makeQuickCountdown / makeGoCountdown all use the 7.6 s cue", G.COUNTDOWN_MS === 7600 && G.QUICK_MS === 7600 && G.STEPS[0][1] === G.NEXT_SET_LINE && G.STEPS[G.STEPS.length - 1][0] === 7600 && G.makeGoCountdown().ms === 7600 && G.makeQuickCountdown().ms === 7600 && G.makeNextSetCountdown().ms === 7600);
check("plank counts share One / two / three / Go; clock starts at Go (setup line is spoken before lock-in)", JSON.stringify(G.PLANK_STEPS) === JSON.stringify(G.NEXT_STEPS) && G.PLANK_COUNT_MS === 3600 && G.COACH.plank.next === G.NEXT_SET_LINE);

{ const said = [], shown = [], q = [];
  const g = G.makeNextSetCountdown({ speak: (w) => said.push(w), unlock() {}, schedule: (f, d) => q.push([f, d]) });
  g.run((t) => shown.push(t));
  const gaps = []; while (q.length) { const [f, d] = q.shift(); gaps.push(d); f(); }
  check("makeNextSetCountdown speaks the full cue and ends on Go", said.join("|") === "Set up, go on three.|One|two|three|Go" && shown.join("|") === "Set up, go on three.|1|2|3|GO" && gaps.join(",") === "4000,1200,1200,1200"); }

check("page uses makeNextSetCountdown with a short idle wait so Set complete. can finish", /makeNextSetCountdown\(\{ waitIdleMaxMs: 2500 \}\)/.test(html));
check("TUT battles use a 7.6 s lead so the same cue fits before startAt; plank battles stay at 5 s", /leadMs: \(window\.ZabbadatGetSet && window\.ZabbadatGetSet\.NEXT_TOTAL_MS\) \|\| 7600/.test(html) && /function tbNextSetCue\(r, st\)/.test(html) && !/controller\(pbFs[\s\S]{0,120}leadMs/.test(html) && BR.LEAD_MS === 5000);
check("unlock no longer cancels speech (Set complete. is not cut off on the next Start)", /function defaultUnlock\(\) \{ var w = g\(\); if \(!w \|\| !w.speechSynthesis\) return; utter\(" ", 0\); \}/.test(fs.readFileSync(path.join(__dirname, "../get-set.js"), "utf8")));
check("fail line is spoken before finish / void cancel paths", /function speakSetDone\(\)/.test(html) && /if \(!\(opts && opts.alreadySpoke\)\)/.test(html) && /freshPushSet\(\{ keepSpeech: true \}\)/.test(html) && /cancelGetSet\(opts && opts.keepSpeech\)/.test(html));

check("Press Start 2P is loaded and used on the arcade strips", /family=Press\+Start\+2P/.test(html) && /font-family:"Press Start 2P"/.test(html));
check("session, camera, and plank strips sit above the video (not overlaid on the body) with safe-area padding", /id="sessionStrip" class="arcade-strip"/.test(html) && /#sessionStrip\{position:fixed;top:0/.test(html) && /padding-top:calc\(.45rem \+ env\(safe-area-inset-top,0px\)\)/.test(html) && /id="camHud"/.test(html) && html.indexOf('id="camHud"') < html.indexOf('id="camVid"') && /id="plankHud"/.test(html) && html.indexOf('id="plankHud"') < html.indexOf('id="plankVid"') && /id="plankStage"/.test(html) && html.indexOf('id="plankStage"') < html.indexOf('id="plankVid"') && /function paintArcadeStrip\(/.test(html) && /body\.arcade-live\{padding-top:calc\(env\(safe-area-inset-top,0px\) \+ 5.6rem\)\}/.test(html));
check("fullscreen camera is a column so the strip stays above the shrunk video", /#camWrap:fullscreen,#camWrap:-webkit-full-screen,#camWrap.cam-fs\{[^}]*flex-direction:column/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
