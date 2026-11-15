// Live tab TURN relay: client loadTurn() (zabba-live.js) fetches /.netlify/functions/turn-creds before any RTCPeerConnection,
// merges the result AFTER Google STUN, falls back to STUN only on failure / timeout; and the Netlify function turn-creds.js
// (Cloudflare Realtime TURN) returns { iceServers: [] } with 200 when not configured or Cloudflare fails, checks the origin,
// rate-limits, never caches, and sends the right request to Cloudflare. No real network, no credentials.
const path = require("path"), fsMod = require("fs");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const fresh = () => { const p = require.resolve("../zabba-live.js"); delete require.cache[p]; return require("../zabba-live.js"); };
const CF_LIST = [{ urls: ["stun:stun.cloudflare.com:3478"] }, { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u1", credential: "c1" }];
const okRes = (body) => ({ ok: true, status: 200, json: async () => body });
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };

(async () => {
  // ---- client: loadTurn ----
  { const ZL = fresh(); const calls = [];
    const list = await ZL.loadTurn({ fetch: async (u, o) => { calls.push([u, o]); return okRes({ iceServers: CF_LIST }); } });
    const ice = ZL.iceServers();
    check("client: POSTs to /.netlify/functions/turn-creds", calls.length === 1 && calls[0][0] === "/.netlify/functions/turn-creds" && calls[0][1].method === "POST");
    check("client: merge order = Google STUN first, then the fetched Cloudflare servers", list.length === 2 && ice.length === 4
      && ice[0].urls === "stun:stun.l.google.com:19302" && ice[1].urls === "stun:stun1.l.google.com:19302" && ice[2] === CF_LIST[0] && ice[3] === CF_LIST[1] && ice[3].credential === "c1");
    await ZL.loadTurn({ fetch: async () => { calls.push(1); return okRes({ iceServers: [] }); } });
    check("client: credentials reused (no second request inside the refresh window)", calls.length === 1);
    let t = 0; const later = await ZL.loadTurn({ now: () => Date.now() + 2 * 3600e3 + t++, fetch: async () => { calls.push(2); return okRes({ iceServers: [CF_LIST[1]] }); } });
    check("client: refetched after the refresh window (before the 2 h ttl runs out)", calls.length === 2 && later.length === 1);
    ZL.config.turn = [{ urls: "turn:manual.example:3478", username: "m", credential: "m" }];
    check("client: manual config.turn override wins over the fetched list", ZL.iceServers().length === 3 && ZL.iceServers()[2].urls === "turn:manual.example:3478");
    ZL.config.turn = null; }
  { const ZL = fresh(); const list = await ZL.loadTurn({ fetch: async () => { throw new Error("offline"); } });
    check("client fallback: fetch throws -> [] and STUN only", Array.isArray(list) && list.length === 0 && ZL.iceServers().length === 2 && ZL.iceServers().every((s) => /^stun:/.test(s.urls))); }
  { const ZL = fresh(); const list = await ZL.loadTurn({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
    check("client fallback: HTTP error -> STUN only", list.length === 0 && ZL.iceServers().length === 2); }
  { const ZL = fresh(); const list = await ZL.loadTurn({ fetch: async () => okRes({ nope: 1 }) });
    check("client fallback: malformed body -> STUN only", list.length === 0 && ZL.iceServers().length === 2); }
  { const ZL = fresh(); const t0 = Date.now(); let n = 0;
    const [a, b] = await Promise.all([ZL.loadTurn({ timeoutMs: 80, fetch: () => { n++; return new Promise(() => {}); } }), ZL.loadTurn({ timeoutMs: 80, fetch: () => { n++; return new Promise(() => {}); } })]);
    const dt = Date.now() - t0;
    check("client fallback: hung request gives up at the timeout -> STUN only; concurrent callers share one request", a.length === 0 && b.length === 0 && n === 1 && dt >= 70 && dt < 1000 && ZL.iceServers().length === 2);
    check("client: default timeout is ~3 s", ZL.TURN_TIMEOUT_MS === 3000); }
  { const ZL = fresh(); const list = await ZL.loadTurn({});
    check("client: no fetch available (Node / old browser) -> STUN only, no throw", list.length === 0); }

  // ---- client: the TURN list is in place BEFORE RTCPeerConnection is created (viewer + caster) ----
  { const ZL = fresh(); const made = []; let release;
    class FakePC { constructor(cfg) { made.push(cfg); this.connectionState = "new"; } addTransceiver() {} getTransceivers() { return []; }
      async createOffer() { return { type: "offer", sdp: "v=0\r\nm=video 9\r\n" }; } async setLocalDescription(d) { this.localDescription = d; }
      async setRemoteDescription() {} async addIceCandidate() {} async createAnswer() { return { type: "answer", sdp: "v=0\r\nans\r\n" }; } addTrack() { return { replaceTrack: async () => {} }; } close() {} }
    const gate = new Promise((r) => (release = r)), sid = "S1d2e3f4g5h6";
    const sig = { watchCaster: (code, seat, cb) => { if (seat === "0") setTimeout(() => cb({ live: true, sid, updatedAt: Date.now() }), 0); return () => {}; },
      createPeer: async () => {}, watchPeer: () => () => {}, updatePeer: async () => {}, ts: () => Date.now(), append: (x) => x, toMs: (v) => v };
    const v = ZL.viewer(sig, { RTC: FakePC, turn: { fetch: async () => { await gate; return okRes({ iceServers: CF_LIST }); } } });
    v.watch("K7QX2"); await settle();
    check("viewer: waits for TURN before creating its RTCPeerConnection", made.length === 0);
    release(); await settle();
    check("viewer: RTCPeerConnection gets STUN + Cloudflare TURN", made.length === 1 && made[0].iceServers.length === 4 && made[0].iceServers[3].username === "u1");
    v.stop();
    // caster
    const made2 = []; class PC2 extends FakePC { constructor(c) { super(c); made2.push(c); } }
    let peersCb = null; const csig = { setCaster: async () => {}, watchPeers: (c, s, id, cb) => { peersCb = cb; return () => {}; }, updatePeer: async () => {}, deletePeer: async () => {}, ts: () => Date.now(), append: (x) => x };
    const ZL2 = fresh(); let rel2; const g2 = new Promise((r) => (rel2 = r)); let nf = 0;
    const ca = ZL2.caster(csig, { RTC: PC2, turn: { fetch: async () => { nf++; await g2; return okRes({ iceServers: CF_LIST }); } } });
    const track = { kind: "video" };
    const csid = await ca.start({ code: "K7QX2", seat: 0, uid: "a", stream: { getVideoTracks: () => [track] } });
    peersCb([{ id: "A".repeat(20), data: ZL2.newPeer(0, csid, "v=0\r\nm=video 9\r\n", null, 1, 1) }]); await settle();
    check("caster: TURN prefetched at Go live; no RTCPeerConnection until it resolves", nf === 1 && made2.length === 0);
    rel2(); await settle();
    check("caster: answers the viewer with STUN + Cloudflare TURN", made2.length === 1 && made2[0].iceServers.length === 4 && made2[0].iceServers[2].urls[0] === "stun:stun.cloudflare.com:3478");
    await ca.stop(); }

  // ---- Netlify function ----
  const F = require("../netlify/functions/turn-creds.js")._test;
  const ev = (o = {}) => Object.assign({ httpMethod: "POST", headers: { origin: "https://zabbadat.com", "x-nf-client-connection-ip": "1.2.3." + Math.floor(Math.random() * 250) } }, o);
  const body = (r) => JSON.parse(r.body);
  delete process.env.CF_TURN_KEY_ID; delete process.env.CF_TURN_API_SECRET;
  { let called = 0; const r = await F.handler(ev(), { fetch: async () => { called++; return okRes({ iceServers: CF_LIST }); } });
    check("function: no env vars -> 200 { iceServers: [] }, Cloudflare not called", r.statusCode === 200 && JSON.stringify(body(r).iceServers) === "[]" && called === 0);
    check("function: Cache-Control no-store", r.headers["Cache-Control"] === "no-store"); }
  process.env.CF_TURN_KEY_ID = "testkeyid"; process.env.CF_TURN_API_SECRET = "testsecretvalue";
  { let req = null; const r = await F.handler(ev(), { fetch: async (u, o) => { req = [u, o]; return okRes({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] }, { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u1", credential: "c1" }] }); } });
    const b = body(r);
    check("function: POST https://rtc.live.cloudflare.com/v1/turn/keys/<id>/credentials/generate-ice-servers, Bearer secret, { ttl: 7200 }",
      req && req[0] === "https://rtc.live.cloudflare.com/v1/turn/keys/testkeyid/credentials/generate-ice-servers" && req[1].method === "POST" && req[1].headers.Authorization === "Bearer testsecretvalue" && JSON.parse(req[1].body).ttl === 7200);
    check("function: returns iceServers to the client (port 53 URLs dropped: browsers block them)", r.statusCode === 200 && b.iceServers.length === 2 && b.iceServers[1].username === "u1" && b.iceServers[1].credential === "c1"
      && b.iceServers.every((s) => s.urls.every((u) => !/:53(\?|$)/.test(u))) && b.iceServers[1].urls.length === 2);
    check("function: CORS echo for an allowed origin; secret never in the response", r.headers["Access-Control-Allow-Origin"] === "https://zabbadat.com" && !r.body.includes("testsecretvalue")); }
  { const r = await F.handler(ev(), { fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
    check("function: Cloudflare error -> 200 { iceServers: [] }", r.statusCode === 200 && body(r).iceServers.length === 0); }
  { const r = await F.handler(ev(), { fetch: async () => { throw new Error("network"); } });
    check("function: Cloudflare unreachable -> 200 { iceServers: [] }", r.statusCode === 200 && body(r).iceServers.length === 0); }
  { const okO = ["https://zabbadat.com", "https://www.zabbadat.com", "capacitor://localhost", "https://localhost"];
    const rs = await Promise.all(okO.map((o) => F.handler(ev({ headers: { origin: o } }), { fetch: async () => okRes({ iceServers: CF_LIST }) })));
    const bad = await F.handler(ev({ headers: { origin: "https://evil.example" } }), { fetch: async () => okRes({ iceServers: CF_LIST }) });
    const none = await F.handler(ev({ headers: {} }), { fetch: async () => okRes({ iceServers: CF_LIST }) });
    const ref = await F.handler(ev({ headers: { referer: "https://www.zabbadat.com/?live=K7QX2" } }), { fetch: async () => okRes({ iceServers: CF_LIST }) });
    check("function: origin allowlist (zabbadat.com, www, capacitor://localhost, https://localhost); others / no origin get []", rs.every((r) => body(r).iceServers.length === 2)
      && bad.statusCode === 403 && body(bad).iceServers.length === 0 && !bad.headers["Access-Control-Allow-Origin"] && none.statusCode === 403 && body(ref).iceServers.length === 2);
    const opt = await F.handler({ httpMethod: "OPTIONS", headers: { origin: "capacitor://localhost" } });
    const get = await F.handler({ httpMethod: "GET", headers: { origin: "https://zabbadat.com" } });
    check("function: CORS preflight for the app origin; GET refused", opt.statusCode === 204 && opt.headers["Access-Control-Allow-Origin"] === "capacitor://localhost" && get.statusCode === 405); }
  { const h = { origin: "https://zabbadat.com", "x-nf-client-connection-ip": "9.9.9.9" }; let last;
    for (let i = 0; i < F.RATE_MAX + 1; i++) last = await F.handler({ httpMethod: "POST", headers: h }, { fetch: async () => okRes({ iceServers: CF_LIST }) });
    check("function: rate limit (per IP per minute) -> 429 with []", last.statusCode === 429 && body(last).iceServers.length === 0); }
  delete process.env.CF_TURN_KEY_ID; delete process.env.CF_TURN_API_SECRET;

  // ---- wiring / no secrets ----
  const src = fsMod.readFileSync(path.join(__dirname, "..", "netlify/functions/turn-creds.js"), "utf8"), live = fsMod.readFileSync(path.join(__dirname, "..", "zabba-live.js"), "utf8");
  check("no credentials committed (env vars only)", /process\.env\.CF_TURN_KEY_ID/.test(src) && /process\.env\.CF_TURN_API_SECRET/.test(src) && !/Bearer [A-Za-z0-9_-]{20,}/.test(src + live));
  const priv = fsMod.readFileSync(path.join(__dirname, "..", "privacy.html"), "utf8");
  check("privacy: live video is peer to peer or relayed by Cloudflare's TURN relay, not recorded, connection details expire", /peer to peer/.test(priv) && /Cloudflare/.test(priv) && /TURN/.test(priv) && /not record/.test(priv) && /expire/.test(priv));
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); process.exit(ok === R.length ? 0 : 1);
})();
