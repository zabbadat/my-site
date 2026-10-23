// POST /.netlify/functions/wager-settle  { key }  Authorization: Bearer <Firebase ID token>
// Decides the battle from the room doc with the shared game logic and pays the pot / refunds exactly once.
const { json, notConfigured, missingEnv, uidFrom } = require("../lib/common");
const W = require("../../zaba-wager.js");
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  const uid = await uidFrom(event); if (!uid) return json(401, { error: "Sign in." });
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  if (typeof body.key !== "string" || !/^(washers|tut|plank)_[A-HJ-NP-Z2-9]{4}_\d{1,15}$/.test(body.key)) return json(400, { error: "Bad key" });
  try {
    const { wagerFs } = require("../lib/wager-fs"); const fs = wagerFs();
    const w = (await fs.db.doc("wagers/" + body.key).get()).data();
    if (!w || !w.players || !(uid in w.players)) return json(403, { error: "Not your wager." });
    return json(200, await W.settle(fs, body.key, Date.now()));
  } catch (e) { return json(e.status || 500, { error: e.status ? e.message : "Settle failed" }); }
};
