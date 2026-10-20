// Pure helpers shared by the Stripe functions (tested in test/members.test.js).
const ACTIVE = ["active", "trialing"];
const isActiveStatus = (s) => typeof s === "string" && ACTIVE.includes(s);
const bearer = (h = {}) => { const v = h.authorization || h.Authorization || ""; const m = /^Bearer\s+(.+)$/i.exec(v); return m ? m[1].trim() : null; };
const rawBody = (event) => Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");
function memberRecord(sub) {
  const item = (sub.items && sub.items.data && sub.items.data[0]) || {};
  const end = sub.current_period_end || item.current_period_end || null; // newer API versions moved it to the item
  return {
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : (sub.customer && sub.customer.id) || null,
    subscriptionId: sub.id,
    status: sub.status,
    active: isActiveStatus(sub.status),
    currentPeriodEnd: end ? end * 1000 : null,
    priceId: (item.price && item.price.id) || null,
  };
}
module.exports = { ACTIVE, isActiveStatus, bearer, rawBody, memberRecord };
