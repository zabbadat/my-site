// Screen Wake Lock for live walks: keeps the screen from idle-sleeping while a walk is active.
// No NoSleep video fallback (autoplay/battery quirks); unsupported phones get a one-time note instead.
(function (root) {
  const NOTE = "Keep the screen on while walking; this phone can't hold it awake.";
  function createWakeLock(opts) {
    opts = opts || {};
    const nav = opts.navigator || (typeof navigator !== "undefined" ? navigator : null);
    const doc = opts.document || (typeof document !== "undefined" ? document : null);
    const onNote = opts.onNote || function () {};
    let active = false, sentinel = null, noted = false, pending = null;
    const supported = () => !!(nav && nav.wakeLock && typeof nav.wakeLock.request === "function");
    function note() { if (!noted) { noted = true; try { onNote(NOTE); } catch (e) {} } }
    async function acquire() {
      if (!active || sentinel || pending) return false;
      if (!supported()) { note(); return false; }
      if (doc && doc.visibilityState && doc.visibilityState !== "visible") return false;
      try {
        pending = nav.wakeLock.request("screen");
        const s = await pending;
        pending = null;
        if (!active) { try { await s.release(); } catch (e) {} return false; }
        sentinel = s;
        if (s && s.addEventListener) s.addEventListener("release", () => { if (sentinel === s) sentinel = null; });
        return true;
      } catch (e) { pending = null; note(); return false; }
    }
    function onVis() { if (active && doc && doc.visibilityState === "visible") acquire(); }
    if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", onVis);
    return {
      start() { active = true; return acquire(); },
      async stop() {
        active = false;
        const s = sentinel; sentinel = null;
        if (s) { try { await s.release(); } catch (e) {} }
      },
      isActive: () => active,
      isHeld: () => !!sentinel,
      supported,
      _onVisibility: onVis,
    };
  }
  const api = { createWakeLock, NOTE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WakeLock = api;
})(typeof window !== "undefined" ? window : this);
