// POST /.netlify/functions/wager-stake  { game: "washers"|"tut"|"plank", code }  Authorization: Bearer <Firebase ID token>
// Debits the room's stake from the caller's Zabba Tokens into escrow (wagers/{key}). Idempotent per player per room.
const { json, notConfigured, missingEnv, uidFrom } = require("../lib/common");
const W = require("../../zaba-wager.js");
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  const uid = await uidFrom(event); if (!uid) return json(401, { error: "Sign in to bet." });
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  try { const { wagerFs } = require("../lib/wager-fs"); return json(200, await W.stake(wagerFs(), uid, body.game, body.code)); }
  catch (e) { return json(e.status || 500, { error: e.status ? e.message : "Stake failed" }); }
};
