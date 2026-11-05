// GET /.netlify/functions/send-summary[?hours=24&n=200]
// Read-only recent player-to-player ZAB sends for the watchdog. Gated by ZAB_BANK_READ_KEY
// (X-Zab-Read-Key or Authorization: Bearer <key>). Missing env disables this path (401).
// Never writes. Output: from/to names, amounts (tenths), timestamps. Never emails, never uids.
const { json, notConfigured, missingEnv, admin } = require("../lib/common");
const { readKeyOk } = require("../lib/read-key");
const Z = require("../../zab-balance.js");
const ZC = require("../../zab-currency.js");

function tsIso(v) {
  if (v == null) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (typeof v.toMillis === "function") return new Date(v.toMillis()).toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v === "string" && v) { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : null; }
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000).toISOString();
  if (typeof v._seconds === "number") return new Date(v._seconds * 1000).toISOString();
  return null;
}

function summarizeSends(docs, nameByUid) {
  const names = nameByUid || {};
  const sends = [];
  for (const d of docs || []) {
    if (!d || d.source !== "transfer" || d.type !== "send") continue;
    const amount = ZC.isZab(Math.abs(Number(d.amount))) ? ZC.roundZab(Math.abs(Number(d.amount))) : null;
    if (amount == null || !(amount >= 0.1)) continue;
    const at = tsIso(d.createdAt); if (!at) continue;
    const from = Z.holderName({ name: names[d.uid] || d.fromName, uid: d.uid });
    const to = Z.holderName({ name: names[d.to] || d.toName, uid: d.to });
    sends.push({ from, to, amount, at });
  }
  sends.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return sends;
}

exports.summarizeSends = summarizeSends;
exports.tsIso = tsIso;
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  if (!readKeyOk(event)) return json(401, { error: "Read key required." });
  const qs = event.queryStringParameters || {};
  const hours = Math.min(168, Math.max(1, parseInt(qs.hours, 10) || 24));
  const n = Math.min(500, Math.max(1, parseInt(qs.n, 10) || 200));
  try {
    const db = admin().firestore();
    const sinceMs = Date.now() - hours * 3600 * 1000;
    const Timestamp = admin().firestore.Timestamp;
    const ts = Timestamp && Timestamp.fromMillis ? Timestamp.fromMillis(sinceMs) : new Date(sinceMs);
    const snap = await db.collectionGroup("zabLedger")
      .where("source", "==", "transfer")
      .where("type", "==", "send")
      .where("createdAt", ">=", ts)
      .orderBy("createdAt", "desc")
      .limit(n)
      .get();
    const docs = snap.docs.map((d) => Object.assign({}, d.data()));
    const ids = [];
    for (const d of docs) {
      if (d.uid && ids.indexOf(d.uid) < 0) ids.push(d.uid);
      if (d.to && ids.indexOf(d.to) < 0) ids.push(d.to);
    }
    const nameByUid = {};
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100).map((id) => db.doc("zabBoard/" + id));
      if (!chunk.length) continue;
      const got = await db.getAll(...chunk);
      for (const s of got) {
        if (s && s.exists) {
          const data = s.data() || {};
          nameByUid[s.id] = data.name;
        }
      }
    }
    const sends = summarizeSends(docs, nameByUid);
    const r = json(200, { ok: true, source: "zabbadat.com transfers", unit: "ZAB", generatedAt: new Date().toISOString(), windowHours: hours, count: sends.length, sends });
    r.headers["Cache-Control"] = "private, max-age=60";
    r.headers["Vary"] = "Authorization, X-Zab-Read-Key";
    return r;
  } catch (e) { return json(500, { error: "Summary failed" }); }
};
