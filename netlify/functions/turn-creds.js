// POST /.netlify/functions/turn-creds   (no body, no sign-in: signed-out viewers need it too)
// Short-lived TURN relay credentials for the Live tab (zabba-live.js), from Cloudflare Realtime TURN:
//   POST https://rtc.live.cloudflare.com/v1/turn/keys/<CF_TURN_KEY_ID>/credentials/generate-ice-servers  { ttl: 7200 }
// Returns { iceServers: [...] } (each entry { urls, username?, credential? }), Cache-Control: no-store.
// Needs CF_TURN_KEY_ID and CF_TURN_API_SECRET (Netlify env vars, never in the repo; CF_TURN_API_SECRET holds the Cloudflare TURN key's API secret, sent as the Bearer value). If they are missing, the caller's origin
// isn't ours, the caller is over the rate limit, or Cloudflare fails, it answers { iceServers: [] } and the client falls back
// to public STUN only (most home wifi still connects; some cellular / symmetric-NAT viewers won't).
const CF = "https://rtc.live.cloudflare.com/v1/turn/keys/";
const TTL = 7200, CF_TIMEOUT_MS = 2500, RATE_MAX = 20, RATE_WINDOW_MS = 60000;
const ORIGINS = ["https://zabbadat.com", "https://www.zabbadat.com", "capacitor://localhost", "https://localhost"];
function allowedOrigins() {
  // Netlify sets URL (primary site URL) and DEPLOY_PRIME_URL (deploy preview / branch URL) at runtime.
  return ORIGINS.concat([process.env.URL, process.env.DEPLOY_PRIME_URL].filter(Boolean).map((u) => String(u).replace(/\/+$/, "")));
}
const header = (h, k) => { if (!h) return ""; const f = Object.keys(h).find((x) => x.toLowerCase() === k); return f ? String(h[f] || "") : ""; };
function originOf(event) {
  const o = header(event.headers, "origin");
  if (o) return o;
  const r = header(event.headers, "referer"); // some browsers omit Origin on same-origin requests
  try { return r ? new URL(r).origin : ""; } catch { return ""; }
}
// per warm instance: at most RATE_MAX calls per client IP per minute (cheap abuse brake, not a hard quota)
const hits = new Map();
function limited(ip, now) {
  if (!ip) return false;
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > RATE_WINDOW_MS) hits.delete(k);
  const h = hits.get(ip);
  if (!h || now - h.t > RATE_WINDOW_MS) { hits.set(ip, { t: now, n: 1 }); return false; }
  return ++h.n > RATE_MAX;
}
const reply = (statusCode, obj, origin) => ({ statusCode, body: JSON.stringify(obj), headers: Object.assign(
  { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" },
  origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" } : {}) });
const EMPTY = { iceServers: [] };
// Browsers can't use port 53 (Chrome/Firefox block it; the attempt just stalls ICE), so drop those URLs.
function clean(list) {
  if (!Array.isArray(list)) return [];
  return list.map((s) => {
    if (!s || typeof s !== "object") return null;
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === "string" && /^(stun|turns?):/.test(u) && !/:53(\?|$)/.test(u));
    if (!urls.length) return null;
    const o = { urls };
    if (typeof s.username === "string") o.username = s.username;
    if (typeof s.credential === "string") o.credential = s.credential;
    return o;
  }).filter(Boolean);
}
async function handler(event, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch, now = deps.now || Date.now;
  const origin = originOf(event), okOrigin = allowedOrigins().includes(origin);
  const cors = okOrigin ? origin : "";
  if (event.httpMethod === "OPTIONS") return reply(okOrigin ? 204 : 403, okOrigin ? {} : EMPTY, cors);
  if (event.httpMethod !== "POST") return reply(405, { error: "POST only", iceServers: [] }, cors);
  if (!okOrigin) return reply(403, EMPTY, "");
  const ip = header(event.headers, "x-nf-client-connection-ip") || header(event.headers, "client-ip") || (header(event.headers, "x-forwarded-for").split(",")[0] || "").trim();
  if (limited(ip, now())) return reply(429, EMPTY, cors);
  const keyId = process.env.CF_TURN_KEY_ID, secret = process.env.CF_TURN_API_SECRET;
  if (!keyId || !secret || typeof fetchFn !== "function") return reply(200, EMPTY, cors);
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), CF_TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(CF + encodeURIComponent(keyId) + "/credentials/generate-ice-servers", {
      method: "POST", headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: TTL }), signal: ac ? ac.signal : undefined });
    if (!res || !res.ok) return reply(200, EMPTY, cors);
    const data = await res.json();
    const list = clean(data && (data.iceServers && !Array.isArray(data.iceServers) ? [data.iceServers] : data.iceServers));
    return reply(200, { iceServers: list, ttl: TTL }, cors);
  } catch { return reply(200, EMPTY, cors); }
  finally { if (timer) clearTimeout(timer); }
}
exports.handler = (event) => handler(event);
exports._test = { handler, clean, allowedOrigins, hits, RATE_MAX, TTL };
