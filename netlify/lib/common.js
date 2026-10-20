const { bearer } = require("./status");
const SITE = process.env.SITE_URL || "https://www.zabbadat.com";
const json = (statusCode, obj) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(obj) });
const notConfigured = (missing) => json(503, { error: "Membership not configured", configured: false, missing });
const missingEnv = (names) => names.filter((n) => !process.env[n]);

let _admin = null;
function admin() {
  if (_admin) return _admin;
  const a = require("firebase-admin");
  if (!a.apps.length) {
    let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
    a.initializeApp({ credential: a.credential.cert(JSON.parse(raw)) });
  }
  _admin = a; return a;
}
let _stripe = null;
const stripe = () => (_stripe ||= require("stripe")(process.env.STRIPE_SECRET_KEY));

async function uidFrom(event) {
  const t = bearer(event.headers);
  if (!t) return null;
  try { return (await admin().auth().verifyIdToken(t)).uid; } catch { return null; }
}
module.exports = { SITE, json, notConfigured, missingEnv, admin, stripe, uidFrom };
