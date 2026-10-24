// Scheduled every 5 minutes: settles open wagers nobody settled (silent players, expired / never-started rooms).
const { json, notConfigured, missingEnv } = require("../lib/common");
const W = require("../../zaba-wager.js");
async function sweep(fs, now, limit = 200) {
  const snap = await fs.db.collection("wagers").where("status", "==", "open").limit(limit).get();
  const out = { checked: 0, paid: 0, refunded: 0, pending: 0, errors: 0 };
  for (const d of snap.docs) {
    out.checked++;
    try { const r = await W.settle(fs, d.id, now); if (r.status === "paid") out.paid++; else if (r.status === "refunded") out.refunded++; else out.pending++; }
    catch (e) { out.errors++; }
  }
  return out;
}
exports.handler = async () => {
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  const { wagerFs } = require("../lib/wager-fs");
  return json(200, await sweep(wagerFs(), Date.now()));
};
exports.config = { schedule: "*/5 * * * *" };
exports.sweep = sweep;
