// Shared check for the Zab Bank Bot read-only key (ZAB_BANK_READ_KEY).
// Accepted only by bank-summary (Firebase sign-in OR this key) and send-summary (this key only).
// Missing or empty env var disables the key path. Constant-time compare. Never log the key.
const crypto = require("crypto");
const { bearer } = require("./status");

function headerVal(headers, name) {
  const want = String(name).toLowerCase();
  for (const k of Object.keys(headers || {})) {
    if (String(k).toLowerCase() === want) return String(headers[k] == null ? "" : headers[k]).trim();
  }
  return "";
}

function offeredKey(headers) {
  return headerVal(headers, "x-zab-read-key") || bearer(headers) || "";
}

function keysEqual(a, b) {
  const aa = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  const n = Math.max(aa.length, bb.length, 1);
  const pa = Buffer.alloc(n); aa.copy(pa);
  const pb = Buffer.alloc(n); bb.copy(pb);
  return crypto.timingSafeEqual(pa, pb) && aa.length === bb.length;
}

function expectedKey() {
  const v = process.env.ZAB_BANK_READ_KEY;
  return v ? String(v).trim() : "";
}

// True when the request presented the env key via X-Zab-Read-Key or Authorization: Bearer.
function readKeyOk(event) {
  const expected = expectedKey();
  if (!expected) return false;
  const got = offeredKey(event && event.headers);
  if (!got) return false;
  return keysEqual(got, expected);
}

async function bankReadAllowed(event) {
  if (readKeyOk(event)) return true;
  const { uidFrom } = require("./common");
  return !!(await uidFrom(event));
}

module.exports = { readKeyOk, bankReadAllowed, offeredKey, keysEqual };
