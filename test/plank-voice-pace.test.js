const G = require("../get-set.js"), fs = require("fs"), path = require("path");
let pass = 0, fail = 0;
function check(n, ok) { console.log((ok ? "PASS " : "FAIL ") + n); ok ? pass++ : fail++; }
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
check("one site-wide voice: relaxed rate 0.85-0.9, default pitch, no chosen voice; plank uses the same", G.VOICE.rate >= 0.85 && G.VOICE.rate <= 0.9 && !("pitch" in G.VOICE) && !("voice" in G.VOICE) && G.PLANK_VOICE === G.VOICE);
check("plank countdown is 1.2 s per step, ending on Go at 3.6 s", JSON.stringify(G.PLANK_STEPS.map((s) => s[0])) === "[0,1200,2400,3600]" && G.PLANK_STEPS[3][2] === "GO");
check("plank counts match the shared go-cue; digits on screen unchanged", G.PLANK_STEPS.map((s) => s[1]).join(" ") === "One two three Go" && G.PLANK_STEPS.map((s) => s[2]).join(" ") === "1 2 3 GO");
global.window = { speechSynthesis: { speaking: true, pending: false, cancelled: 0, spoken: [], cancel() { this.cancelled++; }, speak(u) { this.spoken.push(u); } }, SpeechSynthesisUtterance: function (t) { this.text = t; } };
G.plankSpeak("Go");
const ss = window.speechSynthesis, u = ss.spoken[0];
check("plankSpeak queues behind current speech, never cancels", ss.cancelled === 0 && u && u.text === "Go" && u.rate === 0.88 && u.pitch === undefined && u.voice === undefined);
check("plank countdown in the page uses the plank voice and never stops speech between steps", /makeGoCountdown\(\{ steps: window\.ZabbadatGetSet\.PLANK_STEPS, speak: window\.ZabbadatGetSet\.plankSpeak, stop: \(\) => \{\} \}\)/.test(html));
check("plank coaching lines are spoken with the plank voice, queued", /kind === "plank" && G && G\.PLANK_VOICE \? \{ queue: true \}/.test(html));
check("push-up / TUT go-cue timings", JSON.stringify(G.STEPS.map((s) => s[0])) === "[0,4000,5200,6400,7600]");
window.speechSynthesis.spoken = []; G.interruptSpeak("5"); G.makeGoCountdown({ schedule: () => {} }).run(() => {});
check("push-up / TUT / battle cues use the same voice rate", window.speechSynthesis.spoken.length >= 1 && window.speechSynthesis.spoken.every((x) => x.rate === G.VOICE.rate && x.pitch === undefined));
check("plank lead-in: ~4 s after the get-into-plank line before One, two, three, Go", /PLANK_LEAD_MS = \(window\.ZabbadatGetSet && window\.ZabbadatGetSet\.NEXT_LEAD_MS\) \|\| 4000/.test(html) && /plankLeadUntil = performance\.now\(\) \+ PLANK_LEAD_MS/.test(html) && /performance\.now\(\) >= plankLeadUntil/.test(html));
check("no speech code outside get-set.js picks a voice", !/\.voice\s*=/.test(html + fs.readFileSync(path.join(__dirname, "..", "get-set.js"), "utf8")));
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
