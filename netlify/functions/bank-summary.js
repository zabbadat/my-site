// GET /.netlify/functions/bank-summary[?n=100]  Public, read-only ZAB ranking for the Zab Bank Bot and the site.
// Names, totals and ranks only: never emails, never uids. Names that look like emails are replaced (holderName).
const { json, notConfigured, missingEnv, admin } = require("../lib/common");
const Z = require("../../zab-balance.js");
function summary(docs, n, nowMs) {
  const rows = Z.holdersView(docs, null, n).map((r) => ({ rank: r.rank, name: r.name, total: r.total }));
  return { ok: true, source: "zabbadat.com zabBoard", unit: "ZAB", generatedAt: new Date(nowMs || Date.now()).toISOString(), count: rows.length, holders: rows };
}
exports.summary = summary;
exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "GET only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  const n = Math.min(500, Math.max(1, parseInt((event.queryStringParameters || {}).n, 10) || 100));
  try {
    const snap = await admin().firestore().collection("zabBoard").orderBy("total", "desc").limit(500).get();
    const r = json(200, summary(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())), n));
    r.headers["Cache-Control"] = "public, max-age=60"; r.headers["Access-Control-Allow-Origin"] = "*";
    return r;
  } catch (e) { return json(500, { error: "Summary failed" }); }
};
