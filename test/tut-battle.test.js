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
r = play(judge(), [[plank, 2000, 1000], [plank, 9000]]); check("no rep for 8s -> stopped", r.out === "stopped" && r.at >= 2000 + 7900 - 1000);
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
  // both phones run their own judge; A keeps repping, B stops repping and gets 'stopped'
  const ja = judge(), jb = judge(); const t0 = 0; let ma = { reps: 0, tutMs: 0 }, mb = { reps: 0, tutMs: 0 }, lossWrites = 0;
  const tha = TB.throttle(1000, () => T), thb = TB.throttle(1000, () => T); let pubs = 0;
  for (let t = 33; t < 15000; t += 33) {
    T += 33; const repA = t % 1500 < 33, repB = t < 4000 && t % 1500 < 33;
    if (repA) ma.reps++; if (repB) mb.reps++; ma.tutMs = mb.tutMs = t;
    const la = ja.update(plank, t, TOP, repA), lb = jb.update(plank, t, TOP, repB);
    if (tha()) { await TB.publishLive(rooms, code, "a", ma); pubs++; } if (thb()) { await TB.publishLive(rooms, code, "b", mb); pubs++; }
    if (lb) { if (await TB.reportLoss(rooms, code, "b", lb, mb)) lossWrites++; if (await TB.reportLoss(rooms, code, "b", lb, mb)) lossWrites++; }
    if (la) { if (await TB.reportLoss(rooms, code, "a", la, ma)) lossWrites++; }
    if (rooms.docs[code].status === "done") break;
  }
  const done = rooms.docs[code];
  check("live stats published ~1/s per player", pubs >= 2 * 10 && pubs <= 2 * 13);
  check("opponent sees B's reps via room doc", done.players.b.reps === mb.reps && done.players.a.reps > 0);
  check("B stopped -> loser b, winner a, single result write", done.status === "done" && done.loserUid === "b" && done.winnerUid === "a" && done.loseReason === "stopped" && lossWrites === 1);
  check("A breaking after result can't overwrite", (await TB.reportLoss(rooms, code, "a", "standing", ma)) === false && rooms.docs[code].loserUid === "b");
  await TB.recordResult(stats, done, "a"); await TB.recordResult(stats, done, "b");
  check("ranking: a +1 win, b +1 loss", stats.docs.a.wins === 1 && stats.docs.a.losses === 0 && stats.docs.b.losses === 1 && stats.docs.b.wins === 0);
  check("best TUT/reps stored", stats.docs.a.bestTutMs === done.players.a.tutMs && stats.docs.b.bestReps === mb.reps);
  check("recording twice is idempotent", (await TB.recordResult(stats, done, "a")) === false && stats.docs.a.wins === 1);
  check("board order", TB.rankStats(Object.values(stats.docs))[0].uid === "a");
  if (R.includes(false)) process.exit(1);
})();
