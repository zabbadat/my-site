// Regression: a failing speechSynthesis must never stop plank tracking. Run: node test/plank-speech-failure.test.js
// Bug: startPlankCam called ZabbadatGetSet.interruptSpeak(rules) unguarded inside its try block. When speak()/cancel() threw
// (iOS NotAllowedError etc.) the catch showed "Camera or pose blocked.", plankLoop never started and nothing was counted.
const fs = require("fs"), path = require("path"), vm = require("vm");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const src = fs.readFileSync(path.join(__dirname, "..", "get-set.js"), "utf8");
function load(ss, withUtter) {
  const win = { speechSynthesis: ss }; if (withUtter !== false) win.SpeechSynthesisUtterance = function (t) { this.text = t; };
  win.window = win; vm.createContext(win); vm.runInContext(src, win); return win.ZabbadatGetSet;
}
const boom = () => { throw new Error("NotAllowedError"); };
const rules = "Hips sagging, hips piking up, knees down, standing up, or leaving the frame for a second ends the hold.";
const noThrow = (G) => { try { G.interruptSpeak(rules); return true; } catch (e) { return false; } };
check("speak() throws (idle synth): interruptSpeak does not throw", noThrow(load({ speaking: false, pending: false, cancel() {}, speak: boom })));
check("cancel() throws while speaking: interruptSpeak does not throw", noThrow(load({ speaking: true, pending: false, cancel: boom, speak() {} })));
check("speechSynthesis getter-less / undefined: no throw", noThrow(load(undefined)));
check("no Utterance constructor: no throw", noThrow(load({ speaking: false, cancel() {}, speak() {} }, false)));
const said = []; const ok = load({ speaking: false, pending: false, cancel() {}, speak: (u) => said.push(u.text) });
ok.interruptSpeak(rules);
check("healthy synth still speaks the line", said.length === 1 && said[0] === rules);
// every caller that uses interruptSpeak as its speaker keeps working with a throwing synth
const G = load({ speaking: false, pending: false, cancel() {}, speak: boom });
let ret; try { const hv = G.makeHoldVoice(); ret = hv.tick(15000); } catch (e) { ret = "threw"; }
check("hold voice tick with a throwing synth does not throw", ret !== "threw");
// page wiring: the rules line is still spoken once after Go on a fresh start, through the (now non-throwing) helper
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
check("startPlankCam still calls interruptSpeak for the rules line", /if \(!restart && window\.ZabbadatGetSet && window\.ZabbadatGetSet\.interruptSpeak\) window\.ZabbadatGetSet\.interruptSpeak\(window\.ZabbadatGetSet\.COACH\.plank\.rules\)/.test(html));
check("get-set.js interruptSpeak body is wrapped in try/catch", /function interruptSpeak\(word\) \{\s*try \{/.test(src));
const fails = R.filter((x) => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);
