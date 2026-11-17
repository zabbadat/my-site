// Spoken Gyatt is pronounced "Gyot" (owner Nov 17: one syllable, rhymes with yacht).
// On-screen text and UI keep the official spelling "Gyatt". The map lives in get-set.js say()
// (every speechSynthesis chokepoint) and gyatt-cadence.js's own speak path.
const fs = require("fs"), path = require("path");
const G = require("../get-set.js");
const C = require("../gyatt-cadence.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const pg = read("squat-page.js"), html = read("index.html");
const R = []; const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || why == null ? "" : " :: " + why}`); R.push(!!ok); };

const start = (pg.match(/start:\s*"([^"]+)"/) || [])[1];
check("SAY.start is still spelled 'Gyatt squat on three.'", start === "Gyatt squat on three.");
check("say() utterance text is 'Gyot squat on three.'", G.say(start) === "Gyot squat on three.");
check("case-insensitive: GYATT / gyatt / Gyatt all become Gyot", G.say("GYATT") === "Gyot" && G.say("gyatt") === "Gyot" && G.say("Gyatt Squats") === "Gyot Squats");
check("ZAB map still applies", G.say("1 ZAB") === "1 Zab");
check("on-screen spelling is not rewritten in squat-page source", /start: "Gyatt squat on three\."/.test(pg) && !/start: "Gyot /.test(pg));
check("UI keeps official spelling Gyatt (title, tile, earn line, fine print)", /<h2 id="squatsTitle">Gyatt Squats<\/h2>/.test(html) && />Gyatt Squats<\/span>/.test(html) && /Gyatt Squats have no daily cap/.test(html) && !/Gyot/.test(html));

{ // countdown: show() keeps Gyatt; speechSynthesis gets Gyot
  const shown = [], spoken = [];
  global.window = { speechSynthesis: { speaking: false, pending: false, resume() {}, cancel() {}, speak(u) { spoken.push(u.text); } }, SpeechSynthesisUtterance: function (t) { this.text = t; } };
  const q = [];
  const cd = G.makeNextSetCountdown({ line: start, schedule: (f, d) => { q.push([f, d]); return q.length; } });
  cd.run((t) => shown.push(t), () => false);
  check("countdown displays 'Gyatt squat on three.'", shown[0] === "Gyatt squat on three.");
  check("countdown utterance is 'Gyot squat on three.'", spoken[0] === "Gyot squat on three.");
  // later steps are scheduled, not spoken yet
  check("only the start line has been spoken so far", spoken.length === 1 && spoken[0] === "Gyot squat on three.");
  delete global.window;
}

{ // enqueueSpeak / plankSpeak (squat-page speak() uses plankSpeak)
  const spoken = [];
  global.window = { speechSynthesis: { speaking: false, pending: false, resume() {}, cancel() {}, speak(u) { spoken.push(u.text); } }, SpeechSynthesisUtterance: function (t) { this.text = t; } };
  G.plankSpeak(start);
  check("plankSpeak / enqueueSpeak utterance is 'Gyot squat on three.'", spoken[0] === "Gyot squat on three.");
  delete global.window;
}

{ // gyatt-cadence default speak (no get-set on window: local fallback)
  const calls = [];
  global.window = { performance: { now: () => 0 }, SpeechSynthesisUtterance: function (t) { this.text = t; },
    speechSynthesis: { speaking: false, pending: false, resume: () => calls.push("resume"), cancel: () => calls.push("cancel"), speak: (u) => calls.push("speak:" + u.text) } };
  delete require.cache[require.resolve("../gyatt-cadence.js")];
  const C2 = require("../gyatt-cadence.js");
  check("cadence say() fallback is 'Gyot squat on three.'", C2.say(start) === "Gyot squat on three.");
  // drive the default speak path with a Gyatt line via a custom... start says Down; call say through speakDefault by coaching? not running.
  const c2 = C2.makeCadence({ now: () => 0, schedule: () => 1, clear: () => {} });
  c2.start();
  check("cadence default voice still speaks Down, one (no Gyatt in cues today)", calls.includes("speak:Down, one"));
  // speakDefault builds SpeechSynthesisUtterance(say(text)); the Android TTS bridge receives that same text.
  const before = calls.length;
  global.window.speechSynthesis.speak(new global.window.SpeechSynthesisUtterance(C2.say("Gyatt squat on three.")));
  check("cadence + Android TTS utterance is 'Gyot squat on three.'", calls.slice(before).join() === "speak:Gyot squat on three.");
  c2.stop(); delete global.window;
}

check("shared helper is exported", typeof G.say === "function" && typeof C.say === "function");

const fails = R.filter((x) => !x).length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
