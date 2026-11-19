/* Voice scoring for Zabba Washers Live Match: on-device speech to Bank 5 / Shoot 3 / Box-bound 2 / Out 0.
 * Prefers the native ZabbaListen plugin (iOS SFSpeechRecognizer) when present, else the Web Speech API. (Android ZabbaSpeech is TTS — do not call it for scoring.)
 * Heard phrases are returned for an on-screen confirm; nothing is scored until the caller confirms.
 * Browser: window.WashersVoice. Node: require("./washers-voice.js").
 */
(function (root) {
  var POINTS = { 5: "Bank", 3: "Shoot", 2: "Box-bound", 0: "Out" };
  var RULES = [
    { pts: 5, re: /\b(bank|banking|banked|bank it|five|5)\b/ },
    { pts: 3, re: /\b(shoot|shot|cup|in the cup|three|3)\b/ },
    { pts: 2, re: /\b(box[-\s]?bound|box bound|box|leaner|two|2)\b/ },
    { pts: 0, re: /\b(out|outside|miss|missed|zero|0|nothing)\b/ }
  ];
  function normalize(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
  }
  function parseOne(w) {
    if (/^(bank|banking|banked|banker|five|5)$/.test(w)) return 5;
    if (/^(shoot|shot|cup|three|3)$/.test(w)) return 3;
    if (/^(box|box-bound|boxbound|leaner|two|2)$/.test(w)) return 2;
    if (/^(out|outside|miss|missed|zero|0|nothing)$/.test(w)) return 0;
    return null;
  }
  function parse(text) {
    var t = normalize(text);
    if (!t) return null;
    t = t.replace(/box\s+bound/g, "box-bound").replace(/in the cup/g, "bank");
    var last = null, words = t.split(" "), i, p;
    for (i = 0; i < words.length; i++) {
      p = parseOne(words[i]);
      if (p != null) last = { pts: p, points: p, label: POINTS[p], heard: words[i], text: t };
    }
    return last;
  }
  function hasWebSpeech(w) {
    w = w || root;
    return !!(w && (w.SpeechRecognition || w.webkitSpeechRecognition));
  }
  function nativePlugin(w) {
    w = w || root;
    try {
      var cap = w && w.Capacitor, names = ["ZabbaListen", "ZabbaSpeech"], i, p;
      for (i = 0; i < names.length; i++) {
        if (w && w[names[i]] && typeof w[names[i]].start === "function") return w[names[i]];
        p = cap && cap.Plugins && cap.Plugins[names[i]];
        if (p && typeof p.start === "function") return p;
      }
      if (cap && typeof cap.registerPlugin === "function") {
        p = cap.registerPlugin("ZabbaListen");
        if (p && typeof p.start === "function") return p;
      }
    } catch (e) {}
    return null;
  }
  // engine: 'native' | 'web' | 'none'
  function engine(w) {
    w = w || root;
    if (nativePlugin(w)) return "native";
    if (hasWebSpeech(w)) return "web";
    return "none";
  }
  function start(opts) {
    opts = opts || {};
    var w = opts.window || root;
    var onHeard = opts.onHeard || function () {};
    var onError = opts.onError || function () {};
    var plugin = nativePlugin(w);
    var rec = null, stopped = false;
    function emit(text) { var hit = parse(text); if (hit) onHeard(hit); }
    if (plugin) {
      var listen = plugin.start({ locale: "en-US", phrases: ["bank", "shoot", "box", "box-bound", "out", "five", "three", "two", "zero"] });
      Promise.resolve(listen).then(function (h) {
        rec = h || plugin;
        if (rec && rec.addListener) rec.addListener("result", function (ev) { if (!stopped) emit(ev && (ev.transcript || ev.text || ev)); });
      }).catch(onError);
      return { stop: function () { stopped = true; try { (rec && rec.stop ? rec : plugin).stop(); } catch (e) {} }, engine: "native" };
    }
    var Rec = w && (w.SpeechRecognition || w.webkitSpeechRecognition);
    if (!Rec) return { stop: function () {}, engine: "none" };
    rec = new Rec();
    rec.lang = "en-US"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = function (ev) {
      if (stopped || !ev || !ev.results) return;
      var i, t = "";
      for (i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i] && ev.results[i][0]) t += " " + ev.results[i][0].transcript;
      emit(t);
    };
    rec.onerror = function (e) { if (!stopped) onError(e); };
    rec.onend = function () { if (!stopped && rec && rec.start) { try { rec.start(); } catch (e) {} } };
    try { rec.start(); } catch (e) { onError(e); }
    return { stop: function () { stopped = true; try { rec.stop(); } catch (e) {} }, engine: "web" };
  }
  var api = { POINTS: POINTS, parse: parse, normalize: normalize, hasWebSpeech: hasWebSpeech, nativePlugin: nativePlugin, engine: engine, start: start };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WashersVoice = api;
})(typeof window !== "undefined" ? window : this);
