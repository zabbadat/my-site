/* ZabbaDat day cutoff: every movement day (caps, boards, "today" tallies) runs on the America/New_York calendar date,
 * so everything resets at Eastern midnight, DST-safe (Intl). Same "YYYY-MM-DD" format the day keys already used.
 * Browser: window.ZabbadatEtDay. Node: require("./et-day.js"). Falls back to the device's local date if Intl lacks the zone. */
(function (root) {
  "use strict";
  var TZ = "America/New_York", fmt = null;
  try { fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }); } catch (e) { fmt = null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toMs(t) { return t instanceof Date ? t.getTime() : t == null ? Date.now() : Number(t); }
  function parts(t) {
    var ms = toMs(t);
    if (!fmt) { var l = new Date(ms); return { y: l.getFullYear(), m: l.getMonth() + 1, d: l.getDate(), h: l.getHours(), mi: l.getMinutes(), s: l.getSeconds() }; }
    var p = {}; fmt.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  }
  function key(t) { var p = parts(t); return p.y + "-" + pad(p.m) + "-" + pad(p.d); }
  function shortKey(t) { var p = parts(t); return p.y + "-" + p.m + "-" + p.d; }
  function offset(t) { var ms = toMs(t), p = parts(ms); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; }
  function startMs(t) {
    var p = parts(t), base = Date.UTC(p.y, p.m - 1, p.d);
    var guess = base - offset(t);
    return base - offset(guess);
  }
  function atHourMs(t, hour) {
    var mid = startMs(t), p = parts(mid);
    var h = hour == null ? 0 : Number(hour);
    var base = Date.UTC(p.y, p.m - 1, p.d, h, 0, 0);
    var guess = base - offset(mid);
    return base - offset(guess);
  }
  function keyAtHour(t, hour) {
    var ms = toMs(t), h = hour == null ? 0 : Number(hour);
    var p = parts(ms);
    if (p.h < h) return key(startMs(ms) - 12 * 3600 * 1000);
    return key(ms);
  }
  function nextAtHourMs(t, hour) {
    var ms = toMs(t), h = hour == null ? 0 : Number(hour);
    var todayAt = atHourMs(ms, h);
    if (ms < todayAt) return todayAt;
    return atHourMs(startMs(startMs(ms) + 28 * 3600 * 1000), h);
  }
  var api = { TZ: TZ, parts: parts, key: key, shortKey: shortKey, offset: offset, startMs: startMs,
    atHourMs: atHourMs, keyAtHour: keyAtHour, nextAtHourMs: nextAtHourMs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatEtDay = api;
})(typeof window !== "undefined" ? window : this);
