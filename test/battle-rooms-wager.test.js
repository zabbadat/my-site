// battle-rooms.js: optional create fields (stake) and canStart gate (both stakes in escrow before countdown).
const B = require("../battle-rooms.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
let T = 1e6; const docs = {}; const SV = { __ts: 1 };
const deep = (v) => (v === SV ? T : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
function apply(d, p) { d = clone(d); for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; o[ks[ks.length - 1]] = deep(v); } return d; }
let lock = Promise.resolve();
const fs = { tx: (c, fn) => (lock = lock.then(async () => { let next; const out = fn({ get: () => clone(docs[c]), set: (x) => (next = deep(x)), update: (p) => (next = apply(next || docs[c], p)) }); if (next) docs[c] = next; return out; })),
  update: async (c, p) => { docs[c] = apply(docs[c], p); }, watch: (c, cb) => { setTimeout(() => cb(clone(docs[c]))); return () => {}; }, ts: () => SV, del: () => ({}), toMs: (v) => (typeof v === "number" ? v : null) };
(async () => {
  let gate = false;
  const pa = B.controller(fs, { now: () => T, canStart: () => gate }), pb = B.controller(fs, { now: () => T, canStart: () => gate });
  const code = await pa.createRoom({ uid: "a", name: "A" }, { stake: 3 });
  check("stake stored on room at create", docs[code].stake === 3 && docs[code].status === "waiting" && docs[code].createdBy === "a");
  check("extra can't override core fields", (await pa.createRoom({ uid: "a", name: "A" }, { status: "live", players: {} })) && Object.values(docs).every((d) => d.status === "waiting"));
  await pb.joinRoom(code, { uid: "b", name: "B" });
  await pa.setReady(code, { uid: "a" }, true); await pb.setReady(code, { uid: "b" }, true);
  check("both ready but stakes missing: no countdown", docs[code].status === "waiting" && docs[code].startAt === null);
  gate = true; await pa.maybeStart(code);
  check("stakes in: countdown starts", docs[code].status === "countdown");
  const plain = B.controller(fs, { now: () => T }); const c2 = await plain.createRoom({ uid: "x", name: "X" });
  check("no-bet room has no stake field", !("stake" in docs[c2]));
  const pass = R.filter(Boolean).length; console.log(`${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
})();
