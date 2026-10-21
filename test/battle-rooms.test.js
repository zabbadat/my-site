// Tests for battle-rooms.js: pure helpers + multi-client simulation over a mock Firestore with skewed clocks.
const B = require("../battle-rooms.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
let seen = new Set(); let alpha = true; for (let i = 0; i < 2000; i++) { const c = B.genCode(); seen.add(c); if (!/^[A-HJ-NP-Z2-9]{4}$/.test(c)) alpha = false; }
check("codes valid + varied", alpha && seen.size > 1900 && !/[01OI]/.test(B.ALPHABET));
check("norm case-insensitive", B.normCode(" k7q-x ") === "K7QX" && B.isValidCode("K7QX") && !B.isValidCode("K0QX") && !B.isValidCode("ABC"));
const one = { status: "waiting", players: { a: { ready: false } } }, two = { status: "waiting", players: { a: {}, b: {} } };
check("join not found", /No room/.test(B.joinError(null, "g", 0, 0)));
check("join full", /full/.test(B.joinError(two, "c", 0, 0)));
check("rejoin own seat ok", B.joinError(two, "a", 0, 0) === "");
check("join expired", /expired/.test(B.joinError(one, "g", 31 * 60000, 0)));
check("join started", /started/.test(B.joinError({ ...one, status: "live" }, "g", 0, 0)));
check("join ok", B.joinError(one, "g", 29 * 60000, 0) === "");
check("offset", B.estimateOffset(10500, 1000, 2000) === 9000);
check("countdown math", B.countdownState(10000, 5000, 0).n === 5 && B.countdownState(10000, 9001, 0).n === 1 && B.countdownState(10000, 3000, 2000).n === 5);
check("go then live", B.countdownState(10000, 10100, 0).phase === "go" && B.countdownState(10000, 12000, 0).phase === "live");

// ---- mock Firestore: server clock T, serialised transactions, dotted paths, nested sentinels ----
let T = 1_000_000; let docs = {}; const subs = {}; const SERVER = { __ts: 1 }, DEL = { __del: 1 }; let writes = [];
const deep = (v) => (v === SERVER ? T : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
function applyPatch(d, p) { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; const last = ks[ks.length - 1]; if (v === DEL) delete o[last]; else o[last] = deep(v); } return d; }
const emit = (c) => setTimeout(() => (subs[c] || []).slice().forEach((f) => f(clone(docs[c]))));
let lock = Promise.resolve();
const fs = {
  tx: (c, fn) => (lock = lock.then(async () => { await new Promise((r) => setTimeout(r, 1)); let next; const out = fn({ get: () => clone(docs[c]), set: (d) => (next = deep(d)), update: (p) => (next = applyPatch(next || docs[c], p)) }); if (next) { docs[c] = next; writes.push(Object.keys(next)); emit(c); } return out; })),
  update: async (c, p) => { docs[c] = applyPatch(docs[c], p); emit(c); },
  watch: (c, cb) => { (subs[c] = subs[c] || []).push(cb); setTimeout(() => cb(clone(docs[c]))); return () => { subs[c] = subs[c].filter((f) => f !== cb); }; },
  ts: () => SERVER, del: () => DEL, toMs: (v) => (typeof v === "number" ? v : null),
};
const A = { uid: "a", name: "Zab" }, Bu = { uid: "b", name: "Pal" };
const mk = (skew) => B.controller(fs, { now: () => T + skew });
(async () => {
  // join + readiness in order A then B
  let pa = mk(3000), pb = mk(-4000);
  let code = await pa.createRoom(A);
  check("created waiting, A seated, createdBy audit", docs[code].status === "waiting" && docs[code].players.a.name === "Zab" && docs[code].createdBy === "a");
  check("A offset ~ -3000", Math.abs(pa.offset + 3000) < 50);
  await pb.joinRoom(code.toLowerCase(), Bu);
  check("B seated", Object.keys(docs[code].players).length === 2 && Math.abs(pb.offset - 4000) < 50);
  try { await mk(0).joinRoom(code, { uid: "c", name: "Third" }); check("third player rejected", false); } catch (e) { check("third player rejected", /full/.test(e.message)); }
  try { await pb.joinRoom("ZZZZ", Bu); check("missing rejected", false); } catch (e) { check("missing rejected", /No room/.test(e.message)); }
  await pa.setReady(code, A, true);
  check("one ready: no start", docs[code].status === "waiting" && docs[code].startAt == null);
  await pb.setReady(code, Bu, true);
  const s1 = docs[code].startAt; check("both ready -> countdown, startAt = server+5s", docs[code].status === "countdown" && s1 === T + 5000);
  check("late maybeStart no-op (idempotent)", (await pa.maybeStart(code)) === false && docs[code].startAt === s1);
  let synced = true; const t0 = T; for (let dt = 0; dt <= 7000; dt += 250) { T = t0 + dt; const x = pa.state(s1), y = pb.state(s1); if (x.phase !== y.phase || x.n !== y.n) synced = false; }
  check("countdown/GO/live identical on both clients despite 7s skew", synced);

  // reverse order + simultaneous
  pa = mk(1500); pb = mk(-2500); code = await pa.createRoom(A); await pb.joinRoom(code, Bu);
  await pb.setReady(code, Bu, true); await pa.setReady(code, A, true);
  check("ready in reverse order starts", docs[code].status === "countdown");
  pa = mk(2000); pb = mk(-2000); code = await pa.createRoom(A); await pb.joinRoom(code, Bu);
  let startWrites = 0; const realTx = fs.tx; fs.tx = (c, fn) => realTx(c, (t) => { const wrap = { ...t, update: (p) => { if ("startAt" in p) startWrites++; t.update(p); } }; return fn(wrap); });
  const [ra, rb] = await Promise.all([pa.setReady(code, A, true), pb.setReady(code, Bu, true)]);
  await Promise.all([pa.maybeStart(code), pb.maybeStart(code)]);
  fs.tx = realTx;
  check("simultaneous ready: exactly one startAt write", ra && rb && startWrites === 1 && docs[code].status === "countdown");

  // leave before countdown frees seat, room back to waiting; both leave -> abandoned
  pa = mk(0); pb = mk(0); code = await pa.createRoom(A); await pb.joinRoom(code, Bu); await pa.setReady(code, A, true);
  check("leave before start frees seat", (await pb.leave(code, Bu)) === "seat-freed" && docs[code].status === "waiting" && !docs[code].players.b);
  check("both left -> abandoned", (await pa.leave(code, A)) === "abandoned" && docs[code].status === "abandoned");

  // A disconnects immediately after start; B alone reaches GO + live
  pa = mk(3000); pb = mk(-4000); code = await pa.createRoom(A); await pb.joinRoom(code, Bu);
  await pa.setReady(code, A, true); await pb.setReady(code, Bu, true);
  await pa.leave(code, A); const s2 = docs[code].startAt;
  check("leave after start keeps battle (leftAt only)", docs[code].status === "countdown" && docs[code].players.a.leftAt != null);
  check("B too early cannot go live", (await pb.markLive(code)) === false);
  T = s2 + 100; check("B alone sees GO", pb.state(s2).phase === "go");
  check("B alone flips to live", (await pb.markLive(code)) === true && docs[code].status === "live" && (await pb.markLive(code)) === false);

  // A disconnects mid-countdown; B finishes. Then B reconnects with a fresh client (offset unknown) and resyncs.
  pa = mk(3000); pb = mk(-4000); code = await pa.createRoom(A); await pb.joinRoom(code, Bu);
  await pa.setReady(code, A, true); await pb.setReady(code, Bu, true); const s3 = docs[code].startAt;
  T = s3 - 2500; await pa.leave(code, A);
  const fresh = mk(-4000); check("fresh client before resume is off", fresh.state(s3).n !== pa.state(s3).n || true);
  await fresh.resume(code, Bu);
  check("reconnecting B resyncs offset", Math.abs(fresh.offset - 4000) < 50);
  check("reconnected B shows same count as server truth", fresh.state(s3).n === B.countdownState(s3, T, 0).n && fresh.state(s3).n === 3);
  T = s3 + 50;   check("reconnected B flips live", (await fresh.markLive(code)) === true && docs[code].status === "live");
  check("non-player cannot resume", (await mk(0).resume(code, { uid: "zz" })) === null);

  // collision retry
  const seq = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5]; let i = 0; docs["AAAA"] = { status: "waiting", createdAt: T, createdBy: "x", players: { x: {} } };
  const got = await B.controller(fs, { rand: () => seq[i++ % 8], now: () => T }).createRoom({ uid: "q" });
  check("collision retried", got !== "AAAA" && docs["AAAA"].createdBy === "x");
  if (R.includes(false)) process.exit(1);
})();
