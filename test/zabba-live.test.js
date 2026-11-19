// Live tab (zabba-live.js): link parsing, ICE config + TURN hook, rules mirror for the signaling docs, public view (no uids),
// and a full caster <-> viewer handshake (offer / answer / trickle ICE / viewer cap / camera swap / stop) over an in-memory
// Firestore stand-in with a fake RTCPeerConnection. Every write is replayed through the rules mirror as the writer.
const fsMod = require("fs"), path = require("path");
const ZL = require("../zabba-live.js");
const R = []; const check = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); R.push(!!ok); };
const tick = (n = 1) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : setTimeout(f, 0)); setTimeout(f, 0); });
const settle = async () => { for (let i = 0; i < 40; i++) await tick(); };

// ---- pure helpers ----
check("live link: ?live= and #live= (and #live/), bad codes refused", ZL.liveCodeFromUrl("?a=1&live=k7qx2", "") === "K7QX2" && ZL.liveCodeFromUrl("", "#live=K7QX2") === "K7QX2" && ZL.liveCodeFromUrl("", "#live/k7qx2") === "K7QX2"
  && ZL.liveCodeFromUrl("?live=K0QX2", "") === "" && ZL.liveCodeFromUrl("?match=K7QX2", "") === "" && ZL.liveLinkFor("K7QX2", "https://zabbadat.com") === "https://zabbadat.com/?live=K7QX2#zabbaLive");
