/* Shared elapsed-time clock for every Zabba Washers score display on zabbadat.com.
 * Format is m:ss, or h:mm:ss after an hour. Pure helper: no sensors, no network.
 * Browser: window.WashersClock. Node: require("./washers-clock.js").
 */
(function (root) {
  function pad(n) { return String(n).padStart(2, "0"); }
  function format(ms) {
    var t = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }
  function since(startMs, nowMs, frozenMs) {
    if (frozenMs != null && isFinite(frozenMs)) return format(frozenMs);
    if (startMs == null || !isFinite(startMs)) return format(0);
    var now = nowMs == null ? Date.now() : nowMs;
    return format(Math.max(0, now - startMs));
  }
  function create(nowFn) {
    var now = nowFn || function () { return Date.now(); };
    var startedAt = 0, accrued = 0, running = false, frozen = null;
    return {
      start: function (t) { if (running) return this; running = true; frozen = null; startedAt = t == null ? now() : t; return this; },
      stop: function (t) { if (!running) return this; accrued += Math.max(0, (t == null ? now() : t) - startedAt); running = false; return this; },
      freeze: function (t) { frozen = this.ms(t); running = false; return this; },
      reset: function () { startedAt = 0; accrued = 0; running = false; frozen = null; return this; },
      ms: function (t) {
        if (frozen != null) return frozen;
        return accrued + (running ? Math.max(0, (t == null ? now() : t) - startedAt) : 0);
      },
      text: function (t) { return format(this.ms(t)); },
      running: function () { return running && frozen == null; }
    };
  }
  var api = { format: format, since: since, create: create, pad: pad };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WashersClock = api;
})(typeof window !== "undefined" ? window : this);
