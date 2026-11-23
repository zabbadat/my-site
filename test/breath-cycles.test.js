// All-time breath cycles: localStorage zabbadat-breath-cycles, one per completed 16 s cooling-box cycle.
// Third #miniDash stat, visible signed out. Run: node test/breath-cycles.test.js
const fs = require("fs"), path = require("path");
const CB = require("../cooling-box.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
function mem() { const d = {}; return { getItem: (k) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, d }; }

check("storage key is zabbadat-breath-cycles", CB.KEY === "zabbadat-breath-cycles");
check("cycle is 16 s, four 4-count sides", CB.CYCLE_MS === 16000 && CB.SIDE_MS === 4000 && CB.SIDES.length === 4);
const s = mem();
check("starts at 0", CB.getCycles(s) === 0);
check("addCycle increments", CB.addCycle(s) === 1 && CB.addCycle(s, 2) === 3 && CB.getCycles(s) === 3);

let t = 1e6, cycles = [];
const box = CB.createBox({ store: s, now: () => t, onCycle: (n) => cycles.push(n) });
box.start();
t += 15999; box.tick();
check("15.999 s does not complete a cycle", cycles.length === 0 && box.getCycles() === 3 && box.running());
t += 2; box.tick();
check("16 s completes one cycle and continues", cycles[0] === 4 && box.getCycles() === 4 && box.running());
t += 16000; box.tick();
check("a second cycle adds one more", cycles[1] === 5 && box.getCycles() === 5);
box.stop();
check("stop ends the run", !box.running());
t += 20000; box.tick();
check("stopped box does not count more cycles", box.getCycles() === 5);

check("Start cooling box button and local counter are on the page",
  /id="coolingStartBtn"/.test(html) && />Start cooling box</.test(html)
  && /id="coolingCycles"/.test(html) && /cooling-box.js/.test(html));
check("Breath cycles is the third #miniDash stat and starts visible (not a signed-in dash)",
  /id="miniDashBreath"/.test(html) && /Breath cycles/.test(html)
  && html.indexOf('id="miniDashZab"') < html.indexOf('id="miniDashTut"')
  && html.indexOf('id="miniDashTut"') < html.indexOf('id="miniDashBreath"')
  && /function paintBreathCycles\(/.test(html)
  && /paintBreathCycles\(\);/.test(html));
check("no Firestore writes in cooling-box.js",
  !/firestore|addDoc|setDoc|collection\(/.test(fs.readFileSync(path.join(__dirname, "..", "cooling-box.js"), "utf8")));

const bad = R.filter((x) => !x).length; console.log(`\n${R.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
