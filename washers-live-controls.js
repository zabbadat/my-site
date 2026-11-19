/* Washers Live Match controls — modular so this block can later move into its own Live section.
 * Used by #zabbaMatch (player) and #zabbaLive (viewer). Browser + Capacitor (iOS flagship: ZabbaListen
 * + AVAudioSession voiceChat before getUserMedia; PFP shield canvas.captureStream, never raw while PFP is on).
 */
(function (root) {
  var WashersClock = (typeof module !== "undefined" && module.exports) ? require("./washers-clock.js") : (root && root.WashersClock);
  function pluginListen() {
    try {
      if (root.ZabbaListen && typeof root.ZabbaListen.prepareAudio === "function") return root.ZabbaListen;
      var cap = root.Capacitor, p = cap && cap.Plugins && cap.Plugins.ZabbaListen;
      if (p) return p;
      if (cap && typeof cap.registerPlugin === "function") return cap.registerPlugin("ZabbaListen");
    } catch (e) {}
    return null;
  }
  function prepareAudio() {
    var p = pluginListen();
    if (p && typeof p.prepareAudio === "function") return Promise.resolve(p.prepareAudio()).catch(function () {});
    return Promise.resolve();
  }
  function gumConstraints(facing, withAudio, deviceId) {
    var video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }
      : { facingMode: { ideal: facing || "environment" }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };
    if (!withAudio) return { audio: false, video: video };
    return { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: video };
  }
  function listCameras() {
    var md = root.navigator && root.navigator.mediaDevices;
    if (!md || !md.enumerateDevices) return Promise.resolve([]);
    return md.enumerateDevices().then(function (all) {
      return (all || []).filter(function (d) { return d.kind === "videoinput"; }).map(function (d) {
        return { deviceId: d.deviceId, label: d.label || "Camera", groupId: d.groupId || "" };
      });
    }).catch(function () { return []; });
  }
  function getCamera(facing, deviceId) {
    var md = root.navigator && root.navigator.mediaDevices;
    if (!md || !md.getUserMedia) return Promise.reject(new Error("This browser has no camera access."));
    return prepareAudio().then(function () {
      return md.getUserMedia(gumConstraints(facing, true, deviceId)).catch(function (e) {
        return md.getUserMedia(gumConstraints(facing, false, deviceId)).then(function (s) { s.__noMic = true; return s; }, function () { throw e; });
      });
    });
  }
  // WHIP ingest of an already-covered MediaStream. Host-agnostic: any URL that speaks WHIP (MediaMTX, a custom
  // ffmpeg/GStreamer front end, etc.). The YouTube stream key never appears here.
  function startWhip(stream, whipUrl) {
    if (!stream || !whipUrl) return Promise.reject(new Error("Missing stream or ingest URL"));
    var RTC = root.RTCPeerConnection;
    if (!RTC) return Promise.reject(new Error("This browser has no WebRTC."));
    var pc = new RTC({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }] });
    stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
    return pc.createOffer().then(function (offer) {
      return pc.setLocalDescription(offer).then(function () { return offer; });
    }).then(function (offer) {
      return waitIce(pc).then(function () { return offer; });
    }).then(function (offer) {
      var sdp = (pc.localDescription && pc.localDescription.sdp) || offer.sdp;
      return fetch(whipUrl, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: sdp }).then(function (r) {
        if (!r.ok) throw new Error("Relay returned " + r.status);
        return r.text();
      });
    }).then(function (answer) {
      return pc.setRemoteDescription({ type: "answer", sdp: answer }).then(function () { return pc; });
    }).catch(function (e) { try { pc.close(); } catch (x) {} throw e; });
  }
  function waitIce(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(function (resolve) {
      var to = setTimeout(resolve, 2500);
      pc.onicegatheringstatechange = function () {
        if (pc.iceGatheringState === "complete") { clearTimeout(to); resolve(); }
      };
    });
  }
  // PFP on: only the in-DOM shield canvas stream (iOS WKWebView needs the canvas to stay in the document).
  // Never fall back to the raw camera while PFP is on.
  function coveredStream(id, rawStream, cache) {
    var Z = root.ZabPfp, on = !!(Z && Z.isOn && Z.isOn());
    if (on) {
      var cv = Z.shieldCanvas && Z.shieldCanvas(id);
      if (cv && typeof cv.captureStream === "function") {
        if (cache && cache.canvas === cv && cache.stream && cache.stream.getVideoTracks().some(function (t) { return t.readyState === "live"; })) return cache.stream;
        try { if (cache && cache.stream) cache.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        var st = cv.captureStream(24);
        if (cache) { cache.canvas = cv; cache.stream = st; }
        return st;
      }
      return null;
    }
    return rawStream || null;
  }
  function videoTrack(stream) { return (stream && stream.getVideoTracks && stream.getVideoTracks()[0]) || null; }
  function audioTrack(stream) { return (stream && stream.getAudioTracks && stream.getAudioTracks()[0]) || null; }
  var MATCH_CLOCK = "zdMatchClock:";
  function storeStart(code, ms) {
    try { if (code && ms) sessionStorage.setItem(MATCH_CLOCK + code, String(ms)); } catch (e) {}
  }
  function readStart(code) {
    try { var v = sessionStorage.getItem(MATCH_CLOCK + code); return v ? Number(v) : null; } catch (e) { return null; }
  }
  function matchStartMs(m, code, toMs) {
    if (!m) return null;
    if (m.status === "waiting") return null;
    var stored = readStart(code);
    if (stored) return stored;
    var t0 = null;
    if ((m.seq | 0) === 0 && m.turnAt != null) t0 = toMs ? toMs(m.turnAt) : m.turnAt;
    if (t0) storeStart(code, t0);
    return t0;
  }
  function matchClockText(m, code, now, toMs) {
    var WC = WashersClock || (root && root.WashersClock); if (!WC) return "0:00";
    if (!m || m.status === "waiting") return WC.format(0);
    var start = matchStartMs(m, code, toMs);
    var frozen = null;
    if (m.status === "finished" || m.status === "abandoned") {
      var end = toMs && m.updatedAt != null ? toMs(m.updatedAt) : now;
      if (start && end) frozen = Math.max(0, end - start);
    }
    if (start) storeStart(code, start);
    return WC.since(start, now, frozen);
  }
  function youtubeConfigured() {
    return fetch("/.netlify/functions/youtube-whip", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { configured: false }; });
  }
  var api = { pluginListen: pluginListen, prepareAudio: prepareAudio, getCamera: getCamera, listCameras: listCameras, startWhip: startWhip, gumConstraints: gumConstraints,
    coveredStream: coveredStream, videoTrack: videoTrack, audioTrack: audioTrack,
    matchStartMs: matchStartMs, matchClockText: matchClockText, storeStart: storeStart, youtubeConfigured: youtubeConfigured };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WashersLive = api;
})(typeof window !== "undefined" ? window : this);