check("ids: pid 20 / sid 12 alphanumeric, varied", (() => { const s = new Set(); for (let i = 0; i < 500; i++) { const p = ZL.randId(ZL.PID_LEN); if (!ZL.pidOk(p)) return false; s.add(p); } return s.size === 500 && ZL.sidOk(ZL.randId(ZL.SID_LEN)) && !ZL.pidOk("short") && !ZL.pidOk("a".repeat(19) + "-"); })());
check("ICE: public STUN only by default", ZL.iceServers().length === 2 && ZL.iceServers().every((s) => /^stun:/.test(s.urls)));
ZL.config.turn = [{ urls: "turn:turn.example.com:3478", username: "u", credential: "p" }];
check("ICE: TURN hook appended after STUN", ZL.iceServers().length === 3 && ZL.iceServers()[2].urls === "turn:turn.example.com:3478");
ZL.config.turn = null;
check("SDP / ICE size limits", ZL.sdpOk("v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n") && !ZL.sdpOk("hello there") && !ZL.sdpOk("v=0" + "a".repeat(ZL.SDP_MAX)) && ZL.iceOk("{}") && !ZL.iceOk("x".repeat(ZL.ICE_MAX + 1)));
check("ICE candidate round trip", JSON.stringify(ZL.iceObj(ZL.iceStr({ candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host", sdpMid: "0", sdpMLineIndex: 0 }))) === JSON.stringify({ candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host", sdpMid: "0", sdpMLineIndex: 0 }) && ZL.iceObj("{bad") === null);
check("caster live: needs live=true, valid sid, heartbeat in the last 75 s", ZL.casterLive({ live: true, sid: "A".repeat(12), updatedAt: 1000 }, 1000 + 74000) && !ZL.casterLive({ live: true, sid: "A".repeat(12), updatedAt: 1000 }, 1000 + 76000)
  && !ZL.casterLive({ live: false, sid: "A".repeat(12), updatedAt: 1000 }, 1000) && !ZL.casterLive({ live: true, sid: "x", updatedAt: 1000 }, 1000) && !ZL.casterLive(null, 0));
{ const m = { status: "active", uids: ["a", "b"], players: [{ uid: "a", name: "Ann", photo: "" }, { uid: "b", name: "Bo", photo: "https://x/y.png" }], scores: [7, 12], round: 3, turn: "b", turnAt: 1000, turnMs: 45000 };
  const v = ZL.publicView(m, 11000);
  check("public view: names, photos, scores, turn, round, clock; no uids", v.banner === "Round 3 · Bo is pitching" && v.seats[1].turn && !v.seats[0].turn && v.seats[1].score === 12 && v.secsLeft === 35 && !JSON.stringify(v).includes('"uid"'));
  check("public view: waiting / finished / missing", ZL.publicView(Object.assign({}, m, { status: "waiting", uids: ["a"], players: [m.players[0]] })).seats[1].empty
    && ZL.publicView(Object.assign({}, m, { status: "finished", winner: "a", reason: "score" })).banner === "Ann wins!" && ZL.publicView(null).banner === "No match with that code."); }

// ---- rules mirror ----
{ const T = 5000, m = { status: "active", uids: ["a", "b"] }, sid = "S1d2e3f4g5h6", cast = { uid: "a", live: true, sid, facing: "environment", updatedAt: T };
  const cw = (id, after, uid, mm) => ZL.checkWrite("caster", id, null, after, { uid }, mm || m, T);
  check("rules mirror: caster seat ownership", cw("0", cast, "a") === "" && cw("0", Object.assign({}, cast, { uid: "b" }), "b") === "not your seat" && cw("1", cast, "a") !== "" && cw("0", cast, null) === "sign in" && cw("2", cast, "a") === "bad seat");
  check("rules mirror: caster shape", cw("0", Object.assign({ x: 1 }, cast), "a") === "bad shape" && cw("0", Object.assign({}, cast, { facing: "up" }), "a") === "bad fields");
  const offer = "v=0\r\nm=video 9 UDP\r\n", np = ZL.newPeer(0, sid, offer, null, T, T), pid = "A".repeat(20), live = { caster: { live: true, sid } };
  const pw = (before, after, uid, ex, mm) => ZL.checkWrite("peer", pid, before, after, { uid }, mm || m, T, ex);
  check("rules mirror: signed-out viewer creates offer", pw(null, np, null, live) === "");
  check("rules mirror: create refused when not live / wrong sid / match over / by spoofed / answer prefilled", pw(null, np, null, { caster: { live: false, sid } }) === "not live" && pw(null, Object.assign({}, np, { sid: "B".repeat(12) }), null, live) === "not live"
    && pw(null, np, null, live, { status: "finished", uids: ["a", "b"] }) === "match over" && pw(null, Object.assign({}, np, { by: "c" }), null, live) === "bad by" && pw(null, Object.assign({}, np, { answer: offer }), null, live) === "bad fields");
  const ice = '{"c":"candidate:1","m":"0","i":0}', p1 = Object.assign({}, np, { vIce: [ice] });
  check("rules mirror: viewer appends one ICE; two at once or answer refused", pw(np, p1, null) === "" && pw(np, Object.assign({}, np, { vIce: [ice, ice] }), null) === "bad ice" && pw(np, Object.assign({}, np, { answer: offer }), null) === "broadcaster only");
  check("rules mirror: only seat 0's player answers seat 0; no answer rewrite", pw(np, Object.assign({}, np, { answer: offer }), "a") === "" && pw(np, Object.assign({}, np, { answer: offer }), "b") === "broadcaster only"
    && pw(Object.assign({}, np, { answer: offer }), Object.assign({}, np, { answer: offer + "x" }), "a") === "bad answer");
  check("rules mirror: signed-in viewer's ICE is theirs only", pw(Object.assign({}, np, { by: "c" }), Object.assign({}, np, { by: "c", vIce: [ice] }), null) === "not your peer");
  check("rules mirror: delete only by broadcaster or the signed-in viewer", pw(np, null, "a") === "" && pw(np, null, null) === "no delete" && pw(Object.assign({}, np, { by: "c" }), null, "c") === "");
}

// ---- in-memory signaling + fake WebRTC ----
function memSig(S, who) {
  const T = () => S.T, viol = S.viol;
  const resolve = (o, base) => { const out = Object.assign({}, base); for (const [k, v] of Object.entries(o)) out[k] = v === "__ts" ? T() : v && v.__append !== undefined ? (base[k] || []).includes(v.__append) ? base[k] : (base[k] || []).concat([v.__append]) : v; return out; };
  const emit = (p) => setTimeout(() => { (S.subs[p] || []).slice().forEach((f) => f(S.docs[p] ? JSON.parse(JSON.stringify(S.docs[p])) : null)); Object.values(S.qsubs).forEach((q) => q()); });
  const write = (kind, code, id, p, after) => { const before = S.docs[p] || null; const why = ZL.checkWrite(kind, id, before, after, { uid: who }, S.docs["matches/" + code], T(), kind === "peer" && !before && after ? { caster: S.docs[`matches/${code}/casters/${after.seat}`] } : undefined);
    if (why) { viol.push(who + ":" + kind + ":" + why); return Promise.reject(Object.assign(new Error(why), { code: "permission-denied" })); } if (after) S.docs[p] = after; else delete S.docs[p]; S.writes++; emit(p); return Promise.resolve(); };
  const watch = (p, cb) => { (S.subs[p] = S.subs[p] || []).push(cb); setTimeout(() => cb(S.docs[p] ? JSON.parse(JSON.stringify(S.docs[p])) : null)); return () => { S.subs[p] = S.subs[p].filter((f) => f !== cb); }; };
  return {
    ts: () => "__ts", append: (x) => ({ __append: x }), toMs: (v) => (typeof v === "number" ? v : null),
    setCaster: (code, seat, d) => write("caster", code, seat, `matches/${code}/casters/${seat}`, resolve(d, {})),
    watchCaster: (code, seat, cb) => watch(`matches/${code}/casters/${seat}`, cb),
    createPeer: (code, pid, d) => write("peer", code, pid, `matches/${code}/peers/${pid}`, resolve(d, {})),
    watchPeer: (code, pid, cb) => watch(`matches/${code}/peers/${pid}`, cb),
    updatePeer: (code, pid, p) => { const k = `matches/${code}/peers/${pid}`; return S.docs[k] ? write("peer", code, pid, k, resolve(p, S.docs[k])) : Promise.reject(new Error("missing")); },
    deletePeer: (code, pid) => write("peer", code, pid, `matches/${code}/peers/${pid}`, null),
    watchPeers: (code, seat, sid, cb) => { if (!(who && S.docs["matches/" + code].uids.includes(who))) throw new Error("list denied"); const id = Math.random();
      S.qsubs[id] = () => cb(Object.keys(S.docs).filter((k) => k.startsWith(`matches/${code}/peers/`) && S.docs[k].seat === seat && S.docs[k].sid === sid).map((k) => ({ id: k.split("/").pop(), data: JSON.parse(JSON.stringify(S.docs[k])) })));
      setTimeout(S.qsubs[id]); return () => delete S.qsubs[id]; },
  };
}
let pcN = 0; const offers = {};
class FakePC {
  constructor(cfg) { this.cfg = cfg; this.id = ++pcN; this.connectionState = "new"; this.tr = []; this.gotIce = 0; this.closed = false; FakePC.all.push(this); }
  addTransceiver(kind, o) { const rec = { direction: o.direction, kind, receiver: { track: { kind } }, sender: { track: null, replaceTrack: async (t) => { rec.sender.track = t; }, getParameters: () => ({ encodings: [{}] }), setParameters: async (p) => { this.maxBitrate = p.encodings[0].maxBitrate; } } }; this.tr.push(rec); }
  getTransceivers() { return this.tr; }
  async createOffer() { return { type: "offer", sdp: "v=0\r\no=fake " + this.id + "\r\nm=video recvonly\r\n" }; }
  async createAnswer() { return { type: "answer", sdp: "v=0\r\no=fake " + this.id + "\r\nm=video sendonly\r\n" }; }
  async setLocalDescription(d) { this.localDescription = d; if (d.type === "offer") offers[d.sdp] = this; setTimeout(() => { if (this.closed) return; [1, 2].forEach((k) => this.onicecandidate && this.onicecandidate({ candidate: { candidate: `candidate:${k} 1 udp 1 10.0.0.${this.id} 5000${k} typ host`, sdpMid: "0", sdpMLineIndex: 0 } })); this.onicecandidate && this.onicecandidate({ candidate: null }); }); }
  async setRemoteDescription(d) { this.remoteDescription = d; if (d.type === "offer") { this.peer = offers[d.sdp]; this.addTransceiver("video", { direction: "recvonly" }); } else this.peer = FakePC.all.find((p) => p.localDescription && p.localDescription.sdp === d.sdp); this.maybe(); }
  async addIceCandidate(c) { if (!this.remoteDescription) throw new Error("no remote"); this.gotIce++; this.maybe(); }
  addTrack(track) { const rec = { direction: "sendonly", kind: track && track.kind, receiver: { track: { kind: (track && track.kind) || "video" } }, sender: { track, replaceTrack: async (t) => { rec.sender.track = t; }, getParameters: () => ({ encodings: [{}] }), setParameters: async (p) => { this.maxBitrate = p.encodings[0].maxBitrate; } } }; this.tr.push(rec); return rec.sender; }
  maybe() { const a = this, b = this.peer; if (!b || a.connectionState === "connected" || !a.remoteDescription || !b.remoteDescription || a.gotIce < 1 || b.gotIce < 1) return;
    [a, b].forEach((p) => { p.connectionState = "connected"; p.onconnectionstatechange && p.onconnectionstatechange(); });
    const viewer = (a.tr[0] && a.tr[0].direction === "recvonly") ? a : b, caster = viewer === a ? b : a;
    const vt = (caster.tr || []).find((tr) => (tr.kind === "video") || (tr.sender && tr.sender.track && tr.sender.track.kind === "video")) || caster.tr[0];
    const track = vt && vt.sender && vt.sender.track; if (track) viewer.ontrack && viewer.ontrack({ track, streams: [{ id: "s" + caster.id, track }] }); }
  close() { if (this.closed) return; this.closed = true; this.connectionState = "closed"; const b = this.peer || FakePC.all.find((p) => p.peer === this); // remote side sees DTLS close -> failed
    if (b && !b.closed && b.connectionState === "connected") setTimeout(() => { b.connectionState = "failed"; b.onconnectionstatechange && b.onconnectionstatechange(); }); }
}
FakePC.all = [];

(async () => {
  const S = { T: 100000, docs: {}, subs: {}, qsubs: {}, viol: [], writes: 0 };
  S.docs["matches/K7QX2"] = { code: "K7QX2", status: "active", uids: ["a", "b"], players: [{ uid: "a", name: "Ann", photo: "" }, { uid: "b", name: "Bo", photo: "" }], scores: [0, 0] };
  const camA = { getVideoTracks: () => [{ id: "camA", kind: "video" }], getAudioTracks: () => [{ id: "micA", kind: "audio" }] }, camB = { getVideoTracks: () => [{ id: "camB", kind: "video" }], getAudioTracks: () => [] };
  let nA = 0; const ca = ZL.caster(memSig(S, "a"), { RTC: FakePC, now: () => S.T, onViewers: (n) => (nA = n) }), cb = ZL.caster(memSig(S, "b"), { RTC: FakePC, now: () => S.T });
  const streams = {}, states = {};
  const mkViewer = (by, key) => ZL.viewer(memSig(S, by), { RTC: FakePC, by, now: () => S.T, onStream: (i, s) => (streams[key + i] = s), onState: (i, s) => (states[key + i] = s) });
  const v1 = mkViewer(null, "v1:");
  v1.watch("K7QX2"); await settle();
  check("viewer before anyone is live: both tiles offline, no peers created", states["v1:0"] === "offline" && states["v1:1"] === "offline" && !Object.keys(S.docs).some((k) => k.includes("/peers/")));
  let threw = false; try { await ZL.caster(memSig(S, "c"), { RTC: FakePC }).start({ code: "K7QX2", seat: 0, uid: "c", stream: camA }); } catch (e) { threw = true; }
  check("non-player cannot go live (rules refuse the caster doc)", threw);
  S.viol.length = 0;
  await ca.start({ code: "K7QX2", seat: 0, uid: "a", stream: camA }); await settle();
  check("player A live -> signed-out viewer connects to seat 0 and gets A's camera track", states["v1:0"] === "live" && streams["v1:0"] && streams["v1:0"].track.id === "camA" && nA === 1);
  const pdoc = Object.entries(S.docs).find(([k]) => k.includes("/peers/"))[1];
  check("signaling doc: offer by viewer, answer by broadcaster, trickle ICE both ways, TTL set, by=null", ZL.sdpOk(pdoc.offer) && ZL.sdpOk(pdoc.answer) && pdoc.vIce.length === 2 && pdoc.cIce.length === 2 && pdoc.expireAt === S.T + ZL.PEER_TTL_MS && pdoc.by === null && pdoc.seat === 0);
  check("broadcaster bitrate capped", FakePC.all.some((p) => p.maxBitrate === ZL.MAX_KBPS * 1000));
  await cb.start({ code: "K7QX2", seat: 1, uid: "b", stream: camB }); await settle();
  check("player B live -> same viewer now has both streams", states["v1:1"] === "live" && streams["v1:1"].track.id === "camB" && streams["v1:0"].track.id === "camA");
  check("every signaling write passed the rules mirror", S.viol.length === 0 && S.writes > 10);
  // viewer cap: 11 more viewers on seat 0 (A already has 1)
  const many = []; for (let i = 0; i < ZL.MAX_VIEWERS + 1; i++) { const v = mkViewer(null, "m" + i + ":"); v.watch("K7QX2"); many.push(v); }
  await settle(); await settle();
  const full = many.filter((v, i) => states["m" + i + ":0"] === "full").length, liveN = many.filter((v, i) => states["m" + i + ":0"] === "live").length;
  check(`viewer cap: ${ZL.MAX_VIEWERS} per broadcaster, extras told "full" (${liveN} live + 1 earlier, ${full} full)`, liveN + 1 === ZL.MAX_VIEWERS && full === 2 && nA === ZL.MAX_VIEWERS);
  many.forEach((v) => v.stop()); await settle();
  check("viewers leaving free their slots (remote close -> failed -> dropped)", nA === 1);
  // camera flip / overlay hook: replaceTrack on every sender, no renegotiation
  const flipped = { id: "camA-front", kind: "video" }; await ca.setTrack(flipped, "user"); await settle();
  check("setTrack swaps the outgoing video for connected viewers (camera flip / canvas overlay hook)", (() => { const mine = FakePC.all.filter((p) => p.tr[0] && p.tr[0].direction === "sendonly" && !p.closed && p.tr[0].sender.track && /^camA/.test(p.tr[0].sender.track.id)); return mine.length === 1 && mine[0].tr[0].sender.track === flipped; })() && S.docs["matches/K7QX2/casters/0"].facing === "user");
  // the page that is the seat-0 broadcaster watches with skip -> no self connection
  const sv = ZL.viewer(memSig(S, "a"), { RTC: FakePC, by: "a", now: () => S.T, skip: (i) => i === 0, onState: (i, s) => (states["self:" + i] = s), onStream: () => {} });
  sv.watch("K7QX2"); await settle();
  check("broadcaster watching its own match: own seat shown as self (no peer), opponent streamed", states["self:0"] === "self" && states["self:1"] === "live");
  sv.stop();
  // stale heartbeat (phone died) -> offline
  S.T += ZL.STALE_MS + 1000; const v2 = mkViewer(null, "v2:"); v2.watch("K7QX2"); await settle();
  check("stale caster (no heartbeat for 75 s) shows offline", states["v2:0"] === "offline");
  v2.stop(); S.T -= ZL.STALE_MS + 1000;
  await ca.stop(); await settle();
  check("stop: caster doc live=false, viewer tile offline, its peer docs deleted", S.docs["matches/K7QX2/casters/0"].live === false && states["v1:0"] === "offline" && !Object.values(S.docs).some((d) => d.seat === 0 && d.sid === ca.sid && d.offer));
  S.docs["matches/K7QX2"].status = "finished"; S.viol.length = 0;
  await ca.start({ code: "K7QX2", seat: 0, uid: "a", stream: camA }); const v3 = mkViewer(null, "v3:"); v3.watch("K7QX2"); await settle();
  check("finished match: no new viewer connections (rules refuse peer create)", states["v3:0"] !== "live" && S.viol.some((x) => /match over/.test(x)));
  [v1, v3].forEach((v) => v.stop()); await ca.stop(); await cb.stop();
  // ---- page + rules wiring ----
  const html = fsMod.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"), rules = fsMod.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  check("page: zabba-live.js loaded after zabba-match.js; Watch Live card + hub card; player controls in #zmLiveSlot", html.indexOf('<script src="/zabba-live.js">') > html.indexOf('<script src="/zabba-match.js">') && html.includes('id="zabbaLive"') && /href="#zabbaLive" data-battle="live"/.test(html)
    && ["zlGoLive", "zlStop", "zlFlip", "zlWatchBoth", "zlSelf", "zlCode", "zlWatch", "zlVid0", "zlVid1", "zlScore0", "zlScore1", "zlShare"].every((id) => html.includes('id="' + id + '"')) && html.indexOf('id="zlGoLive"') > html.indexOf('id="zmLiveSlot"'));
  check("page: viewer videos muted + playsinline (iOS autoplay), live link handler, WashersLive camera + PFP-covered outbound", /<video id="zlVid0" playsinline muted autoplay>/.test(html) && /ZL.liveCodeFromUrl\(location.search, location.hash\)/.test(html) && /WashersLive \? window.WashersLive.getCamera/.test(html) && /function zlOutbound\(\)/.test(html) && /echoCancellation: true/.test(html));
  check("page: live controls, clocks, voice confirm, go live solo, mute, record", ["zmRecBtn", "zlMute", "zmElapsed", "zmVoiceConfirm", "zmSolo", "washersSoloBtn", "zlClock0"].every((id) => html.includes('id="' + id + '"')));
  check("page: washers-clock / voice / live-controls scripts after zabba-live.js", html.indexOf('src="/washers-clock.js"') > html.indexOf('src="/zabba-live.js"') && html.includes('src="/washers-voice.js"') && html.includes('src="/washers-live-controls.js"'));
  check("page: signaling paths are matches/{code}/casters + /peers", /doc\(db, "matches", code, "casters", seat\)/.test(html) && /collection\(db, "matches", code, "peers"\)/.test(html));
  const blk = rules.slice(rules.indexOf("match /casters/{seat}"), rules.indexOf("match /{document=**}"));
  check("rules: casters + peers nested under matches/{code}, before default deny; size/field limits; broadcaster-only answer", blk.length > 500 && rules.indexOf("match /peers/{pid}") > rules.indexOf("match /matches/{code}") && /x.size\(\) <= 20000/.test(blk) && /n.size\(\) <= 30/.test(blk) && /size\(\) <= 600/.test(blk)
    && /isCaster\(po\(\).seat\)/.test(blk) && /allow list: if request.auth != null && request.auth.uid in mt\(\).uids;/.test(blk) && /duration.value\(3, 'h'\)/.test(blk));
  const ok = R.filter(Boolean).length; console.log(`\n${ok}/${R.length} passed`); process.exit(ok === R.length ? 0 : 1);
})();
