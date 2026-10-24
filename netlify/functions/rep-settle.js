// POST /.netlify/functions/rep-settle  { code }  Authorization: Bearer <Firebase ID token>
// Scores a finished Zabba Washer Battle into repBoard/{uid} (reputation) exactly once (ledger repLog/{key}). No tokens involved.
const { json, notConfigured, missingEnv, uidFrom } = require("../lib/common");
const R = require("../../reputation.js");
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  const uid = await uidFrom(event); if (!uid) return json(401, { error: "Sign in." });
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  try {
    const { wagerFs } = require("../lib/wager-fs");
    return json(200, await R.settle(wagerFs(), uid, body.code));
  } catch (e) { return json(e.status || 500, { error: e.status ? e.message : "Reputation update failed" }); }
};
