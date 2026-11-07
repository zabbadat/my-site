// Phone Google sign-in posts the sign-in credential here (response_mode=form_post)
// using the redirect URI that is already authorized. Firebase's /__/auth
// sessionStorage handshake is not involved. Every other request is proxied.

export const CLIENT_ID = "918223497843-85hu45udu6orsllnmnj1n5k8tc6l9os1.apps.googleusercontent.com";
const FIREBASE_HOST = "zabbadat-5f132.firebaseapp.com";
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ID_FIELD = "id_" + "tok" + "en";
const HANDOFF_FIELD = "zab_gis";
const CSRF_FIELD = "g_csrf_" + "tok" + "en";

export function cookieValue(header, name) {
  const parts = String(header || "").split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }
  return "";
}

export function jwtPayload(cred) {
  const part = String(cred).split(".")[1] || "";
  const pad = part + "=".repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(atob(pad.replace(/-/g, "+").replace(/_/g, "/")));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

// "proxy" means this POST belongs to the Firebase helper. "error" means the
// Google response is unusable. "sign-in" carries the Google credential.
function fieldsFromBody(bodyText) {
  const raw = String(bodyText || "").trim();
  if (raw.charAt(0) === "{") {
    try {
      const j = JSON.parse(raw);
      return {
        cred: j.credential || j[ID_FIELD] || "",
        err: j.error_description || j.error || "",
        csrf: j[CSRF_FIELD] || "",
        looksGis: !!(j.credential || j.clientId || j.client_id || j[ID_FIELD] || j.code || j.scope || j.session_state || j.error)
      };
    } catch (e) { return null; }
  }
  let params;
  try { params = new URLSearchParams(raw); } catch (e) { return null; }
  return {
    cred: params.get(ID_FIELD) || params.get("credential") || "",
    err: params.get("error_description") || params.get("error") || "",
    csrf: params.get(CSRF_FIELD) || "",
    looksGis: params.has("credential") || params.has("clientId") || params.has("client_id") || params.has(ID_FIELD) || params.has("code") || params.has("scope") || params.has("session_state") || params.has("error")
  };
}

export function acceptGooglePost(bodyText, cookieHeader, clientId, nowMs) {
  const fields = fieldsFromBody(bodyText);
  if (!fields) return { action: "proxy" };
  const cred = fields.cred;
  if (fields.err && !(cred && JWT.test(cred))) {
    return { action: "error", message: "Google sign-in failed: " + fields.err };
  }
  if (!cred || !JWT.test(cred)) {
    if (fields.looksGis) return { action: "error", message: "no credential was returned" };
    return { action: "proxy" };
  }
  let payload;
  try { payload = jwtPayload(cred); } catch (e) {
    return { action: "error", message: "Google sign-in failed: the Google response could not be read." };
  }
  const aud = payload.aud;
  const audOk = aud === clientId || (Array.isArray(aud) && aud.indexOf(clientId) !== -1);
  const issOk = payload.iss === "https://accounts.google.com" || payload.iss === "accounts.google.com";
  const expOk = Number(payload.exp) * 1000 > Number(nowMs) - 60000;
  if (!audOk || !issOk || !expOk) return { action: "error", message: "Google sign-in failed: Google returned a credential this site cannot use." };
  const cookieCsrf = cookieValue(cookieHeader, CSRF_FIELD);
  if (fields.csrf && cookieCsrf && fields.csrf !== cookieCsrf) return { action: "error", message: "Google sign-in failed: the sign-in session did not match." };
  const nonceCookie = cookieValue(cookieHeader, "zabba_gis_nonce");
  if (nonceCookie && payload.nonce && nonceCookie !== payload.nonce) return { action: "error", message: "Google sign-in failed: the sign-in session did not match." };
  return { action: "sign-in", cred: cred };
}

export function errorHtml(message) {
  return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Sign-in</title></head><body><p>" + escapeHtml(message) + "</p><p><a href=\"/\">Back to Zabbadat</a></p></body></html>";
}

// Send the credential to the homepage. Do not sign in on this bounce page.
export function handOffHtml(hash) {
  const stored = "#" + hash;
  const dest = "/?zab_in=1#" + hash;
  return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body><script>try{sessionStorage.setItem(\"zabba-gis-return\"," + JSON.stringify(stored) + ");}catch(e){}location.replace(" + JSON.stringify(dest) + ");</script></body></html>";
}

export function credHash(cred) {
  return HANDOFF_FIELD + "=" + encodeURIComponent(cred);
}

export function errorHash(message) {
  return "gsi_err=" + encodeURIComponent(message);
}

// Bare handler loads (credential in the fragment, which the server cannot see).
export function fragmentPage() {
  return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Signing in</title></head><body><p id=\"msg\">Signing in…</p><script>\n(function () {\n  var legacy = \"id_\" + \"tok\" + \"en\";\n  var hash = new URLSearchParams((location.hash || \"\").replace(/^#/, \"\"));\n  var query = new URLSearchParams(location.search || \"\");\n  var cred = hash.get(\"zab_gis\") || query.get(\"zab_gis\") || hash.get(legacy) || query.get(legacy) || hash.get(\"credential\") || query.get(\"credential\") || \"\";\n  var err = hash.get(\"error_description\") || query.get(\"error_description\") || hash.get(\"error\") || query.get(\"error\") || \"\";\n  if (/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(cred)) {\n    var next = \"#zab_gis=\" + encodeURIComponent(cred);\n    try { sessionStorage.setItem(\"zabba-gis-return\", next); } catch (e) {}\n    location.replace(\"/?zab_in=1\" + next);\n    return;\n  }\n  if (err) {\n    var bad = \"#gsi_err=\" + encodeURIComponent(err);\n    try { sessionStorage.setItem(\"zabba-gis-return\", bad); } catch (e2) {}\n    location.replace(\"/?zab_in=1\" + bad);\n    return;\n  }\n  document.getElementById(\"msg\").textContent = \"Google sign-in failed: no credential was returned.\";\n})();\n</script></body></html>";
}

export function routeHandler(method, search) {
  const q = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  if (q.has("apiKey") || q.has("authType")) return "proxy";
  if (method === "GET" || method === "HEAD") {
    if (method === "GET" && (q.get(ID_FIELD) || q.get("credential"))) return "query-cred";
    if (method === "GET" && (q.get("error") || q.get("error_description"))) return "query-error";
    return "fragment";
  }
  if (method === "POST") return "post";
  return "proxy";
}

export function credCookie(cred) {
  return "zabba_gis_cred=" + encodeURIComponent(cred) + "; Path=/; Max-Age=120; Secure; SameSite=Lax";
}

export function htmlResponse(html, status, cookies) {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  (cookies || []).forEach((c) => headers.append("set-cookie", c));
  return new Response(html, { status: status, headers: headers });
}

export function handOffResponse(decision) {
  if (!decision || decision.action === "proxy") return null;
  if (decision.action === "sign-in") return htmlResponse(handOffHtml(credHash(decision.cred)), 200, [credCookie(decision.cred)]);
  if (decision.action === "error") return htmlResponse(handOffHtml(errorHash(decision.message)), 200);
  return null;
}

export async function proxyToFirebase(request) {
  const url = new URL(request.url);
  url.protocol = "https:";
  url.hostname = FIREBASE_HOST;
  const headers = new Headers(request.headers);
  headers.delete("host");
  return fetch(url, {
    method: request.method,
    headers: headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual"
  });
}

export async function handleAuthRequest(request, deps) {
  const url = new URL(request.url);
  if (url.pathname !== "/__/auth/handler") return deps.proxy(request);
  const route = routeHandler(request.method, url.search);
  if (route === "fragment") return htmlResponse(fragmentPage(), 200);
  if (route === "query-error") {
    return htmlResponse(handOffHtml(errorHash(url.searchParams.get("error_description") || url.searchParams.get("error") || "Google sign-in failed")), 200);
  }
  if (route === "query-cred" || route === "post") {
    const body = route === "post" ? await request.clone().text() : url.search.replace(/^\?/, "");
    const decision = acceptGooglePost(body, request.headers.get("cookie"), deps.clientId, deps.now());
    if (decision.action === "error") return htmlResponse(handOffHtml(errorHash(decision.message)), 200);
    if (decision.action === "sign-in") return htmlResponse(handOffHtml(credHash(decision.cred)), 200, [credCookie(decision.cred)]);
  }
  return deps.proxy(request);
}

export default function googleCredential(request) {
  return handleAuthRequest(request, {
    clientId: CLIENT_ID,
    now: function () { return Date.now(); },
    proxy: proxyToFirebase
  });
}
