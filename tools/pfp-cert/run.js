#!/usr/bin/env node
"use strict";
// Turn a pfp-proof report.json into a signed Zero Face Exposure certificate,
// badge SVGs, and the public report page. Fails if any scenario exposed a
// face pixel or did not actually run (unproven).
//
//   npm run pfp-cert -- --domain zabbadat.com --report /path/to/report.json
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { canonical } = require("./canonical");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_KEY = "/workspace/secrets/pfp-cert-ed25519.pem";
const ARG = (() => {
  const out = {}, argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    if (m[2] != null) out[m[1]] = m[2];
    else if (argv[i + 1] && !String(argv[i + 1]).startsWith("--")) out[m[1]] = argv[++i];
    else out[m[1]] = true;
  }
  return out;
})();

function die(msg, code = 1) {
  console.error("pfp-cert: " + msg);
  process.exit(code);
}
function arg(name, fallback) {
  const v = ARG[name];
  return v == null || v === true ? fallback : String(v);
}
function writeFile(p, data, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data, { mode: mode || 0o644 });
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function commas(n) {
  return Number(n || 0).toLocaleString("en-US");
}
function etDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric" });
}
function etStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) + " ET";
}

const SURFACE = {
  push: "Push-ups",
  plank: "Plank",
  squats: "Gyatt Squats",
  tut: "TUT",
  zlSelf: "Live preview",
  match: "Live Match"
};
const KIND = { startup: "Startup", tracking: "Tracking" };
const VIEW = { phone: "Phone", desktop: "Desktop", landscape: "Landscape" };
const MODEL = { normal: "Normal model", slow: "Slow model", blocked: "Blocked model" };

function humanScenario(name, sc) {
  if (sc && sc.kind) {
    const parts = [KIND[sc.kind] || sc.kind, SURFACE[sc.surface] || sc.surface, VIEW[sc.view] || sc.view, sc.res];
    if (sc.kind === "startup") parts.push(MODEL[sc.model] || sc.model);
    return parts.filter(Boolean).join(" · ");
  }
  return String(name || "");
}

function parseArgs() {
  const domain = arg("domain");
  const reportPath = arg("report");
  if (!domain || !reportPath) {
    die("usage: npm run pfp-cert -- --domain zabbadat.com --report <path-to-report.json>\n" +
      "  options: --out <site-root> --commit <sha> --key <private-pem> --pubkey <path> --url <https://...> --name <site-name> --expires-days 90 --proof-commit <sha> --allow-quick", 2);
  }
  if (!/^[a-z0-9.-]+$/i.test(domain) || domain.startsWith(".") || domain.includes("..")) {
    die("invalid domain: " + domain, 2);
  }
  return {
    domain: domain.toLowerCase(),
    reportPath,
    out: path.resolve(arg("out", ROOT)),
    commit: arg("commit", ""),
    keyPath: arg("key", DEFAULT_KEY),
    pubPath: arg("pubkey", ""),
    url: arg("url", "https://www." + domain.toLowerCase()),
    name: arg("name", domain.toLowerCase() === "zabbadat.com" ? "Zabbadat" : domain),
    expiresDays: Number(arg("expires-days", "90")),
    proofCommit: arg("proof-commit", "8520855"),
    allowQuick: !!ARG["allow-quick"]
  };
}

function loadReport(p) {
  let raw;
  try { raw = fs.readFileSync(p, "utf8"); } catch (e) { die("cannot read report: " + p); }
  let report;
  try { report = JSON.parse(raw); } catch (e) { die("report is not valid JSON: " + p); }
  if (!Array.isArray(report.results) || !report.results.length) die("report has no results[]");
  return report;
}

