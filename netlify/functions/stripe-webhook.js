const { json, notConfigured, missingEnv, admin, stripe } = require("../lib/common");
const { rawBody, memberRecord } = require("../lib/status");
const NEED = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "FIREBASE_SERVICE_ACCOUNT"];

async function uidForCustomer(s, customerId, hint) {
  if (hint) return hint;
  if (!customerId) return null;
  const c = await s.customers.retrieve(customerId);
  return (c && !c.deleted && c.metadata && c.metadata.uid) || null;
}
async function save(uid, rec) {
  const a = admin();
  await a.firestore().doc(`members/${uid}`).set({ ...rec, updatedAt: a.firestore.FieldValue.serverTimestamp() }, { merge: true });
}
exports.handler = async (event) => {
  const missing = missingEnv(NEED);
  if (missing.length) return notConfigured(missing);
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const s = stripe();
  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  let evt;
  try { evt = s.webhooks.constructEvent(rawBody(event), sig, process.env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { return json(400, { error: "Bad signature" }); }
  try {
    const o = evt.data.object;
    if (evt.type === "checkout.session.completed") {
      if (o.mode !== "subscription" || !o.subscription) return json(200, { ignored: true });
      const sub = await s.subscriptions.retrieve(o.subscription);
      const uid = await uidForCustomer(s, o.customer, o.client_reference_id || (sub.metadata && sub.metadata.uid));
      if (uid) await save(uid, memberRecord(sub));
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(evt.type)) {
      const uid = await uidForCustomer(s, o.customer, o.metadata && o.metadata.uid);
      if (uid) await save(uid, memberRecord(o));
    }
    return json(200, { received: true });
  } catch (e) { console.error(e); return json(500, { error: "Webhook handler failed" }); }
};
