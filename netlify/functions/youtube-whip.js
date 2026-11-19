// POST /.netlify/functions/youtube-whip
// Returns a WHIP ingest URL for the live-match "YouTube" option when LIVE_WHIP_URL is set
// on the server (a relay such as Cloudflare Stream or MediaMTX that forwards RTMP to YouTube).
// The YouTube stream key must stay on the relay only — this function never reads or returns
// YOUTUBE_STREAM_KEY. If the ingest URL is missing, { configured: false } is returned.
const ORIGINS = ["https://zabbadat.com", "https://www.zabbadat.com", "capacitor://localhost", "https://localhost"];
function allowedOrigins() {
  return ORIGINS.concat([process.env.URL, process.env.DEPLOY_PRIME_URL].filter(Boolean).map((u) => String(u).replace(/\/+$/, "")));
}
const header = (h, k) => { if (!h) return ""; const f = Object.keys(h).find((x) => x.toLowerCase() === k); return f ? String(h[f] || "") : ""; };
function originOf(event) {
  const o = header(event.headers, "origin");
  if (o) return o;
  const r = header(event.headers, "referer");
  try { return r ? new URL(r).origin : ""; } catch { return ""; }
}
const reply = (statusCode, obj, origin) => ({ statusCode, body: JSON.stringify(obj), headers: Object.assign(
  { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" },
  origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" } : {}) });

async function handler(event) {
  const origin = originOf(event), okOrigin = allowedOrigins().includes(origin);
  const cors = okOrigin ? origin : "";
  if (event.httpMethod === "OPTIONS") return reply(okOrigin ? 204 : 403, okOrigin ? {} : { configured: false }, cors);
  if (event.httpMethod !== "POST") return reply(405, { error: "POST only", configured: false }, cors);
  if (!okOrigin) return reply(403, { configured: false }, "");
  const whip = String(process.env.LIVE_WHIP_URL || "").trim();
  if (!whip) return reply(200, { configured: false }, cors);
  return reply(200, { configured: true, whipUrl: whip }, cors);
}
exports.handler = (event) => handler(event);
exports._test = { handler, allowedOrigins };
