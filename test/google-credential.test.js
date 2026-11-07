// Phone returns (form post, query, or fragment) must be handed to the homepage.
// The handler page must not be the page that signs in. Firebase helper queries stay proxied.
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
  const hand = mod.handOffHtml(mod.credHash(cred));
  check("form post hands the credential to the homepage hash", hand.indexOf("location.replace") > 0 && hand.indexOf("/#" + ID_FIELD + "=") > 0 && hand.indexOf(cred) > 0 && hand.indexOf("signInWithCredential") < 0);
  check("handler source does not sign in on the bounce page", edgeSrc.indexOf("signInWithCredential") < 0);
  check("error page escapes markup", mod.errorHtml("<b>").indexOf("<b>") === -1 && mod.errorHtml("<b>").indexOf("&lt;b&gt;") > 0);
  check("apiKey query stays proxied", mod.routeHandler("GET", "?apiKey=1&authType=signInViaPopup") === "proxy");
  check("code and state are not treated as Firebase", mod.routeHandler("GET", "?code=abc&state=xyz") === "fragment");
  check("bare GET is the fragment reader", mod.routeHandler("GET", "") === "fragment");
  check("oauth code post is a visible error", mod.acceptGooglePost("code=abc&scope=email&session_state=s", "", pageId, now).action === "error");
  check("query credential is not proxied", mod.routeHandler("GET", "?" + ID_FIELD + "=abc.def.ghi") === "query-cred");

  let proxied = 0;
  const deps = { clientId: pageId, now: () => now, proxy: async () => { proxied++; return new Response("proxied", { status: 200 }); } };
  const bare = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler"), deps);
  const bareBody = await bare.text();
  check("bare GET is our fragment page", bare.status === 200 && bare.headers.get("cache-control") === "no-store" && bareBody.indexOf("location.hash") > 0 && bareBody.indexOf("no credential was returned") > 0 && proxied === 0);
  const popupGet = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler?apiKey=1&authType=signInViaPopup"), deps);
  check("firebase helper query is proxied", popupGet.status === 200 && proxied === 1);
  const postHelper = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler", { method: "POST", body: "providerId=google.com" }), deps);
  check("non-credential POST is proxied", postHelper.status === 200 && proxied === 2);
  const postCred = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler", { method: "POST", body: ID_FIELD + "=" + cred, headers: { cookie: "zabba_gis_nonce=n1" } }), deps);
  const postBody = await postCred.text();
  check("credential POST redirects home and does not sign in here", postCred.status === 200 && postBody.indexOf("location.replace") > 0 && postBody.indexOf(cred) > 0 && postBody.indexOf("signInWithCredential") < 0 && proxied === 2 && (postCred.headers.get("set-cookie") || "").indexOf("zabba_gis_cred=") === 0);
  const queryCred = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler?" + ID_FIELD + "=" + cred), deps);
  const queryBody = await queryCred.text();
  check("query credential redirects home", queryCred.status === 200 && queryBody.indexOf(cred) > 0 && proxied === 2);
  const postBad = await mod.handleAuthRequest(new Request("https://www.zabbadat.com/__/auth/handler", { method: "POST", body: ID_FIELD + "=" + jwt({ ...good, aud: "nope" }) }), deps);
  const badBody = await postBad.text();
  check("bad credential is sent home as an error", postBad.status === 200 && badBody.indexOf("gsi_err=") > 0 && proxied === 2);

  function grab(name) {
    const i = html.indexOf("function " + name + "(");
    if (i < 0) throw new Error("missing " + name);
    return html.slice(i, html.indexOf("\n}", i) + 2);
  }
  const readHash = new Function("hash", grab("readPhoneGoogleHash") + "\nreturn readPhoneGoogleHash(hash);");
  const credOk = new Function("cred", "clientId", "nowMs", grab("phoneGooglePayload") + "\n" + grab("phoneGoogleCredOk") + "\nreturn phoneGoogleCredOk(cred, clientId, nowMs);");
  const pending = new Function("cookie", grab("phoneGooglePending") + "\nreturn phoneGooglePending(cookie);");
  const readCookie = new Function("cookie", grab("readPhoneGoogleCookie") + "\nreturn readPhoneGoogleCookie(cookie);");
  check("homepage ignores a normal hash", readHash("#play") === null);
  check("homepage reads the forwarded credential", (readHash("#" + ID_FIELD + "=" + cred) || {}).cred === cred);
  check("homepage reads a returned error", (readHash("#gsi_err=access_denied") || {}).err === "access_denied");
  check("homepage accepts this project's credential", credOk(cred, pageId, now) === true);
  check("homepage rejects a foreign credential", credOk(jwt({ ...good, aud: "other.apps.googleusercontent.com" }), pageId, now) === false);
  check("homepage clears the hash and signs in there", /readPhoneGoogleHash\(location\.hash\)/.test(html) && /history\.replaceState\(null, "", location\.pathname \+ location\.search\)/.test(html) && /function applyPhoneGoogleCred\(cred, err, missing\)/.test(html) && /signInWithCredential\(auth, GoogleAuthProvider\.credential\(c\)\)/.test(html));
  check("pending phone return with no credential is an error", pending("zabba_gis_pending=1") === true && pending("") === false && /no credential was returned/.test(html));
  check("homepage can read the credential cookie", readCookie("zabba_gis_cred=" + encodeURIComponent(cred)) === cred);
  check("phones pass a callback and choose popup or redirect", /callback:\s*onPhoneGisCredential/.test(html) && /ux_mode:\s*popup \? "popup" : "redirect"/.test(html) && /itp_support:\s*true/.test(html) && /login_uri:\s*"https:\/\/www\.zabbadat\.com\/__\/auth\/handler"/.test(html) && /google\.accounts\.id\.renderButton\(/.test(html) && /if \(!popup\) opts\.click_listener = markPhoneGooglePending/.test(html) && /applyPhoneGoogleCred\(cred, err, false\)/.test(html) && /await applyPhoneGoogleCred\(cred, err, missing\)/.test(html));
  const gisFn = html.slice(html.indexOf("function mountPhoneGis"), html.indexOf("function showSignInError"));
  check("GIS button is not script-clicked", gisFn.indexOf(".click(") < 0);
  const gisPopup = new Function("win", "nav", grab("phoneGisPopup") + "\nreturn phoneGisPopup(win, nav);");
  const iphoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  check("Chromium with an iPhone UA uses popup", gisPopup({ chrome: {} }, { userAgent: iphoneUa }) === true);
  check("iPhone Safari uses redirect", gisPopup({}, { userAgent: iphoneUa }) === false);
  check("CriOS uses redirect", gisPopup({ chrome: {} }, { userAgent: iphoneUa.replace("Version/18.5", "CriOS/131.0") }) === false);
  check("desktop popup call is still present", /await signInWithPopup\(auth, provider\)/.test(html));
  check("netlify runs the handler edge function", /\[\[edge_functions\]\][\s\S]*function = "google-credential"[\s\S]*path = "\/__\/auth\/handler"/.test(toml));

  function runFragment(loc) {
    const script = (mod.fragmentPage().match(/<script>\n([\s\S]*)<\/script>/) || [])[1];
    const logs = [];
    const document = { getElementById: () => ({ set textContent(v) { logs.push("msg:" + v); } }) };
    const location = { hash: loc.hash || "", search: loc.search || "", replace: (u) => logs.push("go:" + u) };
    new Function("location", "document", "URLSearchParams", "encodeURIComponent", script)(location, document, URLSearchParams, encodeURIComponent);
    return logs;
  }
  check("fragment credential is forwarded home", runFragment({ hash: "#" + ID_FIELD + "=" + cred })[0] === "go:/#" + ID_FIELD + "=" + encodeURIComponent(cred));
  check("empty fragment shows an error", /no credential was returned/.test(runFragment({ hash: "" }).join(" ")));

  const home = await import("../netlify/edge-functions/home-google-post.js");
  const homeSrc = fs.readFileSync(path.join(__dirname, "..", "netlify", "edge-functions", "home-google-post.js"), "utf8");
  let nexts = 0;
  const ctx = { next: () => { nexts++; return new Response("site", { status: 200 }); } };
  const getHome = await home.default(new Request("https://www.zabbadat.com/"), ctx);
  check("GET / continues to the site", getHome.status === 200 && await getHome.text() === "site" && nexts === 1);
  const postOther = await home.default(new Request("https://www.zabbadat.com/", { method: "POST", body: "providerId=google.com" }), ctx);
  check("unrelated POST / continues to the site", postOther.status === 200 && nexts === 2);
  const liveCred = jwt({ ...good, exp: Math.floor(Date.now() / 1000) + 300 });
  const postHome = await home.default(new Request("https://www.zabbadat.com/", { method: "POST", body: "credential=" + encodeURIComponent(liveCred) }), ctx);
  const postHomeBody = await postHome.text();
  check("credential POST / is handed to the homepage", postHome.status === 200 && nexts === 2 && postHomeBody.indexOf("location.replace") > 0 && postHomeBody.indexOf(liveCred) > 0);
  const postCodeHome = await home.default(new Request("https://www.zabbadat.com/", { method: "POST", body: "code=abc&scope=email" }), ctx);
  check("code POST / is a visible error", postCodeHome.status === 200 && nexts === 2 && (await postCodeHome.text()).indexOf("gsi_err=") > 0);
  check("homepage edge does not proxy to Firebase", homeSrc.indexOf("proxyToFirebase") < 0 && homeSrc.indexOf("context.next()") > 0);
  console.log("\n" + R.filter(Boolean).length + "/" + R.length + " passed");
  process.exit(R.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
