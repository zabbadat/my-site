// POST /.netlify/functions/zab-board  { name?: <board name> }  Authorization: Bearer <Firebase sign-in credential>
// Writes the caller's zabBoard entry on the server (zab-names.js): unique name (ignoring case, spaces, punctuation; names/{key}
// claim in the same transaction), reserved names refused, total copied from users/{uid}.zabBalance. Without a name it only
// refreshes the total (after a wager, for example). Needs FIREBASE_SERVICE_ACCOUNT (Netlify env var). Optional ZAB_NAME_OWNER_UIDS:
// comma-separated uids allowed to use reserved names (the owner's own account, e.g. "Zabbadat").
const { json, notConfigured, missingEnv, uidFrom } = require("../lib/common");
const N = require("../../zab-names.js");
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT"]); if (miss.length) return notConfigured(miss);
  const uid = await uidFrom(event); if (!uid) return json(401, { error: "Sign in first." });
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  try { const { wagerFs } = require("../lib/wager-fs"); return json(200, await N.setBoard(wagerFs(), uid, body, String(process.env.ZAB_NAME_OWNER_UIDS || "").split(",").map((x) => x.trim()).filter(Boolean))); }
  catch (e) { return json(e.status || 500, { error: e.status ? e.message : "Board update failed" }); }
};
