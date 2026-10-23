// Firestore admin adapter for zaba-wager.js (server only). Paths are arrays; reads before writes inside one transaction.
const { admin } = require("./common");
function wagerFs() {
  const a = admin(), db = a.firestore(), FV = a.firestore.FieldValue;
  const ref = (p) => db.doc(p.join("/"));
  return {
    db,
    tx: (fn) => db.runTransaction((tr) => Promise.resolve(fn({
      get: (p) => tr.get(ref(p)).then((s) => (s.exists ? s.data() : null)),
      set: (p, d) => { tr.set(ref(p), d); },
      update: (p, patch) => { tr.update(ref(p), patch); },
    }))),
    ts: () => FV.serverTimestamp(),
    toMs: (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null),
  };
}
module.exports = { wagerFs };
