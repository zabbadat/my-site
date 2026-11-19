// POST /.netlify/functions/youtube-whip
// Two jobs, both server-side only:
//   1. JSON body (or empty): { configured: true|false }. Never returns a publish
//      password, user, or the YouTube stream key.
//   2. Content-Type application/sdp (and PATCH / DELETE with ?session=): proxy the
//      WHIP session to the MediaMTX (or other) relay, attaching publish credentials
//      from Netlify env. The browser talks only to this function.
//
// Env (set on Netlify later; not set in this branch):
//   LIVE_WHIP_URL                 e.g. https://live.zabbadat.com/washers/whip
//                                 or http://USER:PASS@host:8889/washers/whip
//   LIVE_WHIP_USER                publish user (optional if the URL already has userinfo)
//   LIVE_WHIP_PASSWORD            publish password (optional if the URL already has userinfo)
// Aliases: LIVE_WHIP_PUBLISH_USER / LIVE_WHIP_PUBLISH_PASSWORD
// The YouTube stream key stays on the relay. This function never reads it.
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
const reply = (statusCode, obj, origin, extra) => ({ statusCode, body: typeof obj === "string" ? obj : JSON.stringify(obj), headers: Object.assign(
  { "Content-Type": typeof obj === "string" ? "application/sdp" : "application/json", "Cache-Control": "no-store", Vary: "Origin" },
  origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Expose-Headers": "Location", "Access-Control-Max-Age": "600" } : {},
  extra || {}) });

function relayConfig() {
  let url = String(process.env.LIVE_WHIP_URL || "").trim();
  let user = String(process.env.LIVE_WHIP_USER || process.env.LIVE_WHIP_PUBLISH_USER || "").trim();
  let pass = String(process.env.LIVE_WHIP_PASSWORD || process.env.LIVE_WHIP_PUBLISH_PASSWORD || "").trim();
  if (url) {
    try {
      const u = new URL(url);
      if (u.username || u.password) {
        if (!user) user = decodeURIComponent(u.username || "");
        if (!pass) pass = decodeURIComponent(u.password || "");
        u.username = "";
        u.password = "";
        url = u.toString();
      }
    } catch (e) {}
  }
  return { url, user, pass, configured: !!url };
}
function basicAuth(user, pass) {
  if (!user && !pass) return "";
  return "Basic " + Buffer.from(String(user) + ":" + String(pass), "utf8").toString("base64");
}
// Session query is a path on the same relay (e.g. /washers/whip/xxxx). Refuse absolute URLs and userinfo.
function sessionPath(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length > 500) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return ""; // no scheme
  if (s.includes("@") || s.includes("\\") || s.includes("..")) return "";
  const path = s.startsWith("/") ? s : "/" + s;
  if (!/^\/[A-Za-z0-9._~/-]+$/.test(path)) return "";
  return path;
}
function relayOrigin(whipUrl) {
  try { const u = new URL(whipUrl); return u.origin; } catch (e) { return ""; }
}
function clientLocation(event, path) {
  const proto = header(event.headers, "x-forwarded-proto") || "https";
  const host = header(event.headers, "host") || "www.zabbadat.com";
  return `${proto}://${host}/.netlify/functions/youtube-whip?session=${encodeURIComponent(path)}`;
}
function locationPathFromRelay(location, whipUrl) {
  if (!location) return "";
  try {
    const abs = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(location) ? location : new URL(location, whipUrl).toString();
    const u = new URL(abs);
    u.username = ""; u.password = "";
    return u.pathname + (u.search || "");
  } catch (e) { return ""; }
}

async function proxy(event, cfg, method, targetUrl, body, contentType) {
  const headers = { Accept: "application/sdp, application/json, */*" };
  const auth = basicAuth(cfg.user, cfg.pass);
  if (auth) headers.Authorization = auth;
  if (contentType) headers["Content-Type"] = contentType;
  const init = { method, headers };
  if (body != null && method !== "DELETE") init.body = body;
  const r = await fetch(targetUrl, init);
  const text = await r.text();
  const loc = r.headers.get("location") || r.headers.get("Location") || "";
  const path = locationPathFromRelay(loc, cfg.url);
  const extra = {};
  if (path) extra.Location = clientLocation(event, path);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const asSdp = ct.includes("application/sdp") || /^v=0/i.test(text);
  return reply(r.status, asSdp || method === "DELETE" ? text : (text || "{}"), originOf(event) && allowedOrigins().includes(originOf(event)) ? originOf(event) : "", extra);
}

async function handler(event) {
  const origin = originOf(event), okOrigin = allowedOrigins().includes(origin);
  const cors = okOrigin ? origin : "";
  if (event.httpMethod === "OPTIONS") return reply(okOrigin ? 204 : 403, okOrigin ? {} : { configured: false }, cors);
  if (!okOrigin) return reply(403, { configured: false }, "");
  const cfg = relayConfig();
  const ct = header(event.headers, "content-type").toLowerCase();
  const session = sessionPath((event.queryStringParameters || {}).session);
  const method = event.httpMethod;

  if ((method === "PATCH" || method === "DELETE") && session) {
    if (!cfg.configured) return reply(200, { configured: false, error: "Relay is not configured" }, cors);
    const target = relayOrigin(cfg.url) + session;
    return proxy(event, cfg, method, target, event.body || "", ct || "application/trickle-ice-sdpfrag");
  }

  if (method === "POST" && (ct.includes("application/sdp") || /^\s*v=0/i.test(String(event.body || "")))) {
    if (!cfg.configured) return reply(200, { configured: false, error: "Relay is not configured" }, cors);
    return proxy(event, cfg, "POST", cfg.url, event.body || "", "application/sdp");
  }

  if (method !== "POST") return reply(405, { error: "POST only, or PATCH/DELETE with a session", configured: false }, cors);
  // Status probe (JSON). Never include user, password, or a pre-authenticated ingest URL.
  if (!cfg.configured) return reply(200, { configured: false }, cors);
  return reply(200, { configured: true, whipUrl: "/.netlify/functions/youtube-whip" }, cors);
}
exports.handler = (event) => handler(event);
exports._test = { handler, allowedOrigins, relayConfig, sessionPath, locationPathFromRelay, basicAuth };
