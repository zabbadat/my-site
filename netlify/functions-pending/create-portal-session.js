const { SITE, json, notConfigured, missingEnv, admin, stripe, uidFrom } = require("../lib/common");
const NEED = ["STRIPE_SECRET_KEY", "FIREBASE_SERVICE_ACCOUNT"];
exports.handler = async (event) => {
  const missing = missingEnv(NEED);
  if (event.httpMethod !== "POST") return missing.length ? notConfigured(missing) : json(405, { error: "POST only" });
  if (missing.length) return notConfigured(missing);
  try {
    const uid = await uidFrom(event);
    if (!uid) return json(401, { error: "Sign in required" });
    const snap = await admin().firestore().doc(`members/${uid}`).get();
    const customer = snap.exists ? snap.get("stripeCustomerId") : null;
    if (!customer) return json(404, { error: "No membership found for this account" });
    const p = await stripe().billingPortal.sessions.create({ customer, return_url: `${SITE}/#membership` });
    return json(200, { url: p.url });
  } catch (e) { console.error(e); return json(500, { error: "Could not open the membership portal" }); }
};