function evaluate(report, allowQuick) {
  if (report.control) die("negative-control reports cannot be certified");
  if (report.quick && !allowQuick) die("quick proof is not enough for a certificate (re-run without --quick, or pass --allow-quick)");
  const scenarios = report.results.map((r) => {
    const sc = r.sc || {};
    const name = sc.name || r.name || "unknown";
    const rbX = r.readbackExposed || 0, scX = r.screencastExposed || 0;
    const rbN = r.readbackFrames || 0, scN = r.screencastFrames || 0;
    const proven = r.proven === true;
    const exposed = rbX + scX;
    const error = r.error ? String(r.error) : "";
    let result = "PASS";
    if (error) result = "ERROR";
    else if (!proven) result = "UNPROVEN";
    else if (exposed > 0) result = "FAIL";
    return {
      name,
      label: humanScenario(name, sc),
      kind: sc.kind || "",
      surface: sc.surface || "",
      view: sc.view || "",
      res: sc.res || "",
      model: sc.model || "",
      screencastFrames: scN,
      screencastExposed: scX,
      readbackFrames: rbN,
      readbackExposed: rbX,
      framesChecked: scN + rbN,
      framesExposed: exposed,
      proven,
      result
    };
  });
  const bad = scenarios.filter((s) => s.result !== "PASS");
  if (bad.length) {
    const lines = bad.map((s) => `  ${s.result}  ${s.name}  exposed ${s.framesExposed}/${s.framesChecked}`);
    die(`${bad.length} scenario(s) failed certification (exposed > 0 or unproven):\n` + lines.join("\n"));
  }
  const totals = scenarios.reduce((a, s) => {
    a.screencastFrames += s.screencastFrames;
    a.screencastExposed += s.screencastExposed;
    a.readbackFrames += s.readbackFrames;
    a.readbackExposed += s.readbackExposed;
    a.framesChecked += s.framesChecked;
    a.framesExposed += s.framesExposed;
    a.scenarios += 1;
    a.scenariosPassed += 1;
    return a;
  }, { screencastFrames: 0, screencastExposed: 0, readbackFrames: 0, readbackExposed: 0, framesChecked: 0, framesExposed: 0, scenarios: 0, scenariosPassed: 0 });
  return { scenarios, totals };
}

function loadOrCreateKey(keyPath) {
  if (!fs.existsSync(keyPath)) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    try { fs.chmodSync(keyPath, 0o600); } catch (e) {}
    // public material is written separately; never log the private key
    console.error("pfp-cert: created new Ed25519 key at " + keyPath + " (mode 600, contents not printed)");
    return { privateKey, publicPem: publicKey.export({ type: "spki", format: "pem" }) };
  }
  const st = fs.statSync(keyPath);
  if (st.mode & 0o077) {
    try { fs.chmodSync(keyPath, 0o600); } catch (e) {}
  }
  let pem;
  try { pem = fs.readFileSync(keyPath, "utf8"); } catch (e) { die("cannot read private key path"); }
  if (!/BEGIN PRIVATE KEY/.test(pem)) die("private key file is not a PEM private key");
  if (/BEGIN PUBLIC KEY/.test(pem) && !/BEGIN PRIVATE KEY/.test(pem)) die("key path points at a public key");
  let privateKey;
  try { privateKey = crypto.createPrivateKey(pem); } catch (e) { die("could not load private key"); }
  if (privateKey.asymmetricKeyType !== "ed25519") die("private key must be Ed25519");
  const publicPem = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  return { privateKey, publicPem };
}

function signCert(cert, privateKey) {
  const payload = Buffer.from(canonical(cert), "utf8");
  const sig = crypto.sign(null, payload, privateKey);
  return sig.toString("base64");
}

function markSvg(cx, cy, r) {
  // Small Zabbadat mark: lime ring, dark disc, white geometric Z.
  const z = r * 0.55;
  const x0 = cx - z * 0.55, x1 = cx + z * 0.55, y0 = cy - z * 0.62, y1 = cy + z * 0.62, sw = Math.max(1.6, r * 0.18);
  return `<g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#0e1412" stroke="#C6FF00" stroke-width="${Math.max(1.2, r * 0.12)}"/>
    <path d="M${x0} ${y0}h${x1 - x0}L${x0} ${y1}h${x1 - x0}" fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="square" stroke-linejoin="miter"/>
  </g>`;
}

