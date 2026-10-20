// Tests for members.js. Run: node test/members.test.js
const M = require("../members.js");
const S = require("../netlify/lib/status.js");
const R = [];
const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
for (const s of ["active", "trialing"]) check("active: " + s, M.isActiveStatus(s) && S.isActiveStatus(s));
for (const s of ["past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "", null, undefined, 1])
  check("inactive: " + s, !M.isActiveStatus(s) && !S.isActiveStatus(s));
check("no doc", M.memberFromDoc(null).active === false);
check("active doc", M.memberFromDoc({ status: "active", active: true, stripeCustomerId: "cus" }).active);
check("active flag must agree", !M.memberFromDoc({ status: "active", active: false }).active);
check("canceled doc", !M.memberFromDoc({ status: "canceled", active: true }).active);
const now = Date.UTC(2026, 9, 20);
check("stale period end", !M.memberFromDoc({ status: "active", active: true, currentPeriodEnd: { seconds: now / 1000 - 3 * 86400 } }, now).active);
check("future period end", M.memberFromDoc({ status: "active", active: true, currentPeriodEnd: { toMillis: () => now + 86400000 } }, now).active);
check("status text not configured", /coming soon/.test(M.statusText({}, true, false)));
check("status text signed out", /Sign in/.test(M.statusText({}, false, true)));
const rec = S.memberRecord({ id: "sub_1", status: "trialing", customer: "cus_1", current_period_end: 1800000000, items: { data: [{ price: { id: "price_1" } }] } });
check("record", rec.active && rec.subscriptionId === "sub_1" && rec.stripeCustomerId === "cus_1" && rec.priceId === "price_1" && rec.currentPeriodEnd === 1800000000000);
const rec2 = S.memberRecord({ id: "s", status: "active", customer: { id: "cus_2" }, items: { data: [{ current_period_end: 1700000000, price: { id: "p" } }] } });
check("record item-level period end + expanded customer", rec2.currentPeriodEnd === 1700000000000 && rec2.stripeCustomerId === "cus_2");
check("bearer parse", S.bearer({ authorization: "Bearer abc" }) === "abc" && S.bearer({ Authorization: "bearer x" }) === "x" && S.bearer({}) === null);
check("raw body b64", S.rawBody({ body: Buffer.from("hi").toString("base64"), isBase64Encoded: true }).toString() === "hi");
const ok = R.every(Boolean); console.log(ok ? "ALL PASS" : "SOME FAILED"); process.exit(ok ? 0 : 1);
