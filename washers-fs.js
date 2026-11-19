/* Washers full-screen camera: CSS fixed .cam-fs (same iOS-safe mode as plank / squats).
 * HUD reuses the arcade-strip scoreboard. Controls stay .btn / .btn.ghost.
 * Does not change pfp.js OPEN_IDS; the existing shield follows the video box. */
(function (root) {
  var FS = "cam-fs";
  var IDS = { play: "zmGame", cast: "zmLiveSlot", match: "zmCamBox", watch: "zlStage" };
  function el(id) { return (typeof document !== "undefined" && id) ? document.getElementById(id) : null; }
  function isOn(id) {
    var w = el(id);
    return !!(w && w.classList && w.classList.contains(FS));
  }
  function anyOn() {
    return Object.keys(IDS).some(function (k) { return isOn(IDS[k]); });
  }
  function enter(id) {
    var w = el(id); if (!w || !w.classList) return false;
    w.classList.add(FS);
    w.querySelectorAll(".washers-fs-strip").forEach(function (s) { s.hidden = false; });
    return true;
  }
  function exit(id) {
    var w = el(id); if (!w || !w.classList) return false;
    w.classList.remove(FS);
    w.querySelectorAll(".washers-fs-strip").forEach(function (s) { s.hidden = true; });
    return true;
  }
  function exitAll() {
    Object.keys(IDS).forEach(function (k) { exit(IDS[k]); });
  }
  function toggle(id) { return isOn(id) ? exit(id) : enter(id); }
  // Prefer the match game shell (pads + live controls stay on screen); else the live slot.
  function enterCast() {
    var game = el(IDS.play);
    if (game && !game.hidden) return enter(IDS.play);
    return enter(IDS.cast);
  }
  function exitCast() { exit(IDS.play); exit(IDS.cast); }
  function enterWatch() { return enter(IDS.watch); }
  function exitWatch() { return exit(IDS.watch); }
  function setText(node, text) { if (node) node.textContent = text; }
  // seats: [{ name, score }], clock already formatted (WashersLive.matchClockText). No steps.
  function paint(opts) {
    opts = opts || {};
    var clock = opts.clock == null ? "0:00" : String(opts.clock);
    var seats = Array.isArray(opts.seats) ? opts.seats : [];
    var strips = (typeof document !== "undefined") ? document.querySelectorAll(".washers-fs-strip") : [];
    for (var i = 0; i < strips.length; i++) {
      var s = strips[i];
      setText(s.querySelector("[data-fs-clock]"), clock);
      var cell0 = s.querySelector("[data-fs-cell='0']");
      var cell1 = s.querySelector("[data-fs-cell='1']");
      var a = seats[0] || { name: "Score", score: 0 };
      setText(s.querySelector("[data-fs-score='0']"), String(a.score == null ? 0 : a.score));
      setText(s.querySelector("[data-fs-lbl='0']"), a.name || "Score");
      if (cell1) {
        if (seats.length > 1) {
          cell1.hidden = false;
          var b = seats[1];
          setText(s.querySelector("[data-fs-score='1']"), String(b.score == null ? 0 : b.score));
          setText(s.querySelector("[data-fs-lbl='1']"), b.name || "Score");
        } else {
          cell1.hidden = true;
        }
      }
    }
  }
  var api = {
    CLASS: FS, IDS: IDS,
    enter: enter, exit: exit, exitAll: exitAll, toggle: toggle, isOn: isOn, anyOn: anyOn,
    enterCast: enterCast, exitCast: exitCast, enterWatch: enterWatch, exitWatch: exitWatch,
    paint: paint
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WashersFs = api;
})(typeof window !== "undefined" ? window : this);
