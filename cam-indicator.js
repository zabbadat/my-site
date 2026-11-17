/* Camera-on indicator (Nov 17, owner): whenever a camera of THIS device is live (push-ups, plank, Gyatt Squats, TUT, the
 * Live self-view, Live Match, Go live, any later camera view), a small "Camera on" pill with a pulsing red dot sits in the
 * top-left corner of that camera view, on every platform (browser, iOS app, Android app), portrait and landscape. It goes
 * away the moment the camera stops (track ended / stream removed / view closed). Own cameras only: streams from
 * getUserMedia on this page, plus the known camera <video> ids; a remote player's video in Live Match never gets it.
 * If a camera is live but none of its views is on screen (e.g. a hidden preview), the pill shows fixed at the top-right of
 * the window instead. Visual only: it never touches the stream, the pose loops or the PFP face cover (it sits above them,
 * pointer-events none). Colours: white on near-black with a red dot (no green: the face-cover proof's test green is
 * G>180, R<90, B<90).
 */
(function (root) {
  "use strict";
  var IDS = ["camVid", "plankVid", "tbVid", "sqVid", "zlSelf", "zmCamVid"];
  var DOT = "#ff3b30", BG = "rgba(12,12,16,.86)", FG = "#ffffff";
  var CSS = ".cam-on-pill{position:absolute;z-index:6;pointer-events:none;display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 8px;border-radius:999px;" +
    "background:" + BG + ";color:" + FG + ";font:700 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.02em;border:1px solid rgba(255,255,255,.55);" +
    "box-shadow:0 1px 4px rgba(0,0,0,.45);white-space:nowrap;user-select:none;-webkit-user-select:none}" +
    ".cam-on-pill.cam-on-fixed{position:fixed;z-index:10050;top:calc(env(safe-area-inset-top,0px) + 8px);right:calc(env(safe-area-inset-right,0px) + 8px)}" +
    ".cam-on-dot{width:9px;height:9px;border-radius:50%;background:" + DOT + ";box-shadow:0 0 0 0 rgba(255,59,48,.7);animation:camOnPulse 1.4s ease-out infinite}" +
    "@keyframes camOnPulse{0%{box-shadow:0 0 0 0 rgba(255,59,48,.75);opacity:1}70%{box-shadow:0 0 0 7px rgba(255,59,48,0);opacity:.55}100%{box-shadow:0 0 0 0 rgba(255,59,48,0);opacity:1}}" +
    "@media (prefers-reduced-motion:reduce){.cam-on-dot{animation:none}}";
  var LABEL = "Camera on", INSET = 8, TICK = 300;

  // Pure: does this stream carry a live camera (video) track?
  function liveVideo(stream) {
    try {
      if (!stream || typeof stream.getVideoTracks !== "function") return false;
      var t = stream.getVideoTracks();
      for (var i = 0; i < t.length; i++) if (t[i] && t[i].readyState === "live" && t[i].enabled !== false) return true;
    } catch (e) {}
    return false;
  }
  var mine = []; // streams this page got from getUserMedia (own cameras)
  function isOwn(stream) { return !!stream && (stream._zabOwnCam === true || mine.indexOf(stream) >= 0); }
  // Pure-ish: should video v carry the pill? Own camera, live video track, laid out with a size, not hidden.
  function wants(v) {
    try {
      if (!v || !v.isConnected || v.hidden) return false;
      var s = v.srcObject; if (!liveVideo(s)) return false;
      if (!(IDS.indexOf(v.id) >= 0 || isOwn(s))) return false;
      return v.clientWidth > 0 && v.clientHeight > 0;
    } catch (e) { return false; }
  }
  function anyLive() { mine = mine.filter(liveVideo); return mine.length > 0; }

  var doc = root && root.document, pills = typeof Map === "function" ? new Map() : null, fixed = null, timer = null, styled = false;
  function style() { if (styled || !doc) return; styled = true; var st = doc.createElement("style"); st.id = "camOnCss"; st.textContent = CSS; (doc.head || doc.documentElement).appendChild(st); }
  function make(fix) {
    var p = doc.createElement("div"); p.className = "cam-on-pill" + (fix ? " cam-on-fixed" : ""); p.setAttribute("role", "status"); p.setAttribute("aria-live", "polite");
    var d = doc.createElement("span"); d.className = "cam-on-dot"; d.setAttribute("aria-hidden", "true");
    var t = doc.createElement("span"); t.className = "cam-on-txt"; t.textContent = LABEL;
    p.appendChild(d); p.appendChild(t); return p;
  }
  function place(p, v) {
    var L = v.offsetLeft + INSET, T = v.offsetTop + INSET;
    if (p._l !== L) { p.style.left = L + "px"; p._l = L; }
    if (p._t !== T) { p.style.top = T + "px"; p._t = T; }
  }
  function drop(p) { try { if (p && p.parentNode) p.parentNode.removeChild(p); } catch (e) {} }
  function sync() {
    if (!doc || !pills) return 0;
    try {
      style();
      var seen = new Set(), vids = doc.getElementsByTagName("video"), shown = 0;
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i]; if (!wants(v)) continue;
        seen.add(v); var p = pills.get(v);
        if (!p || p.parentNode !== v.parentNode) { drop(p); p = make(false); v.parentNode.insertBefore(p, v.nextSibling); pills.set(v, p); p._l = p._t = null; }
        place(p, v); shown++;
      }
      pills.forEach(function (p, v) { if (!seen.has(v)) { drop(p); pills.delete(v); } });
      var live = anyLive();
      if (!shown && live) { if (!fixed || !fixed.isConnected) { fixed = make(true); (doc.body || doc.documentElement).appendChild(fixed); } }
      else if (fixed) { drop(fixed); fixed = null; }
      var need = shown > 0 || live;
      if (need && !timer) timer = setInterval(sync, TICK);
      else if (!need && timer) { clearInterval(timer); timer = null; }
      return shown + (fixed ? 1 : 0);
    } catch (e) { return 0; }
  }
  // Tag every camera stream this page opens (own camera), and watch its tracks so the pill leaves the moment it stops.
  function wrapGum() {
    try {
      var md = root.navigator && root.navigator.mediaDevices;
      if (!md || typeof md.getUserMedia !== "function" || md.getUserMedia._zabCam) return;
      var orig = md.getUserMedia.bind(md);
      var w = function (c) {
        return orig(c).then(function (s) {
          try {
            if (liveVideo(s)) { s._zabOwnCam = true; mine.push(s); s.getTracks().forEach(function (t) { try { t.addEventListener("ended", sync); } catch (e) {} }); }
            if (s.addEventListener) { s.addEventListener("removetrack", sync); s.addEventListener("inactive", sync); }
            setTimeout(sync, 0);
          } catch (e) {}
          return s;
        });
      };
      w._zabCam = 1; md.getUserMedia = w;
      // track.stop() fires no "ended" event: catch it here so the pill goes at once
      var MT = root.MediaStreamTrack && root.MediaStreamTrack.prototype;
      if (MT && typeof MT.stop === "function" && !MT.stop._zabCam) { var st = MT.stop; MT.stop = function () { var r = st.apply(this, arguments); try { setTimeout(sync, 0); } catch (e) {} return r; }; MT.stop._zabCam = 1; }
    } catch (e) {}
  }
  var api = { liveVideo: liveVideo, wants: wants, sync: sync, IDS: IDS, LABEL: LABEL, COLORS: { dot: DOT, bg: BG, fg: FG }, CSS: CSS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (doc) {
    root.ZabCamOn = api;
    wrapGum();
    var ev = function () { setTimeout(sync, 0); };
    ["playing", "loadeddata", "emptied", "pause", "ended", "resize"].forEach(function (n) { doc.addEventListener(n, ev, true); }); // media events don't bubble: capture
    if (root.addEventListener) { root.addEventListener("resize", ev); root.addEventListener("orientationchange", ev); }
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", ev); else ev();
  }
})(typeof window !== "undefined" ? window : this);
