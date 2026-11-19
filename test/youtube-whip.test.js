const fn = require("../netlify/functions/youtube-whip.js");
const fs = require("fs");
const path = require("path");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
function ev(method, origin, extra) {
  extra = extra || {};
  return { httpMethod: method, headers: Object.assign({ origin: origin || "" }, extra.headers || {}), body: extra.body == null ? "{}" : extra.body, queryStringParameters: extra.query || {} };
}
function leak(body, headers) {
  const s = String(body || "") + " " + JSON.stringify(headers || {});
  return /super-secret|pub-pass|pub-user|YOUTUBE_STREAM|whipUrl":\s*"https?:\/\/[^"]*@/.test(s);
}
(async () => {
  const no = await fn.handler(ev("POST", "https://evil.example"));
  check("foreign origin refused", no.statusCode === 403 && JSON.parse(no.body).configured === false && !leak(no.body, no.headers));
  const miss = await fn.handler(ev("POST", "https://www.zabbadat.com"));
  check("same origin, no env: configured false, no creds leaked", miss.statusCode === 200 && JSON.parse(miss.body).configured === false && !("whipUrl" in JSON.parse(miss.body)));

  process.env.LIVE_WHIP_URL = "https://pub-user:pub-pass@relay.example:8889/washers/whip";
  process.env.YOUTUBE_STREAM_KEY = "super-secret-key";
  const okb = await fn.handler(ev("POST", "https://zabbadat.com"));
  const j = JSON.parse(okb.body);
  check("JSON probe: configured, same-origin whip path only, never user/password/key or userinfo URL",
    okb.statusCode === 200 && j.configured === true && j.whipUrl === "/.netlify/functions/youtube-whip"
    && !leak(okb.body, okb.headers) && !/pub-pass|pub-user|super-secret/.test(okb.body) && !("user" in j) && !("password" in j) && !("streamKey" in j));

  const cap = await fn.handler(ev("POST", "capacitor://localhost"));
  check("Capacitor origin allowed when configured", cap.statusCode === 200 && JSON.parse(cap.body).configured === true && JSON.parse(cap.body).whipUrl === "/.netlify/functions/youtube-whip");

  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response("v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n", { status: 201, headers: { "Content-Type": "application/sdp", Location: "http://pub-user:pub-pass@relay.example:8889/washers/whip/sess1" } });
  };
  const sdp = await fn.handler(ev("POST", "https://www.zabbadat.com", { headers: { "content-type": "application/sdp", host: "www.zabbadat.com", "x-forwarded-proto": "https" }, body: "v=0\r\no=- offer\r\n" }));
  const sentAuth = (calls[0] && calls[0].init && calls[0].init.headers && calls[0].init.headers.Authorization) || "";
  const loc = (sdp.headers && sdp.headers.Location) || "";
  check("SDP POST is proxied to the stripped relay URL with Basic auth from env/userinfo",
    calls.length === 1 && calls[0].url === "https://relay.example:8889/washers/whip" && /^Basic /.test(sentAuth)
    && Buffer.from(sentAuth.replace("Basic ", ""), "base64").toString() === "pub-user:pub-pass"
    && !String(calls[0].url).includes("pub-pass"));
  check("proxy Location is same-origin session path, no userinfo",
    sdp.statusCode === 201 && /application\/sdp/.test(sdp.headers["Content-Type"]) && /^v=0/.test(sdp.body)
    && loc === "https://www.zabbadat.com/.netlify/functions/youtube-whip?session=%2Fwashers%2Fwhip%2Fsess1"
    && !/pub-pass|pub-user/.test(loc) && !leak(sdp.body, sdp.headers));

  calls.length = 0;
  delete process.env.LIVE_WHIP_URL;
  process.env.LIVE_WHIP_URL = "https://relay.example:8889/washers/whip";
  process.env.LIVE_WHIP_USER = "pub-user";
  process.env.LIVE_WHIP_PASSWORD = "pub-pass";
  const del = await fn.handler(ev("DELETE", "https://www.zabbadat.com", { query: { session: "/washers/whip/sess1" }, headers: { host: "www.zabbadat.com" } }));
  check("DELETE session proxies to relay path with server-side auth, client session cannot be an absolute URL",
    del.statusCode === 201 && calls[0].url === "https://relay.example:8889/washers/whip/sess1" && /^Basic /.test(calls[0].init.headers.Authorization)
    && fn._test.sessionPath("https://evil/x") === "" && fn._test.sessionPath("http://pub-user:pub-pass@x/whip") === "" && fn._test.sessionPath("/washers/whip/sess1") === "/washers/whip/sess1");

  global.fetch = origFetch;
  delete process.env.LIVE_WHIP_URL;
  delete process.env.LIVE_WHIP_USER;
  delete process.env.LIVE_WHIP_PASSWORD;
  delete process.env.YOUTUBE_STREAM_KEY;
  const src = fs.readFileSync(path.join(__dirname, "..", "netlify/functions/youtube-whip.js"), "utf8");
  check("function never reads the YouTube stream-key env var", !/process\.env\.YOUTUBE_STREAM_KEY/.test(src) && !/process\.env\[.YOUTUBE_STREAM_KEY/.test(src));
  const doc = fs.readFileSync(path.join(__dirname, "..", "docs/youtube-live-setup.md"), "utf8");
  check("setup doc: server-side publish creds, WHIP path washers, Stream can't simulcast, TURN already live, nothing provisioned",
    /LIVE_WHIP_PASSWORD/.test(doc) && /washers\/whip/.test(doc) && /cannot simulcast/i.test(doc) && /bc20c50/.test(doc) && /not provisioned/i.test(doc) && /never returns the publish user or password/.test(doc));
  const n = R.filter(Boolean).length; console.log(`\n${n}/${R.length} passed`); process.exit(n === R.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
