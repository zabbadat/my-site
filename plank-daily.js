/* Zabbadat Plank Press sets: pure logic (no DOM, no Firestore).
 * - A completed camera hold >= MIN_SET_SEC counts as one set.
 * - Per-day history kept on the phone (localStorage), one entry per local date.
 * - Today's board: rank sets desc, then totalSec desc. */
(function (root) {
  "use strict";
  var MIN_SET_SEC = 10, CAP = { sets: 100, totalSec: 14400, bestSec: 7200 }, KEY = "zabbadat-plank-days";
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function localDateKey(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function docId(uid, date) { return uid + "_" + date; }
  function holdSec(ms) { var s = Math.floor((Number(ms) || 0) / 1000); return s > 0 ? s : 0; }
  function countsAsSet(ms) { return holdSec(ms) >= MIN_SET_SEC; }
  function empty(date) { return { date: date, sets: 0, totalSec: 0, bestSec: 0 }; }
  // Add one hold to a day entry. Returns a new entry (unchanged if the hold is too short).
  function addHold(day, ms) {
    var d = { date: day.date, sets: day.sets | 0, totalSec: day.totalSec | 0, bestSec: day.bestSec | 0 }, s = holdSec(ms);
    if (s < MIN_SET_SEC) return d;
    d.sets = Math.min(CAP.sets, d.sets + 1);
    d.totalSec = Math.min(CAP.totalSec, d.totalSec + s);
    d.bestSec = Math.min(CAP.bestSec, d.totalSec, Math.max(d.bestSec, s));
    return d;
  }
  function readDays(store) { try { var v = JSON.parse(store.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function getDay(store, date) { var days = readDays(store); for (var i = 0; i < days.length; i++) if (days[i].date === date) return days[i]; return empty(date); }
  function putDay(store, day) {
    var days = readDays(store).filter(function (x) { return x && x.date !== day.date; });
    days.push(day); days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    store.setItem(KEY, JSON.stringify(days.slice(-60)));
  }
  function recordHold(store, ms, date) { var day = addHold(getDay(store, date || localDateKey()), ms); putDay(store, day); return day; }
  function lastDays(store, n) { return readDays(store).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, n || 7); }
  function rankDaily(rows, date, n) {
    return (rows || []).filter(function (r) { return r && r.date === date && Number(r.sets) > 0; })
      .map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return Number(b.r.sets) - Number(a.r.sets) || Number(b.r.totalSec) - Number(a.r.totalSec) || a.i - b.i; })
      .slice(0, n || 50).map(function (x) { return x.r; });
  }
  function buildRecord(o) {
    return { name: String(o.name || "Player").slice(0, 40), xHandle: o.xHandle ? ("@" + String(o.xHandle).replace(/^@/, "")).slice(0, 21) : "",
      uid: o.uid, date: o.date, sets: o.sets | 0, totalSec: o.totalSec | 0, bestSec: o.bestSec | 0,
      source: "camera", sessionStartedAt: Math.round(Number(o.sessionStartedAt)) };
  }
  function validateRecord(r, id) {
    var ok = r && typeof r.uid === "string" && r.uid && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && id === docId(r.uid, r.date)
      && r.name.length > 0 && r.name.length <= 40 && r.source === "camera" && isFinite(r.sessionStartedAt) && r.sessionStartedAt > 0
      && r.sets > 0 && r.sets <= CAP.sets && r.totalSec > 0 && r.totalSec <= CAP.totalSec
      && r.bestSec > 0 && r.bestSec <= CAP.bestSec && r.bestSec <= r.totalSec && r.bestSec * r.sets >= r.totalSec;
    return { ok: !!ok };
  }
  var api = { MIN_SET_SEC: MIN_SET_SEC, CAP: CAP, KEY: KEY, localDateKey: localDateKey, docId: docId, holdSec: holdSec, countsAsSet: countsAsSet,
    empty: empty, addHold: addHold, readDays: readDays, getDay: getDay, putDay: putDay, recordHold: recordHold, lastDays: lastDays,
    rankDaily: rankDaily, buildRecord: buildRecord, validateRecord: validateRecord };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatPlankDaily = api;
})(typeof self !== "undefined" ? self : this);
