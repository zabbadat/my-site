// Pocket tracking: steps count with the phone in a pocket (any orientation, thigh swing rotation), throws still veto,
// pocket cue speaks in the shared voice + buzzes, the live walk uses the gravity-included magnitude. Run: node test/pocket-tracking.test.js
const S = require("../step-detector.js");
const GS = require("../get-set.js");
const fs = require("fs");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
// synth walk: 1.8 steps/s, 50 Hz, gravity along an arbitrary axis, step impact + thigh swing rotation
function walk(opts) {
  const o = Object.assign({ secs: 20, hz: 50, cad: 1.8, amp: 3, rot: 0, axis: [0.3, 0.5, 0.81], throwAt: [] }, opts);
  const d = S.createStepDetector(); let steps = 0;
  const n = Math.hypot(...o.axis), ax = o.axis.map((v) => v / n);
  for (let i = 0; i < o.secs * o.hz; i++) {
    const t = i * 1000 / o.hz, ph = 2 * Math.PI * o.cad * t / 1000;
    const m = 9.81 + o.amp * Math.sin(ph);
    let w = o.rot ? o.rot * Math.abs(Math.sin(ph / 2)) : 0;
    if (o.throwAt.some((x) => Math.abs(t - x) < 120)) w = 1200;
    steps = d.update({ t, x: ax[0] * m, y: ax[1] * m, z: ax[2] * m, gravity: true, rot: { alpha: w, beta: 0, gamma: 0 } }).steps;
  }
  return steps;
}
const expect = 20 * 1.8;
const hand = walk({});
check("hand-held walk still counts (~36)", hand >= expect - 5 && hand <= expect + 2);
const pocket = walk({ rot: 300, axis: [0.9, -0.1, 0.4] });
check("pocket walk with 300 deg/s thigh swing counts (~36), was vetoed before", pocket >= expect - 6 && pocket <= expect + 2);
const sideways = walk({ rot: 250, axis: [-0.2, 0.95, -0.2], amp: 4 });
check("pocket, upside-down/sideways orientation counts", sideways >= expect - 6 && sideways <= expect + 2);
const thrown = walk({ rot: 0, throwAt: [8000, 14000] });
check("hand-held throw spikes still veto a few steps", thrown < hand);
let still = S.createStepDetector(), st = 0;
for (let i = 0; i < 1000; i++) st = still.update({ t: i * 20, x: 0, y: 0, z: 9.81 + (Math.random() - 0.5) * 0.1, gravity: true, rot: { alpha: 5, beta: 0, gamma: 0 } }).steps;
check("phone sitting still counts 0", st === 0);
// pocket cue
const said = [], buzz = [];
global.window = { speechSynthesis: { speak: (u) => said.push(u), cancel() {} }, SpeechSynthesisUtterance: function (t) { this.text = t; }, navigator: { vibrate: (p) => buzz.push(p) } };
const c = GS.pocketCue();
check("pocket cue spoken in shared voice (rate 0.88)", said.length === 1 && said[0].text === GS.POCKET_LINE && said[0].rate === 0.88);
check("pocket cue buzzes", buzz.length === 1 && c.buzzed && c.spoke);
check("pocket line is breath-first", /Breathe/.test(GS.POCKET_LINE) && /pocket/.test(GS.POCKET_LINE));
global.window = {};
check("pocket cue never throws without speech/vibrate", GS.pocketCue().spoke === false);
delete global.window;
// wiring
const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
check("washers start fires pocket cue and keeps screen lock (setPocket(true))", /pocketCue\(\);\n  render\(\);\n  setPocket\(true\);/.test(html));
check("washers start holds wake lock", /gameWake\.start\(\)/.test(html));
check("live walk start fires pocket cue", /beginWalk\(\); setWalkLock\(true\);[^\n]*pocketCue\(\)/.test(html));
const ds = fs.readFileSync(__dirname + "/../daily-steps.js", "utf8");
check("live walk prefers gravity-included magnitude, skips null axes", /g && g\.x != null\) \? g : e\.acceleration/.test(ds));
check("no 'screen on' hand-held instruction in steps copy", !/stays open with the screen on/.test(html));
const fails = R.filter((x) => !x).length;
console.log(`${R.length - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
