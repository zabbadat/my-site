/* ZabbaDat app bridge: does nothing in a normal browser. Inside the
   Capacitor app it mirrors personal bests to native storage and adds haptics
   when a plank hold ends. */
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  var BEST = "zabbadat-plank-best";
  function pushToday() {
    var n = 0, d = new Date(), E = window.ZabbadatEtDay, tail = "-" + (E ? E.shortKey() : d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate()); // Eastern day, same key format as index.html pushTotalKey
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf("zabbadat-push-total-") === 0 && k.slice(-tail.length) === tail) n = Math.max(n, Number(localStorage.getItem(k)) || 0);
    }
    return n;
  }
  function save(k, v) { try { P.Preferences && P.Preferences.set({ key: k, value: String(v) }); } catch (e) {} }
  function sync() {
    if (!P.Preferences) return;
    P.Preferences.get({ key: BEST }).then(function (r) {
      var nat = Number(r && r.value) || 0, loc = Number(localStorage.getItem(BEST)) || 0;
      if (nat > loc) { localStorage.setItem(BEST, String(nat)); } else if (loc > nat) save(BEST, loc);
    }).catch(function () {});
    save("zabbadat-push-today", pushToday());
  }
  var orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    orig.apply(this, arguments);
    if (this !== localStorage) return;
    if (k === BEST) {
      save(BEST, v);
      try { P.Haptics && P.Haptics.impact({ style: "HEAVY" }); } catch (e) {}
    } else if (String(k).indexOf("zabbadat-push-total-") === 0) save("zabbadat-push-today", pushToday());
  };
  sync();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) sync(); });
})();
