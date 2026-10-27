// In-memory Firestore stand-in for the room / arena controllers: serialised transactions, dotted-path patches, server clock T.
module.exports = function mockFs() {
  const S = { T: 1_000_000, docs: {}, subs: {} }; const SERVER = { __ts: 1 }, DEL = { __del: 1 };
  const clone = (o) => (o == null ? null : JSON.parse(JSON.stringify(o)));
  const deep = (v) => (v === SERVER ? S.T : v === DEL ? DEL : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
  const strip = (v) => { if (v && typeof v === "object" && !Array.isArray(v)) { Object.keys(v).forEach((k) => { if (v[k] === DEL) delete v[k]; else strip(v[k]); }); } return v; };
  function applyPatch(d, p) { d = clone(d) || {}; for (const [k, v] of Object.entries(p)) { const ks = k.split("."); let o = d; for (const s of ks.slice(0, -1)) o = o[s] = o[s] || {}; const last = ks[ks.length - 1]; if (v === DEL) delete o[last]; else o[last] = deep(v); } return d; }
  const emit = (c) => setTimeout(() => (S.subs[c] || []).slice().forEach((f) => f(clone(S.docs[c]))));
  let lock = Promise.resolve();
  S.fs = {
    tx: (c, fn) => { const run = lock.then(async () => { await new Promise((r) => setTimeout(r, 1)); let next; const out = fn({ get: () => clone(S.docs[c]), set: (d) => (next = strip(deep(d))), update: (p) => (next = applyPatch(next || S.docs[c], p)) }); if (next) { S.docs[c] = strip(next); emit(c); } return out; }); lock = run.catch(() => {}); return run; }, // a throwing transaction must not poison the queue
    update: async (c, p) => { S.docs[c] = applyPatch(S.docs[c], p); emit(c); },
    watch: (c, cb) => { (S.subs[c] = S.subs[c] || []).push(cb); setTimeout(() => cb(clone(S.docs[c]))); return () => { S.subs[c] = S.subs[c].filter((f) => f !== cb); }; },
    ts: () => SERVER, del: () => DEL, toMs: (v) => (typeof v === "number" ? v : null),
  };
  return S;
};