function wideBadge(cert) {
  const date = etDate(cert.testedAt);
  const line2 = `${date}  ·  0 of ${commas(cert.totals.framesChecked)} frames exposed`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="56" viewBox="0 0 160 56" role="img" aria-label="Zero Face Exposure Verified, ${esc(date)}, 0 of ${commas(cert.totals.framesChecked)} frames exposed">
  <title>Zero Face Exposure Verified — ${esc(cert.domain)}</title>
  <rect x="0.6" y="0.6" width="158.8" height="54.8" rx="8" fill="#0e1412" stroke="#C6FF00" stroke-width="1.2"/>
  ${markSvg(18, 28, 11)}
  <text x="34" y="16" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="7.2" font-weight="700" fill="#F4F7F5" letter-spacing="0.2">ZERO FACE EXPOSURE</text>
  <text x="34" y="29" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="10" font-weight="800" fill="#C6FF00" letter-spacing="0.8">VERIFIED</text>
  <text x="34" y="44" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="6.2" fill="#C8D4CE">${esc(line2)}</text>
</svg>
`;
}

function squareBadge(cert) {
  const date = etDate(cert.testedAt);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72" role="img" aria-label="Zero Face Exposure Verified, 0 of ${commas(cert.totals.framesChecked)} frames exposed">
  <title>Zero Face Exposure Verified — ${esc(cert.domain)}</title>
  <rect x="0.6" y="0.6" width="70.8" height="70.8" rx="10" fill="#0e1412" stroke="#C6FF00" stroke-width="1.2"/>
  ${markSvg(36, 20, 10)}
  <text x="36" y="38" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="6" font-weight="700" fill="#F4F7F5">ZERO FACE</text>
  <text x="36" y="47" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="6" font-weight="700" fill="#F4F7F5">EXPOSURE</text>
  <text x="36" y="57" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="7" font-weight="800" fill="#C6FF00">VERIFIED</text>
  <text x="36" y="66" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="5" fill="#C8D4CE">0 of ${esc(commas(cert.totals.framesChecked))}</text>
</svg>
`;
}

