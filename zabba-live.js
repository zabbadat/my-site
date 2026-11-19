/* Zabba Washers Live Match, public Live tab (video): each player can "Go live" from the match panel and their phone camera
 * streams to anyone watching the match by its 5-character code (?live=CODE or #live=CODE, signed-out allowed).
 * Transport: WebRTC, one peer connection per viewer per broadcaster (mesh, video plus optional microphone audio).
 * The phone sends one copy of its media per viewer, so viewers are capped at MAX_VIEWERS per broadcaster (upload ~ viewers x MAX_KBPS).
 * Signaling: Firestore, under the match doc (all fields validated by firestore.rules, see "Live tab signaling"):
 *   matches/{code}/casters/{seat}   seat "0"|"1", written only by that seat's player:
 *     { uid, live: bool, sid (random session id, new each Go live), facing: "environment"|"user", updatedAt }
 *   matches/{code}/peers/{pid}      pid = 20 random chars (the secret: get-only for viewers, never listable by them):
 *     { seat, sid, offer, vIce: [..], answer, cIce: [..], full, by (viewer uid or null), createdAt, updatedAt, expireAt }
 *   The VIEWER creates the doc with a recvonly SDP offer and appends its ICE candidates (vIce, one per write); only the
 *   BROADCASTER of that seat writes answer / cIce / full. expireAt (createdAt + 2 h) is for a Firestore TTL policy (cleanup).
 * ICE: Google public STUN + Cloudflare TURN relay. Before creating any RTCPeerConnection, loadTurn() POSTs to
 * /.netlify/functions/turn-creds (short-lived Cloudflare Realtime TURN credentials, ~2 h; waits at most TURN_TIMEOUT_MS)
 * and the result is merged after STUN. If that fails or returns [], it is STUN only, and some networks (symmetric NAT,
 * many cellular carriers, strict corporate wifi) cannot connect; the tile then shows "Couldn't connect". Manual override:
 * window.ZABBA_LIVE_TURN = [{ urls, username, credential }] or ZabbaLive.config.turn (used instead of the fetched list).
 * Overlay hook: ZabbaLive.hooks.sourceTrack(stream) picks the video track to send (default: the camera track). A later PFP
 * overlay can return canvas.captureStream(24).getVideoTracks()[0]; caster.setTrack(track) swaps it live for every viewer.
 * Browser: window.ZabbaLive. Node: require("./zabba-live.js"). Signaling adapter + RTCPeerConnection are injected (tests).
 */
