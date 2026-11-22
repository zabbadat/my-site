// Plank instructions (spoken + on-screen) walk through the side-view setup and what ends the hold. Run: node test/plank-copy.test.js
const fs = require("fs"), path = require("path");
const rd = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const G = require("../get-set.js"), P = require("../plank-session.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const C = G.COACH.plank, words = (t) => t.trim().split(/\s+/).length;
check("spoken place line (in the tap)", C.place === "Phone on the floor, on its side, off to your side.");
check("spoken criteria line (camera up)", C.criteria === "Step back until you're head to heels.");
check("spoken rules line (fresh start only)", C.rules === "Sagging, piking, knees down, standing up or leaving the frame ends it.");
check("each spoken line is short enough to finish inside the 10 s speech cap (<= 22 words)", [C.place, C.criteria, C.rules, C.clock, C.next].every((l) => words(l) <= 22));
check("the lines cover the walk-through: phone on the floor on its side, step back head to heels; setup does not preview the countdown", /on the floor, on its side, off to your side/.test(C.place) && /Step back until you're head to heels/.test(C.criteria) && !/3, 2, 1, Hold/.test(C.criteria) && !C.cue);
check("the rules line names every hold-ender", ["sagging", "piking", "knees down", "standing up", "leaving the frame"].every((w) => C.rules.toLowerCase().includes(w)));
check("on-screen setup prompt (get-set.js POSITION.plank) matches", G.POSITION.plank.length <= 2 && G.POSITION.plank[0] === C.place && G.POSITION.plank[1] === C.criteria);
const html = rd("index.html"), plank = rd("plank.html");
const setup = html.match(/id="plankSetup">([\s\S]*?)<\/p>/)[1], status = html.match(/id="plankStatus"[^>]*>([\s\S]*?)<\/p>/)[1];
check("index.html set-up note: phone on the floor on its side, head to heels in the outline, without previewing the countdown", /Phone on the floor, on its side, off to your side/.test(setup) && /head to heels in the outline/.test(setup) && !/3, 2, 1, Hold/.test(setup));
check("index.html status note names every hold-ender and when the clock starts", /sagging/i.test(status) && /piking/.test(status) && /knees/.test(status) && /standing up/.test(status) && /leaving the frame/.test(status) && /Clock starts on a proper plank/.test(status));
check("after Go the on-screen line repeats what ends the hold; the rules line is spoken once, not on a quick restart", html.includes("Shoulders, hips and ankles in one line. Clock starts on a proper plank. Sagging, piking, knees down, standing up or leaving the frame ends it.") && /if \(!restart && window\.ZabbadatGetSet && window\.ZabbadatGetSet\.plankSpeak\) window\.ZabbadatGetSet\.plankSpeak\(window\.ZabbadatGetSet\.COACH\.plank\.rules\)/.test(html));
check("plank.html describes the same setup and hold-enders", /Prop your phone on the floor, off to your side, sideways or upright/.test(plank) && /outline shows you head to heels/.test(plank) && /Turn to show your side/.test(plank) && /Sagging, piking up, knees down, standing up, or leaving the frame for a second ends the hold/.test(plank));
check("no old plank setup wording left anywhere (a few steps away, screen facing you, Place your phone on the ground)", ![html, plank, rd("get-set.js")].some((t) => /a few steps away, (with the )?screen facing you|Place your phone on the ground|Get your whole body in camera view/.test(t)));
check("framing messages shown on screen come from the guide (whole body / turn / sideways)", P.MSG.whole === "Step back until your whole body fits" && html.includes('"Step back until your whole body fits"') && /r\.framing\.msg/.test(html));
check("plank stays side-view only: no front-view or placement choice text", !/front-facing|lean your phone/i.test(C.place + C.criteria + C.rules + setup + status));
check("push-up copy is unchanged (leaned-up front-facing)", G.COACH.pushups.place === "Lean your phone up in front of you, camera facing you." && G.COACH.pushups.criteria === "Shoulders and hands in frame. Go all the way down and back up." && G.COACH.tut.criteria === "Shoulders and hands in frame. Slow, controlled reps, all the way down and back up.");
check("plank page: the Plank House board and ZAB lines are untouched", /Every 60 seconds of plank earns 1 <span class="zab">ZAB/.test(plank) && /honor system, not a form judge/.test(plank));
check("no Ready / get set / go wording left in the plank intro (index set-up + status, plank.html, spoken criteria)", ![setup, status, plank, C.criteria].some((x) => /says go|say go|get set|"Ready"/.test(x)) && /Clock starts/.test(status) && !/3, 2, 1, Hold/.test(status));
check("clock line says when timing starts; next-set line leads into One, two, three, hold", C.clock === "Clock starts on a proper plank." && C.next === "Go on, hold on three.");

const FULL_CUE = "Go on, hold on three. One, two, three, hold.";
check("plank start cue is the exact owner line, once (no doubled count)",
  G.PLANK_SET_LINE + " " + G.PLANK_STEPS.map((s) => s[1]).join(", ") + "." === FULL_CUE
  && (G.PLANK_SET_LINE + " " + G.PLANK_STEPS.map((s) => s[1]).join(", ") + ".").split(/one, two, three, hold/i).length === 2
  && !/one, two, three, hold/i.test(G.PLANK_SIDE_LINE));
check("plank page no longer previews countdown and explains proper plank", !/3, 2, 1, Hold/.test(plank) && /Clock starts on a proper plank/.test(plank));
// Exercise the actual New hold handler with an already-running camera, not a camera-start stub.
const vm = require("vm"), els = {}, said = []; let now = 100;
const ctx = { performance: { now: () => now }, $: (id) => els[id] || (els[id] = {}), window: { ZabbadatPlank: { createPlankHold: () => ({}) }, ZabbadatGetSet: { COACH: G.COACH, plankSpeak: (s) => said.push(s) } } };
vm.createContext(ctx);
vm.runInContext('let plankLoop = true, plankHold, plankSaved = true, plankCueSeq = 9, plankLeadUntil = 0; const PLANK_LEAD_MS = 4000;\n' + html.match(/function newPlankHold\(\) \{[\s\S]*?\n\}/)[0] + '\n' + html.split('\n').find((l) => l.startsWith('$("plankAgainBtn").onclick = ')), ctx);
ctx.$("plankAgainBtn").onclick();
check("New hold resets a single 4 s lead-in and clears saved/cue state", vm.runInContext("plankLeadUntil === 4100 && !plankSaved && plankCueSeq === 0", ctx));
check("New hold speaks next-set intro and restores proper-plank status without camera calls", said.length === 1 && said[0] === C.next && /Clock starts on a proper plank/.test(ctx.$("plankStatus").textContent));
now = 20000; ctx.$("plankAgainBtn").onclick();
check("every subsequent hold gets a fresh lead-in, not an expired or stacked one", vm.runInContext("plankLeadUntil === 24000", ctx) && said.length === 2);
vm.runInContext("plankLoop = false", ctx); ctx.$("plankAgainBtn").onclick();
check("New hold does nothing with the camera stopped", said.length === 2);
const fails = R.filter((x) => !x).length; console.log(`\n${R.length - fails}/${R.length} passed`); process.exit(fails ? 1 : 0);
