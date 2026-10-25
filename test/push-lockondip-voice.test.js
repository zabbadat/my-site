// Solo push-ups, leaned-up front-facing camera: zero calibration (the first real dip sets the top and counts), spoken rep
// callouts (Sets count down from the target, other modes count up), setup prompts, through the real flow harness.
const path = require("path"), run = require("./lib/push-flow-harness.js"), P = require("../push-counter.js"), G = require("../get-set.js"), S = require("./lib/push-synth.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const HTML = path.join(__dirname, "..", "index.html");
const repAt = (t0) => (t) => { if (t < t0) return { d: 0 }; const p = (t - t0) % 2000; return { d: p < 800 ? p / 800 : p < 1100 ? 1 : p < 1900 ? 1 - (p - 1100) / 800 : 0 }; };
const feed = (c, sc, from, to, cfg) => { const out = []; S.reseed(4); for (let t = from; t < to; t += 33) { const x = sc(t), r = c.update(S.frameFor(x.d, Object.assign({}, S.BASE, cfg || {}, x.sw != null ? { sw: x.sw } : {}, x.y != null ? { topY: x.y } : {}), t), t, 640); if (r.counted) out.push(t); } return out; };
check("DEFAULTS have no lockOnDip / calibHold / view keys", !("lockOnDip" in P.DEFAULTS) && !("calibHold" in P.DEFAULTS) && !("view" in P.DEFAULTS) && P.DEFAULTS.maxRepMs === 6000 && P.DEFAULTS.minDepth === 0.2);
{ const c = P.createCounter(); feed(c, () => ({ d: 0 }), 0, 10000);
  check("10 s of steady opening frames never lock the top", c.state().phase === "calibrate" && c.state().top == null && /Start your push-ups/.test(c.state().status)); }
{ const c = P.createCounter(); const hits = feed(c, repAt(3000), 0, 20000);
  check("first real dip locks top (start level) + bottom (peak) and counts as rep 1", c.state().phase === "ready" && hits.length === 8 && hits[0] < 5000 && c.state().bottom > c.state().top + 0.2); }
{ const c = P.createCounter(); feed(c, (t) => ({ d: 0, sw: t < 1500 ? 0.34 : t < 3000 ? 0.34 + (0.2 - 0.34) * (t - 1500) / 1500 : 0.2, y: t < 1500 ? 120 : t < 3000 ? 120 + 50 * (t - 1500) / 1500 : 170 }), 0, 4000); const hits = feed(c, repAt(4000), 4000, 20000);
  check("setup close to the phone, then backing into plank: start level follows, reps count", hits.length >= 7); }
{ const c = P.createCounter(); feed(c, (t) => ({ d: 0, sw: t < 1500 ? 0.12 : t < 3000 ? 0.12 + 0.08 * (t - 1500) / 1500 : 0.2, y: t < 1500 ? 200 : t < 3000 ? 200 - 30 * (t - 1500) / 1500 : 170 }), 0, 6000); const hits = feed(c, repAt(6000), 6000, 22000);
  check("setup far away, then stepping in: parked 'dip' re-bases, reps count", hits.length >= 7); }
{ const c = P.createCounter(); feed(c, (t) => { const p = t % 2000; return { d: (p < 800 ? p / 800 : p < 1900 ? 1 - (p - 800) / 1100 : 0) * 0.15 }; }, 0, 8000);
  check("shallow wobble (< minDepth) never locks", c.state().phase === "calibrate"); }
{ const c = P.createCounter(); feed(c, () => ({ d: 0 }), 0, 2000); check("default (TUT battles) is zero calibration too: steady frames lock nothing, no hold step", c.state().phase === "calibrate" && c.state().top == null); const hits = feed(c, repAt(2000), 2000, 8000); check("default: the first real dip counts as rep 1", hits.length >= 2 && c.state().phase === "ready"); }
// spoken callouts
check("Sets target 20: rep 1 -> '20', rep 2 -> '19', rep 20 -> '1', then 'Plus 1'", G.repCallout(1, 20) === "20" && G.repCallout(2, 20) === "19" && G.repCallout(20, 20) === "1" && G.repCallout(21, 20) === "Plus 1" && G.repCallout(23, 20) === "Plus 3");
check("no target: counts up", G.repCallout(1, 0) === "1" && G.repCallout(7, null) === "7" && G.repCallout(0, 20) === null);
{ const log = []; const v = G.makeRepVoice({ speak: (w) => log.push("say:" + w), stop: () => log.push("cancel") }); v.say("20"); v.say("20"); v.say("19");
  check("rep voice cancels queued speech before each number, no repeats", log.join(",") === "cancel,say:20,cancel,say:19"); v.reset(); v.say("19"); check("reset allows the same number again (new set)", log.slice(-1)[0] === "say:19"); }
{ const v = G.makeRepVoice({ speak: () => { throw new Error("no speech"); }, stop: () => { throw new Error("x"); } }); let ok = true; try { v.say("3"); } catch (e) { ok = false; } check("rep voice: silent fallback when speech throws", ok); }
check("coaching lines per exercise (shared get-set.js COACH)", G.coachLines("pushups").place === "Lean your phone up in front of you, camera facing you." && G.coachLines("pushups").criteria === "Shoulders and hands in frame. Go all the way down and back up." && G.coachLines("tut").criteria === "Shoulders and hands in frame. Slow, controlled reps, all the way down and back up." && G.coachLines("plank").place === "Prop your phone sideways on the floor, off to your side. Turn so the camera sees your side." && G.coachLines("plank").criteria === "Step back until the outline shows your whole body, head to heels. Hold still until I say go.");
(async () => {
  // speech mock ends each utterance after 1 s: place 0-1 s, criteria 1-3 s (min 2 s), countdown 3-10 s, Go @10 s
  const CD = "Ready|get set|three|two|one|Go", PL = G.COACH.pushups, TU = G.COACH.tut;
  let sp = []; let r = await run(HTML, { mode: "sets", script: repAt(11000), ms: 19100, spoken: sp });
  const words = sp.filter((x) => x.vol !== 0).map((x) => x.w), at = (w) => (sp.find((x) => x.w === w) || {}).at;
  check("flow (Sets, target 20): place line @0, criteria after it ends, slow countdown, Go @10 s, then 20, 19, 18, 17",
    r.reps === 4 && words.join("|") === [PL.place, PL.criteria, CD, "20|19|18|17"].join("|") && at(PL.place) === 0 && at(PL.criteria) === 1000 && at("Ready") === 3000 && at("get set") === 5000 && at("three") === 7000 && at("one") === 9000 && at("Go") === 10000);
  sp = []; r = await run(HTML, { mode: "long", script: repAt(11000), ms: 17000, spoken: sp });
  check("flow (One long set = TUT): TUT coaching lines, counts up 1, 2, 3", sp.filter((x) => x.vol !== 0).map((x) => x.w).join("|") === [TU.place, TU.criteria, CD, "1|2|3"].join("|"));
  sp = []; r = await run(HTML, { mode: "challenge", script: repAt(11000), ms: 17000, spoken: sp });
  check("flow (Three-minute challenge): counts up 1, 2, 3", sp.filter((x) => x.vol !== 0).map((x) => x.w).slice(8).join("|") === "1|2|3");
  sp = []; r = await run(HTML, { mode: "sets", script: repAt(0), ms: 12000, spoken: sp });
  check("dips before Go: not counted, not spoken", sp.filter((x) => x.vol !== 0 && /^\d|Plus/.test(x.w)).every((x) => x.at >= 10000) && r.reps <= 1);
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
