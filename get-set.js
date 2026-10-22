/* Get-set countdown for camera Start buttons (push Start set / Start challenge, Plank House).
 * makeGetSet({ ms: 2000, speak, schedule }) -> { run(show, cancelled) -> Promise<bool>, cancel() }
 * Words "Start", "get", "set" (shown "Start", "Get", "Set!") at 0 / 1000 / 1700 ms of a 2000 ms window
 * (offsets scale with ms). "set" at 1700 ms (rate 1.3, ~0.3 s long) finishes as run() resolves true at ms
 * and the clock starts.
 * The first word is spoken synchronously inside run() so iOS treats it as part of the tap.
 * Speech is optional: missing or throwing speechSynthesis falls back to visual only, silently.
 */
(function (root) {
  var SPOKEN = ["Start", "get", "set"];
  var SHOWN = ["Start", "Get", "Set!"];
  var AT = [0, 0.5, 0.85]; // fraction of the window
  function defaultSpeak(word, first) {
    try {
      var g = typeof window !== "undefined" ? window : root;
      if (!g || !g.speechSynthesis || typeof g.SpeechSynthesisUtterance !== "function") return;
      if (first) g.speechSynthesis.cancel();
      var u = new g.SpeechSynthesisUtterance(word); u.rate = 1.3;
      g.speechSynthesis.speak(u);
    } catch (e) { /* visual only */ }
  }
  function defaultStop() {
    try { var g = typeof window !== "undefined" ? window : root; if (g && g.speechSynthesis) g.speechSynthesis.cancel(); } catch (e) {}
  }
  function makeGetSet(opts) {
    opts = opts || {};
    var ms = opts.ms || 2000;
    var speak = opts.speak || defaultSpeak, stopSpeech = opts.stop || defaultStop;
    var schedule = opts.schedule || function (f, d) { return setTimeout(f, d); };
    var offs = AT.map(function (f) { return Math.round(f * ms); }), runId = 0;
    function say(w, first) { try { speak(w, first); } catch (e) {} }
    return {
      ms: ms, offsets: offs.slice(), words: SPOKEN.slice(), labels: SHOWN.slice(),
      run: function (show, cancelled) {
        var my = ++runId; cancelled = cancelled || function () { return false; };
        var dead = function () { return my !== runId || cancelled(); };
        return new Promise(function (resolve) {
          var step = function (i) {
            if (dead()) { stopSpeech(); return resolve(false); }
            try { show("Get set \u2014 " + SHOWN[i]); } catch (e) {}
            say(SPOKEN[i], i === 0);
            if (i === SPOKEN.length - 1) return schedule(function () { if (dead()) { stopSpeech(); resolve(false); } else resolve(true); }, ms - offs[i]);
            schedule(function () { step(i + 1); }, offs[i + 1] - offs[i]);
          };
          step(0); // synchronous: first word inside the tap
        });
      },
      cancel: function () { runId += 1; stopSpeech(); }
    };
  }
  var api = { makeGetSet: makeGetSet };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ZabbadatGetSet = api;
})(this);
