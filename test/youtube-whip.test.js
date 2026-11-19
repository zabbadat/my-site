const fn = require("../netlify/functions/youtube-whip.js");
const fs = require("fs");
const path = require("path");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
function ev(method, origin) { return { httpMethod: method, headers: { origin: origin || "" }, body: "{}" }; }
(async () => {
  const no = await fn.handler(ev("POST", "https://evil.example"));
  check("foreign origin refused", no.statusCode === 403 && JSON.parse(no.body).configured === false && !/whipUrl|streamKey|YOUTUBE/i.test(no.body));
  const miss = await fn.handler(ev("POST", "https://www.zabbadat.com"));
  check("same origin, no env: configured false, no key leaked", miss.statusCode === 200 && JSON.parse(miss.body).configured === false && !("whipUrl" in JSON.parse(miss.body)));
  process.env.LIVE_WHIP_URL = "https://relay.example/whip/live";
  process.env.YOUTUBE_STREAM_KEY = "super-secret-key";
  const okb = await fn.handler(ev("POST", "https://zabbadat.com"));
  const j = JSON.parse(okb.body);
  check("configured true returns whip URL only, never the stream key", okb.statusCode === 200 && j.configured === true && j.whipUrl === "https://relay.example/whip/live" && !/super-secret-key/.test(okb.body) && !("streamKey" in j));
  const cap = await fn.handler(ev("POST", "capacitor://localhost"));
  check("Capacitor origin allowed when configured", cap.statusCode === 200 && JSON.parse(cap.body).configured === true);
  delete process.env.LIVE_WHIP_URL;
  delete process.env.YOUTUBE_STREAM_KEY;
  const src = fs.readFileSync(path.join(__dirname, "..", "netlify/functions/youtube-whip.js"), "utf8");
  check("function never reads the stream-key env var", !/process\.env\.YOUTUBE_STREAM_KEY/.test(src) && !/process\.env\[.YOUTUBE_STREAM_KEY/.test(src));
  const doc = fs.readFileSync(path.join(__dirname, "..", "docs/youtube-live-setup.md"), "utf8");
  check("setup doc: separate WHIP-in RTMP-out server, Stream WHIP can't simulcast, TURN already live, nothing provisioned", /WHIP/.test(doc) && /cannot simulcast/i.test(doc) && /bc20c50/.test(doc) && /not provisioned/i.test(doc) && /directly to YouTube/.test(doc));
  const n = R.filter(Boolean).length; console.log(`\n${n}/${R.length} passed`); process.exit(n === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
