// POST /.netlify/functions/wager-pot  { kind: "room" | "arena", code }  Authorization: Bearer <Firebase sign-in credential>
// Forms the ONE combined Zab pot of a Zabba Washer Battle (1v1 room or 2v2 arena), only when every seat is filled, locked in its own wager
// and agreed to the same pot total: all or nothing, every positive amount debited into wagers/{key} with a ledger entry. Idempotent.
// Payout and refunds happen in wager-settle / wager-sweep (same wagers/{key} guard doc). Needs FIREBASE_SERVICE_ACCOUNT (Netlify env var).
const { json, notConfigured, missingEnv, uidFrom } = require("../lib/common");
const P = require("../../washers-pot.js");
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  const uid = await uidFrom(event); if (!uid) return json(401, { error: "Sign in to wager." });
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  try { const { wagerFs } = require("../lib/wager-fs"); return json(200, await P.formPot(wagerFs(), uid, body.kind === "arena" ? "arena" : "room", body.code)); }
  catch (e) { return json(e.status || 500, { error: e.status ? e.message : "Wager pot failed" }); }
};
