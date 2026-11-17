// Phase 1 Zero Face Exposure certificate: generator gates, signed artifacts, badge, report page, no private key in the repo.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { canonical } = require("../tools/pfp-cert/canonical");

const ROOT = path.join(__dirname, "..");
const RUN = path.join(ROOT, "tools/pfp-cert/run.js");
const R = [];
const check = (n, ok, why) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok || !why ? "" : " :: " + why}`); R.push(!!ok); };

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function writeKeypair(dir) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const priv = path.join(dir, "test-ed25519.pem");
  fs.writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return { priv, publicPem: publicKey.export({ type: "spki", format: "pem" }) };
}
function scenario(name, over) {
  const sc = { name, kind: "startup", surface: "push", view: "phone", res: "640x480", model: "normal", ...((over && over.sc) || {}) };
  if (over && over.sc) delete over.sc;
  return {
    sc, ok: true, proven: true,
    readbackFrames: 100, readbackExposed: 0,
    screencastFrames: 80, screencastExposed: 0,
    ...over
  };
}
function report(results, over) {
  return { when: "2026-11-16T15:00:00.000Z", quick: false, control: false, base: "http://127.0.0.1:8765", results, ...over };
}
function runCert(args, extraEnv) {
  const r = spawnSync(process.execPath, [RUN, ...args], { encoding: "utf8", env: { ...process.env, ...(extraEnv || {}) } });
  return r;
}

const work = tmpDir("pfp-cert-test-");
const { priv } = writeKeypair(work);
const out = path.join(work, "site");
fs.mkdirSync(out);

// --- fail closed ---
const exposedRep = path.join(work, "exposed.json");
fs.writeFileSync(exposedRep, JSON.stringify(report([
  scenario("startup-push-phone-640x480-model_normal"),
  scenario("startup-push-phone-640x480-model_slow", { screencastExposed: 3, ok: false })
])));
let r = runCert(["--domain", "zabbadat.com", "--report", exposedRep, "--out", out, "--key", priv]);
check("refuses a report with any exposed frame (exit 1)", r.status === 1);
check("exposed fail mentions the scenario", /FAIL/.test(r.stderr) && /startup-push-phone-640x480-model_slow/.test(r.stderr));
check("writes no cert JSON on an exposed fail", !fs.existsSync(path.join(out, "certs/zabbadat.com.json")));

const unprovenRep = path.join(work, "unproven.json");
fs.writeFileSync(unprovenRep, JSON.stringify(report([
  scenario("startup-push-phone-640x480-model_normal"),
  scenario("tracking-match-phone-640x480", { proven: false, ok: false, sc: { name: "tracking-match-phone-640x480", kind: "tracking", surface: "match", view: "phone", res: "640x480", model: "normal" } })
])));
r = runCert(["--domain", "zabbadat.com", "--report", unprovenRep, "--out", out, "--key", priv]);
check("refuses an unproven scenario (exit 1)", r.status === 1 && /UNPROVEN/.test(r.stderr));

const errRep = path.join(work, "error.json");
fs.writeFileSync(errRep, JSON.stringify(report([
  scenario("startup-push-phone-640x480-model_normal", { error: "page crashed", ok: false, proven: false })
])));
r = runCert(["--domain", "zabbadat.com", "--report", errRep, "--out", out, "--key", priv]);
check("refuses a scenario that errored", r.status === 1 && /ERROR/.test(r.stderr));

const controlRep = path.join(work, "control.json");
fs.writeFileSync(controlRep, JSON.stringify(report([scenario("startup-push-phone-640x480-model_normal")], { control: true })));
r = runCert(["--domain", "zabbadat.com", "--report", controlRep, "--out", out, "--key", priv]);
check("refuses a negative-control report", r.status === 1 && /negative-control/.test(r.stderr));

const quickRep = path.join(work, "quick.json");
fs.writeFileSync(quickRep, JSON.stringify(report([scenario("startup-push-phone-640x480-model_normal")], { quick: true })));
r = runCert(["--domain", "zabbadat.com", "--report", quickRep, "--out", out, "--key", priv]);
check("refuses a --quick report without --allow-quick", r.status === 1 && /quick proof/.test(r.stderr));

r = runCert([]);
check("usage error when --domain / --report are missing (exit 2)", r.status === 2);

// --- happy path ---
const passRep = path.join(work, "pass.json");
const results = [
  scenario("startup-push-phone-640x480-model_normal", { screencastFrames: 94, readbackFrames: 125 }),
  scenario("startup-match-desktop-640x480-model_blocked", { sc: { name: "startup-match-desktop-640x480-model_blocked", kind: "startup", surface: "match", view: "desktop", res: "640x480", model: "blocked" }, screencastFrames: 70, readbackFrames: 90 }),
  scenario("tracking-plank-phone-1280x720", { sc: { name: "tracking-plank-phone-1280x720", kind: "tracking", surface: "plank", view: "phone", res: "1280x720", model: "normal" }, screencastFrames: 200, readbackFrames: 240 })
];
fs.writeFileSync(passRep, JSON.stringify(report(results)));
r = runCert([
  "--domain", "zabbadat.com", "--report", passRep, "--out", out, "--key", priv,
  "--commit", "3615e34df6fce23afe2d326298bc8be5a1d2dc84",
  "--proof-commit", "8520855d6c99194c2951aceceeacc201a024249c",
  "--name", "Zabbadat", "--url", "https://www.zabbadat.com"
]);
check("issues a cert for a clean full report (exit 0)", r.status === 0, r.stderr || r.stdout.slice(0, 300));

const certPath = path.join(out, "certs/zabbadat.com.json");
const widePath = path.join(out, "certified/badge/zabbadat.com.svg");
const sqPath = path.join(out, "certified/badge/zabbadat.com-square.svg");
const pagePath = path.join(out, "certified/zabbadat.com/index.html");
const pubPath = path.join(out, "certified/pubkey");
const badgeJs = path.join(out, "certified/badge.js");
check("writes signed JSON, both badges, report page, pubkey, badge.js", [certPath, widePath, sqPath, pagePath, pubPath, badgeJs].every((f) => fs.existsSync(f)));

if (!fs.existsSync(certPath)) {
  console.log("FAIL  cannot read generated cert (generator failed earlier)");
  console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
  process.exit(1);
}
const cert = JSON.parse(fs.readFileSync(certPath, "utf8"));
check("cert names the domain, 90-day expiry, and commit", cert.domain === "zabbadat.com" && cert.expiresDays === 90 && cert.commit === "3615e34df6fce23afe2d326298bc8be5a1d2dc84" && cert.status === "valid");
check("threshold rules are strict zero on both checks", cert.thresholds.readback.maxGreenPixelsPerFrame === 0 && cert.thresholds.screencast.maxGreenPixelsPerFrame === 0);
const frames = 94 + 125 + 70 + 90 + 200 + 240;
check("totals are 0 exposed across all frames and all scenarios passed", cert.totals.framesExposed === 0 && cert.totals.framesChecked === frames && cert.totals.scenarios === 3 && cert.totals.scenariosPassed === 3);
check("scenario rows keep both check counts and PASS", cert.scenarios.length === 3 && cert.scenarios.every((s) => s.result === "PASS" && s.screencastExposed === 0 && s.readbackExposed === 0));

const pubPem = fs.readFileSync(pubPath, "utf8");
const verified = crypto.verify(null, Buffer.from(canonical(cert), "utf8"), crypto.createPublicKey(pubPem), Buffer.from(cert.signature, "base64"));
check("Ed25519 signature verifies against /certified/pubkey", verified);
const tampered = JSON.parse(JSON.stringify(cert));
tampered.totals.framesExposed = 1;
const tamperedOk = crypto.verify(null, Buffer.from(canonical(tampered), "utf8"), crypto.createPublicKey(pubPem), Buffer.from(cert.signature, "base64"));
check("tampering with totals fails the signature", tamperedOk === false);
check("canonical form omits the signature field", !canonical(cert).includes("signature") && canonical(cert).includes("\"domain\":\"zabbadat.com\""));

const wide = fs.readFileSync(widePath, "utf8");
const square = fs.readFileSync(sqPath, "utf8");
const page = fs.readFileSync(pagePath, "utf8");
check("wide badge is 160x56, dark-on-lime, and names the product", /width="160"/.test(wide) && /height="56"/.test(wide) && /#0e1412/.test(wide) && /#C6FF00/.test(wide) && /ZERO FACE EXPOSURE/.test(wide) && /VERIFIED/.test(wide));
check("wide badge shows the test date and 0 of N frames exposed", /Nov 16, 2026/.test(wide) && /0 of 819 frames exposed/.test(wide));
check("square badge is 72x72 with the same claim", /width="72"/.test(square) && /VERIFIED/.test(square) && /0 of 819/.test(square));
check("both badges include a Zabbadat mark (ring + Z)", (wide.match(/<circle /g) || []).length >= 1 && (wide.match(/<path /g) || []).length >= 1 && /stroke="#fff"/.test(wide));

check("report page has one H1, Valid status, dates, and the commit", (page.match(/<h1>/g) || []).length === 1 && />Valid</.test(page) && /Nov 16, 2026/.test(page) && /3615e34/.test(page) && /90 days/.test(page));
check("report page table lists every scenario as PASS with zero exposed", /Startup · Push-ups · Phone/.test(page) && /Live Match/.test(page) && /Plank/.test(page) && (page.match(/class="pill pass">PASS/g) || []).length === 3);
check("report page totals match the report", /0 of 819 frames exposed/.test(page) && /3 of 3 scenarios passed/.test(page));
check("report explains both zero checks, unproven = fail, and links the open-source command", /bright green/.test(page) && /No tolerance/.test(page) && /no allowance for compression/i.test(page) && /did not really run counts as a fail/.test(page) && /npm run pfp-proof/.test(page) && /docs\/pfp-proof\.md/.test(page));
check("report offers an <a><img> embed and the optional hostname script", /certified\/badge\/zabbadat\.com\.svg/.test(page) && /certified\/badge\.js/.test(page) && /Unverified/.test(page) && /source of truth/.test(page));
check("report page verifies the signature client-side with WebCrypto Ed25519 and a fallback", /Ed25519/.test(page) && /signature check unavailable in this browser/.test(page) && /Verified/.test(page));

const bjs = fs.readFileSync(badgeJs, "utf8");
check("badge.js flags a foreign hostname as Unverified and accepts www", /Unverified/.test(bjs) && /replace\(\/\^www/.test(bjs) && /zab-zfe-badge/.test(bjs));

// Host check behavior, extracted without running a browser
function hostOk(hostname, domain) {
  const h = String(hostname || "").toLowerCase().replace(/^www\./, "");
  const d = String(domain || "").toLowerCase().replace(/^www\./, "");
  return !!d && h === d;
}
check("hostname check: zabbadat.com and www.zabbadat.com pass; other.com fails", hostOk("zabbadat.com", "zabbadat.com") && hostOk("www.zabbadat.com", "zabbadat.com") && hostOk("zabbadat.com", "www.zabbadat.com") && !hostOk("other.com", "zabbadat.com") && !hostOk("evil-zabbadat.com", "zabbadat.com"));

// --- repo hygiene (the real worktree, not the temp out) ---
function walkFiles(dir, acc) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}
const repoFiles = walkFiles(ROOT, []);
const pemInRepo = repoFiles.filter((f) => f.endsWith(".pem"));
check("repo contains no .pem files (private key stays outside)", pemInRepo.length === 0, pemInRepo.join(", "));
const leaked = [];
for (const f of repoFiles) {
  if (!/\.(js|mjs|md|json|html|svg|txt|toml|xml)$/.test(f) && path.basename(f) !== "pubkey") continue;
  if (path.basename(f) === "pubkey") continue;
  const t = fs.readFileSync(f, "utf8");
  if (t.includes("-----BEGIN " + "PRIVATE KEY-----")) leaked.push(path.relative(ROOT, f));
}
check("no committed file contains a PEM private key block", leaked.length === 0, leaked.join(", "));
check("docs/pfp-cert.md describes phase 2 claim flow, generalized proof, revocation, and limits", (() => {
  const d = fs.readFileSync(path.join(ROOT, "docs/pfp-cert.md"), "utf8");
  return /zabbadat-cert=/.test(d) && /meta name="zabbadat-cert"/.test(d) && /Detect \*\*any\*\* `<video>`/.test(d) && /revok/i.test(d) && /Native apps/.test(d) && /No phase 2 code/.test(d);
})());
check("package.json has npm run pfp-cert", /"pfp-cert": "node tools\/pfp-cert\/run\.js"/.test(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")));

// Existing repo public key, if already generated, should be a public PEM only
const repoPub = path.join(ROOT, "certified/pubkey");
if (fs.existsSync(repoPub)) {
  const t = fs.readFileSync(repoPub, "utf8");
  check("repo /certified/pubkey is a public key, not a private key", /BEGIN PUBLIC KEY/.test(t) && !/BEGIN PRIVATE KEY/.test(t));
} else {
  check("repo /certified/pubkey is a public key, not a private key", true); // will exist once issued; not required for this unit test
}

console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
process.exit(R.every(Boolean) ? 0 : 1);