(function (root) {
  const CODE_LEN = 5, ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const MAX_VIEWERS = 10, MAX_KBPS = 500, SDP_MAX = 20000, ICE_MAX = 600, ICE_COUNT = 30, PID_LEN = 20, SID_LEN = 12;
  const STALE_MS = 75000, HEARTBEAT_MS = 25000, PEER_TTL_MS = 2 * 60 * 60 * 1000, RETRY_MS = 4000, MAX_RETRIES = 3;
  const STUN = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
  const config = {
    // ===== TURN CONFIG HOOK =====================================================================================
    // Public STUN works for most home wifi. For symmetric NAT / cellular, add a TURN relay here (or set
    // window.ZABBA_LIVE_TURN before going live). Never commit paid TURN credentials; use short-lived ones from a function.
    turn: null, // e.g. [{ urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:443"], username: "u", credential: "p" }]
    turnUrl: "/.netlify/functions/turn-creds", // short-lived Cloudflare TURN credentials (netlify/functions/turn-creds.js); "" = off
    // ============================================================================================================
  };
  const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  function randId(n, rand) {
    let s = ""; const c = root && root.crypto && root.crypto.getRandomValues && !rand ? root.crypto.getRandomValues(new Uint8Array(n)) : null;
    for (let i = 0; i < n; i++) s += ID_CHARS[(c ? c[i] : Math.floor((rand || Math.random)() * 256)) % ID_CHARS.length];
    return s;
  }
  const normCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isValidCode = (s) => typeof s === "string" && s.length === CODE_LEN && [...s].every((c) => ALPHABET.includes(c));
  /* ?live=CODE or #live=CODE (also #live/CODE) */
  function liveCodeFromUrl(search, hash) {
    const m = /[?&]live=([A-Za-z0-9-]+)/.exec(search || "") || /^#live[=/]([A-Za-z0-9-]+)/.exec(hash || "");
    const c = m ? normCode(m[1]) : ""; return isValidCode(c) ? c : "";
  }
  const liveLinkFor = (code, origin) => (origin || "https://zabbadat.com") + "/?live=" + code + "#zabbaLive";
  /* fetched TURN list (turn-creds), reused until TURN_REFRESH_MS (credentials live 2 h) */
  const TURN_TIMEOUT_MS = 3000, TURN_REFRESH_MS = 90 * 60 * 1000, TURN_RETRY_MS = 60000;
  const turnState = { list: null, at: 0, p: null };
  function iceServers(extra) {
    const t = extra || config.turn || (root && root.ZABBA_LIVE_TURN) || turnState.list || null;
    return STUN.concat(Array.isArray(t) ? t : t ? [t] : []);
  }
  function turnEndpoint() {
    const u = config.turnUrl; if (!u) return "";
    const proto = root && root.location && root.location.protocol;
    // bundled Capacitor page (capacitor://localhost): relative URLs don't reach Netlify
    return /^\//.test(u) && proto && !/^https?:$/.test(proto) ? "https://zabbadat.com" + u : u;
  }
  /* Resolves (never rejects) within TURN_TIMEOUT_MS with the TURN servers to add after STUN ([] = STUN only).
   * opts: { fetch, now, timeoutMs } (tests). Concurrent callers share one request. */
  function loadTurn(opts = {}) {
    const now = opts.now || (() => Date.now()), f = opts.fetch || (root && root.fetch && root.fetch.bind(root));
    if (config.turn || (root && root.ZABBA_LIVE_TURN)) return Promise.resolve(iceServers().slice(STUN.length));
    if (turnState.list && now() - turnState.at < (turnState.list.length ? TURN_REFRESH_MS : TURN_RETRY_MS)) return Promise.resolve(turnState.list);
    if (turnState.p) return turnState.p;
    const url = turnEndpoint();
    if (!url || typeof f !== "function") return Promise.resolve([]);
    const ac = root && typeof root.AbortController === "function" ? new root.AbortController() : null;
    let timer = null;
    const done = (list) => { clearTimeout(timer); turnState.list = list; turnState.at = now(); turnState.p = null; return list; };
    const req = Promise.resolve().then(() => f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", signal: ac ? ac.signal : undefined }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => (d && Array.isArray(d.iceServers) ? d.iceServers.filter((x) => x && x.urls && (!Array.isArray(x.urls) || x.urls.length)) : []))
      .catch(() => []);
    const to = new Promise((r) => { timer = setTimeout(() => { try { ac && ac.abort(); } catch (e) {} r([]); }, opts.timeoutMs || TURN_TIMEOUT_MS); });
    turnState.p = Promise.race([req, to]).then(done, () => done([]));
    return turnState.p;
  }
  const pidOk = (s) => typeof s === "string" && new RegExp("^[A-Za-z0-9]{" + PID_LEN + "}$").test(s);
  const sidOk = (s) => typeof s === "string" && new RegExp("^[A-Za-z0-9]{" + SID_LEN + "}$").test(s);
  const sdpOk = (s) => typeof s === "string" && s.length >= 10 && s.length <= SDP_MAX && s.slice(0, 3) === "v=0";
  const iceOk = (s) => typeof s === "string" && s.length >= 2 && s.length <= ICE_MAX;
  const iceStr = (c) => JSON.stringify({ c: c.candidate, m: c.sdpMid == null ? null : c.sdpMid, i: c.sdpMLineIndex == null ? null : c.sdpMLineIndex });
  const iceObj = (s) => { try { const o = JSON.parse(s); return { candidate: o.c, sdpMid: o.m, sdpMLineIndex: o.i }; } catch (e) { return null; } };
  const ms = (v, toMs) => (toMs ? toMs(v) : typeof v === "number" ? v : null);
  /* A caster doc counts as live when live=true, a valid session, and a heartbeat in the last STALE_MS (phone died / tab closed). */
  function casterLive(c, nowMs, toMs) { if (!c || c.live !== true || !sidOk(c.sid)) return false; const t = ms(c.updatedAt, toMs); return t == null || nowMs - t <= STALE_MS; }
  const PEER_KEYS = ["seat", "sid", "offer", "vIce", "answer", "cIce", "full", "by", "createdAt", "updatedAt", "expireAt"];
  function newPeer(seat, sid, offer, by, ts, nowMs) {
    return { seat, sid, offer, vIce: [], answer: "", cIce: [], full: false, by: by || null, createdAt: ts, updatedAt: ts, expireAt: nowMs + PEER_TTL_MS };
  }
  /* Mirror of the firestore.rules signaling checks (for tests and for the client to refuse bad writes early). "" = allowed.
   * kind: "caster" (casters/{seat}) | "peer" (peers/{pid}); who = { uid|null }; m = match doc; T = server time. */
  function checkWrite(kind, id, before, after, who, m, T, extra) {
    const uid = who && who.uid || null, keys = (o) => Object.keys(o || {}).sort().join(",");
    const changed = (a, b) => Object.keys(Object.assign({}, a, b)).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const appendOne = (o, n) => Array.isArray(n) && n.length <= ICE_COUNT && (n.length === o.length || (n.length === o.length + 1 && iceOk(n[n.length - 1]))) && JSON.stringify(n.slice(0, o.length)) === JSON.stringify(o);
    if (!m) return "no match";
    if (kind === "caster") {
      if (!uid) return "sign in";
      if (!(id === "0" || id === "1")) return "bad seat";
      if (!after) return "no delete";
      if (!Array.isArray(m.uids) || m.uids[Number(id)] !== uid) return "not your seat";
      if (keys(after) !== "facing,live,sid,uid,updatedAt") return "bad shape";
      if (after.uid !== uid || typeof after.live !== "boolean" || !sidOk(after.sid) || !["environment", "user"].includes(after.facing) || after.updatedAt !== T) return "bad fields";
      return "";
    }
    if (kind !== "peer") return "bad kind";
    if (!pidOk(id)) return "bad id";
    const seatUid = before && Array.isArray(m.uids) ? m.uids[before.seat] : null;
    if (!after) return before && uid && (uid === seatUid || uid === before.by) ? "" : "no delete";
    if (keys(after) !== PEER_KEYS.slice().sort().join(",")) return "bad shape";
    if (!before) { // viewer creates
      if (!(m.status === "waiting" || m.status === "active")) return "match over";
      const c = extra && extra.caster;
      if (!(after.seat === 0 || after.seat === 1)) return "bad seat";
      if (!c || c.live !== true || c.sid !== after.sid) return "not live";
      if (!sdpOk(after.offer) || after.vIce.length !== 0 || after.answer !== "" || after.cIce.length !== 0 || after.full !== false) return "bad fields";
      if (after.by !== uid) return "bad by";
      if (after.createdAt !== T || after.updatedAt !== T || !(after.expireAt > T && after.expireAt <= T + 3 * 3600000)) return "bad time";
      return "";
    }
    const ch = changed(before, after);
    if (after.updatedAt !== T) return "bad time";
    if (ch.every((k) => ["vIce", "updatedAt"].includes(k))) { // viewer ICE
      if (before.by && before.by !== uid) return "not your peer";
      return appendOne(before.vIce, after.vIce) ? "" : "bad ice";
    }
    if (ch.every((k) => ["answer", "cIce", "full", "updatedAt"].includes(k))) { // broadcaster only
      if (!uid || uid !== seatUid) return "broadcaster only";
      if (after.answer !== before.answer && !(before.answer === "" && sdpOk(after.answer))) return "bad answer";
      if (typeof after.full !== "boolean") return "bad full";
      return appendOne(before.cIce, after.cIce) ? "" : "bad ice";
    }
    return "bad change";
  }
  /* What a viewer sees (no uids shown): banner + seats with name/photo/score/turn. */
  function publicView(m, nowMs, toMs) {
    const out = { banner: "", round: 0, status: m ? m.status : "missing", secsLeft: null, seats: [] };
    if (!m) { out.banner = "No match with that code."; return out; }
    const ps = Array.isArray(m.players) ? m.players : [];
    out.round = m.round | 0;
    out.seats = [0, 1].map((i) => { const p = ps[i]; return p ? { seat: i, name: p.name || "Player", photo: p.photo || "", score: (m.scores && m.scores[i]) | 0, turn: !!m.turn && m.turn === p.uid } : { seat: i, name: "Waiting…", photo: "", score: 0, turn: false, empty: true }; });
    if (m.status === "waiting") out.banner = "Waiting for the second player to join.";
    else if (m.status === "abandoned") out.banner = "Match cancelled.";
    else if (m.status === "finished") { const wi = Array.isArray(m.uids) ? m.uids.indexOf(m.winner) : -1;
      out.banner = m.reason === "tie" ? "Tie game." : wi >= 0 ? (out.seats[wi].name + " wins" + (m.reason === "forfeit" ? " by forfeit." : "!")) : "Match over."; }
    else { const t = out.seats.find((s) => s.turn); const at = ms(m.turnAt, toMs);
      if (at != null && nowMs != null) out.secsLeft = Math.max(0, Math.ceil((at + (m.turnMs || 45000) - nowMs) / 1000));
      out.banner = "Round " + out.round + " · " + (t ? t.name + " is pitching" : "Live"); }
    return out;
  }
  const hooks = {
    sourceTrack: (stream) => (stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null) || null,
    sourceAudio: (stream) => (stream && stream.getAudioTracks ? stream.getAudioTracks()[0] : null) || null
  };
  /* serial async queue: Firestore writes for one peer go out in order */
  function queue() { let p = Promise.resolve(); return (fn) => (p = p.then(fn).catch(() => {})); }

  /* ---- broadcaster (a player's phone) ----
   * sig: { setCaster(code, seat, data), watchPeers(code, seat, sid, cb(list[{id,data}])), updatePeer(code, pid, patch),
   *        deletePeer(code, pid), ts(), append(x) (arrayUnion), toMs } ; opts: { RTC, now, rand, onViewers(n), onError(msg) } */
  function caster(sig, opts = {}) {
    const RTC = opts.RTC || (root && root.RTCPeerConnection), now = opts.now || (() => Date.now());
    let code = null, seat = null, sid = null, uid = null, track = null, audioTrack = null, facing = "environment", off = null, beat = null, muted = false;
    const peers = new Map(); // pid -> { pc, q, nIce, sender, done }
    const count = () => [...peers.values()].filter((p) => !p.full && !p.closed).length;
    const viewers = () => { try { opts.onViewers && opts.onViewers(count()); } catch (e) {} };
    function drop(pid) { const p = peers.get(pid); if (!p) return; p.closed = true; try { p.pc && p.pc.close(); } catch (e) {} viewers(); }
    async function onPeer(id, d) {
      let p = peers.get(id);
      if (!p) {
        if (!d || d.sid !== sid || d.seat !== seat || !sdpOk(d.offer)) return;
        p = { q: queue(), nIce: 0, closed: false, full: false }; peers.set(id, p);
        if (d.full || d.answer) { p.closed = true; return; } // someone else's / stale
        if (count() > MAX_VIEWERS) { p.full = true; p.q(() => sig.updatePeer(code, id, { full: true, updatedAt: sig.ts() })); viewers(); return; }
        p.last = d; viewers();
        await loadTurn(opts.turn);
        if (p.closed || !peers.has(id) || peers.get(id) !== p) return;
        const pc = new RTC({ iceServers: iceServers() }); p.pc = pc; p.sentIce = 0;
        pc.onicecandidate = (e) => { if (e.candidate && e.candidate.candidate && !p.closed && p.sentIce < ICE_COUNT) { p.sentIce++; const s = iceStr(e.candidate); if (iceOk(s)) p.q(() => sig.updatePeer(code, id, { cIce: sig.append(s), updatedAt: sig.ts() })); } };
        pc.onconnectionstatechange = () => { const s = pc.connectionState; clearTimeout(p.dt);
          if (s === "failed" || s === "closed") drop(id);
          else if (s === "disconnected") p.dt = setTimeout(() => { if (pc.connectionState === "disconnected") drop(id); }, 10000); }; // viewer left: free the slot
        p.q(async () => {
          await pc.setRemoteDescription({ type: "offer", sdp: d.offer });
          const trs = (pc.getTransceivers ? pc.getTransceivers() : []) || [];
          const kindOf = (tr) => (tr.receiver && tr.receiver.track && tr.receiver.track.kind) || (tr.sender && tr.sender.track && tr.sender.track.kind) || "";
          const vtr = trs.find((t) => kindOf(t) === "video") || null;
          const atr = trs.find((t) => kindOf(t) === "audio") || null;
          if (vtr) { vtr.direction = "sendonly"; await vtr.sender.replaceTrack(track); p.sender = vtr.sender; } else { p.sender = pc.addTrack(track); }
          if (audioTrack) {
            const sendA = muted ? null : audioTrack;
            if (atr) { atr.direction = "sendonly"; await atr.sender.replaceTrack(sendA); p.audioSender = atr.sender; }
            else if (sendA) p.audioSender = pc.addTrack(sendA);
          }
          limitBitrate(p.sender);
          const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
          p.ready = true; await sig.updatePeer(code, id, { answer: pc.localDescription ? pc.localDescription.sdp : ans.sdp, updatedAt: sig.ts() });
          addIce(p);
        });
        viewers(); return;
      }
      if (p.pc && !p.closed) p.q(async () => addIce(p, d));
      else if (!p.closed && d) p.last = d; // still waiting for TURN: keep the newest snapshot (viewer ICE) for addIce
    }
    async function addIce(p, d) { if (d) p.last = d; if (!p.ready) return; d = p.last; const l = (d && d.vIce) || []; while (p.nIce < l.length) { const c = iceObj(l[p.nIce++]); if (c) { try { await p.pc.addIceCandidate(c); } catch (e) {} } } p.last = d; }
    function limitBitrate(sender) { try { if (!sender || !sender.getParameters) return; const prm = sender.getParameters(); if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}]; prm.encodings[0].maxBitrate = MAX_KBPS * 1000; const r = sender.setParameters(prm); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
    async function start(o) {
      if (code) await stop();
      code = o.code; seat = o.seat; uid = o.uid; facing = o.facing || "environment"; sid = randId(SID_LEN, opts.rand);
      track = hooks.sourceTrack(o.stream); if (!track) throw new Error("No camera video to send.");
      audioTrack = hooks.sourceAudio(o.stream) || null; muted = !!o.muted;
      loadTurn(opts.turn); // warm the TURN credentials before the first viewer arrives
      await sig.setCaster(code, String(seat), { uid, live: true, sid, facing, updatedAt: sig.ts() });
      off = sig.watchPeers(code, seat, sid, (list) => { list.forEach((x) => onPeer(x.id, x.data)); });
      beat = setInterval(() => { if (code) sig.setCaster(code, String(seat), { uid, live: true, sid, facing, updatedAt: sig.ts() }).catch(() => {}); }, HEARTBEAT_MS);
      if (beat && beat.unref) beat.unref();
      return sid;
    }
    /* swap the outgoing video (camera flip, or a canvas.captureStream() overlay track) for every viewer, no renegotiation */
    async function setTrack(t, newFacing) { track = t; if (newFacing) facing = newFacing;
      await Promise.all([...peers.values()].filter((p) => p.sender && !p.closed).map((p) => p.sender.replaceTrack(t).catch(() => {})));
      if (code && newFacing) await sig.setCaster(code, String(seat), { uid, live: true, sid, facing, updatedAt: sig.ts() }).catch(() => {}); }
    async function setAudioTrack(t) { audioTrack = t || null;
      await Promise.all([...peers.values()].filter((p) => p.audioSender && !p.closed).map((p) => p.audioSender.replaceTrack(muted ? null : audioTrack).catch(() => {}))); }
    async function setMuted(on) { muted = !!on;
      await Promise.all([...peers.values()].filter((p) => p.audioSender && !p.closed).map((p) => p.audioSender.replaceTrack(muted ? null : audioTrack).catch(() => {})));
      return muted; }
    async function stop() {
      const c = code, s = seat, ids = [...peers.keys()];
      if (off) off(); off = null; clearInterval(beat); beat = null;
      ids.forEach(drop); peers.clear(); code = null; viewers();
      if (c == null) return;
      await sig.setCaster(c, String(s), { uid, live: false, sid, facing, updatedAt: sig.ts() }).catch(() => {});
      await Promise.all(ids.map((id) => (sig.deletePeer ? sig.deletePeer(c, id).catch(() => {}) : null)));
    }
    return { start, stop, setTrack, setAudioTrack, setMuted, get muted() { return muted; }, get live() { return !!code; }, get sid() { return sid; }, get viewers() { return count(); }, _peers: peers };
  }

  /* ---- viewer (anyone with the code; one connection per live seat) ----
   * sig: { watchCaster(code, seat, cb(doc|null)), createPeer(code, pid, data), watchPeer(code, pid, cb), updatePeer, ts(), append(x), toMs }
   * opts: { RTC, by (viewer uid or null), now, rand, onStream(seat, MediaStream|null), onState(seat, state) }
   * states: offline | connecting | live | full | failed | self (opts.skip(seat) true: this page is that seat's broadcaster) */
  function viewer(sig, opts = {}) {
    const RTC = opts.RTC || (root && root.RTCPeerConnection), now = opts.now || (() => Date.now());
    let code = null; const seats = [null, null], offs = [];
    const state = (i, s) => { if (seats[i]) seats[i].state = s; try { opts.onState && opts.onState(i, s); } catch (e) {} };
    function close(i) { const s = seats[i]; if (!s) return; s.dead = true; if (s.off) s.off(); try { s.pc && s.pc.close(); } catch (e) {} clearTimeout(s.retry); seats[i] = null; try { opts.onStream && opts.onStream(i, null); } catch (e) {} }
    async function connect(i, sid, tries) {
      close(i);
      const ph = { pending: true, sid, state: "connecting", dead: false }; seats[i] = ph; state(i, "connecting");
      await loadTurn(opts.turn);
      if (seats[i] !== ph) return; // closed or superseded while waiting for TURN
      const pid = randId(PID_LEN, opts.rand), q = queue(), pc = new RTC({ iceServers: iceServers() });
      const s = { pid, sid, pc, q, nIce: 0, created: false, pending: [], dead: false, tries: tries | 0, state: "connecting" }; seats[i] = s; state(i, "connecting");
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = (e) => { if (s.dead) return; const st = (e.streams && e.streams[0]) || (root && root.MediaStream ? new root.MediaStream([e.track]) : { track: e.track }); try { opts.onStream && opts.onStream(i, st); } catch (x) {} };
      let sentIce = 0;
      pc.onicecandidate = (e) => { if (!e.candidate || !e.candidate.candidate || s.dead || sentIce >= ICE_COUNT) return; const str = iceStr(e.candidate); if (!iceOk(str)) return; sentIce++;
        q(() => (s.dead ? null : sig.updatePeer(code, pid, { vIce: sig.append(str), updatedAt: sig.ts() }))); };
      pc.onconnectionstatechange = () => { if (s.dead) return; const cs = pc.connectionState;
        if (cs === "connected") state(i, "live");
        if (cs === "failed") { state(i, "failed"); if (s.tries < MAX_RETRIES) s.retry = setTimeout(() => { if (!s.dead && seats[i] === s) connect(i, sid, s.tries + 1); }, RETRY_MS); } };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      if (s.dead) return;
      q(() => sig.createPeer(code, pid, newPeer(i, sid, pc.localDescription ? pc.localDescription.sdp : offer.sdp, opts.by || null, sig.ts(), now())));
      s.off = sig.watchPeer(code, pid, (d) => { if (!d || s.dead) return;
        if (d.full) { state(i, "full"); return; }
        q(async () => { if (s.dead) return;
          if (d.answer && !s.answered) { s.answered = true; await pc.setRemoteDescription({ type: "answer", sdp: d.answer }); }
          if (!s.answered) return; const l = d.cIce || []; while (s.nIce < l.length) { const c = iceObj(l[s.nIce++]); if (c) { try { await pc.addIceCandidate(c); } catch (e) {} } } }); });
    }
    function watch(c) {
      stop(); code = c; loadTurn(opts.turn);
      [0, 1].forEach((i) => { offs[i] = sig.watchCaster(code, String(i), (doc) => {
        if (opts.skip && opts.skip(i, code)) { if (seats[i]) close(i); state(i, casterLive(doc, now(), sig.toMs) ? "self" : "offline"); return; }
        const live = casterLive(doc, now(), sig.toMs);
        if (!live) { if (seats[i]) close(i); state(i, "offline"); return; }
        if (!seats[i] || seats[i].sid !== doc.sid) connect(i, doc.sid, 0).catch(() => state(i, "failed"));
      }); });
    }
    function stop() { offs.forEach((f) => f && f()); offs.length = 0; [0, 1].forEach(close); code = null; }
    /* re-run the seat checks (e.g. this page just went live / stopped, so opts.skip changed) */
    function refresh() { const c = code; if (c) watch(c); }
    return { watch, stop, refresh, get code() { return code; }, _seats: seats };
  }
  const api = { CODE_LEN, MAX_VIEWERS, MAX_KBPS, SDP_MAX, ICE_MAX, ICE_COUNT, PID_LEN, SID_LEN, STALE_MS, HEARTBEAT_MS, PEER_TTL_MS, STUN, PEER_KEYS, config, hooks,
    randId, normCode, isValidCode, liveCodeFromUrl, liveLinkFor, iceServers, loadTurn, turnState, TURN_TIMEOUT_MS, pidOk, sidOk, sdpOk, iceOk, iceStr, iceObj, casterLive, newPeer, checkWrite, publicView, caster, viewer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ZabbaLive = api;
})(typeof window !== "undefined" ? window : null);
