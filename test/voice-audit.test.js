// Voice audit: every start path speaks. Real handlers sliced from index.html, real get-set.js / battle-rooms.js,
// fake speechSynthesis (each utterance "ends" after 1 s). Solo push/TUT/plank timelines are in push-single-start /
// push-lockondip-voice / plank-time-voice tests; this file covers TUT Battles, Plank Battles and washers.
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, ".."), html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const GS = require("../get-set.js"), BR = require("../battle-rooms.js");
let pass = 0, fail = 0; const check = (n, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n); };
const between = (a, b) => { const i = html.indexOf(a); if (i < 0) throw new Error("missing " + a); return html.slice(i, html.indexOf(b, i + a.length) + b.length); };
const fnSrc = (n) => between("function " + n + "(", "\n}");
const line = (s) => between(s, "\n");
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
function env(extra) {
  let now = 0; const timers = [], said = [], log = [], els = {};
  const $ = (id) => (els[id] = els[id] || { id, textContent: "", hidden: true, style: {}, className: "", play: async () => {}, srcObject: null, videoWidth: 640 });
  const ctx = { $, console, Math, Promise, JSON, String, Number, Object, log, said, Date: { now: () => now },
    setTimeout: (f, d) => { timers.push({ at: now + (d || 0), f }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    performance: { now: () => now }, requestAnimationFrame: () => {},
    navigator: { mediaDevices: { getUserMedia: async () => { log.push("camera"); return { getTracks: () => [{ stop() {} }] }; } } },
    speechSynthesis: { speaking: false, pending: false, cancel: () => log.push("cancel"), speak: (u) => { said.push({ w: u.text, at: now, vol: u.volume }); if (u.onend) timers.push({ at: now + 1000, f: () => u.onend() }); } },
    SpeechSynthesisUtterance: function (t) { this.text = t; }, ...extra };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "get-set.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "battle-rooms.js"), "utf8"), ctx);
  const advance = async (ms) => { const end = now + ms; for (;;) { await flush(); timers.sort((a, b) => a.at - b.at); const t = timers.find((x) => !x.done && x.at <= end); if (!t) break; now = t.at; t.done = true; t.f(); } now = end; await flush(); };
  return { ctx, $, said, log, advance, setNow: (t) => { now = t; }, now: () => now, run: (c) => vm.runInContext(c, ctx) };
}
const W = (e) => e.said.filter((x) => x.vol !== 0).map((x) => x.w);
const TUT = GS.coachLines("tut");
(async () => {
  // ---- TUT Battles: camera tap -> placement + criteria; I'm ready tap unlocks; shared countdown spoken; reps counted up
  { const e = env();
    e.run(`function requireSignIn() { return true; } const tbWake = null; let tbStream = null, tbLoop = false, tbCounter = null, tbLiveT0 = null, tbRoom = null, tbCodeCur = "K7QX";
      let tbMine = { reps: 0, tutMs: 0 }; async function loadCamLibs() {} async function ensurePose() { log.push("pose"); } function tbPose() {} function tbPaint() {}
      window.ZabbadatPush = { createCounter: () => ({}) }; const POSITION_MS = 2000, POSITION_SPOKEN_MAX_MS = 10000;
      ${line("const GET_SET_MS")} ${line("const getSet = ")} ${line("function unlockGetSet")} ${fnSrc("showPositioning")}
      ${line("const tbVoice = ")} ${line("const tbRepVoice = ")} ${line("let tbCoaching")}
      async ${fnSrc("tbCamOn")}
      ${line('$("tbCam").onclick = ')}`);
    e.$("tbCam").onclick();
    check("TUT battle camera tap: speech unlocked + TUT placement line spoken inside the tap", e.said[0] && e.said[0].vol === 0 && W(e)[0] === TUT.place && e.$("tbCamNote").textContent === TUT.place);
    await e.advance(10); check("TUT battle: camera opens while the placement line plays", e.log.includes("camera") && W(e).length === 1);
    await e.advance(1000); check("TUT battle: criteria line after placement ends", W(e)[1] === TUT.criteria && e.$("tbCamNote").textContent === TUT.criteria);
    await e.advance(3000); check("TUT battle: coaching done, counter status shows again", e.run("tbCoaching") === false);
    // shared countdown via the real battle-rooms countdownState, ticked every 100 ms like tbTickFn
    const startAt = 20000; e.said.length = 0;
    for (let t = 15000; t <= 22000; t += 100) { e.setNow(t); const st = BR.countdownState(startAt, t, 0); e.run(`tbVoice.phase("tut:K7QX:${startAt}", ${JSON.stringify(st.phase)}, ${st.n || 0})`); }
    check("TUT battle shared countdown spoken once each: Ready, get set, three, two, one, Go (1 s apart, Go at start)", e.said.map((x) => x.w + "@" + x.at).join(",") === "Ready@15000,get set@16000,three@17000,two@18000,one@19000,Go@20000");
    check("tbTickFn feeds the countdown voice; I'm ready tap unlocks speech", /if \(tbVoice\) tbVoice\.phase\("tut:" \+ tbCodeCur \+ ":" \+ r\.startAt, st\.phase, st\.n\);/.test(html) && /\$\("tbReady"\)\.onclick = async \(\) => \{ if \(!requireSignIn\("tut battle"\)\) return; unlockGetSet\(\);/.test(html));
    e.said.length = 0; e.run("tbRepVoice.reset()"); for (const n of [1, 1, 2, 3]) e.run(`tbRepVoice.say("${n}")`);
    check("TUT battle reps counted up, no repeats", W(e).join(",") === "1,2,3");
    check("tbPose speaks each new rep; reset at GO", /if \(c\.reps > tbMine\.reps && tbRepVoice\) tbRepVoice\.say\(String\(c\.reps\)\);/.test(html) && /clearTimeout\(tbSettleTimer\); if \(tbRepVoice\) tbRepVoice\.reset\(\);/.test(html)); }
  // ---- Plank Battles: I'm ready unlocks; shared countdown spoken
  { const e = env(); e.run(`${line("const pbVoice = ")}`); const startAt = 9000;
    for (let t = 4000; t <= 11000; t += 100) { e.setNow(t); const st = BR.countdownState(startAt, t, 0); e.run(`pbVoice.phase("plank:AB:${startAt}", ${JSON.stringify(st.phase)}, ${st.n || 0})`); }
    check("Plank battle shared countdown spoken: Ready, get set, three, two, one, Go", W(e).join(",") === "Ready,get set,three,two,one,Go");
    check("tickBattle feeds it; I'm ready tap unlocks speech", /if \(pbVoice && battleRoom\) pbVoice\.phase\("plank:" \+ battleCode \+ ":" \+ battleRoom\.startAt, st\.phase, st\.n\);/.test(html) && /\$\("battleReady"\)\.onclick = async \(\) => \{ if \(!requireSignIn\("plank battle"\)\) return; unlockGetSet\(\);/.test(html)); }
  // ---- Washers: score spoken inside the scoring tap
  check("Washers: score spoken in the scoring tap (scoreVoice.say(state.score))", /btn\.onclick = \(\) => \{[\s\S]{0,600}scoreVoice\.say\(state\.score\)/.test(html));
  // ---- iOS-safe speak: no cancel when idle; cancel then delayed speak when busy
  { const e = env(); e.run("window.ZabbadatGetSet.interruptSpeak('7')"); const idle = e.log.length === 0 && W(e)[0] === "7";
    e.ctx.speechSynthesis.speaking = true; e.run("window.ZabbadatGetSet.interruptSpeak('8')"); const queued = W(e).length === 1 && e.log.includes("cancel"); await e.advance(70);
    check("iOS-safe speak: idle -> speak now; busy -> cancel, speak ~60 ms later", idle && queued && W(e)[1] === "8"); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
