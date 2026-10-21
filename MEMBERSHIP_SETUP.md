# Membership setup (Stripe + Firebase + Netlify)

> **Status (Oct 20, 2026): functions are parked in `netlify/functions-pending/`.** Every deploy that contains any Netlify Function (even a one-line test) fails on this site, so they are not active yet. Fix that first: open the failed deploy log in Netlify (Deploys) — likely Functions are disabled/blocked for the account or plan. Then `git mv netlify/functions-pending netlify/functions` and push. Until then the site shows "Membership is coming soon." with no buttons.

The code is deployed but stays dormant until these env vars exist. Until then the functions return `503 {"error":"Membership not configured"}` and the site shows "Membership is coming soon." with the buttons hidden.

## 1. Stripe account
1. Create an account at https://dashboard.stripe.com/register and finish business verification (needed for live payments).
2. Use **Test mode** first; repeat steps 2–5 in Live mode when ready.

## 2. Product and monthly price
Product catalog → **Add product** → name it (e.g. "ZabbaDat™ Membership") → Recurring, Monthly, set the price → Save. Open the price and copy its ID (`price_...`) → `STRIPE_PRICE_ID`.

## 3. API keys
Developers → API keys → copy the **Secret key** (`sk_test_...` / `sk_live_...`) → `STRIPE_SECRET_KEY`. (No publishable key is needed; Checkout is hosted.)

## 4. Customer Portal
Settings → Billing → **Customer portal** → activate it; allow cancel and payment-method updates; Save. (Do this in both Test and Live mode.)

## 5. Webhook
Developers → Webhooks → **Add endpoint**:
- URL: `https://www.zabbadat.com/.netlify/functions/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`

Copy the **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`.

## 6. Firebase service account
Firebase console (project `zabbadat-5f132`) → Project settings → **Service accounts** → Generate new private key. Paste the whole JSON (or its base64: `base64 -w0 key.json`) → `FIREBASE_SERVICE_ACCOUNT`. Keep this file private; don't commit it.

## 7. Firestore rules
Publish `firestore.rules` (Firebase console → Firestore → Rules → paste → Publish). It adds `members/{uid}`: the owner can read their own doc, nobody can write from the client.

## 8. Netlify env vars
Netlify → site `spectacular-cucurucho-a7d422` → Site configuration → Environment variables → add (scope: Functions):

| Var | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_...` |
| `STRIPE_PRICE_ID` | `price_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `FIREBASE_SERVICE_ACCOUNT` | service-account JSON or base64 |
| `SITE_URL` (optional) | defaults to `https://www.zabbadat.com` |

Then **Deploys → Trigger deploy** so functions pick them up.

## 9. Test
Sign in on the site → Membership → Join monthly → pay with card `4242 4242 4242 4242` → back on the site the status shows "Member: active" and the placeholder premium block unlocks. Manage membership opens the Stripe portal.

## Data written: `members/{uid}`
`stripeCustomerId, subscriptionId, status, active (status is active/trialing), currentPeriodEnd (ms), priceId, updatedAt`.

## Gating premium content
Add `data-premium` (hidden for non-members) or `data-premium="lock"` (greyed out, "Members only") to any element. In JS use `window.zabbadatMember`, `body.is-member`, or listen for the `zabbadat:membership` event.

## Caveats
- Membership follows the Firebase account (Google/X sign-in). It's tied to whichever login was used at checkout.
- Apple App Store rules generally require in-app purchase for digital subscriptions sold inside iOS apps; Google Play has similar billing rules. Keep the Join button off in the app builds (or use IAP) before store submission. Web Checkout on the website is fine.
