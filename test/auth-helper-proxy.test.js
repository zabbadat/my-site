// Safari (and other storage-partitioned browsers) reject signInWithRedirect when the
// Firebase helper runs on *.firebaseapp.com while the app runs on www.zabbadat.com.
// The supported fix is a same-origin authDomain plus a transparent reverse proxy of
// /__/auth/* (HTTP 200 rewrite, never a 301/302). Run: node test/auth-helper-proxy.test.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const bankHtml = fs.readFileSync(path.join(root, "bank.html"), "utf8");
const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
const R = [];
const check = (n, ok, why) => { console.log((ok ? "PASS" : "FAIL") + "  " + n + (ok || !why ? "" : " :: " + why)); R.push(!!ok); };

function firebaseConfig(html, file) {
  const m = html.match(/const firebaseConfig = \{([\s\S]*?)\n\s*\};/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split("\n")) {
    const f = line.match(/^\s*([A-Za-z0-9_]+):\s*"([^"]*)"\s*,?\s*$/);
    if (f) fields[f[1]] = f[2];
  }
  check(file + " has a firebaseConfig object", Object.keys(fields).length > 0);
  return fields;
}

const EXPECTED_KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
const indexCfg = firebaseConfig(indexHtml, "index.html");
const bankCfg = firebaseConfig(bankHtml, "bank.html");
check("index and bank use the same firebaseConfig", !!indexCfg && !!bankCfg && EXPECTED_KEYS.every((k) => indexCfg[k] && indexCfg[k] === bankCfg[k]), "keys diverged");
check("config keys are only the original web fields", !!indexCfg && EXPECTED_KEYS.every((k) => k in indexCfg) && Object.keys(indexCfg).length === EXPECTED_KEYS.length);
check("authDomain is the site host that serves the app", indexCfg && indexCfg.authDomain === "www.zabbadat.com");
check("authDomain is not the firebaseapp.com helper host", indexCfg && !/firebaseapp\.com/.test(indexCfg.authDomain));
check("project id is unchanged", indexCfg && indexCfg.projectId === "zabbadat-5f132");
check("storage bucket is unchanged", indexCfg && indexCfg.storageBucket === "zabbadat-5f132.firebasestorage.app");
check("messaging sender is unchanged", indexCfg && indexCfg.messagingSenderId === "918223497843");
check("app id is unchanged", indexCfg && indexCfg.appId === "1:918223497843:web:5d9bd1c2ce1b125b905806");
const omit = toml.match(/SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES\s*=\s*"([^"]+)"/);
check("apiKey is unchanged from the published web key", !!(indexCfg && omit && indexCfg.apiKey === omit[1]));

const blocks = toml.split("[[redirects]]").slice(1).map((b) => b.split(/\n\[/)[0]);
check("exactly one auth-helper proxy rule", blocks.length === 1, "found " + blocks.length);
function field(block, key) {
  const m = block.match(new RegExp("^\\s*" + key + "\\s*=\\s*(.+)\\s*$", "m"));
  if (!m) return null;
  const raw = m[1].trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  const q = raw.match(/^"([^"]*)"$/);
  return q ? q[1] : raw;
}
const rule = blocks[0] || "";
const from = field(rule, "from"), to = field(rule, "to"), status = field(rule, "status"), force = field(rule, "force");
check("proxy matches /__/auth/*", from === "/__/auth/*");
check("proxy target is the project firebaseapp.com helper", to === "https://zabbadat-5f132.firebaseapp.com/__/auth/:splat");
check("proxy is an HTTP 200 rewrite, not a browser redirect", status === 200);
check("proxy is forced so a static file cannot shadow the helper", force === true);
check("no 301 or 302 sends /__/auth off-site", !/^\s*status\s*=\s*30[12]\s*$/m.test(rule) && !/\/__\/auth\/\*\s+https?:\/\/\S+\s+30[12]/.test(toml));

// Netlify :splat keeps the helper path. These are the files the Auth JS SDK loads.
const HELPERS = ["handler", "handler.js", "experiments.js", "iframe", "iframe.js", "links", "links.js"];
function proxied(path) {
  const prefix = "/__/auth/";
  if (from !== "/__/auth/*" || !path.startsWith(prefix) || path.slice(prefix.length).includes("/")) return null;
  const splat = path.slice(prefix.length);
  return to.replace(":splat", splat);
}
HELPERS.forEach((name) => {
  const dest = proxied("/__/auth/" + name);
  check("proxies /__/auth/" + name, dest === "https://zabbadat-5f132.firebaseapp.com/__/auth/" + name);
});

check("desktop Google path still uses the popup", /await signInWithPopup\(auth, provider\)/.test(indexHtml) && /preferGoogleRedirect\(navigator\)/.test(indexHtml));
check("popup-blocked still falls back to signInWithRedirect", /e\.code === "auth\/popup-blocked" \|\| e\.code === "auth\/operation-not-supported-in-this-environment"[\s\S]*?await signInWithRedirect\(auth, provider\)/.test(indexHtml));
const redirectTail = indexHtml.slice(indexHtml.indexOf("getRedirectResult(auth)"), indexHtml.indexOf("getRedirectResult(auth)") + 420);
check("return path still reads getRedirectResult and shows its errors", /getRedirectResult\(auth\)/.test(redirectTail) && !/\.catch\(\(\) => \{\}\)/.test(redirectTail));

console.log("\n" + R.filter(Boolean).length + "/" + R.length + " passed");
process.exit(R.every(Boolean) ? 0 : 1);
