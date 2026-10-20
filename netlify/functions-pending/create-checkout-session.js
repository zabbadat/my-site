const { SITE, json, notConfigured, missingEnv, admin, stripe, uidFrom } = require("../lib/common");
const NEED = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "FIREBASE_SERVICE_ACCOUNT"];
exports.handler = async (event) => {
  const missing = missingEnv(NEED);
  if (event.httpMethod === "GET") return missing.length ? notConfigured(missing) : json(200, { configured: true });
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (missing.length) return notConfigured(missing);
  try {
    const uid = await uidFrom(event);
    if (!uid) return json(401, { error: "Sign in required" });
    const s = stripe(), db = admin().firestore();
    const snap = await db.doc(`members/${uid}`).get();
    let customerId = snap.exists ? snap.get("stripeCustomerId") : null;
    if (!customerId) {
      const found = await s.customers.search({ query: `metadata['uid']:'${uid.replace(/'/g, "")}'`, limit: 1 }).catch(() => ({ data: [] }));
      if (found.data[0]) customerId = found.data[0].id;
      else {
        const u = await admin().auth().getUser(uid).catch(() => null);
        customerId = (await s.customers.create({ email: (u && u.email) || undefined, metadata: { uid } })).id;
      }
      await db.doc(`members/${uid}`).set({ stripeCustomerId: customerId, updatedAt: admin().firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    const session = await s.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: uid,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: { metadata: { uid } },
      success_url: `${SITE}/?member=success`,
      cancel_url: `${SITE}/?member=cancel`,
    });
    return json(200, { url: session.url });
  } catch (e) { console.error(e); return json(500, { error: "Could not start checkout" }); }
};
