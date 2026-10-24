// Plank Battle: spoken hold time every 15 s from GO, silent after drop/decision, restarts per room+startAt.
const fs = require("fs"), G = require("../get-set.js");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const h = fs.readFileSync(__dirname + "/../index.html", "utf8");
const i = h.indexOf("const pbTimeVoice"), body = h.slice(i, h.indexOf("\nfunction enterBattle", i));
const said = [];
const window = { ZabbadatGetSet: { makeHoldVoice: () => G.makeHoldVoice({ speak: (w) => said.push(w), stop: () => {} }) } };
let now = 0, room, mine = {}, done = false; const c = { hidden: false };
const env = { window, $: () => c, battle: { state: () => ({ phase: "live" }), markLive: () => Promise.resolve(), offset: 0 }, battleVoice: null, bStatus: () => {}, fmtT: (x) => String(x),
  BR: { serverNow: () => now }, PBm: { decide: () => ({ done }), holdMs: (r) => now - r.startAt }, currentUser: { uid: "me" }, document: { visibilityState: "visible" }, paintBattle: () => {}, pbDec: () => ({ done }), plankArc: { paint() {} }, clearInterval: () => {} };
const run = new Function(...Object.keys(env), "let battleCode='AB', battleRoom, plankLiveFor='AB', plankHidden, plankSent, battleTick;" + body +
  "; return { tick: tickBattle, set: (r) => { battleRoom = r; } };")(...Object.values(env));
room = { startAt: 1000, status: "live", players: { me: mine } }; run.set(room);
for (now = 1000; now <= 50000; now += 100) run.tick();
check("callouts from GO every 15 s, no duplicates", JSON.stringify(said) === JSON.stringify(["15 seconds", "30 seconds", "45 seconds"]));
mine.result = { dropMs: 1 }; for (; now <= 80000; now += 100) run.tick();
check("silent after you drop", said.length === 3);
said.length = 0; delete mine.result; room = { startAt: 100000, status: "live", players: { me: mine } }; run.set(room);
for (now = 100000; now <= 117000; now += 100) run.tick();
check("new battle (startAt) restarts from 0", JSON.stringify(said) === JSON.stringify(["15 seconds"]));
done = true; for (; now <= 140000; now += 100) run.tick();
check("silent once the battle is decided", said.length === 1);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
