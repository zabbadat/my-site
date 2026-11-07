// The phone return posts a Google credential to /__/auth/handler. That post must
// become a Firebase signInWithCredential page. Firebase helper posts stay proxied.
// Run: node test/google-credential.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const edgeSrc = fs.readFileSync(path.join(__dirname, "..", "netlify", "edge-functions", "google-credential.js"), "utf8");
const toml = fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8");
const R = [];
const check = (n, ok, why) => { console.log((ok ? "PASS" : "FAIL") + "  " + n + (ok || !why ? "" : " :: " + why)); R.push(!!ok); };
const ID_FIELD = "id_" + "tok" + "en";
const CSRF_FIELD = "g_csrf_" + "tok" + "en";

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function jwt(payload) {
  return b64url({ alg: "none", typ: "JWT" }) + "." + b64url(payload) + ".sig";
}

const pageId = (html.match(/const GOOGLE_CLIENT_ID = "([^"]+)"/) || [])[1];
check("page names the Firebase web client", !!pageId && pageId.startsWith("918223497843-") && pageId.endsWith(".apps.googleusercontent.com"));
check("edge function uses the same client id", edgeSrc.indexOf(pageId) > 0);

(async () => {
  const mod = await import("../netlify/edge-functions/google-credential.js");
  const now = Date.parse("2026-11-07T20:00:00Z");
  const good = { iss: "https://accounts.google.com", aud: pageId, exp: Math.floor(now / 1000) + 300, nonce: "n1", sub: "u" };
  const cred = jwt(good);
  check("a Google credential post is accepted", mod.acceptGooglePost(ID_FIELD + "=" + cred, "", pageId, now).action === "sign-in");
  check("credential field is accepted too", mod.acceptGooglePost("credential=" + encodeURIComponent(cred), "", pageId, now).action === "sign-in");
  check("Firebase helper posts are proxied", mod.acceptGooglePost("providerId=google.com&sessionId=abc", "", pageId, now).action === "proxy");
  check("empty post is proxied", mod.acceptGooglePost("", "", pageId, now).action === "proxy");
  check("wrong audience is rejected", mod.acceptGooglePost(ID_FIELD + "=" + jwt({ ...good, aud: "other.apps.googleusercontent.com" }), "", pageId, now).action === "error");
  check("expired credential is rejected", mod.acceptGooglePost(ID_FIELD + "=" + jwt({ ...good, exp: Math.floor(now / 1000) - 120 }), "", pageId, now).action === "error");
  check("bad issuer is rejected", mod.acceptGooglePost(ID_FIELD + "=" + jwt({ ...good, iss: "https://evil.example" }), "", pageId, now).action === "error");
  check("csrf mismatch is rejected", mod.acceptGooglePost(ID_FIELD + "=" + cred + "&" + CSRF_FIELD + "=a", CSRF_FIELD + "=b", pageId, now).action === "error");
  check("matching csrf is accepted", mod.acceptGooglePost(ID_FIELD + "=" + cred + "&" + CSRF_FIELD + "=a", CSRF_FIELD + "=a", pageId, now).action === "sign-in");
  check("missing csrf cookie still accepts the credential", mod.acceptGooglePost(ID_FIELD + "=" + cred + "&" + CSRF_FIELD + "=a", "", pageId, now).action === "sign-in");
  check("nonce mismatch is rejected", mod.acceptGooglePost(ID_FIELD + "=" + cred, "zabba_gis_nonce=other", pageId, now).action === "error");
  check("matching nonce is accepted", mod.acceptGooglePost(ID_FIELD + "=" + cred, "zabba_gis_nonce=n1", pageId, now).action === "sign-in");
  check("Google error is shown", /access_denied/.test(mod.acceptGooglePost("error=access_denied&error_description=access_denied", "", pageId, now).message || ""));
  const page = mod.completionHtml(cred, { apiKey: "k", authDomain: "www.zabbadat.com", projectId: "zabbadat-5f132" });
  check("completion page signs in with the credential and returns home", page.indexOf("signInWithCredential") > 0 && page.indexOf("GoogleAuthProvider.credential") > 0 && page.indexOf("location.replace") > 0 && page.indexOf(cred) > 0);
  check("completion page does not ask the user to refresh", !/refresh/i.test(page));
  check("error page escapes markup", mod.errorHtml("<b>").indexOf("<b>") === -1 && mod.errorHtml("<b>").indexOf("&lt;b&gt;") > 0);

  let proxied = 0;
  const deps = { clientId: pageId, firebaseConfig: { apiKey: "k", authDomain: "www.zabbadat.com" }, now: () => now, proxy: async () => { proxied++; return new Response("proxied", { status: 200 }); } };
  const getRes = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler?apiKey=1"), deps);
  check("GET handler is proxied", getRes.status === 200 && proxied === 1);
  const postHelper = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler", { method: "POST", body: "providerId=google.com" }), deps);
  check("non-credential POST is proxied", postHelper.status === 200 && proxied === 2);
  const postCred = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler", { method: "POST", body: ID_FIELD + "=" + cred, headers: { cookie: "zabba_gis_nonce=n1" } }), deps);
  const postBody = await postCred.text();
  check("credential POST is the sign-in page, not the proxy", postCred.status === 200 && postCred.headers.get("cache-control") === "no-store" && postBody.indexOf("signInWithCredential") > 0 && proxied === 2);
  const postBad = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler", { method: "POST", body: ID_FIELD + "=" + jwt({ ...good, aud: "nope" }) }), deps);
  check("bad credential POST is an error page", postBad.status === 400 && proxied === 2);

  const cfg = {};
  const block = (html.match(/const firebaseConfig = \{([\s\S]*?)\n\s*\};/) || [])[1] || "";
  block.split("\n").forEach((line) => { const m = line.match(/^\s*([A-Za-z0-9_]+):\s*"([^"]*)"/); if (m) cfg[m[1]] = m[2]; });
  check("edge firebase config matches the page", ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"].every((k) => cfg[k] && edgeSrc.indexOf(cfg[k]) > 0));
  check("edge keeps authDomain on the site", edgeSrc.indexOf('authDomain: "www.zabbadat.com"') > 0);
  check("netlify runs the handler edge function", /\[\[edge_functions\]\][\s\S]*function = "google-credential"[\s\S]*path = "\/__\/auth\/handler"/.test(toml));
  console.log("\n" + R.filter(Boolean).length + "/" + R.length + " passed");
  process.exit(R.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
