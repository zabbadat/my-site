// Tests for tut-battle.js: loss detection with synthetic landmarks, and a two-player sim to result + ranking.
const TB = require("../tut-battle.js");
const BR = require("../battle-rooms.js");
const { createPostureGuard } = require("../push-session.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const K = (o, score = 0.9) => Object.entries(o).map(([name, [x, y]]) => ({ name, x, y, score }));
const plank = K({ left_shoulder: [220, 240], right_shoulder: [420, 240] });
const away = K({ left_shoulder: [290, 240], right_shoulder: [350, 240] });
const kneesDown = K({ left_shoulder: [100, 200], left_hip: [300, 220], left_knee: [400, 300], left_ankle: [300, 310] });
const TOP = 200;
const judge = () => { const j = TB.createJudge(createPostureGuard({ holdMs: TB.RULES.postureHoldMs })); j.reset(0); return j; };
// play [frames, ms, repEveryMs?] at 30fps
function play(j, segs) { let t = 0, out = null, at = null; for (const [kps, ms, rep] of segs) { for (let e = 0; e < ms; e += 33) { t += 33; const c = rep && Math.floor(t / rep) !== Math.floor((t - 33) / rep); const r = j.update(kps, t, TOP, c); if (r && !out) { out = r; at = t; } } } return { out, at }; }
check("good plank with reps: no loss in 20s", play(judge(), [[plank, 20000, 2000]]).out === null);
let r = play(judge(), [[plank, 3000, 1500], [away, 2000, 1500]]); check("stood up -> standing ~0.75s", r.out === "standing" && r.at - 3000 >= 700 && r.at - 3000 < 900);
check("brief 0.5s stand blip is ignored", play(judge(), [[plank, 3000, 1500], [away, 500, 1500], [plank, 3000, 1500]]).out === null);
r = play(judge(), [[plank, 3000, 1500], [kneesDown, 2000, 1500]]); check("knee down -> knees ~0.75s", r.out === "knees" && r.at - 3000 < 900);
r = play(judge(), [[plank, 3000, 1500], [[], 3000, 1500]]); check("out of frame -> frame after ~2s", r.out === "frame" && r.at - 3000 >= 1950 && r.at - 3000 < 2100);
check("1.5s dropout tolerated", play(judge(), [[plank, 3000, 1500], [[], 1500, 1500], [plank, 3000, 1500]]).out === null);
check("no 8 s no-rep loss: 30 s top rest in plank is fine", play(judge(), [[plank, 2000, 1000], [plank, 30000]]).out === null);
check("RULES: no noRepMs, 3:00 clock, 10 s top cap, 2 s frame", !("noRepMs" in TB.RULES) && TB.RULES.durationMs === 180000 && TB.RULES.topCapMs === 10000 && TB.RULES.outOfFrameMs === 2000);
check("flag texts", TB.REASONS.standing === "Stood up / left plank flagged" && TB.REASONS.knees === "Knees down flagged");
check("3:00 clock from startAt: time left", TB.endAt({ startAt: 1000 }) === 181000 && TB.timeLeft({ startAt: 1000 }, 61000) === 120000 && TB.timeLeft({ startAt: 1000 }, 999999) === 0 && TB.timeLeft({ startAt: null }, 5) === null);
{ const CH = require("../push-challenge.js"); const c = CH.createChallenge({ durationMs: TB.RULES.durationMs, topCapMs: TB.RULES.topCapMs }); c.start(0); let x;
  for (let t = 0; t <= 25000; t += 100) x = c.update(t, { atTop: true });
  check("battle top hold capped at 10 s with note flag", x.topTutMs === 10000 && x.capped);
  x = c.update(181000, {}); check("battle clock ends at 3:00", x.ended && c.update(200000, { counted: true, repMs: 1000 }).reps === 0); }
const RM = (a, b) => ({ status: "live", players: { a: { reps: a[0], tutMs: a[1] }, b: { reps: b[0], tutMs: b[1] } } });
check("time-up: higher TUT wins", TB.timeUpLoser(RM([10, 50000], [30, 40000])) === "b");
check("time-up: TUT tie -> more reps wins", TB.timeUpLoser(RM([10, 50000], [12, 50000])) === "a");
check("time-up: full tie -> draw (null)", TB.timeUpLoser(RM([10, 50000], [10, 50000])) === null);
check("result text both sides", TB.resultText({ status: "done", loseReason: "stopped", winnerUid: "a" }, "a") === "Time: more time under tension" && TB.resultText({ status: "done", loseReason: "stopped", winnerUid: "a" }, "b") === "Time: less time under tension" && TB.resultText({ status: "done", loseReason: "knees" }, "b") === "Knees down flagged");
{ const html = require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
  check("static: scoreboard shows both players' reps + clock", html.includes('id="tbP1s"') && html.includes('id="tbP2s"') && html.includes('" reps · " + fmtT(mine ? tbMine.tutMs : p.tutMs || 0)'));
  check("static: separate camera + ready buttons kept", html.includes('>Turn on camera</button>') && html.includes(">I'm ready</button>"));
  check("static: intro describes 3:00 rules, no 8 s rule", html.includes("Three minutes, head to head.") && !html.includes("stop repping for 8 seconds"));
  check("static: battle cap note", html.includes('"Top hold capped at 10 seconds"') && html.includes("TBC.atTopFrom(st)")); }
check("loss latches", (() => { const j = judge(); play(j, [[[], 2500]]); return j.update(plank, 99999, TOP, true) === "frame"; })());
check("throttle ~1/s", (() => { let t = 0; const th = TB.throttle(1000, () => t); let n = 0; for (t = 0; t < 5000; t += 100) if (th()) n++; return n === 5; })());
check("rank by wins", TB.rankStats([{ wins: 1, losses: 0, bestTutMs: 0 }, { wins: 3, losses: 5, bestTutMs: 0 }])[0].wins === 3);

// ---- mock firestore (two collections) ----
let T = 5_000_000; const SERVER = { __ts: 1 }, DEL = { __del: 1 };
function mkFs() {
  const docs = {}, subs = {};
  const deep = (v) => (v === SERVER ? T : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
  const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
  const apply = (d, p) => { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; if (v === DEL) delete o[ks.at(-1)]; else o[ks.at(-1)] = deep(v); } return d; };
  const emit = (c) => setTimeout(() => (subs[c] || []).slice().forEach((f) => f(clone(docs[c]))));
  let lock = Promise.resolve();
  return { docs,
    tx: (c, fn) => (lock = lock.then(async () => { await new Promise((r) => setTimeout(r, 1)); let next; const out = fn({ get: () => clone(docs[c]), set: (d) => (next = deep(d)), update: (p) => (next = apply(next || docs[c], p)) }); if (next) { docs[c] = next; emit(c); } return out; })),
    update: async (c, p) => { docs[c] = apply(docs[c], p); emit(c); },
    watch: (c, cb) => { (subs[c] = subs[c] || []).push(cb); setTimeout(() => cb(clone(docs[c]))); return () => { subs[c] = subs[c].filter((f) => f !== cb); }; },
    ts: () => SERVER, del: () => DEL, toMs: (v) => (typeof v === "number" ? v : null) };
}
(async () => {
  const rooms = mkFs(), stats = mkFs();
  const A = { uid: "a", name: "Zab" }, B = { uid: "b", name: "Pal" };
  const ca = BR.controller(rooms, { now: () => T + 2500 }), cb = BR.controller(rooms, { now: () => T - 1500 });
  const code = await ca.createRoom(A); await cb.joinRoom(code, B);
  await Promise.all([ca.setReady(code, A, true), cb.setReady(code, B, true)]);
  const room = rooms.docs[code]; check("TUT room flow reuses rooms module: countdown with one startAt", room.status === "countdown" && room.startAt === T + 5000);
  T = room.startAt + 1300; check("either flips live", (await cb.markLive(code)) && rooms.docs[code].status === "live");
  // full 3:00 on both phones; nobody breaks. A has more TUT, B fewer. Then both settle; only B (loser) writes.
  const ja = judge(), jb = judge(); let ma = { reps: 0, tutMs: 0 }, mb = { reps: 0, tutMs: 0 }, lossWrites = 0;
  const tha = TB.throttle(1000, () => T), thb = TB.throttle(1000, () => T); let pubs = 0;
  for (let t = 33; t < TB.RULES.durationMs; t += 33) {
    T += 33; const repA = t % 1500 < 33, repB = t % 3000 < 33;
    if (repA) { ma.reps++; ma.tutMs += 1500; } if (repB) { mb.reps++; mb.tutMs += 1500; }
    if (ja.update(plank, t, TOP) || jb.update(plank, t, TOP)) lossWrites += 100;
    if (tha()) { await TB.publishLive(rooms, code, "a", ma); pubs++; } if (thb()) { await TB.publishLive(rooms, code, "b", mb); pubs++; }
  }
  check("no break in 3:00 of plank with top rests", lossWrites === 0 && rooms.docs[code].status === "live");
  await TB.publishLive(rooms, code, "a", ma); await TB.publishLive(rooms, code, "b", mb);
  const sa = await TB.settleTimeUp(rooms, code, "a"), sb = await TB.settleTimeUp(rooms, code, "b"), sb2 = await TB.settleTimeUp(rooms, code, "b");
  check("settle: winner no-ops, loser writes once, repeat is idempotent", sa === "won" && sb === "lost" && sb2 === "done");
  lossWrites = 1;
  const done = rooms.docs[code];
  check("live stats published ~1/s per player", pubs >= 2 * 170 && pubs <= 2 * 182);
  check("opponent sees B's reps via room doc", done.players.b.reps === mb.reps && done.players.a.reps > 0);
  check("time-up: loser b (less TUT), winner a, allowed reason 'stopped'", done.status === "done" && done.loserUid === "b" && done.winnerUid === "a" && done.loseReason === "stopped" && lossWrites === 1);
  check("winner A's settle after done is a no-op", (await TB.settleTimeUp(rooms, code, "a")) === "done");
  check("A breaking after result can't overwrite", (await TB.reportLoss(rooms, code, "a", "standing", ma)) === false && rooms.docs[code].loserUid === "b");
  await TB.recordResult(stats, done, "a"); await TB.recordResult(stats, done, "b");
  check("ranking: a +1 win, b +1 loss", stats.docs.a.wins === 1 && stats.docs.a.losses === 0 && stats.docs.b.losses === 1 && stats.docs.b.wins === 0);
  check("best TUT/reps stored", stats.docs.a.bestTutMs === done.players.a.tutMs && stats.docs.b.bestReps === mb.reps);
  check("recording twice is idempotent", (await TB.recordResult(stats, done, "a")) === false && stats.docs.a.wins === 1);
  check("board order", TB.rankStats(Object.values(stats.docs))[0].uid === "a");
  // break = immediate loss mid-battle, and draw leaves the room live (no write)
  { const r2 = mkFs(); const c1 = BR.controller(r2, { now: () => T }); const c2 = BR.controller(r2, { now: () => T });
    const k = await c1.createRoom(A); await c2.joinRoom(k, B); await Promise.all([c1.setReady(k, A, true), c2.setReady(k, B, true)]);
    T = r2.docs[k].startAt + 100; await c1.markLive(k);
    const j = judge(); const res = play(j, [[plank, 5000, 1500], [kneesDown, 2000]]);
    check("break = immediate loss (~0.75 s after knees down)", res.out === "knees" && res.at - 5000 < 900);
    check("break writes loss right away", (await TB.reportLoss(r2, k, "b", res.out, { reps: 3, tutMs: 4500 })) && r2.docs[k].loserUid === "b" && r2.docs[k].loseReason === "knees"); }
  { const r3 = mkFs(); const c1 = BR.controller(r3, { now: () => T }); const c2 = BR.controller(r3, { now: () => T });
    const k = await c1.createRoom(A); await c2.joinRoom(k, B); await Promise.all([c1.setReady(k, A, true), c2.setReady(k, B, true)]);
    T = r3.docs[k].startAt + 100; await c1.markLive(k);
    await TB.publishLive(r3, k, "a", { reps: 5, tutMs: 9000 }); await TB.publishLive(r3, k, "b", { reps: 5, tutMs: 9000 });
    check("draw: both settle 'draw', no result written", (await TB.settleTimeUp(r3, k, "a")) === "draw" && (await TB.settleTimeUp(r3, k, "b")) === "draw" && r3.docs[k].status === "live" && !r3.docs[k].loserUid); }
  if (R.includes(false)) process.exit(1);
})();
