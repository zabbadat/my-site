// POST /.netlify/functions/zab-earn  { source: pushups|tut|hold|plank|walk|washers|tutBattle, id: <session doc id / battle code> }
// Authorization: Bearer <Firebase sign-in credential>. Credits ZAB for one recorded session the caller owns, computed on the
// server from the stored session (zab-earn.js), once per session and source, within the per-claim and per-day caps.
// Needs FIREBASE_SERVICE_ACCOUNT and ZAB_EARN_SINCE (ms since epoch: sessions recorded before it can't be claimed; set it to
// the deploy time so sessions already credited by the old client-side path can't be claimed again).
const { json, notConfigured, missingEnv, uidFrom } = require("../lib/common");
const E = require("../../zab-earn.js");
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const miss = missingEnv(["FIREBASE_SERVICE_ACCOUNT", "ZAB_EARN_SINCE"]); if (miss.length) return notConfigured(miss);
  const since = Number(process.env.ZAB_EARN_SINCE); if (!(since > 0)) return notConfigured(["ZAB_EARN_SINCE"]);
  const uid = await uidFrom(event); if (!uid) return json(401, { error: "Sign in to earn ZAB." });
  let body = {}; try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad JSON" }); }
  try { const { wagerFs } = require("../lib/wager-fs"); return json(200, await E.claim(wagerFs(), uid, body, Date.now(), since)); }
  catch (e) { return json(e.status || 500, { error: e.status ? e.message : "Earn failed" }); }
};
