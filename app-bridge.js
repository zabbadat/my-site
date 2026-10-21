/* ZabbaDat app bridge: does nothing in a normal browser. Inside the
   Capacitor app it mirrors personal bests to native storage, adds haptics
   when a plank hold ends, and offers an opt-in daily practice reminder. */
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  var BEST = "zabbadat-plank-best";
  function pushToday() {
    var n = 0, d = new Date(), tail = "-" + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
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
  function reminderButton() {
    if (!P.LocalNotifications || document.getElementById("zdReminder")) return;
    var b = document.createElement("button");
    b.id = "zdReminder"; b.type = "button";
    b.style.cssText = "position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9999;padding:10px 14px;border-radius:20px;border:0;background:#222;color:#fff;font:14px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.4)";
    function label(on) { b.textContent = on ? "Daily reminder: on" : "Daily reminder: off"; b.setAttribute("aria-pressed", on ? "true" : "false"); }
    P.LocalNotifications.getPending().then(function (r) { label(r && r.notifications && r.notifications.some(function (n) { return n.id === 7001; })); }).catch(function () { label(false); });
    b.onclick = function () {
      if (b.getAttribute("aria-pressed") === "true") {
        P.LocalNotifications.cancel({ notifications: [{ id: 7001 }] }).then(function () { label(false); });
        return;
      }
      P.LocalNotifications.requestPermissions().then(function (p) {
        if (p.display !== "granted") { b.textContent = "Notifications blocked in Settings"; return; }
        return P.LocalNotifications.schedule({ notifications: [{ id: 7001, title: "ZabbaDat™", body: "Time for today's push-ups and plank. Beat your best!", schedule: { on: { hour: 18, minute: 0 }, allowWhileIdle: true } }] }).then(function () { label(true); });
      }).catch(function () {});
    };
    document.body.appendChild(b);
  }
  sync();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) sync(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reminderButton); else reminderButton();
})();
