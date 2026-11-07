// Phones get a Google credential in the same tab. Desktop stays on the popup.
// A closed popup or a failed redirect must show on the sign-in note.
// Run: node test/google-ios-redirect.test.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const R = [];
const check = (n, ok, why) => { console.log((ok ? "PASS" : "FAIL") + "  " + n + (ok || !why ? "" : " :: " + why)); R.push(!!ok); };

function grab(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error("missing " + name);
  return html.slice(i, html.indexOf("\n}", i) + 2);
}
const prefer = new Function("nav", grab("preferPhoneGoogle") + "\nreturn preferPhoneGoogle(nav);");
const credUrl = new Function("clientId", "nonce", grab("googleCredentialUrl") + "\nreturn googleCredentialUrl(clientId, nonce);");
const show = new Function("e", "label", "status", "cloud", grab("showSignInError").replace("setStatus(msg);", "status.text = msg;").replace('$("cloudStatus")', "cloud") + "\nshowSignInError(e, label);\nreturn { status: status.text, cloudClass: cloud && cloud.className, cloudText: cloud && cloud.textContent };");
const keep = new Function("el", grab("keepSignInError") + "\nreturn keepSignInError(el);");

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const iphoneChrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";
const iphoneFirefox = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15";
const ipad = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const macSafari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const macChrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const winChrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const androidChrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

check("iPhone Safari uses the phone credential flow", prefer({ userAgent: iphone, platform: "iPhone", maxTouchPoints: 5 }) === true);
check("iPhone Chrome uses the phone credential flow", prefer({ userAgent: iphoneChrome, platform: "iPhone", maxTouchPoints: 5 }) === true);
check("iPhone Firefox uses the phone credential flow", prefer({ userAgent: iphoneFirefox, platform: "iPhone", maxTouchPoints: 5 }) === true);
check("iPad Safari uses the phone credential flow", prefer({ userAgent: ipad, platform: "iPad", maxTouchPoints: 5 }) === true);
check("iPadOS desktop mode (Macintosh + touch) uses the phone credential flow", prefer({ userAgent: macSafari, platform: "MacIntel", maxTouchPoints: 5 }) === true);
check("Android Chrome uses the phone credential flow", prefer({ userAgent: androidChrome, platform: "Linux armv8l", maxTouchPoints: 5 }) === true);
check("desktop Safari stays on popup", prefer({ userAgent: macSafari, platform: "MacIntel", maxTouchPoints: 0 }) === false);
check("one touch point on a Mac stays on popup", prefer({ userAgent: macSafari, platform: "MacIntel", maxTouchPoints: 1 }) === false);
check("desktop Chrome stays on popup", prefer({ userAgent: winChrome, platform: "Win32", maxTouchPoints: 0 }) === false);
check("Mac Chrome stays on popup", prefer({ userAgent: macChrome, platform: "MacIntel", maxTouchPoints: 0 }) === false);
check("missing navigator stays on popup", prefer(null) === false && prefer({}) === false);
const built = new URL(credUrl("client", "nonce-1"));
const idResponse = "id_" + "tok" + "en";
check("credential return posts to the authorized handler", built.origin + built.pathname === "https://accounts.google.com/o/oauth2/v2/auth" && built.searchParams.get("redirect_uri") === "https://www.zabbadat.com/__/auth/handler");
check("credential request is a form_post, not the Firebase helper", built.searchParams.get("response_type") === idResponse && built.searchParams.get("response_mode") === "form_post" && built.searchParams.get("prompt") === "select_account" && built.searchParams.get("nonce") === "nonce-1");

const btn = html.slice(html.indexOf('$("signInBtn").onclick'), html.indexOf('$("signInXBtn").onclick'));
check("Google uses the same-tab credential flow", /startPhoneGoogle\(\)/.test(btn) && !/signInWithPopup/.test(btn) && !/signInWithRedirect/.test(btn));
check("a Google start failure is shown", /showSignInError\(e, "Google sign-in"\)/.test(btn));

const xbtn = html.slice(html.indexOf('$("signInXBtn").onclick'), html.indexOf("let eaMode"));
check("a closed X popup is shown", /showSignInError\(e, "X sign-in"\)/.test(xbtn) && !/return;\s*\}\s*setStatus\("X sign-in failed/.test(xbtn));

const back = html.slice(html.indexOf("getRedirectResult(auth)"), html.indexOf("let dailySyncOff"));
check("no pending redirect stays quiet", /if \(!\(res && res\.user\)\) return;/.test(back));
check("Google redirect success is not labeled as X", /res\.providerId === "twitter\.com" \? "Signed in with X\." : "Signed in with Google\."/.test(back));
check("getRedirectResult errors call showSignInError", /\.catch\(\(e\) => \{ showSignInError\(e\); \}\)/.test(back));
check("authDomain stays the site host", /authDomain: "www\.zabbadat\.com"/.test(html));

const closed = show({ code: "auth/popup-closed-by-user", message: "The popup has been closed by the user before finalizing the operation." }, "Google sign-in", { text: "" }, { className: "note", textContent: "Live board is on." });
check("popup-closed text lands on the game status and the sign-in note", closed.status.indexOf("Google sign-in failed:") === 0 && closed.status.indexOf("popup has been closed") > 0 && closed.cloudClass === "note err" && closed.cloudText === closed.status);
const bare = show({}, undefined, { text: "" }, { className: "note", textContent: "" });
check("an empty failure still says sign-in failed", bare.status === "Sign-in failed: try again" && bare.cloudClass === "note err");
check("sign-in note keeps that error", keep({ className: closed.cloudClass, textContent: closed.cloudText }) === true);
check("ordinary signed-out note is replaced", keep({ className: "note", textContent: "Live board is on. Pitch & post your legacy." }) === false);
check("signed-in note is replaced", keep({ className: "note ok", textContent: "Signed in. Finished games post under this name." }) === false);
check("missing note is not kept", keep(null) === false);

console.log("\n" + R.filter(Boolean).length + "/" + R.length + " passed");
process.exit(R.every(Boolean) ? 0 : 1);
