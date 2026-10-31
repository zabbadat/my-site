// POST /.netlify/functions/zab-send  { to: <recipient uid from zabBoard>, amount: <whole ZAB>, key: <idempotency key> }
// Authorization: Bearer <Firebase sign-in credential>. Moves ZAB between two players in one transaction (zab-transfer.js).
const { json, notConfigured, missingEnv, uidFrom } = require("../lib/common");
const X = require("../../zab-transfer.js");
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  const uid = await uidFrom(event); if (!uid) return json(401, { error: "Sign in to send ZAB." });
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  try { const { wagerFs } = require("../lib/wager-fs"); return json(200, await X.send(wagerFs(), uid, body)); }
  catch (e) { return json(e.status || 500, { error: e.status ? e.message : "Send failed" }); }
};
