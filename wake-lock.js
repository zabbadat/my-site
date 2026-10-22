// Screen Wake Lock for live walks: keeps the screen from idle-sleeping while a walk is active.
// Fallback (only when navigator.wakeLock is missing or its request rejects): a NoSleep-style hidden,
// muted, playsinline, looping video (/walk-wake.mp4, no audio track). The one-time note shows only if both fail.
(function (root) {
  const NOTE = "Keep the screen on while walking; this phone can't hold it awake.";
  const VIDEO_SRC = "/walk-wake.mp4";
  // Default fallback: a 1px, opacity 0, muted inline looping video. Returns { play(): Promise, stop() }.
  function videoFallback(doc) {
    let v = null;
    return {
      play() {
        if (!doc || !doc.createElement || !doc.body) return Promise.reject(new Error("no document"));
        if (!v) {
          v = doc.createElement("video");
          v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
          ["muted", "playsinline", "webkit-playsinline", "loop", "disableremoteplayback"].forEach((a) => v.setAttribute(a, ""));
          v.setAttribute("aria-hidden", "true");
          v.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1";
          v.src = VIDEO_SRC;
          doc.body.appendChild(v);
        }
        try { return Promise.resolve(v.play()); } catch (e) { return Promise.reject(e); }
      },
      stop() {
        if (!v) return;
        try { v.pause(); v.removeAttribute("src"); if (v.load) v.load(); } catch (e) {}
        if (v.parentNode) v.parentNode.removeChild(v);
        v = null;
      },
    };
  }
  function createWakeLock(opts) {
    opts = opts || {};
    const nav = opts.navigator || (typeof navigator !== "undefined" ? navigator : null);
    const doc = opts.document || (typeof document !== "undefined" ? document : null);
    const onNote = opts.onNote || function () {};
    const makeFallback = opts.createFallback || (() => videoFallback(doc));
    let active = false, sentinel = null, noted = false, pending = null;
    let fb = null, fbOn = false, gen = 0;
    const supported = () => !!(nav && nav.wakeLock && typeof nav.wakeLock.request === "function");
    function note() { if (!noted) { noted = true; try { onNote(NOTE); } catch (e) {} } }
    // When the API is missing this runs synchronously inside start(), so play() stays in the Start tap's gesture.
    function startFallback() {
      if (!active) return Promise.resolve(false);
      if (fbOn) return Promise.resolve(true);
      const g = gen;
      try { if (!fb) fb = makeFallback(); } catch (e) { fb = null; }
      if (!fb) { note(); return Promise.resolve(false); }
      fbOn = true;
      let p; try { p = Promise.resolve(fb.play()); } catch (e) { p = Promise.reject(e); }
      return p.then(() => active && g === gen,
        () => { if (g === gen) { fbOn = false; try { fb.stop(); } catch (e) {} if (active) note(); } return false; });
    }
    function stopFallback() { if (fb) { try { fb.stop(); } catch (e) {} } fbOn = false; }
    async function acquire() {
      if (!active || sentinel || pending) return false;
      if (!supported()) return fbOn ? true : startFallback();
      if (doc && doc.visibilityState && doc.visibilityState !== "visible") return false;
      const g = gen;
      try {
        pending = nav.wakeLock.request("screen");
        const s = await pending;
        pending = null;
        if (!active || g !== gen) { try { await s.release(); } catch (e) {} return false; }
        sentinel = s;
        if (fbOn) stopFallback(); // API works again; drop the video
        if (s && s.addEventListener) s.addEventListener("release", () => { if (sentinel === s) sentinel = null; });
        return true;
      } catch (e) {
        pending = null;
        if (!active || g !== gen) return false;
        return startFallback();
      }
    }
    function onVis() {
      if (!active || !doc || doc.visibilityState !== "visible") return;
      if (fbOn && fb) { try { Promise.resolve(fb.play()).catch(() => {}); } catch (e) {} return; }
      acquire();
    }
    if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onVis);
    return {
      start() { active = true; return acquire(); },
      async stop() {
        active = false; gen++;
        stopFallback();
        const s = sentinel; sentinel = null;
        if (s) { try { await s.release(); } catch (e) {} }
      },
      isActive: () => active,
      isHeld: () => !!sentinel || fbOn,
      usingFallback: () => fbOn,
      supported,
      _onVisibility: onVis,
    };
  }
  const api = { createWakeLock, videoFallback, NOTE, VIDEO_SRC };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WakeLock = api;
})(typeof window !== "undefined" ? window : this);