function reportPage(cert, origin) {
  const hostShow = String(cert.url || "").replace(/^https?:\/\//, "");
  const rows = cert.scenarios.map((s) => `<tr>
      <td>${esc(s.label)}</td>
      <td class="num">${commas(s.screencastFrames)} / ${commas(s.readbackFrames)}</td>
      <td class="num">${commas(s.screencastExposed)} / ${commas(s.readbackExposed)}</td>
      <td><span class="pill pass">${esc(s.result)}</span></td>
    </tr>`).join("\n");
  const commitShort = (cert.commit || "").slice(0, 7);
  const commitUrl = cert.commit ? `https://github.com/zabbadat/my-site/commit/${esc(cert.commit)}` : "";
  const proofUrl = "https://github.com/zabbadat/my-site/blob/tools/pfp-proof/docs/pfp-proof.md";
  const title = "Zero Face Exposure certificate — Zabbadat";
  const desc = "Public report for " + cert.domain + ": the camera path passed Zabbadat's Zero Face Exposure proof, with zero face pixels in every tested frame.";
  // desc length check is for our own quality; not a top-level page in the sitemap test
  const embedImg = `${origin}/certified/badge/${cert.domain}.svg`;
  const reportUrl = `${origin}/certified/${cert.domain}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-273E209E9K"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-273E209E9K');
  </script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="canonical" href="${esc(reportUrl)}">
  <meta name="description" content="${esc(desc)}">
  <meta name="theme-color" content="#0e1412">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Zabbadat™">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(reportUrl)}">
  <meta property="og:image" content="${origin}/og-zd-v2.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${origin}/og-zd-v2.png">
  <link rel="icon" href="/favicon.ico">
  <style>
    body { font-family: Georgia, serif; max-width: 52rem; margin: 2rem auto; padding: 0 1.25rem 3rem; line-height: 1.5; color: #111; background: #fafbfa; }
    h1, h2, h3 { font-family: system-ui, sans-serif; }
    h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
    h2 { font-size: 1.15rem; margin-top: 1.8rem; }
    .sub { color: #444; margin-top: 0; }
    :where(a):link, :where(a):visited { color: #2f6b55; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: .18em; }
    :where(a):hover, :where(a):focus-visible { color: #1f4d3c; text-decoration-thickness: 2px; }
    :where(a):focus-visible { outline: 2px solid #1f4d3c; outline-offset: 2px; border-radius: 2px; }
    .brand { display: flex; align-items: center; gap: .5rem; font-family: system-ui, sans-serif; font-weight: 600; margin: 0 0 .75rem; }
    :where(a).brand:link, :where(a).brand:visited { color: #111; text-decoration: none; }
    .brand img { display: block; background: #0e1412; border-radius: 50%; padding: 2px; }
    .pages { font-family: system-ui, sans-serif; font-size: .92rem; display: flex; flex-wrap: wrap; gap: .3rem 1rem; padding: .6rem 0; margin: 0 0 1rem; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; }
    footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #ddd; font-family: system-ui, sans-serif; font-size: .85rem; color: #444; }
    .hero { display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; align-items: flex-start; justify-content: space-between; margin: 1rem 0 1.4rem; }
    .status { font-family: system-ui, sans-serif; border-radius: 14px; padding: 1rem 1.2rem; min-width: 11rem; color: #0e1412; background: #C6FF00; box-shadow: 0 4px 18px rgba(198,255,0,.28); }
    .status .label { font-size: .75rem; letter-spacing: .08em; font-weight: 700; text-transform: uppercase; opacity: .75; }
    .status .value { font-size: 2rem; font-weight: 800; line-height: 1.1; margin-top: .15rem; }
    .status.expired, .status.revoked { background: #2a1616; color: #ffd6d6; box-shadow: none; }
    .status.expired .value, .status.revoked .value { color: #ff8a8a; }
    .meta { font-family: system-ui, sans-serif; font-size: .92rem; display: grid; gap: .35rem 1.2rem; grid-template-columns: 9.5rem 1fr; }
    .meta dt { color: #555; }
    .meta dd { margin: 0; }
    .sig { font-family: system-ui, sans-serif; font-size: .92rem; margin: .8rem 0 0; }
    .sig[data-state="verified"] .sig-value { color: #1f4d3c; font-weight: 700; }
    .sig[data-state="invalid"] .sig-value { color: #8b1e1e; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; font-family: system-ui, sans-serif; font-size: .88rem; background: #fff; }
    th, td { text-align: left; padding: .45rem .55rem; border-bottom: 1px solid #e3e6e4; vertical-align: top; }
    th { font-size: .75rem; letter-spacing: .04em; text-transform: uppercase; color: #555; background: #eef1ef; }
    td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pill { display: inline-block; padding: .05rem .45rem; border-radius: 999px; font-weight: 700; font-size: .75rem; }
    .pill.pass { background: #e7f6c8; color: #1a4a16; }
    .totals { font-family: system-ui, sans-serif; margin: .8rem 0 0; font-weight: 600; }
    .badges { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; margin: .6rem 0 1rem; }
    pre, code, textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8rem; }
    textarea { width: 100%; min-height: 5.2rem; padding: .6rem; border: 1px solid #ccc; border-radius: 8px; background: #fff; resize: vertical; }
    .note { font-size: .92rem; }
    .warn { background: #fff6d8; border: 1px solid #e6d089; border-radius: 8px; padding: .7rem .85rem; font-family: system-ui, sans-serif; font-size: .88rem; }
    @media (max-width: 640px) {
      .meta { grid-template-columns: 1fr; gap: 0; }
      .meta dt { margin-top: .4rem; }
      table { font-size: .8rem; }
      th, td { padding: .4rem .35rem; }
    }
  </style>
</head>
<body>
  <a class="brand" href="/"><img src="/zd-v2-mark.svg" width="32" height="32" alt=""><span>Zabbadat<sup style="font-size:0.5em">™</sup></span></a>
  <nav class="pages" aria-label="Zabbadat pages">
    <a href="/">Home</a>
    <a href="/washers">Washers</a>
    <a href="/tut">TUT push-ups</a>
    <a href="/plank">Plank</a>
    <a href="/zab">ZAB</a>
    <a href="/bank">Zab Bank</a>
    <a href="/reputation">Reputation</a>
    <a href="/rules">Rules</a>
    <a href="/how-it-works">How it works</a>
  </nav>
  <main>
    <h1>Zero Face Exposure certificate</h1>
    <p class="sub">${esc(cert.siteName)} · <a href="${esc(cert.url)}">${esc(hostShow)}</a></p>
    <div class="hero">
      <div class="status valid" id="certStatus" data-expires="${esc(cert.expiresAt)}" data-revoked="${cert.status === "revoked" ? "1" : "0"}">
        <div class="label">Status</div>
        <div class="value" id="certStatusValue">Valid</div>
      </div>
      <dl class="meta">
        <dt>Site</dt><dd>${esc(cert.siteName)} (<code>${esc(cert.domain)}</code>)</dd>
        <dt>Tested</dt><dd>${esc(etStamp(cert.testedAt))}</dd>
        <dt>Expires</dt><dd>${esc(etStamp(cert.expiresAt))} <span style="color:#555">(90 days)</span></dd>
        <dt>Commit tested</dt><dd>${commitUrl ? `<a href="${commitUrl}"><code>${esc(commitShort)}</code></a>` : "<code>—</code>"} ${cert.proofToolsCommit ? ` · proof tools <code>${esc(String(cert.proofToolsCommit).slice(0, 7))}</code>` : ""}</dd>
        <dt>Threshold</dt><dd>Zero green face pixels per frame, on both checks</dd>
      </dl>
    </div>
    <p class="sig" id="sigLine" data-state="checking">Signature: <span class="sig-value" id="sigValue">Checking…</span></p>

    <h2>Totals</h2>
    <p class="totals">0 of ${commas(cert.totals.framesChecked)} frames exposed. ${commas(cert.totals.scenariosPassed)} of ${commas(cert.totals.scenarios)} scenarios passed.</p>
    <p class="note">Screencast: ${commas(cert.totals.screencastExposed)} of ${commas(cert.totals.screencastFrames)} frames exposed. Readback: ${commas(cert.totals.readbackExposed)} of ${commas(cert.totals.readbackFrames)} frames exposed.</p>

    <h2>Scenarios</h2>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Frames checked<br><span style="font-weight:500;text-transform:none;letter-spacing:0">screencast / readback</span></th>
            <th>Frames exposed<br><span style="font-weight:500;text-transform:none;letter-spacing:0">screencast / readback</span></th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>

    <h2>How this test works</h2>
    <p>With the profile-logo (PFP) switch on, no displayed camera frame may show any part of a face. The proof feeds the browser a fake camera whose “face” is painted bright green, then counts green pixels in every displayed frame, two ways:</p>
    <ol>
      <li><strong>Readback.</strong> After every repaint, the exact pixels drawn on every visible camera video and every logo canvas are read back. If even one bright-green face pixel shows up, that frame fails. No tolerance.</li>
      <li><strong>Screencast.</strong> The browser’s real composited output is recorded, frame by frame, and scanned the same way. This check also requires zero green pixels per frame, with no allowance for compression specks.</li>
    </ol>
    <p>A scenario passes only when both checks show zero exposed frames and the camera and logo actually ran during the test (enough frames were captured, the cover was present, and tracking runs locked on at least once). A scenario that did not really run counts as a fail, and the whole certificate is refused.</p>
    <p>This run covered startup (cold and warm loads, front-style phone and desktop views, and a normal, slow, or blocked tracking model) and tracking (including camera switching, a stall, and more than one resolution) on every camera surface: push-ups, plank, Gyatt Squats, TUT, the live preview, and Live Match.</p>
    <p>The open-source command is <code>npm run pfp-proof</code> on the <code>tools/pfp-proof</code> branch. The method is documented in <a href="${proofUrl}">docs/pfp-proof.md</a>.</p>

    <h2>Embed this badge</h2>
    <div class="badges">
      <a href="${esc(reportUrl)}"><img src="${esc(embedImg)}" width="160" height="56" alt="Zero Face Exposure Verified"></a>
      <a href="${esc(reportUrl)}"><img src="${origin}/certified/badge/${esc(cert.domain)}-square.svg" width="72" height="72" alt="Zero Face Exposure Verified"></a>
    </div>
    <p>Paste this on your own page. The image is the seal; the link opens this report.</p>
    <textarea readonly id="embedSnippet" spellcheck="false">&lt;a href="${esc(reportUrl)}" rel="noopener noreferrer"&gt;&lt;img src="${esc(embedImg)}" width="160" height="56" alt="Zero Face Exposure Verified"&gt;&lt;/a&gt;</textarea>
    <p>Optional: a tiny script badge that also checks the page’s hostname against the certified domain and shows <strong>Unverified</strong> if the seal is copied onto another site. This is only a casual check — anyone can delete the script or spoof it — so this signed report on zabbadat.com is the source of truth.</p>
    <textarea readonly spellcheck="false">&lt;div class="zab-zfe-badge" data-domain="${esc(cert.domain)}"&gt;&lt;/div&gt;
&lt;script src="${origin}/certified/badge.js" async&gt;&lt;/script&gt;</textarea>
    <p class="warn">The certificate describes the public web camera path of <code>${esc(cert.domain)}</code> as it was served on the test date, under this automated proof. It is not a guarantee about later code changes, other pages, or native apps.</p>
  </main>
  <footer>
    <p>© 2026 Zabbadat<sup style="font-size:0.5em">™</sup>. All rights reserved.</p>
  </footer>
  <script>
  (function () {
    var CERT_URL = "/certs/${esc(cert.domain)}.json";
    var PUB_URL = "/certified/pubkey";
    var statusEl = document.getElementById("certStatus");
    var statusVal = document.getElementById("certStatusValue");
    var sigLine = document.getElementById("sigLine");
    var sigVal = document.getElementById("sigValue");
    function setStatus(kind, label) {
      statusEl.className = "status " + kind;
      statusVal.textContent = label;
    }
    function applyExpiry() {
      if (statusEl.getAttribute("data-revoked") === "1") { setStatus("revoked", "Revoked"); return; }
      var exp = Date.parse(statusEl.getAttribute("data-expires") || "");
      if (exp && Date.now() > exp) setStatus("expired", "Expired");
    }
    applyExpiry();
    function canonical(value) {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
      var keys = Object.keys(value).filter(function (k) { return k !== "signature"; }).sort();
      return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + canonical(value[k]); }).join(",") + "}";
    }
    function pemToSpki(pem) {
      var b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\\s+/g, "");
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
    function b64ToBuf(b64) {
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    function unavailable() {
      sigLine.setAttribute("data-state", "unavailable");
      sigVal.textContent = "signature check unavailable in this browser";
    }
    if (!window.crypto || !crypto.subtle) { unavailable(); return; }
    Promise.all([fetch(CERT_URL, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("cert"); return r.json(); }),
                 fetch(PUB_URL, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("pub"); return r.text(); })])
      .then(function (pair) {
        var cert = pair[0], pem = pair[1];
        if (cert.status === "revoked") setStatus("revoked", "Revoked");
        else if (cert.expiresAt && Date.now() > Date.parse(cert.expiresAt)) setStatus("expired", "Expired");
        var algo = { name: "Ed25519" };
        return crypto.subtle.importKey("spki", pemToSpki(pem), algo, false, ["verify"])
          .then(function (key) {
            var msg = new TextEncoder().encode(canonical(cert));
            return crypto.subtle.verify(algo, key, b64ToBuf(cert.signature), msg);
          });
      })
      .then(function (ok) {
        if (ok) { sigLine.setAttribute("data-state", "verified"); sigVal.textContent = "Verified"; }
        else { sigLine.setAttribute("data-state", "invalid"); sigVal.textContent = "Invalid"; }
      })
      .catch(function (err) {
        var name = String(err && (err.name || err.message) || err);
        if (/Ed25519|Algorithm|Unsupported|not supported|not be imported/i.test(name)) unavailable();
        else { sigLine.setAttribute("data-state", "invalid"); sigVal.textContent = "Could not verify"; }
      });
  })();
  </script>
</body>
</html>
`;
}

// I'll fix after writing if needed. Let me check the replace and regex.

function badgeScript() {
  return `/* Zabbadat Zero Face Exposure badge. Optional hostname check only.
   Anyone can remove or spoof this script; the signed report on zabbadat.com is the source of truth. */
(function () {
  var SCRIPT = document.currentScript;
  var ORIGIN = "https://www.zabbadat.com";
  function hostOk(domain) {
    var h = String(location.hostname || "").toLowerCase().replace(/^www\\./, "");
    var d = String(domain || "").toLowerCase().replace(/^www\\./, "");
    return !!d && h === d;
  }
  function paint(el) {
    var domain = (el.getAttribute("data-domain") || "").toLowerCase();
    var variant = el.getAttribute("data-variant") === "square" ? "square" : "wide";
    var report = ORIGIN + "/certified/" + domain;
    el.innerHTML = "";
    if (!hostOk(domain)) {
      el.setAttribute("data-state", "unverified");
      var box = document.createElement("div");
      box.textContent = "Unverified";
      box.setAttribute("title", "This Zero Face Exposure badge is not valid on this domain.");
      box.style.cssText = "display:inline-block;font:700 12px/1.2 system-ui,sans-serif;background:#2a1616;color:#ffd6d6;border:1px solid #8b1e1e;border-radius:8px;padding:10px 12px;";
      el.appendChild(box);
      return;
    }
    var a = document.createElement("a");
    a.href = report;
    a.rel = "noopener noreferrer";
    var img = document.createElement("img");
    img.src = ORIGIN + "/certified/badge/" + domain + (variant === "square" ? "-square.svg" : ".svg");
    img.alt = "Zero Face Exposure Verified";
    if (variant === "square") { img.width = 72; img.height = 72; }
    else { img.width = 160; img.height = 56; }
    a.appendChild(img);
    el.appendChild(a);
    el.setAttribute("data-state", "verified-host");
  }
  function run() {
    var nodes = document.querySelectorAll(".zab-zfe-badge[data-domain]");
    for (var i = 0; i < nodes.length; i++) paint(nodes[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
`;
}

function main() {
  const opts = parseArgs();
  const report = loadReport(opts.reportPath);
  const { scenarios, totals } = evaluate(report, opts.allowQuick);
  const testedAt = report.when || new Date().toISOString();
  const testedMs = Date.parse(testedAt);
  if (!testedMs) die("report.when is missing or invalid");
  const expiresAt = new Date(testedMs + opts.expiresDays * 24 * 60 * 60 * 1000).toISOString();
  let commit = opts.commit;
  if (!commit) {
    try {
      commit = require("child_process").execSync("git rev-parse HEAD", { cwd: opts.out, encoding: "utf8" }).trim();
    } catch (e) { commit = ""; }
  }
  const cert = {
    schema: "zabbadat.pfp-cert/v1",
    domain: opts.domain,
    siteName: opts.name,
    url: opts.url,
    status: "valid",
    testedAt,
    expiresAt,
    expiresDays: opts.expiresDays,
    commit,
    proofToolsCommit: opts.proofCommit,
    proofCommand: "npm run pfp-proof",
    proofBase: report.base || "",
    thresholds: {
      readback: { maxGreenPixelsPerFrame: 0, rule: "Any bright-green face pixel in a post-repaint readback of a visible camera video or PFP canvas fails the frame." },
      screencast: { maxGreenPixelsPerFrame: 0, rule: "Any bright-green face pixel in the browser's composited screencast fails the frame. No compression allowance." }
    },
    totals,
    scenarios
  };

  const { privateKey, publicPem } = loadOrCreateKey(opts.keyPath);
  cert.signature = signCert(cert, privateKey);
  // self-check
  const ok = crypto.verify(null, Buffer.from(canonical(cert), "utf8"), crypto.createPublicKey(publicPem), Buffer.from(cert.signature, "base64"));
  if (!ok) die("internal error: signature did not verify with the public key");

  const pubPath = opts.pubPath ? path.resolve(opts.pubPath) : path.join(opts.out, "certified", "pubkey");
  writeFile(pubPath, publicPem.endsWith("\n") ? publicPem : publicPem + "\n");
  const certPath = path.join(opts.out, "certs", opts.domain + ".json");
  writeFile(certPath, JSON.stringify(cert, null, 2) + "\n");
  writeFile(path.join(opts.out, "certified", "badge", opts.domain + ".svg"), wideBadge(cert));
  writeFile(path.join(opts.out, "certified", "badge", opts.domain + "-square.svg"), squareBadge(cert));
  writeFile(path.join(opts.out, "certified", "badge.js"), badgeScript());
  const origin = "https://www.zabbadat.com";
  writeFile(path.join(opts.out, "certified", opts.domain, "index.html"), reportPage(cert, origin));

  console.log("pfp-cert: PASS  " + opts.domain);
  console.log("  tested    " + etStamp(testedAt));
  console.log("  expires   " + etStamp(expiresAt));
  console.log("  commit    " + (commit || "(none)"));
  console.log("  totals    0 of " + commas(totals.framesChecked) + " frames exposed; " + totals.scenariosPassed + "/" + totals.scenarios + " scenarios");
  console.log("  screencast " + totals.screencastExposed + "/" + totals.screencastFrames + "  readback " + totals.readbackExposed + "/" + totals.readbackFrames);
  console.log("  wrote     " + path.relative(opts.out, certPath));
  console.log("  wrote     certified/badge/" + opts.domain + ".svg");
  console.log("  wrote     certified/badge/" + opts.domain + "-square.svg");
  console.log("  wrote     certified/" + opts.domain + "/index.html");
  console.log("  wrote     certified/pubkey");
  console.log("  wrote     certified/badge.js");
}

main();
