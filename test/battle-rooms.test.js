// Tests for battle-rooms.js, including a two-client simulation over a mock Firestore with skewed clocks.
const B = require("../battle-rooms.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
// pure
let seen = new Set(); for (let i = 0; i < 2000; i++) { const c = B.genCode(); seen.add(c); if (!/^[A-HJ-NP-Z2-9]{4}$/.test(c)) check("code alphabet " + c, false); }
check("codes valid + varied", seen.size > 1900 && !B.ALPHABET.match(/[01OI]/));
check("norm case-insensitive", B.normCode(" k7q-x ") === "K7QX" && B.isValidCode("K7QX") && !B.isValidCode("K0QX") && !B.isValidCode("ABC"));
const room = { hostUid: "h", status: "waiting", guestUid: null };
check("join not found", /No room/.test(B.joinError(null, "g", 0, 0)));
check("join own", /own room/.test(B.joinError(room, "h", 0, 0)));
check("join full", /full/.test(B.joinError({ ...room, guestUid: "x" }, "g", 0, 0)));
check("join expired", /expired/.test(B.joinError(room, "g", 31 * 60000, 0)));
check("join ok", B.joinError(room, "g", 29 * 60000, 0) === "");
check("join abandoned", /ended/.test(B.joinError({ ...room, status: "abandoned" }, "g", 0, 0)));
check("offset", B.estimateOffset(10500, 1000, 2000) === 9000);
check("countdown 5", B.countdownState(10000, 5000, 0).n === 5 && B.countdownState(10000, 9001, 0).n === 1);
check("countdown skew", B.countdownState(10000, 3000, 2000).n === 5);
check("go then live", B.countdownState(10000, 10100, 0).phase === "go" && B.countdownState(10000, 12000, 0).phase === "live");
// mock firestore: server clock T; each client has local clock T+skew
let T = 1_000_000; const docs = {}; const subs = {}; const SERVER = { __ts: 1 };
const emit = (c) => (subs[c] || []).forEach((f) => f(docs[c] ? { ...docs[c] } : null));
const resolve = (o) => { const r = {}; for (const k in o) r[k] = o[k] === SERVER ? T : o[k]; return r; };
const fs = {
  tx: async (c, fn) => { let next; const out = fn({ get: () => (docs[c] ? { ...docs[c] } : null), set: (d) => (next = resolve(d)), update: (p) => (next = { ...docs[c], ...resolve(p) }) }); if (next) { docs[c] = next; setTimeout(() => emit(c)); } return out; },
  update: async (c, p) => { docs[c] = { ...docs[c], ...resolve(p) }; setTimeout(() => emit(c)); },
  watch: (c, cb) => { (subs[c] = subs[c] || []).push(cb); setTimeout(() => cb(docs[c] ? { ...docs[c] } : null)); return () => { subs[c] = subs[c].filter((f) => f !== cb); }; },
  ts: () => SERVER, toMs: (v) => (typeof v === "number" ? v : null),
};
(async () => {
  const host = B.controller(fs, { now: () => T + 3000 });   // host clock 3s fast
  const guest = B.controller(fs, { now: () => T - 4000 });  // guest clock 4s slow
  const code = await host.createRoom({ uid: "h", name: "Zab" });
  check("created waiting", docs[code].status === "waiting" && docs[code].hostName === "Zab");
  check("host offset ~ -3000", Math.abs(host.offset + 3000) < 50);
  try { await host.joinRoom(code, { uid: "h" }); check("own room rejected", false); } catch (e) { check("own room rejected", /own room/.test(e.message)); }
  await guest.joinRoom(code.toLowerCase(), { uid: "g", name: "Pal" });
  check("joined ready", docs[code].status === "ready" && docs[code].guestName === "Pal");
  check("guest offset ~ +4000", Math.abs(guest.offset - 4000) < 50);
  try { await B.controller(fs, { now: () => T }).joinRoom(code, { uid: "z" }); check("full rejected", false); } catch (e) { check("full rejected", /full/.test(e.message)); }
  try { await guest.joinRoom("ZZZZ", { uid: "g" }); check("missing rejected", false); } catch (e) { check("missing rejected", /No room/.test(e.message)); }
  await host.start(code, { uid: "h" });
  const s = docs[code].startAt; check("startAt = server+5s", s === T + 5000 && docs[code].status === "countdown");
  let synced = true; for (let dt = 0; dt <= 7000; dt += 250) { T += dt === 0 ? 0 : 250; const a = host.state(s), b = guest.state(s); if (a.phase !== b.phase || a.n !== b.n) synced = false; }
  check("both clients show identical countdown/go/live despite 7s skew", synced);
  // collision retry
  let seq = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5], i = 0; const c2 = B.controller(fs, { rand: () => seq[i++ % 8], now: () => T });
  docs["AAAA"] = { status: "waiting", createdAt: T, hostUid: "x" };
  const got = await c2.createRoom({ uid: "q" }); check("collision retried", got !== "AAAA" && docs["AAAA"].hostUid === "x");
  await host.leave(code, docs[code], { uid: "h" }); check("host leave abandons", docs[code].status === "abandoned");
  if (R.includes(false)) process.exit(1);
})();
