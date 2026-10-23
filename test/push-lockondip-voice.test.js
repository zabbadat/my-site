// Solo push-ups: top locks from the first real dip (counter option lockOnDip), spoken rep callouts (Sets count down
// from the target, other modes count up), setup prompts, through the real flow harness. DEFAULTS unchanged.
const path = require("path"), run = require("./lib/push-flow-harness.js"), P = require("../push-counter.js"), G = require("../get-set.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const HTML = path.join(__dirname, "..", "index.html");
const TOP = 0.3125, BOT = 0.42;
const f = (w, e) => { const sx = 320 - w * 320, a = (180 - e) * Math.PI / 180; return [{ name: "left_shoulder", x: sx, y: 240, score: .9 }, { name: "right_shoulder", x: 320 + w * 320, y: 240, score: .9 }, { name: "left_elbow", x: sx, y: 300, score: .9 }, { name: "left_wrist", x: sx + 60 * Math.sin(a), y: 300 + 60 * Math.cos(a), score: .9 }]; };
const repAt = (t0) => (t) => { if (t < t0) return { w: TOP, e: 170 }; const p = (t - t0) % 2000; const k = p < 800 ? p / 800 : p < 1100 ? 1 : p < 1900 ? 1 - (p - 1100) / 800 : 0; return { w: TOP + k * (BOT - TOP), e: 170 - k * 90 }; };
const feed = (c, sc, from, to) => { let out = []; for (let t = from; t < to; t += 33) { const r = c.update(f(sc(t).w, sc(t).e), t, 640); if (r.counted) out.push(t); } return out; };
check("DEFAULTS has no lockOnDip key (option only)", !("lockOnDip" in P.DEFAULTS) && P.DEFAULTS.maxRepMs === 6000 && P.DEFAULTS.calibMs === 1000 && P.DEFAULTS.minDepth === 0.12);
{ const c = P.createCounter({ lockOnDip: true }); feed(c, () => ({ w: TOP, e: 170 }), 0, 10000);
  check("lockOnDip: 10 s of steady opening frames never lock the top", c.state().phase === "calibrate" && c.state().top == null && /set the top/.test(c.state().status)); }
{ const c = P.createCounter({ lockOnDip: true }); const hits = feed(c, repAt(3000), 0, 20000);
  check("lockOnDip: first real dip locks top (start level) + bottom (peak) and counts as rep 1", c.state().phase === "ready" && Math.abs(c.state().top - TOP) < 0.01 && Math.abs(c.state().bottom - BOT) < 0.02 && hits.length === 8 && hits[0] < 5000); }
{ const c = P.createCounter({ lockOnDip: true }); feed(c, (t) => ({ w: t < 1500 ? 0.55 : t < 3000 ? 0.55 - (0.55 - TOP) * (t - 1500) / 1500 : TOP, e: 170 }), 0, 4000); const hits = feed(c, repAt(4000), 4000, 20000);
  check("lockOnDip: setup close to the camera then plank: start level follows down, reps count", hits.length >= 7 && Math.abs(c.state().top - TOP) < 0.01); }
{ const c = P.createCounter({ lockOnDip: true }); feed(c, (t) => ({ w: t < 1500 ? 0.2 : t < 3000 ? 0.2 + (TOP - 0.2) * (t - 1500) / 1500 : TOP, e: 170 }), 0, 6000); const hits = feed(c, repAt(6000), 6000, 22000);
  check("lockOnDip: setup far away then plank: parked 'dip' re-bases, reps count", hits.length >= 7 && Math.abs(c.state().top - TOP) < 0.01); }
{ const c = P.createCounter({ lockOnDip: true }); feed(c, (t) => { const p = t % 2000, k = p < 800 ? p / 800 : p < 1900 ? 1 - (p - 800) / 1100 : 0; return { w: TOP + k * 0.02, e: 170 }; }, 0, 8000);
  check("lockOnDip: shallow wobble (< minDepth) never locks", c.state().phase === "calibrate"); }
{ const c = P.createCounter(); feed(c, () => ({ w: TOP, e: 170 }), 0, 2000); check("default (TUT battles) still calibrates from a steady top", c.state().phase === "first"); }
// spoken callouts
check("Sets target 20: rep 1 -> '20', rep 2 -> '19', rep 20 -> '1', then 'Plus 1'", G.repCallout(1, 20) === "20" && G.repCallout(2, 20) === "19" && G.repCallout(20, 20) === "1" && G.repCallout(21, 20) === "Plus 1" && G.repCallout(23, 20) === "Plus 3");
check("no target: counts up", G.repCallout(1, 0) === "1" && G.repCallout(7, null) === "7" && G.repCallout(0, 20) === null);
{ const log = []; const v = G.makeRepVoice({ speak: (w) => log.push("say:" + w), stop: () => log.push("cancel") }); v.say("20"); v.say("20"); v.say("19");
  check("rep voice cancels queued speech before each number, no repeats", log.join(",") === "cancel,say:20,cancel,say:19"); v.reset(); v.say("19"); check("reset allows the same number again (new set)", log.slice(-1)[0] === "say:19"); }
{ const v = G.makeRepVoice({ speak: () => { throw new Error("no speech"); }, stop: () => { throw new Error("x"); } }); let ok = true; try { v.say("3"); } catch (e) { ok = false; } check("rep voice: silent fallback when speech throws", ok); }
check("setup prompts per exercise (2 lines, Eyes forward)", G.positionPrompt("pushups") === "Phone flat under your chest · Shoulders in frame\nArms straight · Eyes forward" && G.positionPrompt("plank") === "Full body in frame · Phone on a table, 4-6 ft away\nFront view · Eyes forward" && G.positionPrompt("tut") === G.positionPrompt("pushups"));
(async () => {
  let sp = []; let r = await run(HTML, { mode: "sets", script: repAt(8000), ms: 16100, spoken: sp });
  const words = sp.filter((x) => x.vol !== 0).map((x) => x.w);
  check("flow (Sets, target 20): Ready get set @2 s, Go @7 s, then spoken 20, 19, 18, 17", r.reps === 4 && words.join("|") === "Ready, get set|Go|20|19|18|17" && sp.find((x) => x.w === "Go").at === 7000);
  sp = []; r = await run(HTML, { mode: "long", script: repAt(8000), ms: 14000, spoken: sp });
  check("flow (One long set): counts up 1, 2, 3", sp.filter((x) => x.vol !== 0).map((x) => x.w).slice(2).join("|") === "1|2|3");
  sp = []; r = await run(HTML, { mode: "challenge", script: repAt(8000), ms: 14000, spoken: sp });
  check("flow (Three-minute challenge): counts up 1, 2, 3", sp.filter((x) => x.vol !== 0).map((x) => x.w).slice(2).join("|") === "1|2|3");
  sp = []; r = await run(HTML, { mode: "sets", script: repAt(0), ms: 9000, spoken: sp });
  check("dips before Go: not counted, not spoken", sp.filter((x) => x.vol !== 0 && /^\d|Plus/.test(x.w)).every((x) => x.at >= 7000) && r.reps <= 1);
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
