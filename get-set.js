/* 3-2-1 countdown for camera Start buttons (push Start set / Start session / Start challenge, Plank House).
 * Runs AFTER camera, pose model and calibration are ready; the clock starts when run() resolves true.
 * makeGetSet({ ms: 2000, speak, unlock, stop, schedule }) -> { unlock(), run(show, cancelled) -> Promise<bool>, cancel() }
 * Words "3", "2", "1" at 0 / 700 / 1400 ms of a 2000 ms window (offsets scale with ms); resolves at ms.
 * iOS: call unlock() synchronously inside the tap (cancel + silent volume-0 utterance) so later speech is allowed.
 * Speech is optional: missing or throwing speechSynthesis falls back to on-screen only, silently.
 */
(function (root) {
  var SPOKEN = ["3", "2", "1"];
  var SHOWN = ["3", "2", "1"];
  var AT = [0, 0.35, 0.7]; // fraction of the window
  function g() { return typeof window !== "undefined" ? window : root; }
  function utter(text, volume) {
    var w = g();
    if (!w || !w.speechSynthesis || typeof w.SpeechSynthesisUtterance !== "function") return;
    var u = new w.SpeechSynthesisUtterance(text); u.rate = 1.3; if (volume !== undefined) u.volume = volume;
    w.speechSynthesis.speak(u);
  }
  function defaultUnlock() { var w = g(); if (!w || !w.speechSynthesis) return; w.speechSynthesis.cancel(); utter(" ", 0); }
  function defaultSpeak(word) { utter(word); }
  function defaultStop() { var w = g(); if (w && w.speechSynthesis) w.speechSynthesis.cancel(); }
  function safe(f) { return function () { try { return f.apply(null, arguments); } catch (e) { /* on-screen only */ } }; }
  function makeGetSet(opts) {
    opts = opts || {};
    var ms = opts.ms || 2000;
    var speak = safe(opts.speak || defaultSpeak), unlock = safe(opts.unlock || defaultUnlock), stopSpeech = safe(opts.stop || defaultStop);
    var schedule = opts.schedule || function (f, d) { return setTimeout(f, d); };
    var offs = AT.map(function (f) { return Math.round(f * ms); }), runId = 0;
    return {
      ms: ms, offsets: offs.slice(), words: SPOKEN.slice(), labels: SHOWN.slice(),
      unlock: function () { unlock(); },
      run: function (show, cancelled) {
        var my = ++runId; cancelled = cancelled || function () { return false; };
        var dead = function () { return my !== runId || cancelled(); };
        return new Promise(function (resolve) {
          var step = function (i) {
            if (dead()) { stopSpeech(); return resolve(false); }
            try { show(SHOWN[i]); } catch (e) {}
            speak(SPOKEN[i]);
            if (i === SPOKEN.length - 1) return schedule(function () { if (dead()) { stopSpeech(); resolve(false); } else resolve(true); }, ms - offs[i]);
            schedule(function () { step(i + 1); }, offs[i + 1] - offs[i]);
          };
          step(0);
        });
      },
      cancel: function () { runId += 1; stopSpeech(); }
    };
  }
  var api = { makeGetSet: makeGetSet };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatGetSet = api;
})(this);
