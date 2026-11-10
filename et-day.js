/* ZabbaDat day cutoff: every movement day (caps, boards, "today" tallies) runs on the America/New_York calendar date,
 * so everything resets at Eastern midnight, DST-safe (Intl). Same "YYYY-MM-DD" format the day keys already used.
 * Browser: window.ZabbadatEtDay. Node: require("./et-day.js"). Falls back to the device's local date if Intl lacks the zone. */
(function (root) {
  "use strict";
  var TZ = "America/New_York", fmt = null;
  try { fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }); } catch (e) { fmt = null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toMs(t) { return t instanceof Date ? t.getTime() : t == null ? Date.now() : Number(t); }
  // { y, m (1-12), d, h, mi, s } of the Eastern wall clock at t (ms or Date; default now).
  function parts(t) {
    var ms = toMs(t);
    if (!fmt) { var l = new Date(ms); return { y: l.getFullYear(), m: l.getMonth() + 1, d: l.getDate(), h: l.getHours(), mi: l.getMinutes(), s: l.getSeconds() }; }
    var p = {}; fmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  }
  function key(t) { var p = parts(t); return p.y + "-" + pad(p.m) + "-" + pad(p.d); }          // "2026-11-10"
  function shortKey(t) { var p = parts(t); return p.y + "-" + p.m + "-" + p.d; }               // "2026-11-10" unpadded (push-up localStorage keys)
  // Eastern offset at t in ms (EST -5 h, EDT -4 h): Eastern wall clock read as UTC, minus t.
  function offset(t) { var ms = toMs(t), p = parts(ms); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; }
  // ms of the Eastern midnight that starts t's Eastern day.
  function startMs(t) {
    var p = parts(t), base = Date.UTC(p.y, p.m - 1, p.d);
    var guess = base - offset(t);
    return base - offset(guess);
  }
  var api = { TZ: TZ, parts: parts, key: key, shortKey: shortKey, offset: offset, startMs: startMs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatEtDay = api;
})(typeof window !== "undefined" ? window : this);
