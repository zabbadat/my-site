// iOS app (ZabbaAuth plugin, build 7+): Google sign-in opens in Apple's sign-in sheet with state=zab_app and the
// handler sends the credential to com.zabbadat.app://signin#zab_gis=... Browsers and builds without the plugin
// keep the same-tab return to the homepage.
// Run: node test/app-google-signin.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = [];
const check = (n, ok, why) => { console.log((ok ? "PASS" : "FAIL") + "  " + n + (ok || !why ? "" : " :: " + why)); R.push(!!ok); };
const ID_FIELD = "id_" + "tok" + "en";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p) => b64url({ alg: "none" }) + "." + b64url(p) + ".sig";
const pageId = (html.match(/const GOOGLE_CLIENT_ID = "([^"]+)"/) || [])[1];

(async () => {
  const mod = await import("../netlify/edge-functions/google-credential.js");
  const now = Date.now();
  const cred = jwt({ iss: "https://accounts.google.com", aud: pageId, exp: Math.floor(now / 1000) + 300, nonce: "n1", sub: "u" });
  const deps = { clientId: pageId, now: () => now, proxy: async () => new Response("proxied", { status: 200 }) };
  const post = (body) => new Request("https://www.zabbadat.com/__/auth/handler", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });

  const app = await mod.handleAuthRequest(post(ID_FIELD + "=" + cred + "&state=zab_app"), deps);
  const loc = app.headers.get("location") || "";
  check("app return redirects to the app scheme with the credential", app.status === 302 && loc === "com.zabbadat.app://signin#zab_gis=" + encodeURIComponent(cred), app.status + " " + loc);
  check("app return sets no cookie", !app.headers.get("set-cookie"));
  const appErr = await mod.handleAuthRequest(post("error=access_denied&state=zab_app"), deps);
  check("app error goes back to the app too", appErr.status === 302 && /^com\.zabbadat\.app:\/\/signin#gsi_err=/.test(appErr.headers.get("location") || ""));
  const web = await mod.handleAuthRequest(post(ID_FIELD + "=" + cred), deps);
  const webHtml = await web.text();
  check("browser return is unchanged (homepage hand-off + cookie)", web.status === 200 && /location\.replace\("\/\?zab_in=1#zab_gis=/.test(webHtml) && /zabba_gis_cred=/.test(web.headers.get("set-cookie") || ""));
  const other = await mod.handleAuthRequest(post(ID_FIELD + "=" + cred + "&state=other"), deps);
  check("other state values keep the browser return", other.status === 200);

  // Page side: the app branch only runs with the ZabbaAuth plugin; the same-tab flow is untouched.
  const grab = (name) => { const i = html.indexOf("function " + name + "("); const a = html.lastIndexOf("\n", i); let d = 0, j = html.indexOf("{", i); for (; j < html.length; j++) { if (html[j] === "{") d++; else if (html[j] === "}" && --d === 0) break; } return html.slice(a + 1, j + 1); };
  const src = ["googleCredentialUrl", "nativeGoogleAuth", "startAppGoogle", "readPhoneGoogleHash", "phoneGooglePayload", "startPhoneGoogle", "markPhoneGooglePending"].map(grab).join("\n");
  function run(plugin, credOut) {
    const calls = { assign: [], applied: null, err: null, started: null };
    const window = { Capacitor: plugin ? { isNativePlatform: () => true, Plugins: { ZabbaAuth: plugin(calls, credOut) } } : undefined };
    const document = { cookie: "" };
    const location = { assign: (u) => calls.assign.push(u) };
    const f = new Function("window", "document", "location", "calls", "GOOGLE_CLIENT_ID", "atob",
      src + "\nasync function applyPhoneGoogleCred(c, e, m) { calls.applied = { c, e, m }; }\nfunction showSignInError(e) { calls.err = e.message; }\nstartPhoneGoogle(); return calls;");
    return f(window, document, location, calls, pageId, (s) => Buffer.from(s, "base64").toString("binary"));
  }
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const browser = run(null);
  check("browser: same-tab Google URL, no state", browser.assign.length === 1 && /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/.test(browser.assign[0]) && !/state=/.test(browser.assign[0]));
  let nonceSeen = "";
  const okPlugin = (calls) => ({ start: async (o) => { calls.started = o; nonceSeen = new URL(o.url).searchParams.get("nonce"); return { url: "com.zabbadat.app://signin#zab_gis=" + encodeURIComponent(jwt({ nonce: nonceSeen, aud: pageId })) }; } });
  const a = run(okPlugin); await tick();
  check("app: opens the sheet with state=zab_app, no same-tab navigation", a.assign.length === 0 && a.started && new URL(a.started.url).searchParams.get("state") === "zab_app" && a.started.callbackScheme === "com.zabbadat.app");
  check("app: the returned credential is applied", a.applied && a.applied.c && !a.applied.e && !a.err);
  const bad = run((calls) => ({ start: async () => ({ url: "com.zabbadat.app://signin#zab_gis=" + encodeURIComponent(jwt({ nonce: "other" })) }) })); await tick();
  check("app: a credential for another nonce is refused", !bad.applied && /did not match/.test(bad.err || ""));
  const cancel = run((calls) => ({ start: async () => ({ cancelled: true }) })); await tick();
  check("app: closing the sheet is quiet", !cancel.applied && !cancel.err);
  const failed = run((calls) => ({ start: async () => { throw new Error("sheet failed"); } })); await tick();
  check("app: a sheet failure shows a sign-in error", failed.err === "sheet failed");
  const errBack = run((calls) => ({ start: async () => ({ url: "com.zabbadat.app://signin#gsi_err=denied" }) })); await tick();
  check("app: a Google error is shown", errBack.applied && errBack.applied.e === "denied");

  const failedN = R.filter((x) => !x).length;
  console.log(failedN ? failedN + " FAILED" : "all " + R.length + " passed");
  process.exit(failedN ? 1 : 0);
})();
