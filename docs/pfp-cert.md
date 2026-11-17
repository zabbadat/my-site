# Zero Face Exposure certification

A public seal a site can embed that links to a signed report: their camera path passed Zabbadat’s frame-by-frame Zero Face Exposure proof (`npm run pfp-proof`), with **zero** face pixels in every displayed frame.

Phase 1 (this branch) dogfoods the badge and report on zabbadat.com itself. Phase 2, described below, opens the same seal to other sites. **No phase 2 code is in this branch.**

## What phase 1 ships

- **Badge.** A dark lime-edged SVG seal (160×56, plus a 72×72 square variant) reading “Zero Face Exposure Verified,” the test date, and “0 of N frames exposed,” with a small Zabbadat mark. Served from `/certified/badge/<domain>.svg` and `/certified/badge/<domain>-square.svg`. The seal uses a solid dark background so it works on light and dark pages.
- **Report.** A public page at `/certified/zabbadat.com` showing the site name and URL, a large Valid / Expired / Revoked status, the test date, a 90-day expiry, the commit tested, a per-scenario table, totals, a plain-language “How this test works,” and an embed snippet.
- **Signed data.** `certs/zabbadat.com.json` holds the domain, dates, commit, totals, scenarios, and threshold rules, plus an Ed25519 signature. Only the public key is in the repo, at `/certified/pubkey`. The report page verifies the signature in the browser (WebCrypto Ed25519), and shows “signature check unavailable in this browser” if that API is missing.
- **Generator.** `npm run pfp-cert -- --domain zabbadat.com --report <path-to-report.json>` turns a real `report.json` from `npm run pfp-proof` into the signed cert, both badges, and the report page. It **refuses** to certify if any scenario has more than zero exposed frames, is unproven, errored, or came from a negative-control run. A `--quick` proof is also refused unless you pass `--allow-quick`.

The proof itself lives on the `tools/pfp-proof` branch. Official certificates use the strict threshold: **zero green pixels per frame** on both the post-repaint readback and the screencast (no compression allowance).

## Signing

The payload is canonical JSON: keys sorted, no whitespace, the `signature` field omitted. That UTF-8 string is signed with Ed25519. The private key is kept **outside the repo** at `/workspace/secrets/pfp-cert-ed25519.pem` (mode 600) and must never be printed, committed, or served. Rotate it if it leaks; after a rotation, re-sign outstanding certs and update `/certified/pubkey`.

## Domain binding on the embed

The basic embed is an `<a>` wrapping the badge `<img>`, pointing at the report on zabbadat.com.

An optional script, `/certified/badge.js`, looks for `.zab-zfe-badge[data-domain]` and paints the seal only if `document.location.hostname` (with or without `www.`) matches the certified domain. Otherwise it shows “Unverified.”

**Limits of this check.** It runs only in the visitor’s browser. Anyone can delete the script, edit it, or serve a look-alike image. A copied image still *looks* like the seal on any site; only the script (when present) flags the mismatch. The signed report at `https://www.zabbadat.com/certified/<domain>` is the source of truth. A valid badge always links there.

## How to re-issue zabbadat.com’s certificate

1. Run the full proof against the build you want to certify:
   `npm run pfp-proof` (from the `tools/pfp-proof` branch, or with `--base` pointing at that build).
2. `npm run pfp-cert -- --domain zabbadat.com --report /path/to/report.json --commit <sha>`.
3. Commit the generated `certs/`, `certified/badge/`, and `certified/zabbadat.com/` files (never the private key).

Certificates expire 90 days after the test date, or sooner if we revoke them. Re-test before expiry, and whenever the camera or face-cover code changes.

## Phase 2 — other sites (design only)

The goal is that any site or app with a camera path can apply, prove they own their domain, and — only if *we* run the proof against their public page and it passes at zero — embed the same seal, which links to a report on zabbadat.com.

### Claim flow

1. **Sign up.** The site owner asks for a certificate for a domain (for example `example.com`) and a starting URL where the camera UI is available (a public page; no login wall if we can avoid one, or a documented test account).
2. **Prove domain ownership**, one of:
   - a DNS TXT record `zabbadat-cert=<code>` on the domain (or `_zabbadat-cert.example.com`), or
   - a `<meta name="zabbadat-cert" content="<code>">` tag on the exact origin we will test.
   The code is short-lived, issued by us, and checked before a run starts.
3. **We run the proof.** The site does not upload its own results. A self-submitted pass could be faked. We run `npm run pfp-proof -- --base=https://example.com/...` (or a generalized runner) from our infrastructure, against the public URL as served on that date, with the same green fake face and the same two zero-pixel checks.
4. **Issue or refuse.** On a full pass (zero exposed, every scenario proven), we sign a cert bound to that domain, publish `/certified/<domain>` and `/certified/badge/<domain>.svg`, and give the owner the embed snippet. On a fail, they get the failing frame and scenario, not a badge.
5. **Re-test.** A cert expires in 90 days. We re-test on request, on expiry, and when the owner says the camera path changed. A failed re-test, a lost domain-ownership check, or abuse leads to **revocation**: `status` becomes `revoked`, the report page shows Revoked, and the badge must not be advertised as valid.
6. **Domain binding.** The signed JSON names the domain. The optional script flags a badge copied onto a different hostname as Unverified. Copying the image alone is still possible, which is why the report page — not the image — is authoritative.

### Generalizing the proof

Today the runner knows Zabbadat’s element ids (`#camVid`, `#plankVid`, the PFP canvases, the Start buttons, and so on). For another site we have to:

- Detect **any** `<video>` or `<canvas>` that is showing the live camera (a `srcObject` media stream), not only our ids.
- Cover every such surface for the whole session, including when the site swaps cameras, goes fullscreen, or draws the stream onto a canvas.
- Drive “start the camera” without our button ids: a documented selector, a query parameter the applicant adds, or a short playbook we follow.
- Keep the same pass rules: both checks at zero, and a scenario that never really ran is a fail.

Native apps (iOS, Android) need a **different path**: this proof is a browser with a fake camera and a pixel readback of a web page. App store builds would need an instrumented harness on a device or emulator, which is out of scope for the web badge.

### Risks and limits (please read)

- We certify the **public page as served on the test date**, under our automated conditions (fake green face, our Chromium, the pages we could reach). We do not certify every later deploy, every locale, every logged-in state, or every A/B variant unless we re-test it.
- A site can change its camera code the next day. Expiry, re-test on request, and revocation are how we limit that, not a continuous guarantee.
- The proof can only see what the page displays in our test browser. It cannot prove a native app, a partner iframe we did not load, or a server-side recording pipeline.
- The embed’s hostname check is advisory. Always click through to the signed report.
- A passing cert means “no face pixels reached the display in the scenarios we ran,” not “this product is private in every other sense.”

## A current limit of the official proof

The proof’s screencast check records the **entire page**, then flags any pixel that looks bright green (G > 150, R < 100, B < 100), including after JPEG compression. On zabbadat.com, lime-colored UI text (for example “Sign in with X,” “Record,” “fullscreen”) and the Fall Frenzy artwork can produce one or two such pixels in a compressed screencast frame even when the camera and logo canvases are clean. The lossless readback of those camera surfaces stays at zero in that case — the face is still covered — but a strict-zero screencast run still fails, so **we will not issue a certificate from that run**.

A later revision of the proof should scan only the camera region, use lossless frames, or match the actual fake-face green more tightly, so page chrome cannot fail a certificate. Until then, a fail has to be reviewed frame by frame before anyone treats it as a real face leak — and a certificate is issued only when the official command reports a clean pass.

