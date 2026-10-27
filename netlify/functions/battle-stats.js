// POST /.netlify/functions/battle-stats  { code, kind?: 'room' (default) | 'arena' }  Authorization: Bearer <Firebase sign-in credential>
// Counts a finished Zabba Washer Battle (a 1v1 room, or a 2v2 team arena) into the seasonal board
// washersBattleSeason/{season}_{uid} (public: name + counts), the private lifetime tally washersBattleLifetime/{uid}
// and the one-time guard washersBattleLog/{code}_{createdAtMs}, exactly once. Winner/loser come from the room doc
// (washers-battle.js decide() for a 1v1, washers-arena.js decide() for a 2v2: same checks as the phones). No ZAB is moved. Needs FIREBASE_SERVICE_ACCOUNT (Netlify env var).
const { json, notConfigured, missingEnv, uidFrom } = require("../lib/common");
const B = require("../../washers-battlers.js");
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  const uid = await uidFrom(event); if (!uid) return json(401, { error: "Sign in." });
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  try {
    const { wagerFs } = require("../lib/wager-fs");
    return json(200, await B.settle(wagerFs(), uid, body.code, Date.now(), body.kind));
  } catch (e) { return json(e.status || 500, { error: e.status ? e.message : "Battle stats update failed" }); }
};
